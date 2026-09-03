const crypto = require('crypto');
require('dotenv').config();

const HMAC_SECRET = process.env.HMAC_SECRET || 'insecure_dev_hmac_secret_change_me';

if (!process.env.HMAC_SECRET) {
  console.warn('[hmac] WARNING: HMAC_SECRET is not set in .env — using an insecure fallback.');
}

/**
 * FR-024: cryptographic signature = HMAC-SHA256(fileHash + approverSecretKey), appended as metadata.
 * We use the file's own SHA-256 hash (not the raw bytes) as the HMAC message so it stays cheap
 * to recompute for verification without re-reading the whole file.
 */
function computeSignatureHmac(fileHash, timestampIso) {
  return crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(`${fileHash}|${timestampIso}`)
    .digest('hex');
}

module.exports = { computeSignatureHmac };
