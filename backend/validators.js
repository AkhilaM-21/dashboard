/**
 * PAN card validation (server-side).
 *
 * Mirrors frontend/src/validators.js — the browser check is for UX, this one
 * is the one that actually protects the database. Keep the two in sync.
 */

const PAN_LENGTH = 10;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const ENTITY_TYPES = {
  A: 'Association of Persons',
  B: 'Body of Individuals',
  C: 'Company',
  F: 'Firm / LLP',
  G: 'Government',
  H: 'Hindu Undivided Family',
  J: 'Artificial Juridical Person',
  L: 'Local Authority',
  P: 'Individual',
  T: 'Trust',
};

/** Uppercase and drop separators (spaces, dashes) — but never truncate. */
const cleanPan = (value = '') =>
  String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Input-field helper: same as cleanPan but capped at PAN_LENGTH. */
const formatPan = (value = '') => cleanPan(value).slice(0, PAN_LENGTH);

function validatePan(value) {
  // Validate the untruncated value so an over-long PAN is rejected, not trimmed.
  const pan = cleanPan(value || '');

  if (!pan) return { valid: false, error: 'PAN card number is required.', pan, entity: null };

  if (pan.length !== PAN_LENGTH) {
    return {
      valid: false,
      error: `PAN must be exactly ${PAN_LENGTH} characters (got ${pan.length}).`,
      pan,
      entity: null,
    };
  }

  if (!PAN_REGEX.test(pan)) {
    return { valid: false, error: 'Invalid PAN format. Expected 5 letters, 4 digits, 1 letter (e.g. ABCPE1234F).', pan, entity: null };
  }

  const entity = ENTITY_TYPES[pan[3]];
  if (!entity) {
    return {
      valid: false,
      error: `"${pan[3]}" is not a valid PAN entity type. Expected one of: ${Object.keys(ENTITY_TYPES).join(', ')}.`,
      pan,
      entity: null,
    };
  }

  return { valid: true, error: null, pan, entity };
}

/**
 * Indian mobile number: 10 digits starting 6-9, ignoring a +91 / 0 prefix.
 * Needed for OTP delivery and for matching against the Telegram account.
 */
function validatePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;

  if (!local) return { valid: false, error: 'Phone number is required.', phone: '' };
  if (local.length !== 10) {
    return { valid: false, error: `Enter a 10-digit mobile number (got ${local.length} digits).`, phone: local };
  }
  if (!/^[6-9]/.test(local)) {
    return { valid: false, error: 'Indian mobile numbers start with 6, 7, 8 or 9.', phone: local };
  }

  return { valid: true, error: null, phone: local };
}

module.exports = { validatePan, formatPan, cleanPan, validatePhone, ENTITY_TYPES, PAN_LENGTH };
