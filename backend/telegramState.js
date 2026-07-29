/**
 * Persists the Telegram getUpdates offset across restarts.
 *
 * Telegram keeps unconfirmed updates for ~24h and re-delivers them to any
 * poller that asks with a low offset. Holding the offset only in memory means
 * every restart (nodemon reloads on each file save) replays the backlog and
 * re-sends messages the user already received.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'telegram-state.json');

const read = () => {
  try {
    const state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
};

const write = (state) => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
};

module.exports = {
  file: FILE,

  /** @returns {number|null} null when this is the first ever run. */
  getLastUpdateId() {
    const { lastUpdateId } = read();
    return Number.isInteger(lastUpdateId) ? lastUpdateId : null;
  },

  setLastUpdateId(id) {
    write({ ...read(), lastUpdateId: id, updatedAt: new Date().toISOString() });
  },

  /**
   * Remembers every group/channel the bot sees. Telegram invite links can't be
   * resolved to a numeric chat_id via the API, so this is how a new channel
   * gets discovered: add the bot, send a message, read the id from here.
   */
  recordChat(chat) {
    const state = read();
    const chats = state.chats || {};

    chats[chat.id] = {
      id: chat.id,
      type: chat.type,
      title: chat.title || chat.username || null,
      seenAt: new Date().toISOString(),
    };

    write({ ...state, chats });
  },

  getChats() {
    return Object.values(read().chats || {});
  },
};
