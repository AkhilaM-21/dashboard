require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const { validatePan, validatePhone } = require('./validators');
const telegramState = require('./telegramState');
const otp = require('./otp');

// --- DATABASE ---
// DB_MODE=mock uses a local JSON file (backend/data/users.json) instead of
// MongoDB, so the app runs with no Atlas cluster. Set DB_MODE=mongo (and a
// valid MONGO_URI) to switch back.
const USE_MOCK_DB = process.env.DB_MODE === 'mock' || !process.env.MONGO_URI;
const User = USE_MOCK_DB ? require('./models/User.mock') : require('./models/User');

const app = express();

// Wide open by default for local dev. In production set CORS_ORIGIN to your
// frontend's URL (comma-separated for more than one) so other sites can't
// drive this API.
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors(
  allowedOrigins.length
    ? { origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)) }
    : {}
));
if (allowedOrigins.length) console.log(`[INIT] CORS restricted to: ${allowedOrigins.join(', ')}`);

app.use(express.json());

// Render (and most hosts) ping a URL to check the service is alive
app.get('/api/health', (req, res) => res.json({ ok: true, mode: USE_MOCK_DB ? 'mock' : 'mongo' }));

// Serve the built frontend from this same service when it's present, so the
// whole app runs on one URL (and same-origin requests need no CORS at all).
// Absent in local dev, where Vite serves the frontend on its own port.
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
const SERVE_FRONTEND = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));

if (SERVE_FRONTEND) {
  app.use(express.static(FRONTEND_DIST));
  console.log(`[INIT] Serving frontend from ${FRONTEND_DIST}`);
}

if (USE_MOCK_DB) {
  console.log(`[DB] Mock mode - using local file store: ${User._dataFile}`);
} else {
  mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));
}

// --- TELEGRAM CONFIG ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
// Defaults to on; set REQUIRE_PHONE_VERIFICATION=false to hand out the invite
// link as soon as the user opens the bot.
const REQUIRE_PHONE_VERIFICATION = process.env.REQUIRE_PHONE_VERIFICATION !== 'false';

console.log(
  REQUIRE_PHONE_VERIFICATION
    ? '[INIT] Phone verification ON - user must share their contact (button only shows in the Telegram MOBILE app)'
    : '[INIT] Phone verification OFF - /start hands out the join link immediately'
);

// Surface missing config at boot — otherwise the first symptom is a subscriber
// being sent to the wrong place.
if (!TELEGRAM_BOT_TOKEN) console.error('[INIT] WARNING: TELEGRAM_BOT_TOKEN is not set - registrations will be refused.');
if (!CHANNEL_ID) console.error('[INIT] WARNING: CHANNEL_ID is not set - registrations will be refused.');
if (TELEGRAM_BOT_TOKEN && CHANNEL_ID) console.log(`[INIT] Channel: ${CHANNEL_ID}`);

let BOT_USERNAME = '';
// Fetch Bot Username on Startup
if (TELEGRAM_BOT_TOKEN) {
  axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`)
    .then(res => {
      BOT_USERNAME = res.data.result.username;
      console.log(`[INIT] Bot Username: ${BOT_USERNAME}`);
    })
    .catch(err => console.error("[INIT] Failed to fetch bot username:", err.message));
}

/**
 * Creates a single-use invite to the channel.
 *
 * Returns null rather than a placeholder URL when it can't: t.me resolves any
 * unknown path as a username, so a made-up link doesn't fail — it sends the
 * subscriber into a stranger's channel, which is far worse than an error.
 */
const generateOneTimeLink = async () => {
  if (!TELEGRAM_BOT_TOKEN || !CHANNEL_ID) {
    console.error(
      `[TELEGRAM] Cannot create an invite - ${!TELEGRAM_BOT_TOKEN ? 'TELEGRAM_BOT_TOKEN' : 'CHANNEL_ID'} is not set. ` +
      `Set it in your host's environment variables.`
    );
    return null;
  }

  try {
    // member_limit: 1 ensures the link works only once
    const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createChatInviteLink`, {
      chat_id: CHANNEL_ID,
      member_limit: 1, 
      expire_date: Math.floor(Date.now() / 1000) + (86400 * 7) // Link valid for 7 days to join
    });
    return response.data.result.invite_link;
  } catch (error) {
    const detail = error.response?.data?.description || error.message;
    console.error(`[TELEGRAM] createChatInviteLink failed for chat ${CHANNEL_ID}: ${detail}`);
    console.error('[TELEGRAM] Check CHANNEL_ID is the numeric id (npm run chat-id) and the bot is an admin with "Invite Users via Link".');
    return null;
  }
};

// --- API ROUTES ---

// 0a. Send a verification code to the phone number
app.post('/api/send-otp', async (req, res) => {
  try {
    const phone = validatePhone(req.body.phone);
    if (!phone.valid) return res.status(400).json({ field: 'phone', error: phone.error });

    const result = await otp.requestCode(phone.phone);
    if (!result.ok) return res.status(429).json({ field: 'phone', error: result.error });

    res.json({
      message: result.smsConfigured ? 'Code sent by SMS.' : 'SMS not configured - showing the code here for testing.',
      devCode: result.devCode,
      smsConfigured: result.smsConfigured,
    });
  } catch (error) {
    console.error('[OTP] send failed:', error.message);
    res.status(500).json({ error: 'Could not send the verification code.' });
  }
});

// 0b. Check the code the user typed
app.post('/api/verify-otp', (req, res) => {
  const phone = validatePhone(req.body.phone);
  if (!phone.valid) return res.status(400).json({ field: 'phone', error: phone.error });

  const result = otp.verifyCode(phone.phone, req.body.code);
  if (!result.ok) return res.status(400).json({ field: 'code', error: result.error });

  res.json({ message: 'Phone verified.' });
});

// 1. Register User & Simulate Payment Success
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, email, phone, panCard, gstin, state, dob, plan } = req.body;

    // Validate PAN before touching the database. The browser checks this too,
    // but that can be bypassed by posting straight to the API.
    const pan = validatePan(panCard);
    if (!pan.valid) {
      return res.status(400).json({ field: 'panCard', error: pan.error });
    }

    const phoneCheck = validatePhone(phone);
    if (!phoneCheck.valid) {
      return res.status(400).json({ field: 'phone', error: phoneCheck.error });
    }

    // The number must have been proved by OTP first — otherwise anyone could
    // post straight to this endpoint and claim someone else's phone.
    if (!otp.isVerified(phoneCheck.phone)) {
      return res.status(400).json({
        field: 'phone',
        error: 'Please verify your phone number before registering.'
      });
    }

    // Calculate Expiry based on plan duration
    const startDate = new Date();
    const expiryDate = new Date();
    expiryDate.setMinutes(startDate.getMinutes() + plan.durationMinutes);

    // Phone is already proven, so issue the channel invite now. The link is
    // single-use and unique to this user; when they join, the chat_member
    // update tells us their Telegram id so expiry can remove them later.
    const inviteLink = await generateOneTimeLink();
    if (!inviteLink) {
      // Better to reject than to record a paid subscriber we can't let in.
      return res.status(503).json({
        error: 'Could not create your channel invite. Nothing has been charged — please try again shortly.'
      });
    }

    const newUser = new User({
      fullName,
      email,
      phone: phoneCheck.phone,
      panCard: pan.pan, // normalized: uppercase, no spaces/dashes
      gstin,
      state,
      dob,
      selectedPlan: plan,
      amountPaid: plan.totalAmount,
      paymentStatus: 'Paid',
      subscriptionStartDate: startDate,
      subscriptionExpiryDate: expiryDate,
      telegramInviteLink: inviteLink
    });

    await newUser.save();
    otp.consumeVerification(phoneCheck.phone);

    res.status(201).json({
      message: "Registration successful",
      link: inviteLink,
      registrationId: newUser._id,
      expiresAt: expiryDate
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 1b. Status of one registration — lets the success page tell when the invite
// has actually been used, so a spent link is never left on screen.
// Deliberately returns only what that page needs; no PAN, email or phone.
app.get('/api/registration/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Registration not found.' });

    const joined = Boolean(user.isTelegramLinkUsed);

    res.json({
      fullName: user.fullName,
      planName: user.selectedPlan?.name,
      joined,
      status: user.paymentStatus,
      expiresAt: user.subscriptionExpiryDate,
      // Once used the link is dead — don't hand it back out.
      link: joined ? null : user.telegramInviteLink
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Admin Dashboard Data
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- SUBSCRIPTION LIFECYCLE ---

// How long before expiry to warn the user. Capped per-user at a quarter of the
// plan length, so a 5-minute test plan doesn't fire its warning at purchase.
const EXPIRY_WARNING_MINUTES = Number(process.env.EXPIRY_WARNING_MINUTES || 1440);

const sendTelegramMessage = (chatId, text, extra = {}) =>
  axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    chat_id: chatId,
    text,
    ...extra
  });

const formatDuration = (ms) => {
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes && !days) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  return parts.join(' ');
};

const warningWindowMs = (user) => {
  const planMinutes = user.selectedPlan?.durationMinutes || 0;
  return Math.min(EXPIRY_WARNING_MINUTES, planMinutes * 0.25) * 60000;
};

/** DMs subscribers whose plan is about to run out. Sends once per subscription. */
const notifyExpiringSoon = async (now) => {
  if (!TELEGRAM_BOT_TOKEN) return;

  const active = await User.find({ paymentStatus: 'Paid' });

  for (const user of active) {
    if (!user.telegramUserId || user.expiryWarningSent) continue;

    const remaining = new Date(user.subscriptionExpiryDate).getTime() - now.getTime();
    if (remaining <= 0 || remaining > warningWindowMs(user)) continue;

    try {
      await sendTelegramMessage(
        user.telegramUserId,
        `Hi ${user.fullName}, your "${user.selectedPlan?.name}" plan expires in ${formatDuration(remaining)}.\n\n` +
        `You'll be removed from the channel when it does. Renew on the website to stay in.`
      );
      user.expiryWarningSent = true;
      await user.save();
      console.log(`[CRON] Sent expiry warning to ${user.fullName} (${formatDuration(remaining)} left)`);
    } catch (err) {
      console.error(`[CRON] Could not warn ${user.fullName}:`, err.response?.data?.description || err.message);
    }
  }
};

// --- CRON JOB (Runs Every Minute for Testing) ---
// Checks for expired subscriptions and removes users from Telegram
cron.schedule('* * * * *', async () => {
  console.log(`[CRON] Checking for expired subscriptions at ${new Date().toLocaleTimeString()}...`);
  const today = new Date();

  await notifyExpiringSoon(today);

  // Find expired users who are marked as Paid
  const expiredUsers = await User.find({
    subscriptionExpiryDate: { $lt: today },
    paymentStatus: 'Paid'
  });

  if (expiredUsers.length > 0) {
      console.log(`[CRON] Found ${expiredUsers.length} expired users.`);
  }

  for (const user of expiredUsers) {
    // 1. Mark as Expired in Database (Do this regardless of Bot status)
    user.paymentStatus = 'Expired';
    await user.save();
    console.log(`[CRON] Subscription expired for: ${user.fullName} (ID: ${user._id})`);

    // 2. Attempt to remove from Telegram (Only if Bot & UserID exist)
    if (TELEGRAM_BOT_TOKEN && user.telegramUserId) {
      // Tell them before the kick — otherwise they just silently vanish from
      // the channel with no idea why.
      try {
        await sendTelegramMessage(
          user.telegramUserId,
          `Your "${user.selectedPlan?.name}" plan has expired, ${user.fullName}.\n\n` +
          `You've been removed from the channel. Renew on the website and you'll get a fresh join link.`
        );
      } catch (err) {
        console.error(`[CRON] Could not notify ${user.fullName} of removal:`, err.response?.data?.description || err.message);
      }

      try {
        console.log(`[CRON] Kicking Telegram User ID: ${user.telegramUserId} from Channel: ${CHANNEL_ID}`);

        // Kick user from channel (Ban)
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/banChatMember`, {
          chat_id: CHANNEL_ID,
          user_id: user.telegramUserId
        });
        
        // Unban immediately so they can rejoin if they renew
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/unbanChatMember`, {
          chat_id: CHANNEL_ID,
          user_id: user.telegramUserId
        });

        console.log(`[CRON] Successfully removed user ${user.fullName} from Telegram.`);
      } catch (err) {
        const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
        console.error(`[CRON] Failed to remove user ${user.fullName} from Telegram. Error: ${errMsg}`);
      }
    } else {
      console.log(`[CRON] Skipping Telegram removal for ${user.fullName}. Reason: ${!user.telegramUserId ? 'No Telegram User ID linked' : 'Bot Token missing'}`);
    }
  }
});

/** Last 10 digits — strips country codes and formatting before comparing. */
const nationalNumber = (value = '') => String(value).replace(/\D/g, '').slice(-10);

// --- HELPER: Handle Private Bot Messages ---
const handlePrivateMessage = async (message) => {
  const chatId = message.chat.id;
  const text = message.text;
  const contact = message.contact;

  // Bare /start typed by hand carries no user id, so there's nothing to look up.
  if (text && text.trim() === '/start') {
    return await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: "Please register on the website first, then open the link it gives you - it carries your account details."
    });
  }

  // 1. Handle /start <USER_ID>
  if (text && text.startsWith('/start ')) {
    const userIdParam = text.split(' ')[1].trim();
    
    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(userIdParam)) {
      return await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId, text: "Invalid link. Please register again."
      });
    }

    const user = await User.findById(userIdParam);
    if (!user) {
      return await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId, text: "User not found. Please register on the website."
      });
    }

    // Expired subscriptions shouldn't hand out channel invites — without this
    // an old link still works, and the user joins only to be kicked minutes later.
    const expiresAt = new Date(user.subscriptionExpiryDate).getTime();
    if (user.paymentStatus === 'Expired' || expiresAt <= Date.now()) {
      return await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: `Your "${user.selectedPlan?.name}" plan has expired, ${user.fullName}.\n\nPlease register again on the website to get a new link.`
      });
    }

    // Already verified? Resend the link — but only to the account that claimed
    // this registration, otherwise anyone with the URL could collect the link.
    if (user.telegramInviteLink && user.telegramInviteLink.startsWith('http')) {
      if (String(user.telegramUserId) !== chatId.toString()) {
        console.log(`[TELEGRAM] Blocked ${chatId} from reusing ${user.fullName}'s registration (owned by ${user.telegramUserId})`);
        return await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: "❌ This registration is already linked to a different Telegram account.\n\nPlease register on the website with your own details.",
          reply_markup: { remove_keyboard: true }
        });
      }

      return await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: `You're already verified, ${user.fullName}.\n\nTap below to join.`,
        reply_markup: { inline_keyboard: [[{ text: 'Join Channel', url: user.telegramInviteLink }]] }
      });
    }

    user.telegramUserId = chatId.toString();

    // Straight to the link. The request_contact button below only renders in
    // the Telegram mobile apps - on Web/Desktop it hides behind a keyboard
    // icon most users never find, which dead-ends the whole flow.
    if (!REQUIRE_PHONE_VERIFICATION) {
      const inviteLink = await generateOneTimeLink();
      user.telegramInviteLink = inviteLink;
      await user.save();

      return await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: `Welcome ${user.fullName}!\n\nTap below to join the channel. This link works once and is tied to your account.`,
        reply_markup: {
          inline_keyboard: [[{ text: 'Join Channel', url: inviteLink }]]
        }
      });
    }

    // Ask for Contact
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: `Welcome ${user.fullName}! \n\nTo prevent unauthorized access, please verify your phone number by clicking the button below.\n\nIf you don't see a button, open this chat in the Telegram mobile app.`,
      reply_markup: {
        keyboard: [[{ text: "📱 Verify Phone Number", request_contact: true }]],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
    
    // telegramUserId was set above; persist it so the contact reply can find
    // this user even if the phone formats differ slightly.
    await user.save();
  }

  // 2. Handle Contact Sharing
  if (contact) {
    // A contact card can belong to anyone — Telegram sets contact.user_id to
    // the owner's account. Without this check, someone holding the link could
    // forward the registered person's contact and pass verification.
    if (!contact.user_id || contact.user_id !== message.from?.id) {
      return await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: "❌ That's someone else's contact.\n\nUse the \"Verify Phone Number\" button to share your own number.",
        reply_markup: { remove_keyboard: true }
      });
    }

    // Find user by the Telegram User ID (saved in step 1)
    const user = await User.findOne({ telegramUserId: chatId.toString() });

    if (user) {
      // Compare the last 10 digits so "+91 98765 43210" and "9876543210" match.
      // The old substring test was far too loose — a short registered number
      // was contained in, and so matched, almost anything.
      const regPhone = nationalNumber(user.phone);
      const telePhone = nationalNumber(contact.phone_number);

      if (regPhone.length === 10 && regPhone === telePhone) {
        // MATCH! Generate Link
        const inviteLink = await generateOneTimeLink();
        
        user.telegramInviteLink = inviteLink;
        await user.save();

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: `✅ Verification Successful!\n\nTap below to join the channel. This link works once.`,
          reply_markup: { inline_keyboard: [[{ text: 'Join Channel', url: inviteLink }]] }
        });
      } else {
        // MISMATCH
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: `❌ Verification Failed.\n\nRegistered Phone: XXXXXX${regPhone.slice(-4)}\nTelegram Phone: XXXXXX${telePhone.slice(-4)}\n\nPlease join using the Telegram account linked to your registered mobile number.`,
          reply_markup: { remove_keyboard: true }
        });
      }
    } else {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: "Session expired or user not found. Please click the registration link again.",
        reply_markup: { remove_keyboard: true }
      });
    }
  }
};

// --- TELEGRAM POLLING (Capture User ID on Join) ---
// The offset is persisted (see telegramState.js). Keeping it in memory meant
// every restart replayed Telegram's backlog and re-sent old welcome messages.
let lastUpdateId = telegramState.getLastUpdateId();

/**
 * First ever run: jump past whatever is already queued instead of processing
 * a day's worth of stale updates.
 */
const skipBacklog = async () => {
  const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`, {
    offset: -1,
    timeout: 0
  });

  const updates = response.data.result || [];
  lastUpdateId = updates.length ? updates[updates.length - 1].update_id : 0;
  telegramState.setLastUpdateId(lastUpdateId);
  console.log(`[TELEGRAM] No saved offset - skipping backlog, resuming after update_id ${lastUpdateId}`);
};

const pollTelegramUpdates = async () => {
  if (!TELEGRAM_BOT_TOKEN) return;
  // Telegram allows one poller per token; set this to run a second instance
  // (e.g. to exercise the cron) without a 409 conflict.
  if (process.env.DISABLE_TELEGRAM_POLLING === 'true') {
    console.log('[TELEGRAM] Polling disabled via DISABLE_TELEGRAM_POLLING');
    return;
  }

  try {
    if (lastUpdateId === null) await skipBacklog();

    // Long polling for updates to see who joins
    const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`, {
      offset: lastUpdateId + 1,
      timeout: 10,
      allowed_updates: ["chat_member", "message", "my_chat_member"]
    });

    const updates = response.data.result;
    if (updates && updates.length > 0) {
      for (const update of updates) {
        try {
          await handleUpdate(update);
        } catch (err) {
          // Advance past a message we can't handle rather than retrying forever
          console.error(`[TELEGRAM] Failed to handle update ${update.update_id}:`, err.message);
        }

        lastUpdateId = update.update_id;
        telegramState.setLastUpdateId(lastUpdateId);
      }
    }
  } catch (error) {
    const status = error.response?.status;
    const description = error.response?.data?.description || error.message;

    if (status === 409) {
      console.error(
        '[TELEGRAM] Conflict: another process is already polling this bot token. ' +
        'Only one server may run at a time - stop the other instance.'
      );
    } else if (!/timeout/i.test(description)) {
      console.error('[TELEGRAM] Poll error:', description);
    }
  }

  // Poll again
  setTimeout(pollTelegramUpdates, 1000);
};

/**
 * Telegram invite links (https://t.me/+hash) can't be resolved to a numeric
 * chat_id through the API, so we note the id of every group/channel the bot
 * sees. Add the bot to a group, send a message there, and the id shows up in
 * the console and in data/telegram-state.json.
 */
const noteChat = (update) => {
  const chat =
    update.message?.chat ||
    update.channel_post?.chat ||
    update.my_chat_member?.chat ||
    update.chat_member?.chat;

  if (!chat || chat.type === 'private') return;

  telegramState.recordChat(chat);

  if (String(chat.id) !== String(CHANNEL_ID)) {
    console.log(`[TELEGRAM] Saw ${chat.type} "${chat.title || chat.id}" - chat_id: ${chat.id}`);
    console.log(`[TELEGRAM] Not the configured channel. To use it: set CHANNEL_ID=${chat.id} in backend/.env`);
  }
};

const handleUpdate = async (update) => {
  noteChat(update);

  // Handle Private Messages (Verification Flow)
  if (update.message) {
    await handlePrivateMessage(update.message);
  }

  // Check for new member joins via invite link
  if (update.chat_member && update.chat_member.new_chat_member.status === 'member') {
    const inviteLinkObj = update.chat_member.invite_link;
    const tUserId = update.chat_member.new_chat_member.user.id;
    const tUserName = update.chat_member.new_chat_member.user.first_name;

    console.log(`[TELEGRAM] Join Event Detected. User: ${tUserName} (${tUserId})`);

    if (inviteLinkObj && inviteLinkObj.invite_link) {
      console.log(`[TELEGRAM] Joined via link: ${inviteLinkObj.invite_link}`);
      // Find user by the specific link they used
      const user = await User.findOne({ telegramInviteLink: inviteLinkObj.invite_link });
      if (user) {
        user.telegramUserId = tUserId.toString();
        user.isTelegramLinkUsed = true;
        await user.save();
        console.log(`[TELEGRAM] >>> SUCCESS: Linked Telegram ID ${tUserId} to User ${user.fullName}`);
      } else {
        console.log(`[TELEGRAM] Warning: No database record found for invite link ${inviteLinkObj.invite_link}`);
      }
    } else {
      console.log(`[TELEGRAM] User joined without specific invite link (or public link). Cannot link to DB user.`);
    }
  }
};

// Start the poller
pollTelegramUpdates();

// Anything that isn't an API call goes to the SPA. Registered last so it can't
// shadow the routes above.
if (SERVE_FRONTEND) {
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
