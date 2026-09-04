'use strict';

const tls = require('tls');
const dotenv = require('dotenv');

dotenv.config();

/* ============================================================
   HELPERS
   ============================================================ */

/**
 * Base64 encode
 */
function b64(value) {
  return Buffer.from(String(value || '')).toString('base64');
}

/**
 * SMTP dot-stuffing.
 *
 * A line containing only "." must be escaped inside DATA.
 */
function dotStuff(value) {
  return String(value || '').replace(
    /\r?\n\.\r?\n/g,
    '\n..\n'
  );
}

/**
 * Encode text as MIME Base64.
 */
function encodeBase64(value) {
  const encoded = Buffer.from(
    String(value || ''),
    'utf8'
  ).toString('base64');

  if (!encoded) {
    return '';
  }

  return encoded.match(/.{1,76}/g).join('\r\n');
}

/* ============================================================
   MIME MESSAGE BUILDER
   ============================================================ */

/**
 * Build MIME email.
 *
 * Supports:
 * - HTML-only emails
 * - HTML + attachments
 */
function buildMimeMessage({
  from,
  to,
  subject,
  html,
  attachments = [],
}) {
  const boundary =
    'boundary_' + Date.now().toString(36);

  const toList = Array.isArray(to)
    ? to.join(', ')
    : String(to || '');

  const hasAttachments =
    Array.isArray(attachments) &&
    attachments.length > 0;

  /* ----------------------------------------------------------
     HTML ONLY
     ---------------------------------------------------------- */

  if (!hasAttachments) {
    const encodedHtml = encodeBase64(html);

    return [
      `From: ${from}`,
      `To: ${toList}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      encodedHtml,
    ].join('\r\n');
  }

  /* ----------------------------------------------------------
     HTML + ATTACHMENTS
     ---------------------------------------------------------- */

  const htmlEncoded = encodeBase64(html);

  const parts = [
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    htmlEncoded,
  ];

  for (const attachment of attachments) {
    const content = Buffer.isBuffer(attachment.content)
      ? attachment.content
      : Buffer.from(attachment.content || '');

    const encoded = content.toString('base64');

    const chunks =
      encoded.match(/.{1,76}/g) || [];

    parts.push(
      `--${boundary}`,
      `Content-Type: ${
        attachment.contentType ||
        'application/octet-stream'
      }; name="${attachment.filename}"`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      chunks.join('\r\n')
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

/* ============================================================
   SMTP SENDER
   ============================================================ */

/**
 * Low-level SMTP sender using TLS.
 *
 * IMPORTANT:
 * tls.connect() is intended for implicit TLS,
 * normally SMTP port 465.
 */
function smtpSend({
  host,
  port,
  user,
  pass,
  from,
  to,
  mimeMessage,
  timeoutMs = 20000,
}) {
  return new Promise((resolve, reject) => {
    const toList = Array.isArray(to)
      ? to
      : [to];

    let socket = null;
    let finished = false;
    let buffer = '';
    let step = 0;

    const timer = setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;

      if (socket) {
        socket.destroy();
      }

      reject(
        new Error(
          `SMTP connection timed out after ${timeoutMs}ms`
        )
      );
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
    }

    function fail(message) {
      if (finished) {
        return;
      }

      finished = true;
      cleanup();

      if (socket && !socket.destroyed) {
        socket.destroy();
      }

      reject(new Error(message));
    }

    function success(result) {
      if (finished) {
        return;
      }

      finished = true;
      cleanup();

      resolve(result);
    }

    /* --------------------------------------------------------
       CONNECT TO SMTP SERVER
       -------------------------------------------------------- */

    try {
      socket = tls.connect(
        {
          host,
          port,
          rejectUnauthorized: true,
          servername: host,
        },
        () => {
          console.log(
            `[email] TLS connection established: ${host}:${port}`
          );
        }
      );
    } catch (error) {
      fail(
        `SMTP connection error: ${
          error && error.message
            ? error.message
            : String(error)
        }`
      );

      return;
    }

    socket.setEncoding('utf8');

    /* --------------------------------------------------------
       SEND SMTP COMMAND
       -------------------------------------------------------- */

    function send(line) {
      if (!socket || socket.destroyed) {
        fail('SMTP socket is not available.');
        return;
      }

      try {
        socket.write(line + '\r\n');
      } catch (error) {
        fail(
          `SMTP write error: ${
            error && error.message
              ? error.message
              : String(error)
          }`
        );
      }
    }

    /* --------------------------------------------------------
       SOCKET ERROR
       -------------------------------------------------------- */

    socket.on('error', (error) => {
      fail(
        `SMTP socket error${
          error && error.code
            ? ` (${error.code})`
            : ''
        }: ${
          error && error.message
            ? error.message
            : String(error)
        }`
      );
    });

    /* --------------------------------------------------------
       SMTP RESPONSE HANDLER
       -------------------------------------------------------- */

    socket.on('data', (chunk) => {
      if (finished) {
        return;
      }

      buffer += chunk;

      /*
       * SMTP responses are terminated by CRLF.
       */
      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n');

        let line = buffer.substring(
          0,
          index
        );

        buffer = buffer.substring(index + 1);

        line = line.replace(/\r$/, '');

        if (!line) {
          continue;
        }

        const code = parseInt(
          line.substring(0, 3),
          10
        );

        if (Number.isNaN(code)) {
          continue;
        }

        /*
         * SMTP multiline response:
         *
         * 250-example
         * 250-example
         * 250 final
         *
         * The final line contains a space
         * after the SMTP status code.
         */

        const finalLine =
          line.length >= 4 &&
          line[3] === ' ';

        switch (step) {
          /* ==================================================
             0. SMTP GREETING
             ================================================== */

          case 0:
            if (code !== 220) {
              fail(
                `SMTP greeting error (${code}): ${line}`
              );

              return;
            }

            step = 1;

            send('EHLO localhost');

            break;

          /* ==================================================
             1. EHLO
             ================================================== */

          case 1:
            if (code !== 250) {
              fail(
                `SMTP EHLO failed (${code}): ${line}`
              );

              return;
            }

            if (!finalLine) {
              continue;
            }

            step = 2;

            send('AUTH LOGIN');

            break;

          /* ==================================================
             2. USERNAME PROMPT
             ================================================== */

          case 2:
            if (code !== 334) {
              fail(
                `AUTH LOGIN username prompt failed (${code}): ${line}`
              );

              return;
            }

            step = 3;

            send(b64(user));

            break;

          /* ==================================================
             3. PASSWORD PROMPT
             ================================================== */

          case 3:
            if (code !== 334) {
              fail(
                `AUTH LOGIN password prompt failed (${code}): ${line}`
              );

              return;
            }

            step = 4;

            send(b64(pass));

            break;

          /* ==================================================
             4. AUTHENTICATION RESULT
             ================================================== */

          case 4:
            if (code !== 235) {
              fail(
                `SMTP authentication failed (${code}): ${line}`
              );

              return;
            }

            step = 5;

            send(
              `MAIL FROM:<${from}>`
            );

            break;

          /* ==================================================
             5. MAIL FROM
             ================================================== */

          case 5:
            if (code !== 250) {
              fail(
                `MAIL FROM rejected (${code}): ${line}`
              );

              return;
            }

            step = 6;

            /*
             * Send all recipients.
             */
            send(
              `RCPT TO:<${toList[0]}>`
            );

            break;

          /* ==================================================
             6. RCPT TO
             ================================================== */

          case 6:
            if (
              code !== 250 &&
              code !== 251
            ) {
              fail(
                `RCPT TO rejected (${code}): ${line}`
              );

              return;
            }

            step = 7;

            send('DATA');

            break;

          /* ==================================================
             7. DATA
             ================================================== */

          case 7:
            if (code !== 354) {
              fail(
                `DATA command rejected (${code}): ${line}`
              );

              return;
            }

            step = 8;

            try {
              socket.write(
                dotStuff(mimeMessage) +
                '\r\n.\r\n'
              );
            } catch (error) {
              fail(
                `SMTP DATA error: ${
                  error && error.message
                    ? error.message
                    : String(error)
                }`
              );
            }

            break;

          /* ==================================================
             8. MESSAGE ACCEPTED
             ================================================== */

          case 8:
            if (code !== 250) {
              fail(
                `Message rejected (${code}): ${line}`
              );

              return;
            }

            step = 9;

            send('QUIT');

            break;

          /* ==================================================
             9. QUIT
             ================================================== */

          case 9:
            success({
              messageId:
                `<smtp-${Date.now()}@${host}>`,
              response: line,
            });

            if (
              socket &&
              !socket.destroyed
            ) {
              socket.destroy();
            }

            break;

          default:
            fail(
              `Unknown SMTP state: ${step}`
            );
        }
      }
    });

    /* --------------------------------------------------------
       SOCKET CLOSED
       -------------------------------------------------------- */

    socket.on('close', () => {
      if (!finished) {
        fail(
          'SMTP connection closed unexpectedly.'
        );
      }
    });
  });
}

/* ============================================================
   PUBLIC sendMail()
   ============================================================ */

async function sendMail({
  to,
  subject,
  html,
  attachments = [],
}) {
  const smtpHost =
    (process.env.SMTP_HOST || '').trim();

  /* ----------------------------------------------------------
     SMTP NOT CONFIGURED
     ---------------------------------------------------------- */

  if (!smtpHost) {
    const toAddress =
      Array.isArray(to)
        ? to.join(',')
        : to;

    console.log(
      `[email:DRY-RUN] To:${toAddress} | Subject:${subject}`
    );

    return {
      success: false,
      dryRun: true,
      error:
        'SMTP_HOST is not configured',
    };
  }

  /* ----------------------------------------------------------
     SMTP SETTINGS
     ---------------------------------------------------------- */

  const isGmail =
    smtpHost.toLowerCase() ===
    'smtp.gmail.com';

  /*
   * tls.connect() requires implicit TLS.
   *
   * Gmail:
   *     smtp.gmail.com
   *     port 465
   */

  const smtpPort = isGmail
    ? 465
    : Number(process.env.SMTP_PORT) || 465;

  const smtpUser =
    (process.env.SMTP_USER || '').trim();

  const smtpPass =
    process.env.SMTP_PASSWORD || '';

  const fromAddress =
    (
      process.env.SMTP_FROM ||
      smtpUser ||
      'no-reply@doc-automation.local'
    ).trim();

  const toList =
    Array.isArray(to)
      ? to.filter(Boolean)
      : [to].filter(Boolean);

  /* ----------------------------------------------------------
     VALIDATE CONFIGURATION
     ---------------------------------------------------------- */

  if (!smtpUser) {
    const error =
      'SMTP_USER is not configured.';

    console.error(
      '[email] send failed:',
      error
    );

    return {
      success: false,
      error,
    };
  }

  if (!smtpPass) {
    const error =
      'SMTP_PASSWORD is not configured.';

    console.error(
      '[email] send failed:',
      error
    );

    return {
      success: false,
      error,
    };
  }

  if (!toList.length) {
    const error =
      'Recipient email address is missing.';

    console.error(
      '[email] send failed:',
      error
    );

    return {
      success: false,
      error,
    };
  }

  console.log(
    `[email] Connecting to ${smtpHost}:${smtpPort} ` +
    `as ${smtpUser}`
  );

  try {
    /* --------------------------------------------------------
       BUILD MIME MESSAGE
       -------------------------------------------------------- */

    const mimeMessage =
      buildMimeMessage({
        from: fromAddress,
        to: toList,
        subject,
        html,
        attachments,
      });

    /* --------------------------------------------------------
       SEND EMAIL
       -------------------------------------------------------- */

    const info =
      await smtpSend({
        host: smtpHost,
        port: smtpPort,
        user: smtpUser,
        pass: smtpPass,
        from: fromAddress,
        to: toList,
        mimeMessage,
      });

    console.log(
      `[email] sent → ${toList.join(', ')} | ` +
      `msgId:${info.messageId}`
    );

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    const message =
      error && error.message
        ? error.message
        : String(error);

    console.error(
      '[email] send failed:',
      message
    );

    if (error) {
      console.error(
        '[email] error code:',
        error.code || 'N/A'
      );

      if (error.stack) {
        console.error(
          '[email] stack:',
          error.stack
        );
      }
    }

    return {
      success: false,
      error: message,
    };
  }
}

/* ============================================================
   EMAIL TEMPLATES
   ============================================================ */

const templates = {
  /* ==========================================================
     DOCUMENT READY FOR SIGNING
     ========================================================== */

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
      <p>Hi ${approverName || 'there'},</p>

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
      </p>

      ${otpNote || ''}
    `,
  }),

  /* ==========================================================
     DOCUMENT SIGNED
     ========================================================== */

  docSigned: ({
    generatorName,
    docId,
    reviewUrl,
  }) => ({
    subject:
      `Document ${docId} has been signed`,

    html: `
      <p>
        Hi ${generatorName || 'there'},
      </p>

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

  /* ==========================================================
     DOCUMENT REJECTED
     ========================================================== */

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
        Hi ${generatorName || 'there'},
      </p>

      <p>
        Document <b>${docId}</b>
        was rejected.
      </p>

      <p>
        <b>Reason:</b>
        ${reason || 'No reason provided.'}
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

  /* ==========================================================
     24-HOUR REMINDER
     ========================================================== */

  reminder24h: ({
    approverName,
    docId,
  }) => ({
    subject:
      `Reminder: Document ${docId} still awaiting signature`,

    html: `
      <p>
        Hi ${approverName || 'there'},
      </p>

      <p>
        Document <b>${docId}</b>
        is still pending your review.
      </p>
    `,
  }),

  /* ==========================================================
     72-HOUR ESCALATION
     ========================================================== */

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
        has remained unsigned for 72+ hours.
      </p>

      <p>
        <b>Generator:</b>
        ${generatorName || 'N/A'}
      </p>

      <p>
        <b>Approver:</b>
        ${approverName || 'N/A'}
      </p>
    `,
  }),

  /* ==========================================================
     DELIVERY READY
     ========================================================== */

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
        Your document
        <b>${docId}</b>
        is ready.
      </p>

      <p>
        <a href="${downloadUrl}">
          Open secure link
        </a>
        <br>
        <small>
          Link expires in 7 days.
        </small>
      </p>
    `,
  }),

  /* ==========================================================
     SECURE LINK READY
     ========================================================== */

  secureLinkReady: ({
    docId,
    downloadUrl,
  }) => ({
    subject:
      `A document (${docId}) has been shared with you`,

    html: `
      <p>Hi,</p>

      <p>
        A document has been shared with you.
      </p>

      <p>
        <a href="${downloadUrl}">
          Open secure link
        </a>
      </p>

      <p>
        <small>
          The link expires in 7 days
          and can be used only once.
        </small>
      </p>
    `,
  }),

  /* ==========================================================
     DOCUMENT ATTACHED
     ========================================================== */

  documentAttached: ({
    docId,
  }) => ({
    subject:
      `Document ${docId}`,

    html: `
      <p>Hi,</p>

      <p>
        Please find your document attached.
      </p>

      <p>
        Document ID:
        <b>${docId}</b>
      </p>
    `,
  }),

  /* ==========================================================
     PASSWORD RESET
     ========================================================== */

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
        We received a request to reset
        your Doc Automation password.
      </p>

      <p>
        <a
          href="${resetUrl}"
          style="
            display:inline-block;
            padding:10px 20px;
            background:#0F2747;
            color:#ffffff;
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
        Expires in 1 hour and can be used
        only once.
        Ignore this email if you didn't
        request a password reset.
      </p>
    `,
  }),

  /* ==========================================================
     SECURE DELIVERY READY
     ========================================================== */

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
        A document requires your confirmation
        before download.
      </p>

      <p>
        <a href="${secureUrl}">
          Open the secure document link
        </a>
      </p>

      <p>
        <small>
          The secure link is single-use
          and expires in 7 days.
        </small>
      </p>

      <p>
        Your one-time code:
        <b>${otpCode}</b>
      </p>

      <p>
        <small>
          The OTP expires in 5 minutes.
        </small>
      </p>
    `,
  }),

  /* ==========================================================
     SECURE DELIVERY PLAIN COPY
     ========================================================== */

  secureDeliveryPlainCopy: ({
    docId,
  }) => ({
    subject:
      `Document ${docId} (copy)`,

    html: `
      <p>Hi,</p>

      <p>
        Please find a copy of your document
        attached.
      </p>

      <p>
        Document ID:
        <b>${docId}</b>
      </p>
    `,
  }),

  /* ==========================================================
     DELIVERY OWNED
     ========================================================== */

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
        <b>
          ${recipientName || 'The recipient'}
        </b>
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
            color:#ffffff;
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

  /* ==========================================================
     OWNERSHIP REJECTED
     ========================================================== */

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
        <b>
          ${recipientName || 'The recipient'}
        </b>
        rejected document
        <b>${docId}</b>.
      </p>

      <p>
        <b>Reason:</b>
      </p>

      <p>
        ${reason || 'No reason provided.'}
      </p>

      <p>
        Download link blocked.
        Please verify the recipient
        and re-send the document.
      </p>
    `,
  }),

  /* ==========================================================
     OWNERSHIP REJECTED WITH LINK
     ========================================================== */

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
        <b>
          ${recipientName || 'The recipient'}
        </b>
        rejected document
        <b>${docId}</b>.
      </p>

      <p>
        <b>Reason:</b>
      </p>

      <p>
        ${reason || 'No reason provided.'}
      </p>

      <p>
        <a
          href="${reviewUrl}"
          style="
            display:inline-block;
            padding:10px 20px;
            background:#6366F1;
            color:#ffffff;
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

/* ============================================================
   EXPORTS
   ============================================================ */

module.exports = {
  sendMail,
  templates,
};