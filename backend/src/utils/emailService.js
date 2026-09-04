'use strict';

const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

dotenv.config();

/* ─────────────────────────────────────────────────────────────────────────────
 * SMTP CONFIGURATION
 * ─────────────────────────────────────────────────────────────────────────── */

const smtpHost = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpUser = (process.env.SMTP_USER || '').trim();
const smtpPassword = (process.env.SMTP_PASSWORD || '').trim();
const smtpFrom = (process.env.SMTP_FROM || smtpUser).trim();

/*
 * Gmail:
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=465
 *   secure=true
 *
 * Port 465 uses direct TLS.
 */
const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,

  auth: {
    user: smtpUser,
    pass: smtpPassword,
  },

  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 30000,

  /*
   * Do not use rejectUnauthorized:false here.
   * Gmail provides a valid TLS certificate.
   */
  tls: {
    minVersion: 'TLSv1.2',
  },
});


/* ─────────────────────────────────────────────────────────────────────────────
 * SMTP CONFIGURATION VALIDATION
 * ─────────────────────────────────────────────────────────────────────────── */

function validateEmailConfiguration() {
  const missing = [];

  if (!smtpHost) {
    missing.push('SMTP_HOST');
  }

  if (!smtpUser) {
    missing.push('SMTP_USER');
  }

  if (!smtpPassword) {
    missing.push('SMTP_PASSWORD');
  }

  if (!smtpFrom) {
    missing.push('SMTP_FROM');
  }

  if (missing.length > 0) {
    throw new Error(
      `Email configuration missing: ${missing.join(', ')}`
    );
  }
}


/* ─────────────────────────────────────────────────────────────────────────────
 * EMAIL CONNECTION TEST
 * ─────────────────────────────────────────────────────────────────────────── */

/*
 * This function can be used during startup or debugging.
 *
 * It verifies that:
 *   1. Render can connect to Gmail.
 *   2. Gmail accepts the SMTP credentials.
 *
 * It does NOT send an email.
 */
async function verifyEmailConnection() {
  validateEmailConfiguration();

  try {
    await transporter.verify();

    console.log(
      `[email] SMTP connection verified: ${smtpHost}:${smtpPort} as ${smtpUser}`
    );

    return true;
  } catch (error) {
    console.error('[email] SMTP verification failed:', error);

    if (error && error.code) {
      console.error('[email] error code:', error.code);
    }

    if (error && error.command) {
      console.error('[email] SMTP command:', error.command);
    }

    throw error;
  }
}


/* ─────────────────────────────────────────────────────────────────────────────
 * PUBLIC sendMail()
 * ─────────────────────────────────────────────────────────────────────────── */

async function sendMail({
  to,
  subject,
  html,
  text,
  attachments,
}) {
  /*
   * Validate recipient.
   */
  if (!to) {
    console.error('[email] send failed: recipient email is missing');

    return {
      success: false,
      error: 'Recipient email is required',
    };
  }

  /*
   * Validate SMTP configuration.
   */
  try {
    validateEmailConfiguration();
  } catch (error) {
    console.error('[email] configuration error:', error.message);

    return {
      success: false,
      error: error.message,
    };
  }

  /*
   * Normalize recipients.
   */
  const toList = Array.isArray(to)
    ? to.filter(Boolean)
    : [to];

  if (toList.length === 0) {
    return {
      success: false,
      error: 'No valid recipient email address provided',
    };
  }

  /*
   * Convert attachments to Nodemailer format.
   *
   * Your existing code already sends attachment objects containing:
   *
   *   {
   *     filename,
   *     content,
   *     contentType
   *   }
   *
   * Nodemailer accepts the same structure.
   */
  const normalizedAttachments = Array.isArray(attachments)
    ? attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType:
          attachment.contentType ||
          'application/octet-stream',
      }))
    : undefined;

  try {
    console.log(
      `[email] Sending email to ${toList.join(', ')}`
    );

    console.log(
      `[email] SMTP: ${smtpHost}:${smtpPort} as ${smtpUser}`
    );

    const mailOptions = {
      from: smtpFrom,
      to: toList.join(', '),
      subject: subject || '',
      text: text || '',
      html: html || '',
    };

    if (normalizedAttachments && normalizedAttachments.length > 0) {
      mailOptions.attachments = normalizedAttachments;
    }

    const info = await transporter.sendMail(mailOptions);

    console.log(
      `[email] sent successfully → ${toList.join(', ')}`
    );

    console.log(
      `[email] messageId: ${info.messageId}`
    );

    console.log(
      `[email] response: ${info.response || 'accepted'}`
    );

    return {
      success: true,
      messageId: info.messageId,
      response: info.response,
    };

  } catch (error) {
    /*
     * IMPORTANT:
     *
     * Do not only print error.message.
     * Your previous implementation produced:
     *
     *   [email] send failed:
     *
     * because the useful socket information was hidden.
     *
     * We now print the complete error information.
     */
    console.error(
      '[email] send failed:',
      error
    );

    if (error && error.code) {
      console.error(
        '[email] error code:',
        error.code
      );
    }

    if (error && error.command) {
      console.error(
        '[email] SMTP command:',
        error.command
      );
    }

    if (error && error.response) {
      console.error(
        '[email] SMTP response:',
        error.response
      );
    }

    return {
      success: false,
      error: error?.message || String(error),
      code: error?.code || null,
      command: error?.command || null,
      response: error?.response || null,
    };
  }
}


/* ─────────────────────────────────────────────────────────────────────────────
 * EMAIL TEMPLATES
 * ─────────────────────────────────────────────────────────────────────────── */

const templates = {

  docReadyForSigning: ({
    approverName,
    docId,
    otpNote,
    reviewUrl,
    resubmitNote,
  }) => ({
    subject: `Action required: Document ${docId} awaiting your signature`,

    html: `
      <p>Hi ${approverName},</p>

      <p>
        Document <b>${docId}</b> is awaiting your approval.
      </p>

      ${
        resubmitNote
          ? `<p><b>What was fixed:</b> ${resubmitNote}</p>`
          : ''
      }

      <p>
        <a href="${reviewUrl}">
          Review the document
        </a>
        ${otpNote || ''}
      </p>
    `,
  }),


  docSigned: ({
    generatorName,
    docId,
    reviewUrl,
  }) => ({
    subject: `Document ${docId} has been signed`,

    html: `
      <p>Hi ${generatorName},</p>

      <p>
        Document <b>${docId}</b>
        was approved and digitally signed.
      </p>

      <p>
        <a href="${reviewUrl}">
          Review the signed document
        </a>
      </p>
    `,
  }),


  docRejected: ({
    generatorName,
    docId,
    reason,
    reviewUrl,
    requiresLogin = false,
  }) => ({
    subject: `Document ${docId} was rejected`,

    html: `
      <p>Hi ${generatorName},</p>

      <p>
        Document <b>${docId}</b> was rejected.
        <b>Reason:</b> ${reason}
      </p>

      <p>
        It has been reverted to Draft status.
      </p>

      <p>
        <a href="${reviewUrl}">
          Review the document
        </a>
        ${
          requiresLogin
            ? ' — sign in to open it.'
            : ' — one-time link, no login required.'
        }
      </p>
    `,
  }),


  reminder24h: ({
    approverName,
    docId,
  }) => ({
    subject:
      `Reminder: Document ${docId} still awaiting signature`,

    html: `
      <p>Hi ${approverName},</p>

      <p>
        Document <b>${docId}</b>
        is still pending your review.
      </p>
    `,
  }),


  escalation72h: ({
    generatorName,
    approverName,
    docId,
  }) => ({
    subject:
      `Escalation: Document ${docId} unsigned for 72+ hours`,

    html: `
      <p>
        Document <b>${docId}</b>
        unsigned 72+ hrs.
      </p>

      <p>
        Generator: ${generatorName}
        |
        Approver: ${approverName}
      </p>
    `,
  }),


  deliveryReady: ({
    recipientName,
    docId,
    downloadUrl,
  }) => ({
    subject:
      `Your document ${docId} is ready`,

    html: `
      <p>
        Hi ${recipientName || 'there'},
      </p>

      <p>
        <a href="${downloadUrl}">
          Open secure link
        </a>
        (expires 7 days)
      </p>
    `,
  }),


  secureLinkReady: ({
    docId,
    downloadUrl,
  }) => ({
    subject:
      `A document (${docId}) has been shared with you`,

    html: `
      <p>Hi,</p>

      <p>
        <a href="${downloadUrl}">
          Open secure link
        </a>
        (expires 7 days, single-use)
      </p>
    `,
  }),


  documentAttached: ({
    docId,
  }) => ({
    subject:
      `Document ${docId}`,

    html: `
      <p>Hi,</p>

      <p>
        Please find your document attached
        (ID: <b>${docId}</b>).
      </p>
    `,
  }),


  passwordReset: ({
    fullName,
    resetUrl,
  }) => ({
    subject:
      'Reset your Doc Automation password',

    html: `
      <p>
        Hi ${fullName || 'there'},
      </p>

      <p>
        <a
          href="${resetUrl}"
          style="
            display:inline-block;
            padding:10px 20px;
            background:#0F2747;
            color:#fff;
            border-radius:6px;
            text-decoration:none;
            font-weight:600;
          "
        >
          Reset Your Password
        </a>
      </p>

      <p
        style="
          font-size:0.85em;
          color:#64748B;
        "
      >
        Expires in 1 hour, single-use.
        Ignore if you didn't request this.
      </p>
    `,
  }),


  secureDeliveryReady: ({
    recipientName,
    docId,
    secureUrl,
    otpCode,
  }) => ({
    subject:
      `A document (${docId}) requires your confirmation`,

    html: `
      <p>
        Hi ${recipientName || 'there'},
      </p>

      <p>
        A document requires confirmation
        before download.
      </p>

      <p>
        <a href="${secureUrl}">
          Open the secure document link
        </a>
        (single-use, 7 days).
      </p>

      <p>
        Your one-time code:
        <b>${otpCode}</b>
        (expires in 5 minutes).
      </p>
    `,
  }),


  secureDeliveryPlainCopy: ({
    docId,
  }) => ({
    subject:
      `Document ${docId} (copy)`,

    html: `
      <p>Hi,</p>

      <p>
        Please find a copy of your document attached
        (ID: <b>${docId}</b>).
      </p>
    `,
  }),


  deliveryOwned: ({
    generatorName,
    docId,
    recipientName,
    reviewUrl,
  }) => ({
    subject:
      `Document ${docId} confirmed by recipient`,

    html: `
      <p>
        Hi ${generatorName || 'there'},
      </p>

      <p>
        <b>${recipientName || 'The recipient'}</b>
        confirmed document <b>${docId}</b>.
      </p>

      <p>
        <a
          href="${reviewUrl}"
          style="
            display:inline-block;
            padding:10px 20px;
            background:#0F2747;
            color:#fff;
            border-radius:6px;
            text-decoration:none;
            font-weight:600;
          "
        >
          View Submitted Document
        </a>
      </p>
    `,
  }),


  ownershipRejected: ({
    generatorName,
    docId,
    recipientName,
    reason,
  }) => ({
    subject:
      `Document ${docId} was rejected by the recipient`,

    html: `
      <p>
        Hi ${generatorName || 'there'},
      </p>

      <p>
        <b>${recipientName || 'The recipient'}</b>
        rejected document <b>${docId}</b>.
      </p>

      <p>
        <b>Reason:</b> ${reason}
      </p>

      <p>
        Download link blocked.
        Please verify recipient and re-send.
      </p>
    `,
  }),


  ownershipRejectedWithLink: ({
    generatorName,
    docId,
    recipientName,
    reason,
    reviewUrl,
  }) => ({
    subject:
      `Document ${docId} was rejected by the recipient`,

    html: `
      <p>
        Hi ${generatorName || 'there'},
      </p>

      <p>
        <b>${recipientName || 'The recipient'}</b>
        rejected document <b>${docId}</b>.
      </p>

      <p>
        <b>Reason:</b> ${reason}
      </p>

      <p>
        <a
          href="${reviewUrl}"
          style="
            display:inline-block;
            padding:10px 20px;
            background:#6366F1;
            color:#fff;
            border-radius:6px;
            text-decoration:none;
            font-weight:600;
          "
        >
          Review Rejection &amp; Edit / Resubmit
        </a>
      </p>
    `,
  }),

};


/* ─────────────────────────────────────────────────────────────────────────────
 * EXPORTS
 * ─────────────────────────────────────────────────────────────────────────── */

module.exports = {
  sendMail,
  templates,
  verifyEmailConnection,
};