const jwt = require('jsonwebtoken');
require('dotenv').config();

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

if (!SECRET) {
  console.warn('[jwt] WARNING: JWT_SECRET is not set in .env — using an insecure fallback.');
}

function signToken(payload) {
  return jwt.sign(payload, SECRET || 'insecure_dev_fallback_secret', { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET || 'insecure_dev_fallback_secret');
}

module.exports = { signToken, verifyToken };
