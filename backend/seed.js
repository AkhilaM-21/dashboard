/**
 * Seeds backend/data/users.json with mock subscribers.
 * Run with: npm run seed
 */
const crypto = require('crypto');
const User = require('./models/User.mock');
const { validatePan } = require('./validators');

const PLANS = [
  { name: 'Basic Monthly', price: 999, durationMinutes: 43200 },
  { name: 'Pro Quarterly', price: 2499, durationMinutes: 129600 },
  { name: 'Elite Yearly', price: 8999, durationMinutes: 525600 },
  { name: 'Trial Pass', price: 99, durationMinutes: 60 },
];

const PEOPLE = [
  ['Akhila Menon', 'akhila.menon@example.com', '9845012345', 'Karnataka'],
  ['Rohit Sharma', 'rohit.sharma@example.com', '9820098200', 'Maharashtra'],
  ['Priya Nair', 'priya.nair@example.com', '9847011122', 'Kerala'],
  ['Vikram Reddy', 'vikram.reddy@example.com', '9908877665', 'Telangana'],
  ['Sneha Patel', 'sneha.patel@example.com', '9925544332', 'Gujarat'],
  ['Arjun Iyer', 'arjun.iyer@example.com', '9884433221', 'Tamil Nadu'],
  ['Meera Joshi', 'meera.joshi@example.com', '9822233445', 'Maharashtra'],
  ['Karthik Rao', 'karthik.rao@example.com', '9886655443', 'Karnataka'],
  ['Ananya Bose', 'ananya.bose@example.com', '9831122334', 'West Bengal'],
  ['Sameer Khan', 'sameer.khan@example.com', '9811223344', 'Delhi'],
  ['Divya Pillai', 'divya.pillai@example.com', '9846677889', 'Kerala'],
  ['Nikhil Verma', 'nikhil.verma@example.com', '9873344556', 'Uttar Pradesh'],
];

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const objectId = (secondsAgo) =>
  Math.floor((Date.now() - secondsAgo * 1000) / 1000).toString(16).padStart(8, '0') +
  crypto.randomBytes(8).toString('hex');

// Build a structurally valid PAN: 3-letter series, entity type 'P' (individual),
// surname initial, 4 digits, check letter.
const PAN_SERIES = ['AAB', 'ABC', 'AFZ', 'BKP', 'CQR', 'DLM', 'EPS', 'FGH', 'HJK', 'LMN', 'PQR', 'TUV'];

const panFor = (name, i) => {
  const parts = name.trim().split(/\s+/);
  const surnameInitial = (parts[parts.length - 1] || name)[0].toUpperCase();
  const series = PAN_SERIES[i % PAN_SERIES.length];
  const digits = String(1000 + i * 137).slice(0, 4);
  const check = String.fromCharCode(65 + (i * 5) % 26);
  return `${series}P${surnameInitial}${digits}${check}`;
};

const gstinFor = (i) => (i % 3 === 0 ? `29AAACB${2000 + i}K1Z${i % 10}` : undefined);

const rows = PEOPLE.map(([fullName, email, phone, state], i) => {
  const plan = PLANS[i % PLANS.length];

  // Spread signups over the last ~40 days
  const createdAt = new Date(Date.now() - (i * 3 + 1) * DAY - i * 37 * MINUTE);
  const expiry = new Date(createdAt.getTime() + plan.durationMinutes * MINUTE);

  // Every 4th user is already expired; the rest are active
  const expired = i % 4 === 3;
  const subscriptionExpiryDate = expired
    ? new Date(Date.now() - (i + 1) * DAY)
    : new Date(Math.max(expiry.getTime(), Date.now() + (i + 2) * DAY));

  // Most users have completed Telegram verification
  const joinedTelegram = i % 3 !== 2;

  return {
    _id: objectId((PEOPLE.length - i) * 3600),
    fullName,
    email,
    phone,
    panCard: panFor(fullName, i),
    ...(gstinFor(i) ? { gstin: gstinFor(i) } : {}),
    state,
    dob: new Date(1985 + (i % 15), i % 12, ((i * 7) % 27) + 1).toISOString(),
    selectedPlan: { ...plan },
    amountPaid: plan.price,
    paymentStatus: expired ? 'Expired' : 'Paid',
    subscriptionStartDate: createdAt.toISOString(),
    subscriptionExpiryDate: subscriptionExpiryDate.toISOString(),
    telegramInviteLink: joinedTelegram
      ? `https://t.me/+mock${crypto.randomBytes(6).toString('hex')}`
      : 'PENDING_VERIFICATION',
    isTelegramLinkUsed: joinedTelegram,
    ...(joinedTelegram ? { telegramUserId: String(700000000 + i * 13711) } : {}),
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
  };
});

// Mock data has to satisfy the same rules the API enforces.
const badPans = rows
  .map((r) => ({ pan: r.panCard, check: validatePan(r.panCard) }))
  .filter((x) => !x.check.valid);

if (badPans.length) {
  console.error('Seed aborted - generated invalid PANs:');
  badPans.forEach((x) => console.error(`  ${x.pan}: ${x.check.error}`));
  process.exit(1);
}

User._replaceAll(rows).then((count) => {
  const active = rows.filter((r) => r.paymentStatus === 'Paid').length;
  const revenue = rows.reduce((sum, r) => sum + r.amountPaid, 0);
  console.log(`Seeded ${count} mock users -> ${User._dataFile}`);
  console.log(`  Active: ${active} | Expired: ${count - active} | Revenue: Rs.${revenue.toLocaleString('en-IN')}`);
});
