const crypto = require('crypto');
const bcrypt = require('bcrypt');

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 5;        // BR-004
const MAX_OTP_ATTEMPTS = 3;          // BR-004
const LOCKOUT_MINUTES = 15;          // BR-004

function generateOtp() {
  const max = 10 ** OTP_LENGTH;
  const code = crypto.randomInt(0, max).toString().padStart(OTP_LENGTH, '0');
  return code;
}

async function hashOtp(code) {
  return bcrypt.hash(code, 10);
}

async function verifyOtp(code, hash) {
  return bcrypt.compare(code, hash);
}

function otpExpiryDate() {
  return new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
}

function lockoutExpiryDate() {
  return new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
}

module.exports = {
  generateOtp,
  hashOtp,
  verifyOtp,
  otpExpiryDate,
  lockoutExpiryDate,
  OTP_EXPIRY_MINUTES,
  MAX_OTP_ATTEMPTS,
  LOCKOUT_MINUTES,
};
