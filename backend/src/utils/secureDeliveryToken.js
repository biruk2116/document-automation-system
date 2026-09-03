const crypto = require('crypto');

const SECURE_LINK_EXPIRY_DAYS = 7; // matches the existing delivery_logs download-link expiry

/**
 * Generates the raw, cryptographically random secure-link token (256 bits of
 * entropy — crypto.randomInt/randomBytes are CSPRNG-backed) and the SHA-256 hash
 * of it that actually gets persisted.
 *
 * Only the HASH is ever stored in document_deliveries.secure_token_hash — same
 * defense-in-depth pattern already used for users.reset_token in this codebase
 * (see authController.requestPasswordReset). A database read/leak alone can never
 * yield a token usable to open a delivery; the raw value only ever exists in the
 * one-time email sent to the recipient and in the URL the browser holds.
 */
function generateSecureToken() {
  const rawToken = crypto.randomBytes(32).toString('hex'); // 64 hex chars, 256 bits
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function tokenExpiryDate() {
  return new Date(Date.now() + SECURE_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/** Opaque public identifier embedded in a generated PDF's verification QR code. */
function generateVerificationId() {
  return crypto.randomBytes(16).toString('hex'); // 32 hex chars, 128 bits — unguessable, unrelated to doc_uuid/hash
}

module.exports = {
  generateSecureToken,
  hashToken,
  tokenExpiryDate,
  generateVerificationId,
  SECURE_LINK_EXPIRY_DAYS,
};
