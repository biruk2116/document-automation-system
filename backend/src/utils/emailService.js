'use strict';

require('dotenv').config();

/*
|--------------------------------------------------------------------------
| Brevo Email Configuration
|--------------------------------------------------------------------------
|
| Required environment variables:
|
| EMAIL_PROVIDER=brevo
| BREVO_API_KEY=your_brevo_api_key
| EMAIL_FROM=your_verified_sender@gmail.com
|
| Optional:
|
| EMAIL_FROM_NAME=Document Automation
|
|--------------------------------------------------------------------------
*/

const emailProvider = (
  process.env.EMAIL_PROVIDER ||
  'brevo'
).trim().toLowerCase();

const brevoApiKey = (
  process.env.BREVO_API_KEY ||
  ''
).trim();

const fromEmail = (
  process.env.EMAIL_FROM ||
  ''
).trim();

const fromName = (
  process.env.EMAIL_FROM_NAME ||
  'Document Automation'
).trim();

/*
|--------------------------------------------------------------------------
| Brevo API URL
|--------------------------------------------------------------------------
*/

const BREVO_API_URL =
  'https://api.brevo.com/v3/smtp/email';


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
| Brevo expects attachment content as Base64.
|
| Your existing application may provide:
|
| - Buffer
| - string
|
|--------------------------------------------------------------------------
*/

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }

  return attachments
    .filter(
      (att) =>
        att &&
        att.filename &&
        att.content
    )
    .map((att) => {
      let content;

      /*
      |----------------------------------------------------------------------
      | Buffer
      |----------------------------------------------------------------------
      */

      if (Buffer.isBuffer(att.content)) {
        content = att.content.toString('base64');
      }

      /*
      |----------------------------------------------------------------------
      | Uint8Array / ArrayBuffer-like data
      |----------------------------------------------------------------------
      */

      else if (
        att.content instanceof Uint8Array
      ) {
        content = Buffer
          .from(att.content)
          .toString('base64');
      }

      /*
      |----------------------------------------------------------------------
      | String
      |----------------------------------------------------------------------
      */

      else if (typeof att.content === 'string') {
        /*
        | If the string is already Base64, keep it.
        | Otherwise encode it as UTF-8.
        */

        content = Buffer
          .from(att.content)
          .toString('base64');
      }

      /*
      |----------------------------------------------------------------------
      | Other data types
      |----------------------------------------------------------------------
      */

      else {
        content = Buffer
          .from(String(att.content))
          .toString('base64');
      }

      return {
        name: String(att.filename),
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
| Helper: Escape HTML
|--------------------------------------------------------------------------
|
| Used for user-controlled text such as:
|
| - names
| - rejection reasons
|
| This prevents accidentally breaking the email HTML.
|
|--------------------------------------------------------------------------
*/

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


/*
|--------------------------------------------------------------------------
| Send Email
|--------------------------------------------------------------------------
|
| Application
|     ↓
| HTTPS
|     ↓
| Brevo API
|     ↓
| Recipient
|
|--------------------------------------------------------------------------
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
  | Validate Provider
  |--------------------------------------------------------------------------
  */

  if (emailProvider !== 'brevo') {
    console.error(
      `[email] Unsupported EMAIL_PROVIDER: ${emailProvider}`
    );

    return {
      success: false,
      error:
        `Unsupported EMAIL_PROVIDER: ${emailProvider}`,
    };
  }


  /*
  |--------------------------------------------------------------------------
  | Normalize Recipients
  |--------------------------------------------------------------------------
  */

  const toList = normalizeRecipients(to);

  if (toList.length === 0) {
    console.error(
      '[email] No recipient email address provided.'
    );

    return {
      success: false,
      error: 'No recipient email address provided.',
    };
  }


  /*
  |--------------------------------------------------------------------------
  | Validate Recipient Emails
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
    console.error(
      '[email] Email subject is missing.'
    );

    return {
      success: false,
      error: 'Email subject is required.',
    };
  }


  /*
  |--------------------------------------------------------------------------
  | Validate Brevo API Key
  |--------------------------------------------------------------------------
  */

  if (!brevoApiKey) {
    console.error(
      '[email] BREVO_API_KEY is not configured.'
    );

    return {
      success: false,
      error:
        'BREVO_API_KEY is not configured.',
    };
  }


  /*
  |--------------------------------------------------------------------------
  | Validate Sender
  |--------------------------------------------------------------------------
  */

  if (!fromEmail) {
    console.error(
      '[email] EMAIL_FROM is not configured.'
    );

    return {
      success: false,
      error:
        'EMAIL_FROM is not configured.',
    };
  }


  if (!isValidEmail(fromEmail)) {
    console.error(
      `[email] Invalid EMAIL_FROM address: ${fromEmail}`
    );

    return {
      success: false,
      error:
        `Invalid EMAIL_FROM address: ${fromEmail}`,
    };
  }


  /*
  |--------------------------------------------------------------------------
  | Prepare Recipients
  |--------------------------------------------------------------------------
  */

  const recipients = toList.map((email) => ({
    email,
  }));


  /*
  |--------------------------------------------------------------------------
  | Prepare Attachments
  |--------------------------------------------------------------------------
  */

  const brevoAttachments =
    normalizeAttachments(attachments);


  /*
  |--------------------------------------------------------------------------
  | Prepare Brevo Payload
  |--------------------------------------------------------------------------
  */

  const payload = {
    sender: {
      name: fromName,
      email: fromEmail,
    },

    to: recipients,

    subject: String(subject),

    htmlContent:
      html ||
      '<p></p>',
  };


  /*
  |--------------------------------------------------------------------------
  | Optional Plain Text
  |--------------------------------------------------------------------------
  */

  if (text) {
    payload.textContent =
      String(text);
  }


  /*
  |--------------------------------------------------------------------------
  | Optional Attachments
  |--------------------------------------------------------------------------
  */

  if (brevoAttachments.length > 0) {
    payload.attachment =
      brevoAttachments;

    console.log(
      `[email] Attachments: ${brevoAttachments.length}`
    );
  }


  /*
  |--------------------------------------------------------------------------
  | Send Through Brevo
  |--------------------------------------------------------------------------
  */

  try {
    console.log(
      `[email] Sending email to ${toList.join(', ')}`
    );

    console.log(
      '[email] Provider: Brevo HTTP API'
    );

    console.log(
      `[email] From: ${fromName} <${fromEmail}>`
    );


    /*
    |--------------------------------------------------------------------------
    | Brevo HTTP Request
    |--------------------------------------------------------------------------
    */

    const response =
      await fetch(
        BREVO_API_URL,
        {
          method: 'POST',

          headers: {
            accept: 'application/json',

            'api-key':
              brevoApiKey,

            'content-type':
              'application/json',
          },

          body:
            JSON.stringify(payload),
        }
      );


    /*
    |--------------------------------------------------------------------------
    | Read Response
    |--------------------------------------------------------------------------
    */

    let responseData = null;

    try {
      responseData =
        await response.json();
    } catch {
      responseData = null;
    }


    /*
    |--------------------------------------------------------------------------
    | Handle Brevo Error
    |--------------------------------------------------------------------------
    */

    if (!response.ok) {
      console.error(
        '[email] Brevo API error:',
        responseData
      );

      return {
        success: false,

        error:
          responseData?.message ||
          responseData?.code ||
          `Brevo API returned HTTP ${response.status}.`,

        statusCode:
          response.status,
      };
    }


    /*
    |--------------------------------------------------------------------------
    | Success
    |--------------------------------------------------------------------------
    */

    const messageId =
      responseData?.messageId ||
      null;

    console.log(
      `[email] Email sent successfully → ${toList.join(', ')}`
    );

    console.log(
      `[email] Brevo message ID: ${
        messageId || 'unknown'
      }`
    );


    return {
      success: true,

      messageId,

      provider: 'brevo',
    };

  } catch (err) {
    console.error(
      '[email] Brevo send failed:',
      err
    );

    return {
      success: false,

      error:
        err?.message ||
        'Failed to send email through Brevo.',
    };
  }
}


/*
|--------------------------------------------------------------------------
| Verify Email Configuration
|--------------------------------------------------------------------------
|
| This checks local configuration only.
| It does NOT send a test email.
|
|--------------------------------------------------------------------------
*/

async function verifyEmailConnection() {
  if (emailProvider !== 'brevo') {
    console.warn(
      `[email] Unsupported EMAIL_PROVIDER: ${emailProvider}`
    );

    return {
      success: false,

      configured: false,

      provider: emailProvider,

      error:
        `Unsupported EMAIL_PROVIDER: ${emailProvider}`,
    };
  }


  if (!brevoApiKey) {
    console.warn(
      '[email] BREVO_API_KEY is not configured.'
    );

    return {
      success: false,

      configured: false,

      provider: 'brevo',

      error:
        'BREVO_API_KEY is not configured.',
    };
  }


  if (!fromEmail) {
    console.warn(
      '[email] EMAIL_FROM is not configured.'
    );

    return {
      success: false,

      configured: false,

      provider: 'brevo',

      error:
        'EMAIL_FROM is not configured.',
    };
  }


  if (!isValidEmail(fromEmail)) {
    console.warn(
      `[email] Invalid EMAIL_FROM: ${fromEmail}`
    );

    return {
      success: false,

      configured: false,

      provider: 'brevo',

      error:
        `Invalid EMAIL_FROM address: ${fromEmail}`,
    };
  }


  console.log(
    '[email] Brevo API configuration detected.'
  );

  console.log(
    `[email] Sender: ${fromName} <${fromEmail}>`
  );


  return {
    success: true,

    configured: true,

    provider: 'brevo',
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
      <p>Hi ${escapeHtml(approverName)},</p>

      <p>
        Document <b>${escapeHtml(docId)}</b>
        is awaiting your approval.
      </p>

      ${
        resubmitNote
          ? `
            <p>
              <b>What was fixed:</b>
              ${escapeHtml(resubmitNote)}
            </p>
          `
          : ''
      }

      <p>
        <a href="${escapeHtml(reviewUrl)}">
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
      <p>
        Hi ${escapeHtml(generatorName)},
      </p>

      <p>
        Document <b>${escapeHtml(docId)}</b>
        was approved and digitally signed.
      </p>

      <p>
        <a href="${escapeHtml(reviewUrl)}">
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
      <p>
        Hi ${escapeHtml(generatorName)},
      </p>

      <p>
        Document <b>${escapeHtml(docId)}</b>
        was rejected.
        <b>Reason:</b>
        ${escapeHtml(reason)}
      </p>

      <p>
        It has been reverted to Draft status.
      </p>

      <p>
        <a href="${escapeHtml(reviewUrl)}">
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
      <p>
        Hi ${escapeHtml(approverName)},
      </p>

      <p>
        Document <b>${escapeHtml(docId)}</b>
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
        Document <b>${escapeHtml(docId)}</b>
        unsigned 72+ hrs.
      </p>

      <p>
        Generator:
        ${escapeHtml(generatorName)}
        |
        Approver:
        ${escapeHtml(approverName)}
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
        Hi ${escapeHtml(recipientName || 'there')},
      </p>

      <p>
        <a href="${escapeHtml(downloadUrl)}">
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
        <a href="${escapeHtml(downloadUrl)}">
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
        (ID: <b>${escapeHtml(docId)}</b>).
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
        Hi ${escapeHtml(fullName || 'there')},
      </p>

      <p>
        <a
          href="${escapeHtml(resetUrl)}"
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
        Hi ${escapeHtml(recipientName || 'there')},
      </p>

      <p>
        A document requires confirmation
        before download.
      </p>

      <p>
        <a href="${escapeHtml(secureUrl)}">
          Open the secure document link
        </a>

        (single-use, 7 days).
      </p>

      <p>
        Your one-time code:
        <b>${escapeHtml(otpCode)}</b>
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
        (ID: <b>${escapeHtml(docId)}</b>).
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
        Hi ${escapeHtml(generatorName || 'there')},
      </p>

      <p>
        <b>
          ${escapeHtml(
            recipientName || 'The recipient'
          )}
        </b>

        confirmed document
        <b>${escapeHtml(docId)}</b>.
      </p>

      <p>
        <a
          href="${escapeHtml(reviewUrl)}"
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
        Hi ${escapeHtml(generatorName || 'there')},
      </p>

      <p>
        <b>
          ${escapeHtml(
            recipientName || 'The recipient'
          )}
        </b>

        rejected document
        <b>${escapeHtml(docId)}</b>.
      </p>

      <p>
        <b>Reason:</b>
        ${escapeHtml(reason)}
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
        Hi ${escapeHtml(generatorName || 'there')},
      </p>

      <p>
        <b>
          ${escapeHtml(
            recipientName || 'The recipient'
          )}
        </b>

        rejected document
        <b>${escapeHtml(docId)}</b>.
      </p>

      <p>
        <b>Reason:</b>
        ${escapeHtml(reason)}
      </p>

      <p>
        <a
          href="${escapeHtml(reviewUrl)}"
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