/**
 * File-backed drop-in replacement for the Mongoose `User` model.
 *
 * Data lives in backend/data/users.json so it survives server restarts.
 * Only the slice of the Mongoose API that server.js actually uses is
 * implemented: find/findOne/findById, cursor .sort(), and doc.save().
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

// --- Storage ---------------------------------------------------------------

let docs = [];

const load = () => {
  try {
    docs = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(docs)) docs = [];
  } catch {
    docs = [];
  }
};

const persist = () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(docs, null, 2));
};

load();

// 24-char hex so mongoose.Types.ObjectId.isValid() still accepts it
const newObjectId = () =>
  Math.floor(Date.now() / 1000).toString(16).padStart(8, '0') +
  crypto.randomBytes(8).toString('hex');

// --- Query matching --------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

// Make dates and date-like strings comparable with <, >, ===
const norm = (v) => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' && ISO_DATE.test(v)) return new Date(v).getTime();
  return v;
};

const matchesCondition = (value, cond) => {
  const isOperator =
    cond !== null &&
    typeof cond === 'object' &&
    !(cond instanceof Date) &&
    Object.keys(cond).some((k) => k.startsWith('$'));

  if (!isOperator) return norm(value) === norm(cond);

  return Object.entries(cond).every(([op, target]) => {
    const a = norm(value);
    const b = norm(target);
    switch (op) {
      case '$lt': return a < b;
      case '$lte': return a <= b;
      case '$gt': return a > b;
      case '$gte': return a >= b;
      case '$ne': return a !== b;
      case '$in': return (target || []).map(norm).includes(a);
      case '$exists': return (value !== undefined && value !== null) === !!target;
      default: throw new Error(`User.mock: unsupported query operator "${op}"`);
    }
  });
};

const matches = (doc, query = {}) =>
  Object.entries(query).every(([field, cond]) => matchesCondition(doc[field], cond));

const applySort = (rows, spec) => {
  if (!spec) return rows;
  const entries = Object.entries(spec);
  return [...rows].sort((x, y) => {
    for (const [field, dir] of entries) {
      const a = norm(x[field]);
      const b = norm(y[field]);
      if (a === b) continue;
      if (a === undefined) return 1;
      if (b === undefined) return -1;
      return (a < b ? -1 : 1) * (dir === -1 || dir === 'desc' ? -1 : 1);
    }
    return 0;
  });
};

// --- Document --------------------------------------------------------------

const DEFAULTS = {
  paymentStatus: 'Pending',
  isTelegramLinkUsed: false,
};

class UserDoc {
  constructor(data = {}) {
    Object.assign(this, DEFAULTS, data);
  }

  async save() {
    const now = new Date().toISOString();

    if (!this._id) {
      this._id = newObjectId();
      this.createdAt = now;
    }
    this.updatedAt = now;

    const raw = JSON.parse(JSON.stringify(this)); // Dates -> ISO strings
    const i = docs.findIndex((d) => d._id === this._id);
    if (i === -1) docs.push(raw);
    else docs[i] = raw;

    persist();
    return this;
  }
}

const hydrate = (raw) => (raw ? new UserDoc(raw) : null);

// --- Cursor (so `User.find().sort({...})` works) ---------------------------

const cursor = (getRows) => {
  let sortSpec = null;
  const exec = async () => applySort(getRows(), sortSpec).map(hydrate);

  const api = {
    sort(spec) { sortSpec = spec; return api; },
    then(onOk, onErr) { return exec().then(onOk, onErr); },
    catch(onErr) { return exec().catch(onErr); },
    finally(fn) { return exec().finally(fn); },
    exec,
  };
  return api;
};

// --- Model -----------------------------------------------------------------

const User = Object.assign(UserDoc, {
  find(query = {}) {
    return cursor(() => docs.filter((d) => matches(d, query)));
  },

  async findOne(query = {}) {
    return hydrate(docs.find((d) => matches(d, query)));
  },

  async findById(id) {
    return hydrate(docs.find((d) => d._id === String(id)));
  },

  async countDocuments(query = {}) {
    return docs.filter((d) => matches(d, query)).length;
  },

  /** Test/seed helper — not part of the Mongoose API. */
  async _replaceAll(rows) {
    docs = rows.map((r) => JSON.parse(JSON.stringify(r)));
    persist();
    return docs.length;
  },

  get _dataFile() {
    return DATA_FILE;
  },
});

module.exports = User;
