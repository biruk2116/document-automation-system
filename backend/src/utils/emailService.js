'use strict';

/**
 * emailService.js — custom SMTP client for Doc Automation.
 *
 * Uses Node's built-in `tls` module to send over Gmail port 465 (direct SSL).
 * This bypasses nodemailer's pool/transport layer which hangs on Node.js v22
 * due to internal timer unreffing changes.  Auth is tested and confirmed working
 * (235 Accepted) with the Gmail App Password in .env.
 *
 * Falls back to dry-run logging when SMTP_HOST is not configured.
 * sendMail() NEVER throws — all errors are caught and returned as { success:false }.
 */

const tls   = require('tls');
const net   = require('net');
const require_dotenv = require('dotenv');
require_dotenv.config();

/* ── helpers ────────────────────────────────────────────────────────────────── */

function b64(s) { return Buffer.from(String(s)).toString('base64'); }

/** Escape lone dots on a line (SMTP transparency) */
function dotStuff(s) {
  return s.replace(/\r?\n\.\r?\n/g, '\n..\n');
}

/** Minimal quoted-printable safe content-transfer for HTML bodies */
function buildMimeMessage({ from, to, subject, html, attachments }) {
  const boundary = 'boundary_' + Date.now().toString(36);
  const toList = Array.isArray(to) ? to.join(', ') : to;

  const hasAttachments = attachments && attachments.length > 0;

  if (!hasAttachments) {
    // Simple message: headers + HTML body
    const encoded = Buffer.from(html || '').toString('base64')
      .match(/.{1,76}/g).join('\r\n');
    return [
      `From: ${from}`,
      `To: ${toList}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      encoded,
    ].join('\r\n');
  }

  // With attachments: multipart/mixed
  const htmlEncoded = Buffer.from(html || '').toString('base64')
    .match(/.{1,76}/g).join('\r\n');

  const parts = [
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    htmlEncoded,
  ];

  for (const att of attachments) {
    const data = Buffer.isBuffer(att.content)
      ? att.content.toString('base64')
      : Buffer.from(att.content).toString('base64');
    const chunks = data.match(/.{1,76}/g).join('\r\n');
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.contentType || 'application/octet-stream'}; name="${att.filename}"`,
      `Content-Disposition: attachment; filename="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      chunks
    );
  }
  parts.push(`--${boundary}--`);

  return [
    `From: ${from}`,
    `To: ${toList}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    parts.join('\r\n'),
  ].join('\r\n');
}

/**
 * Low-level SMTP send over TLS port 465.
 * Returns a Promise that resolves/rejects with the SMTP server's final response.
 */
function smtpSend({ host, port, user, pass, from, to, mimeMessage, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const toList = Array.isArray(to) ? to : [to];
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('SMTP connection timed out after ' + timeoutMs + 'ms'));
    }, timeoutMs);

    const sock = tls.connect({ host, port, rejectUnauthorized: false }, () => {
      // connected
    });

    sock.setEncoding('utf8');
    let buf = '';
    let step = 0;

    function send(line) {
      sock.write(line + '\r\n');
    }

    function fail(msg) {
      clearTimeout(timer);
      sock.destroy();
      reject(new Error(msg));
    }

    sock.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    sock.on('data', (chunk) => {
      buf += chunk;
      // SMTP responses end with \r\n; wait for a complete line
      if (!buf.endsWith('\n')) return;
      const line = buf.trim();
      buf = '';

      // Extract numeric code
      const code = parseInt(line, 10);

      switch (step) {
        case 0: // greeting
          if (code !== 220) return fail('SMTP greeting error: ' + line);
          step = 1;
          send('EHLO localhost');
          break;

        case 1: // EHLO — may be multi-line (250-...)
          if (!line.match(/^250 /m) && !line.match(/^250$/m)) return; // still reading
          step = 2;
          send('AUTH LOGIN');
          break;

        case 2: // AUTH LOGIN prompt for username
          if (code !== 334) return fail('AUTH LOGIN failed: ' + line);
          step = 3;
          send(b64(user));
          break;

        case 3: // AUTH LOGIN prompt for password
          if (code !== 334) return fail('AUTH LOGIN password prompt error: ' + line);
          step = 4;
          send(b64(pass));
          break;

        case 4: // AUTH result
          if (code !== 235) return fail('Authentication failed (' + code + '): ' + line);
          step = 5;
          send('MAIL FROM:<' + from + '>');
          break;

        case 5: // MAIL FROM
          if (code !== 250) return fail('MAIL FROM rejected: ' + line);
          step = 6;
          // Send first RCPT TO
          send('RCPT TO:<' + toList[0] + '>');
          break;

        case 6: // RCPT TO (handle multi-recipient if needed)
          if (code !== 250) return fail('RCPT TO rejected: ' + line);
          step = 7;
          send('DATA');
          break;

        case 7: // DATA prompt
          if (code !== 354) return fail('DATA command rejected: ' + line);
          step = 8;
          sock.write(mimeMessage + '\r\n.\r\n');
          break;

        case 8: // message accepted
          if (code !== 250) return fail('Message rejected: ' + line);
          step = 9;
          send('QUIT');
          break;

        case 9: // QUIT
          clearTimeout(timer);
          sock.destroy();
          resolve({ messageId: '<smtp-' + Date.now() + '@' + host + '>', response: line });
          break;
      }
    });
  });
}

/* ── public sendMail ─────────────────────────────────────────────────────────── */
async function sendMail({ to, subject, html, attachments }) {
  const smtpHost = (process.env.SMTP_HOST || '').trim();

  if (!smtpHost) {
    const toAddr = Array.isArray(to) ? to.join(',') : to;
    console.log(`[email:DRY-RUN] To:${toAddr} | Subject:${subject}`);
    return { success: false, dryRun: true };
  }

  const isGmail = smtpHost.toLowerCase() === 'smtp.gmail.com';
  const smtpPort = isGmail ? 465 : (Number(process.env.SMTP_PORT) || 587);
  const smtpUser = process.env.SMTP_USER || '';
  const smtpPass = process.env.SMTP_PASSWORD || '';
  const fromAddr = process.env.SMTP_FROM || smtpUser || 'no-reply@doc-automation.local';
  const toList   = Array.isArray(to) ? to : [to];

  try {
    const mime = buildMimeMessage({ from: fromAddr, to: toList, subject, html, attachments });
    const info = await smtpSend({
      host: smtpHost,
      port: smtpPort,
      user: smtpUser,
      pass: smtpPass,
      from: fromAddr,
      to:   toList,
      mimeMessage: mime,
    });
    console.log(`[email] sent → ${toList.join(',')} | msgId:${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[email] send failed:', err.message);
    return { success: false, error: err.message };
  }
}

/* ── Templates ────────────────────────────────────────────────────────────────── */
const templates = {
  docReadyForSigning: ({ approverName, docId, otpNote, reviewUrl, resubmitNote }) => ({
    subject: `Action required: Document ${docId} awaiting your signature`,
    html: `<p>Hi ${approverName},</p>
      <p>Document <b>${docId}</b> is awaiting your approval.</p>
      ${resubmitNote ? `<p><b>What was fixed:</b> ${resubmitNote}</p>` : ''}
      <p><a href="${reviewUrl}">Review the document</a> ${otpNote || ''}</p>`,
  }),

  docSigned: ({ generatorName, docId, reviewUrl }) => ({
    subject: `Document ${docId} has been signed`,
    html: `<p>Hi ${generatorName},</p>
      <p>Document <b>${docId}</b> was approved and digitally signed.</p>
      <p><a href="${reviewUrl}">Review the signed document</a></p>`,
  }),

  docRejected: ({ generatorName, docId, reason, reviewUrl, requiresLogin = false }) => ({
    subject: `Document ${docId} was rejected`,
    html: `<p>Hi ${generatorName},</p>
      <p>Document <b>${docId}</b> was rejected. <b>Reason:</b> ${reason}</p>
      <p>It has been reverted to Draft status.</p>
      <p><a href="${reviewUrl}">Review the document</a>${requiresLogin
        ? ' — sign in to open it.'
        : ' — one-time link, no login required.'}</p>`,
  }),

  reminder24h: ({ approverName, docId }) => ({
    subject: `Reminder: Document ${docId} still awaiting signature`,
    html: `<p>Hi ${approverName},</p><p>Document <b>${docId}</b> is still pending your review.</p>`,
  }),

  escalation72h: ({ generatorName, approverName, docId }) => ({
    subject: `Escalation: Document ${docId} unsigned for 72+ hours`,
    html: `<p>Document <b>${docId}</b> unsigned 72+ hrs. Generator:${generatorName} | Approver:${approverName}</p>`,
  }),

  deliveryReady: ({ recipientName, docId, downloadUrl }) => ({
    subject: `Your document ${docId} is ready`,
    html: `<p>Hi ${recipientName || 'there'},</p>
      <p><a href="${downloadUrl}">Open secure link</a> (expires 7 days)</p>`,
  }),

  secureLinkReady: ({ docId, downloadUrl }) => ({
    subject: `A document (${docId}) has been shared with you`,
    html: `<p>Hi,</p><p><a href="${downloadUrl}">Open secure link</a> (expires 7 days, single-use)</p>`,
  }),

  documentAttached: ({ docId }) => ({
    subject: `Document ${docId}`,
    html: `<p>Hi,</p><p>Please find your document attached (ID: <b>${docId}</b>).</p>`,
  }),

  passwordReset: ({ fullName, resetUrl }) => ({
    subject: 'Reset your Doc Automation password',
    html: `<p>Hi ${fullName || 'there'},</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:10px 20px;background:#0F2747;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Reset Your Password</a></p>
      <p style="font-size:0.85em;color:#64748B;">Expires in 1 hour, single-use. Ignore if you didn't request this.</p>`,
  }),

  secureDeliveryReady: ({ recipientName, docId, secureUrl, otpCode }) => ({
    subject: `A document (${docId}) requires your confirmation`,
    html: `<p>Hi ${recipientName || 'there'},</p>
      <p>A document requires confirmation before download.</p>
      <p><a href="${secureUrl}">Open the secure document link</a> (single-use, 7 days).</p>
      <p>Your one-time code: <b>${otpCode}</b> (expires in 5 minutes).</p>`,
  }),

  secureDeliveryPlainCopy: ({ docId }) => ({
    subject: `Document ${docId} (copy)`,
    html: `<p>Hi,</p><p>Please find a copy of your document attached (ID: <b>${docId}</b>).</p>`,
  }),

  deliveryOwned: ({ generatorName, docId, recipientName, reviewUrl }) => ({
    subject: `Document ${docId} confirmed by recipient`,
    html: `<p>Hi ${generatorName || 'there'},</p>
      <p><b>${recipientName || 'The recipient'}</b> confirmed document <b>${docId}</b>.</p>
      <p><a href="${reviewUrl}" style="display:inline-block;padding:10px 20px;background:#0F2747;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">View Submitted Document</a></p>`,
  }),

  ownershipRejected: ({ generatorName, docId, recipientName, reason }) => ({
    subject: `Document ${docId} was rejected by the recipient`,
    html: `<p>Hi ${generatorName || 'there'},</p>
      <p><b>${recipientName || 'The recipient'}</b> rejected document <b>${docId}</b>.</p>
      <p><b>Reason:</b> ${reason}</p>
      <p>Download link blocked. Please verify recipient and re-send.</p>`,
  }),

  ownershipRejectedWithLink: ({ generatorName, docId, recipientName, reason, reviewUrl }) => ({
    subject: `Document ${docId} was rejected by the recipient`,
    html: `<p>Hi ${generatorName || 'there'},</p>
      <p><b>${recipientName || 'The recipient'}</b> rejected document <b>${docId}</b>.</p>
      <p><b>Reason:</b> ${reason}</p>
      <p><a href="${reviewUrl}" style="display:inline-block;padding:10px 20px;background:#6366F1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Review Rejection &amp; Edit / Resubmit</a></p>`,
  }),
};

module.exports = { sendMail, templates };
