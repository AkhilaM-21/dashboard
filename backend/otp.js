/**
 * Phone verification by SMS one-time password.
 *
 * Sends through Twilio when TWILIO_* is configured; otherwise runs in dev mode
 * where the code is logged to the console and returned in the API response, so
 * the flow is testable without an SMS account.
 *
 * State is persisted to data/otp.json so a nodemon restart mid-signup doesn't
 * force the user to request a new code.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'data', 'otp.json');

const CODE_TTL_MS = 5 * 60 * 1000;        // code is valid for 5 minutes
const VERIFIED_TTL_MS = 30 * 60 * 1000;   // verified phone may register for 30 minutes
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;
const smsConfigured = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER);

let twilioClient = null;
if (smsConfigured) {
  twilioClient = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

// --- storage ---------------------------------------------------------------

const read = () => {
  try {
    const state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { pending: state.pending || {}, verified: state.verified || {} };
  } catch {
    return { pending: {}, verified: {} };
  }
};

const write = (state) => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
};

/** Drops anything past its expiry so the file doesn't grow forever. */
const prune = (state, now) => {
  for (const [phone, entry] of Object.entries(state.pending)) {
    if (entry.expiresAt <= now) delete state.pending[phone];
  }
  for (const [phone, expiresAt] of Object.entries(state.verified)) {
    if (expiresAt <= now) delete state.verified[phone];
  }
  return state;
};

const key = (phone) => String(phone).replace(/\D/g, '').slice(-10);

// --- api -------------------------------------------------------------------

/** 6 digits, uniformly random. */
const generateCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

const sendSms = async (phone, code) => {
  const text = `Your Tradotsav verification code is ${code}. It expires in 5 minutes.`;

  if (!twilioClient) {
    console.log(`[OTP] SMS not configured - code for ${phone} is ${code}`);
    return { delivered: false, code };
  }

  await twilioClient.messages.create({
    body: text,
    from: TWILIO_PHONE_NUMBER,
    to: phone.startsWith('+') ? phone : `+91${key(phone)}`,
  });
  console.log(`[OTP] SMS sent to ${phone}`);
  return { delivered: true };
};

async function requestCode(phone) {
  const now = Date.now();
  const state = prune(read(), now);
  const id = key(phone);

  const existing = state.pending[id];
  if (existing && now - existing.sentAt < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - existing.sentAt)) / 1000);
    return { ok: false, error: `Please wait ${wait}s before requesting another code.` };
  }

  const code = generateCode();
  state.pending[id] = { code, expiresAt: now + CODE_TTL_MS, sentAt: now, attempts: 0 };
  write(state);

  const result = await sendSms(phone, code);

  return {
    ok: true,
    // Only exposed when SMS isn't wired up — lets you test without Twilio.
    devCode: result.delivered ? undefined : code,
    smsConfigured,
  };
}

function verifyCode(phone, code) {
  const now = Date.now();
  const state = prune(read(), now);
  const id = key(phone);
  const entry = state.pending[id];

  if (!entry) {
    return { ok: false, error: 'No code was sent to this number, or it expired. Request a new one.' };
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    delete state.pending[id];
    write(state);
    return { ok: false, error: 'Too many incorrect attempts. Request a new code.' };
  }

  if (String(code).trim() !== entry.code) {
    entry.attempts += 1;
    write(state);
    const left = MAX_ATTEMPTS - entry.attempts;
    return { ok: false, error: `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` };
  }

  delete state.pending[id];
  state.verified[id] = now + VERIFIED_TTL_MS;
  write(state);

  return { ok: true };
}

/** True while the phone's verification is still fresh enough to register with. */
function isVerified(phone) {
  const now = Date.now();
  const state = prune(read(), now);
  write(state);
  return Boolean(state.verified[key(phone)]);
}

/** Called after a successful registration so the proof can't be replayed. */
function consumeVerification(phone) {
  const state = read();
  delete state.verified[key(phone)];
  write(state);
}

module.exports = { requestCode, verifyCode, isVerified, consumeVerification, smsConfigured };
