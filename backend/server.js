require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const User = require('./models/User');

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log('MongoDB Connected'))
.catch(err => console.error('MongoDB Connection Error:', err));

// --- TELEGRAM CONFIG ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID; 

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

// Helper: Generate One-Time Link
const generateOneTimeLink = async () => {
  if (!TELEGRAM_BOT_TOKEN || !CHANNEL_ID) {
    console.log("Bot not configured. Returning placeholder link.");
    return "https://t.me/your_channel_link"; // Replace with your static channel link if needed
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
    console.error("Telegram API Error:", error.response ? error.response.data : error.message);
    return "https://t.me/demo_fallback_link"; // Return a dummy link so the UI doesn't break
  }
};

// --- API ROUTES ---

// 1. Register User & Simulate Payment Success
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, email, phone, panCard, gstin, state, dob, plan } = req.body;

    // Calculate Expiry based on plan duration
    const startDate = new Date();
    const expiryDate = new Date();
    expiryDate.setMinutes(startDate.getMinutes() + plan.durationMinutes);

    // Generate Bot Verification Link instead of direct Channel Link
    // This forces the user to go through the bot to verify their number
    const newUser = new User({
      fullName, 
      email, 
      phone, 
      panCard, 
      gstin, 
      state, 
      dob,
      selectedPlan: plan,
      amountPaid: plan.totalAmount,
      paymentStatus: 'Paid', 
      subscriptionStartDate: startDate,
      subscriptionExpiryDate: expiryDate,
      telegramInviteLink: "PENDING_VERIFICATION" // Will be updated after bot verification
    });

    const savedUser = await newUser.save();
    
    // Link to the bot with the User ID as a parameter
    const botLink = `https://t.me/${BOT_USERNAME}?start=${savedUser._id}`;

    res.status(201).json({ message: "Registration successful", link: botLink });
  } catch (error) {
    console.error(error);
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

// --- CRON JOB (Runs Every Minute for Testing) ---
// Checks for expired subscriptions and removes users from Telegram
cron.schedule('* * * * *', async () => {
  console.log(`[CRON] Checking for expired subscriptions at ${new Date().toLocaleTimeString()}...`);
  const today = new Date();
  
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

// --- HELPER: Handle Private Bot Messages ---
const handlePrivateMessage = async (message) => {
  const chatId = message.chat.id;
  const text = message.text;
  const contact = message.contact;

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

    // Ask for Contact
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: `Welcome ${user.fullName}! \n\nTo prevent unauthorized access, please verify your phone number by clicking the button below.`,
      reply_markup: {
        keyboard: [[{ text: "📱 Verify Phone Number", request_contact: true }]],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
    
    // Temporarily store chatId if needed, or just rely on contact update finding the user by phone logic?
    // Better: We rely on the user sending the contact next.
    // We can update the user record with the potential telegramUserId now to help matching later if phone formats differ slightly.
    user.telegramUserId = chatId.toString(); 
    await user.save();
  }

  // 2. Handle Contact Sharing
  if (contact) {
    // Find user by the Telegram User ID (saved in step 1)
    const user = await User.findOne({ telegramUserId: chatId.toString() });
    
    if (user) {
      // Normalize phones (remove non-digits)
      const regPhone = user.phone.replace(/\D/g, '');
      const telePhone = contact.phone_number.replace(/\D/g, '');

      // Check if numbers match (handling country codes loosely)
      if (telePhone.includes(regPhone) || regPhone.includes(telePhone)) {
        // MATCH! Generate Link
        const inviteLink = await generateOneTimeLink();
        
        user.telegramInviteLink = inviteLink;
        await user.save();

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: `✅ Verification Successful!\n\nHere is your unique link to join the channel:\n${inviteLink}`,
          reply_markup: { remove_keyboard: true }
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
let lastUpdateId = 0;
const pollTelegramUpdates = async () => {
  if (!TELEGRAM_BOT_TOKEN) return;
  
  try {
    // Long polling for updates to see who joins
    const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`, {
      offset: lastUpdateId + 1,
      timeout: 10,
      allowed_updates: ["chat_member", "message"]
    });

    const updates = response.data.result;
    if (updates && updates.length > 0) {
      for (const update of updates) {
        lastUpdateId = update.update_id;

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
              await user.save();
              console.log(`[TELEGRAM] >>> SUCCESS: Linked Telegram ID ${tUserId} to User ${user.fullName}`);
            } else {
                console.log(`[TELEGRAM] Warning: No database record found for invite link ${inviteLinkObj.invite_link}`);
            }
          } else {
              console.log(`[TELEGRAM] User joined without specific invite link (or public link). Cannot link to DB user.`);
          }
        }
      }
    }
  } catch (error) {
    // Ignore timeouts or network blips
  }
  
  // Poll again
  setTimeout(pollTelegramUpdates, 1000);
};

// Start the poller
pollTelegramUpdates();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
