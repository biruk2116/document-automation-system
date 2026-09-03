const crypto = require('crypto');
require('dotenv').config();

// Secret used to encrypt external-database connection passwords at rest (see
// externalDbController.js). Deliberately its OWN env var — never reuse HMAC_SECRET/
// JWT_SECRET for a different cryptographic purpose. Same "warn, don't crash" pattern
// as hmac.js so local dev keeps working, but production should always set this.
const RAW_KEY = process.env.EXTERNAL_DB_ENC_KEY || 'insecure_dev_external_db_enc_key_change_me';

if (!process.env.EXTERNAL_DB_ENC_KEY) {
  console.warn('[encryption] WARNING: EXTERNAL_DB_ENC_KEY is not set in .env — using an insecure fallback. Set a long random value before storing real external database credentials.');
}

// AES-256-GCM needs a 32-byte key; scrypt derives one deterministically from whatever
// string is configured, and a fixed salt is fine here (single static secret, not a
// per-user password store).
const KEY = crypto.scryptSync(RAW_KEY, 'doc_automation_external_db_salt', 32);
const IV_LENGTH = 12; // recommended IV size for GCM

/**
 * Encrypts a plaintext string (e.g. an external DB password) for storage.
 * Output format: base64(iv):base64(authTag):base64(ciphertext) — everything needed
 * to decrypt is bundled in the one stored string.
 */
function encryptSecret(plainText) {
  if (plainText === null || plainText === undefined || plainText === '') return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** Reverses encryptSecret(). Returns null for empty/undefined input instead of throwing. */
function decryptSecret(stored) {
  if (!stored) return null;
  const [ivB64, tagB64, dataB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !dataB64) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
