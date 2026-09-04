'use strict';

const { Resend } = require('resend');
require('dotenv').config();

/*
|--------------------------------------------------------------------------
| Resend Configuration
|--------------------------------------------------------------------------
*/

const resendApiKey = (process.env.RESEND_API_KEY || '').trim();

const resend = resendApiKey
  ? new Resend(resendApiKey)
  : null;

/*
|--------------------------------------------------------------------------
| Sender
|--------------------------------------------------------------------------
|
| For the first test, use:
|
| RESEND_FROM=Doc Automation <onboarding@resend.dev>
|
| Later, after verifying your own domain in Resend, you can use:
|
| RESEND_FROM=Doc Automation <no-reply@yourdomain.com>
|
*/

const fromAddress =
  (process.env.RESEND_FROM || '').trim() ||
  'Doc Automation <onboarding@resend.dev>';


/*
|--------------------------------------------------------------------------
| Helper: Normalize Recipients
|--------------------------------------------------------------------------
*/

function normalizeRecipients(to) {
  if (Array.isArray(to)) {
    return to
      .map((email) => String(email || '').trim())
      .filter(Boolean);
  }

  if (typeof to === 'string') {
    return to
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean);
  }

  return [];
}


/*
|--------------------------------------------------------------------------
| Helper: Normalize Attachments
|--------------------------------------------------------------------------
|
| Resend supports attachments.
| Your existing document/PDF attachment workflows can therefore continue
| using the same sendMail() function.
|
*/

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return undefined;
  }

  return attachments
    .filter((att) => att && att.filename && att.content)
    .map((att) => {
      let content = att.content;

      if (!Buffer.isBuffer(content)) {
        content = Buffer.from(content);
      }

      return {
        filename: String(att.filename),
        content,
      };
    });
}


/*
|--------------------------------------------------------------------------
| Helper: Validate Email
|--------------------------------------------------------------------------
*/

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


/*
|--------------------------------------------------------------------------
| Send Email
|--------------------------------------------------------------------------
|
| This replaces the old SMTP implementation.
|
| OLD:
|   Application → Gmail SMTP → Recipient
|
| NEW:
|   Application → HTTPS → Resend API → Recipient
|
*/

async function sendMail({
  to,
  subject,
  html,
  text,
  attachments,
}) {
  /*
  |--------------------------------------------------------------------------
  | Validate Recipient
  |--------------------------------------------------------------------------
  */

  const toList = normalizeRecipients(to);

  if (toList.length === 0) {
    console.error('[email] No recipient email address provided.');

    return {
      success: false,
      error: 'No recipient email address provided.',
    };
  }


  /*
  |--------------------------------------------------------------------------
  | Validate Recipient Email Addresses
  |--------------------------------------------------------------------------
  */

  const invalidRecipients = toList.filter(
    (email) => !isValidEmail(email)
  );

  if (invalidRecipients.length > 0) {
    console.error(
      '[email] Invalid recipient email address(es):',
      invalidRecipients
    );

    return {
      success: false,
      error:
        `Invalid recipient email address: ` +
        `${invalidRecipients.join(', ')}`,
    };
  }


  /*
  |--------------------------------------------------------------------------
  | Validate Subject
  |--------------------------------------------------------------------------
  */

  if (!subject) {
    console.error('[email] Email subject is missing.');

    return {
      success: false,
      error: 'Email subject is required.',
    };
  }


  /*
  |--------------------------------------------------------------------------
  | Check Resend Configuration
  |--------------------------------------------------------------------------
  */

  if (!resend) {
    console.error(
      '[email] RESEND_API_KEY is not configured. Email not sent.'
    );

    return {
      success: false,
      error: 'RESEND_API_KEY is not configured.',
    };
  }


  /*
  |--------------------------------------------------------------------------
  | Prepare Attachments
  |--------------------------------------------------------------------------
  */

  const resendAttachments = normalizeAttachments(attachments);


  /*
  |--------------------------------------------------------------------------
  | Send Through Resend
  |--------------------------------------------------------------------------
  */

  try {
    console.log(
      `[email] Sending email to ${toList.join(', ')}`
    );

    console.log(
      '[email] Provider: Resend HTTP API'
    );

    console.log(
      `[email] From: ${fromAddress}`
    );


    /*
    |--------------------------------------------------------------------------
    | Resend Payload
    |--------------------------------------------------------------------------
    */

    const payload = {
      from: fromAddress,
      to: toList,
      subject: String(subject),
      html: html || '<p></p>',
    };


    /*
    |--------------------------------------------------------------------------
    | Optional Plain Text
    |--------------------------------------------------------------------------
    */

    if (text) {
      payload.text = String(text);
    }


    /*
    |--------------------------------------------------------------------------
    | Optional Attachments
    |--------------------------------------------------------------------------
    */

    if (
      resendAttachments &&
      resendAttachments.length > 0
    ) {
      payload.attachments = resendAttachments;

      console.log(
        `[email] Attachments: ${resendAttachments.length}`
      );
    }


    /*
    |--------------------------------------------------------------------------
    | Send Email
    |--------------------------------------------------------------------------
    */

    const { data, error } =
      await resend.emails.send(payload);


    /*
    |--------------------------------------------------------------------------
    | Handle Resend API Error
    |--------------------------------------------------------------------------
    */

    if (error) {
      console.error(
        '[email] Resend API error:',
        error
      );

      return {
        success: false,
        error:
          error.message ||
          error.name ||
          'Resend API returned an error.',
      };
    }


    /*
    |--------------------------------------------------------------------------
    | Success
    |--------------------------------------------------------------------------
    */

    const messageId = data?.id || null;

    console.log(
      `[email] Email sent successfully → ${toList.join(', ')}`
    );

    console.log(
      `[email] Resend message ID: ${
        messageId || 'unknown'
      }`
    );


    return {
      success: true,
      messageId,
      provider: 'resend',
    };

  } catch (err) {
    console.error(
      '[email] Resend send failed:',
      err
    );

    return {
      success: false,
      error:
        err.message ||
        'Failed to send email.',
    };
  }
}


/*
|--------------------------------------------------------------------------
| Verify Email Configuration
|--------------------------------------------------------------------------
|
| This checks whether the Resend API key exists.
| It does not send a test email.
|
*/

async function verifyEmailConnection() {
  if (!resendApiKey) {
    console.warn(
      '[email] RESEND_API_KEY is not configured.'
    );

    return {
      success: false,
      configured: false,
      error: 'RESEND_API_KEY is not configured.',
    };
  }

  console.log(
    '[email] Resend API configuration detected.'
  );

  return {
    success: true,
    configured: true,
    provider: 'resend',
  };
}


/*
|--------------------------------------------------------------------------
| Email Templates
|--------------------------------------------------------------------------
*/

const templates = {

  /*
  |--------------------------------------------------------------------------
  | Document Ready For Signing
  |--------------------------------------------------------------------------
  */

  docReadyForSigning: ({
    approverName,
    docId,
    otpNote,
    reviewUrl,
    resubmitNote,
  }) => ({
    subject:
      `Action required: Document ${docId} awaiting your signature`,

    html: `
      <p>Hi ${approverName},</p>

      <p>
        Document <b>${docId}</b>
        is awaiting your approval.
      </p>

      ${
        resubmitNote
          ? `
            <p>
              <b>What was fixed:</b>
              ${resubmitNote}
            </p>
          `
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


  /*
  |--------------------------------------------------------------------------
  | Document Signed
  |--------------------------------------------------------------------------
  */

  docSigned: ({
    generatorName,
    docId,
    reviewUrl,
  }) => ({
    subject:
      `Document ${docId} has been signed`,

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


  /*
  |--------------------------------------------------------------------------
  | Document Rejected
  |--------------------------------------------------------------------------
  */

  docRejected: ({
    generatorName,
    docId,
    reason,
    reviewUrl,
    requiresLogin = false,
  }) => ({
    subject:
      `Document ${docId} was rejected`,

    html: `
      <p>Hi ${generatorName},</p>

      <p>
        Document <b>${docId}</b>
        was rejected.
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


  /*
  |--------------------------------------------------------------------------
  | 24 Hour Reminder
  |--------------------------------------------------------------------------
  */

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


  /*
  |--------------------------------------------------------------------------
  | 72 Hour Escalation
  |--------------------------------------------------------------------------
  */

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


  /*
  |--------------------------------------------------------------------------
  | Delivery Ready
  |--------------------------------------------------------------------------
  */

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


  /*
  |--------------------------------------------------------------------------
  | Secure Link Ready
  |--------------------------------------------------------------------------
  */

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


  /*
  |--------------------------------------------------------------------------
  | Document Attached
  |--------------------------------------------------------------------------
  */

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


  /*
  |--------------------------------------------------------------------------
  | Password Reset
  |--------------------------------------------------------------------------
  */

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


  /*
  |--------------------------------------------------------------------------
  | Secure Delivery + OTP
  |--------------------------------------------------------------------------
  */

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


  /*
  |--------------------------------------------------------------------------
  | Secure Delivery Plain Copy
  |--------------------------------------------------------------------------
  */

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


  /*
  |--------------------------------------------------------------------------
  | Delivery Owned
  |--------------------------------------------------------------------------
  */

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
        confirmed document
        <b>${docId}</b>.
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


  /*
  |--------------------------------------------------------------------------
  | Ownership Rejected
  |--------------------------------------------------------------------------
  */

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
        rejected document
        <b>${docId}</b>.
      </p>

      <p>
        <b>Reason:</b>
        ${reason}
      </p>

      <p>
        Download link blocked.
        Please verify recipient and re-send.
      </p>
    `,
  }),


  /*
  |--------------------------------------------------------------------------
  | Ownership Rejected With Review Link
  |--------------------------------------------------------------------------
  */

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
        rejected document
        <b>${docId}</b>.
      </p>

      <p>
        <b>Reason:</b>
        ${reason}
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
          Review Rejection &amp;
          Edit / Resubmit
        </a>
      </p>
    `,
  }),
};


/*
|--------------------------------------------------------------------------
| Exports
|--------------------------------------------------------------------------
*/

module.exports = {
  sendMail,
  templates,
  verifyEmailConnection,
};