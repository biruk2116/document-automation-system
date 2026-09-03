require('dotenv').config();

/**
 * FR-023 requires OTP delivery to the approver's "registered mobile/email".
 * Without SMS_PROVIDER configured, this logs the intended SMS instead of sending
 * (same dry-run pattern as emailService.js) so local dev still works with no setup.
 *
 * Set SMS_PROVIDER=twilio + TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER
 * in .env to actually deliver texts. Requires `npm install twilio` in backend/.
 */

let twilioClient = null;
function getTwilioClient() {
  if (twilioClient) return twilioClient;
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.warn('[sms] SMS_PROVIDER=twilio is set but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are missing in .env.');
    return null;
  }
  try {
    // Lazy require: the "twilio" package is an optional dependency — only needed if
    // you actually turn SMS delivery on. This avoids crashing the whole server on
    // startup for anyone who hasn't run `npm install twilio` yet.
    // eslint-disable-next-line global-require
    const twilio = require('twilio');
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    return twilioClient;
  } catch (err) {
    console.error('[sms] "twilio" package not installed. Run: npm install twilio (inside backend/).');
    return null;
  }
}

/**
 * Twilio (and most SMS providers) require E.164 format: a leading "+" and country
 * code, e.g. +251961733380 rather than 0961733380. This does a best-effort fix for
 * Ethiopian-style local numbers (leading 0) using PHONE_DEFAULT_COUNTRY_CODE from
 * .env (default 251 = Ethiopia) — numbers that already start with "+" are left as-is.
 */
function toE164(phone) {
  if (!phone) return phone;
  const trimmed = String(phone).trim();
  if (trimmed.startsWith('+')) return trimmed;
  const countryCode = process.env.PHONE_DEFAULT_COUNTRY_CODE || '251';
  const digitsOnly = trimmed.replace(/\D/g, '');
  const withoutLeadingZero = digitsOnly.replace(/^0+/, '');
  return `+${countryCode}${withoutLeadingZero}`;
}

async function sendSms({ to, message }) {
  const provider = process.env.SMS_PROVIDER;

  if (!provider || !to) {
    console.log(`[sms:DRY-RUN] To: ${to || '(no phone on file)'} | Message: ${message}`);
    return { success: false, dryRun: true };
  }

  if (provider === 'twilio') {
    const client = getTwilioClient();
    if (!client) {
      console.log(`[sms:DRY-RUN] To: ${to} | Message: ${message}`);
      return { success: false, dryRun: true };
    }
    try {
      const toNumber = toE164(to);
      await client.messages.create({
        to: toNumber,
        from: process.env.TWILIO_FROM_NUMBER,
        body: message,
      });
      return { success: true };
    } catch (err) {
      console.error('[sms] Twilio send failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  console.warn(`[sms] SMS_PROVIDER="${provider}" is not a recognized provider (supported: "twilio").`);
  console.log(`[sms:DRY-RUN] To: ${to} | Message: ${message}`);
  return { success: false, error: `Unsupported SMS_PROVIDER: ${provider}` };
}

module.exports = { sendSms, toE164 };
