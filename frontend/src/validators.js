/**
 * PAN card validation.
 *
 * Format (10 chars): AAAAA9999A
 *   1-3  : alphabetic series
 *   4    : entity type (see ENTITY_TYPES)
 *   5    : first letter of surname (individual) or entity name
 *   6-9  : 4 digits
 *   10   : alphabetic check character
 *
 * Keep this in sync with backend/validators.js.
 */

export const PAN_LENGTH = 10;
export const PHONE_LENGTH = 10;

/** Digits only, capped at 10 — strips a leading +91 as it's typed. */
export const formatPhone = (value = '') => {
  const digits = String(value).replace(/\D/g, '');
  return (digits.length > PHONE_LENGTH ? digits.slice(-PHONE_LENGTH) : digits);
};

/** Indian mobile: 10 digits starting 6-9. Mirrors backend/validators.js. */
export function validatePhone(value) {
  const phone = formatPhone(value);

  if (!phone) return { valid: false, error: 'Phone number is required.', phone };
  if (phone.length !== PHONE_LENGTH) {
    return { valid: false, error: `Enter a 10-digit mobile number (got ${phone.length} digits).`, phone };
  }
  if (!/^[6-9]/.test(phone)) {
    return { valid: false, error: 'Indian mobile numbers start with 6, 7, 8 or 9.', phone };
  }

  return { valid: true, error: null, phone };
}

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const ENTITY_TYPES = {
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
export const cleanPan = (value = '') =>
  String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Input-field helper: same as cleanPan but capped at PAN_LENGTH. */
export const formatPan = (value = '') => cleanPan(value).slice(0, PAN_LENGTH);

/**
 * @returns {{ valid: boolean, error: string|null, entity: string|null }}
 */
export function validatePan(value) {
  // Validate the untruncated value so an over-long PAN is rejected, not trimmed.
  const pan = cleanPan(value || '');

  if (!pan) {
    return { valid: false, error: 'PAN card number is required.', entity: null };
  }

  if (pan.length !== PAN_LENGTH) {
    return {
      valid: false,
      error: `PAN must be exactly ${PAN_LENGTH} characters (got ${pan.length}).`,
      entity: null,
    };
  }

  if (!PAN_REGEX.test(pan)) {
    // Point at the specific position that's wrong rather than a generic message
    const head = pan.slice(0, 5);
    const digits = pan.slice(5, 9);
    const tail = pan.slice(9);

    if (!/^[A-Z]{5}$/.test(head)) {
      return { valid: false, error: 'First 5 characters must be letters.', entity: null };
    }
    if (!/^[0-9]{4}$/.test(digits)) {
      return { valid: false, error: 'Characters 6-9 must be digits.', entity: null };
    }
    if (!/^[A-Z]$/.test(tail)) {
      return { valid: false, error: 'Last character must be a letter.', entity: null };
    }
    return { valid: false, error: 'Invalid PAN format. Example: ABCPE1234F', entity: null };
  }

  const entity = ENTITY_TYPES[pan[3]];
  if (!entity) {
    return {
      valid: false,
      error: `"${pan[3]}" is not a valid 4th character. It must be one of ${Object.keys(ENTITY_TYPES).join(', ')}.`,
      entity: null,
    };
  }

  return { valid: true, error: null, entity };
}
