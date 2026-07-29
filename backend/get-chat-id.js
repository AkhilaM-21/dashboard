/**
 * Discovers the numeric chat_id of a group/channel your bot has been added to.
 *
 * Telegram invite links (https://t.me/+abc123...) can't be resolved to an ID
 * via the API — the bot has to see an update from the chat. So:
 *
 *   1. Stop the backend (only one process may poll a bot token at a time).
 *   2. Add the bot to the group and promote it to admin, with at least
 *      "Invite Users via Link" and "Ban Users" permissions.
 *   3. Run:  npm run chat-id
 *   4. Send any message in the group while it's listening.
 *
 * Then copy the printed ID into backend/.env as CHANNEL_ID.
 *
 * Note: updates consumed here are not delivered to the server afterwards, so
 * don't run this while real users are registering.
 */
require('dotenv').config();
const axios = require('axios');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECONDS = Number(process.argv[2]) || 60;

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is missing from backend/.env');
  process.exit(1);
}

const api = (method, body) =>
  axios.post(`https://api.telegram.org/bot${TOKEN}/${method}`, body).then((r) => r.data.result);

// Every update type that carries a chat object we care about
const chatFrom = (update) =>
  update.message?.chat ||
  update.channel_post?.chat ||
  update.my_chat_member?.chat ||
  update.chat_member?.chat ||
  update.chat_join_request?.chat ||
  null;

const seen = new Map();

const report = async (chat) => {
  if (seen.has(chat.id)) return;
  seen.set(chat.id, chat);

  const label = chat.title || chat.username || chat.first_name || '(no title)';
  console.log(`\n  ${chat.type.toUpperCase()}: ${label}`);
  console.log(`  chat_id: ${chat.id}`);

  if (chat.type === 'private') {
    console.log('  (this is a direct message, not a group — skip it)');
    return;
  }

  // Confirm the bot can actually do what the app needs
  try {
    const me = await api('getMe');
    const member = await api('getChatMember', { chat_id: chat.id, user_id: me.id });
    const canInvite = member.status === 'creator' || member.can_invite_users;
    const canBan = member.status === 'creator' || member.can_restrict_members;

    console.log(`  bot status: ${member.status}`);
    console.log(`  ${canInvite ? 'OK  ' : 'MISSING'} invite users via link  (needed for one-time join links)`);
    console.log(`  ${canBan ? 'OK  ' : 'MISSING'} ban users               (needed to remove expired subscribers)`);

    if (canInvite && canBan) {
      console.log(`\n  --> Put this in backend/.env:   CHANNEL_ID=${chat.id}`);
    } else {
      console.log('\n  --> Fix the missing permissions in the group admin settings, then re-run.');
    }
  } catch (err) {
    console.log(`  Could not read bot permissions: ${err.response?.data?.description || err.message}`);
  }
};

(async () => {
  const me = await api('getMe').catch((err) => {
    console.error('Bad bot token:', err.response?.data?.description || err.message);
    process.exit(1);
  });

  console.log(`Listening as @${me.username} for ${SECONDS}s...`);
  console.log('Send any message in the group now (or add the bot to it).\n');

  const deadline = Date.now() + SECONDS * 1000;
  let offset = 0;

  while (Date.now() < deadline) {
    let updates;
    try {
      updates = await api('getUpdates', {
        offset,
        timeout: 5,
        allowed_updates: ['message', 'channel_post', 'my_chat_member', 'chat_member', 'chat_join_request'],
      });
    } catch (err) {
      const status = err.response?.status;
      if (status === 409) {
        console.error('Conflict: the backend is still running. Stop it first, then re-run this.');
        process.exit(1);
      }
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      const chat = chatFrom(update);
      if (chat) await report(chat);
    }
  }

  const groups = [...seen.values()].filter((c) => c.type !== 'private');
  if (!groups.length) {
    console.log('\nNo group/channel updates seen.');
    console.log('Make sure the bot was added to the group, then send a message there and re-run.');
  }
  process.exit(0);
})();
