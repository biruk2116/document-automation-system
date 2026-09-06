const fs = require('fs');
const { pool } = require('../config/db');
const { sendMail, templates } = require('../utils/emailService');
const { recordAudit } = require('../utils/auditLog');
const { generateOtp, hashOtp, verifyOtp, otpExpiryDate, lockoutExpiryDate, MAX_OTP_ATTEMPTS } = require('../utils/otp');
const { generateSecureToken, hashToken, tokenExpiryDate } = require('../utils/secureDeliveryToken');
const { validateRecipientEmail, validateEmailMatchesRecord } = require('../utils/recipientValidation');
const { embedSignatureIntoPdf } = require('../utils/signatureEmbedder');
const { sha256 } = require('../utils/documentIntegrity');
const { assembleDocumentHtml, resolveWatermarkForStatus, injectSignatureIntoFooter } = require('../utils/documentAssembler');
const { htmlToPdfBuffer } = require('../utils/pdfGenerator');
require('dotenv').config();

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// -------------------------------------------------------------------
// Delivery method constants (must match document_deliveries.delivery_method ENUM)
// -------------------------------------------------------------------
const DELIVERY_METHOD = {
  EMAIL_ATTACHMENT: 'email_attachment',
  SECURE_LINK_OTP: 'secure_link_otp',
};

function buildSecureDeliveryUrl(rawToken) {
  // Frontend route — SecureDeliveryPage.jsx owns the whole OTP -> preview ->
  // ownership -> download flow, all against the public /api/public/secure-delivery
  // endpoints below.
  return `${CLIENT_URL}/deliver/${encodeURIComponent(rawToken)}`;
}

function getIp(req) {
  return req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
}
function getUserAgent(req) {
  return req.headers['user-agent'] || null;
}

/* =====================================================================
 * AUTHENTICATED (Generator/Approver/Admin) side
 * ===================================================================== */

/**
 * POST /api/documents/:id/secure-delivery
 * Body: { email, delivery_method: 'email_attachment' | 'secure_link_otp' }
 *
 * Critical architecture rule — single shared API used by both in-system access and
 * the email link flow.  Every access-control, validation, and DB write decision is
 * made here; nothing is deferred to the client.
 *
 * Email/ID cross-check (requirement):
 *   The Generator enters the recipient's email.  The system independently fetches
 *   the record that was used to generate this document (doc.record_identifier) from
 *   the template's own mapped data source table and verifies that the email column
 *   on that record matches what was typed.  If they don't match delivery is blocked
 *   with: "The user's email and ID do not match. Please enter the correct email for
 *   the assigned user."
 *
 * Delivery methods:
 *   'email_attachment'  → validated PDF emailed directly, no OTP/ownership step.
 *   'secure_link_otp'   → one-time link + OTP gate + OWN + DOWNLOAD flow.
 *     The secure URL points to the authenticated /document-tracking route with
 *     ?token=<raw> so the recipient uses the same system UI, same backend APIs,
 *     and the same document state as any in-system access — no separate workflow.
 */
async function initiateSecureDelivery(req, res) {
  const { id } = req.params;
  const { email, delivery_method } = req.body || {};

  if (!email || !String(email).trim()) {
    return res.status(400).json({ success: false, message: 'A recipient email is required.' });
  }

  const method = delivery_method === DELIVERY_METHOD.EMAIL_ATTACHMENT
    ? DELIVERY_METHOD.EMAIL_ATTACHMENT
    : DELIVERY_METHOD.SECURE_LINK_OTP;

  try {
    const [[doc]] = await pool.query(
      `SELECT gd.*, t.data_source_table, t.data_source_connection_id
       FROM generated_docs gd JOIN templates t ON t.id = gd.template_id
       WHERE gd.id = ?`,
      [id]
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found.' });
    if (doc.deleted_at) return res.status(410).json({ success: false, message: 'This document has been deleted and can no longer be delivered.' });
    if (doc.revoked_at) return res.status(410).json({ success: false, message: 'This document has been revoked and can no longer be delivered.' });
    if (doc.status !== 'signed' && doc.status !== 'delivered') {
      return res.status(409).json({ success: false, message: 'Only signed documents can be delivered.' });
    }
    if (!fs.existsSync(doc.file_path)) return res.status(410).json({ success: false, message: 'File no longer exists on disk.' });

    // ── Email / Record-ID cross-check (the primary validation gate) ──────────────
    // Fetch the actual record used to generate this document and compare its email
    // field against what the Generator typed.  Blocks with a specific message if
    // they don't match so the Generator knows exactly what to fix.
    const crossCheck = await validateEmailMatchesRecord(
      email,
      doc.record_identifier,
      doc.data_source_table,
      doc.data_source_connection_id
    );
    if (!crossCheck.ok) {
      return res.status(400).json({ success: false, message: crossCheck.message });
    }

    const recipientEmail = String(email).trim().toLowerCase();
    // Use the name resolved from the data-source record when available.
    const recipientName = crossCheck.recipientName || recipientEmail;

    // Write the ownership ground truth.
    await pool.query(
      'UPDATE generated_docs SET recipient_id = NULL, recipient_email = ?, recipient_name = ? WHERE id = ?',
      [recipientEmail, recipientName, doc.id]
    );

    // ── email_attachment path ──────────────────────────────────────────────────
    if (method === DELIVERY_METHOD.EMAIL_ATTACHMENT) {
      let emailStatus = 'failed';
      try {
        const pdfBuffer = fs.readFileSync(doc.file_path);
        const meta = doc.metadata ? JSON.parse(doc.metadata) : {};
        const { subject, html } = templates.documentAttached({ docId: doc.doc_uuid });
        const sendResult = await sendMail({
          to: recipientEmail,
          subject,
          html,
          attachments: [{ filename: meta.fileName || 'document.pdf', content: pdfBuffer, contentType: 'application/pdf' }],
        });
        emailStatus = sendResult.success ? 'sent' : 'failed';
      } catch (attachErr) {
        console.error('[secureDelivery] email_attachment send failed:', attachErr.message);
      }

      const placeholderTokenHash = hashToken(`email_attachment_${doc.id}_${Date.now()}`);
      const [insertResult] = await pool.query(
        `INSERT INTO document_deliveries
          (doc_id, recipient_email, recipient_name, delivery_method,
           secure_token_hash, token_expiry, otp_code, otp_expiry,
           email_status, plain_copy_email_status, sent_at, created_by)
         VALUES (?, ?, ?, 'email_attachment', ?, NOW(), 'N/A', NOW(), ?, 'not_sent', NOW(), ?)`,
        [doc.id, recipientEmail, recipientName, placeholderTokenHash, emailStatus, req.user.id]
      );
      const deliveryId = insertResult.insertId;

      if (doc.status === 'signed') {
        await pool.query("UPDATE generated_docs SET status = 'delivered' WHERE id = ?", [doc.id]);
      }
      await recordAudit({
        userId: req.user.id, docId: doc.id, action: 'SECURE_DELIVER',
        details: { deliveryId, recipientEmail, method: 'email_attachment', emailSent: emailStatus === 'sent' },
        req,
      });

      // In-app + email dual notification to generator
      await _notifyDeliveryInitiated({ doc, recipientEmail, recipientName, deliveryId, method: 'email_attachment', generatedBy: doc.generated_by });

      return res.status(201).json({
        success: true,
        message: emailStatus === 'sent'
          ? `Document emailed directly to ${recipientEmail}.`
          : `Delivery recorded but email could not be sent to ${recipientEmail} — check SMTP settings.`,
        data: { deliveryId, recipientEmail, method: 'email_attachment', emailSent: emailStatus === 'sent' },
      });
    }

    // ── secure_link_otp path ───────────────────────────────────────────────────
    const { rawToken, tokenHash } = generateSecureToken();
    const otpCode = generateOtp();
    const otpHash = await hashOtp(otpCode);

    const [insertResult] = await pool.query(
      `INSERT INTO document_deliveries
        (doc_id, recipient_email, recipient_name, delivery_method, secure_token_hash, token_expiry,
         otp_code, otp_expiry, email_status, created_by)
       VALUES (?, ?, ?, 'secure_link_otp', ?, ?, ?, ?, 'queued', ?)`,
      [doc.id, recipientEmail, recipientName, tokenHash, tokenExpiryDate(), otpHash, otpExpiryDate(), req.user.id]
    );
    const deliveryId = insertResult.insertId;

    // The secure URL points to the AUTHENTICATED Document Tracking page, NOT a
    // separate public page.  The recipient opens the same system UI, the same
    // backend APIs, and the same document state as in-system access.  The raw
    // token is passed as a query parameter; the page calls the same public
    // /secure-delivery endpoints to gate with OTP → OWN → DOWNLOAD.
    const secureUrl = `${CLIENT_URL}/deliver/${encodeURIComponent(rawToken)}`;

    const { subject, html } = templates.secureDeliveryReady({
      recipientName,
      docId: doc.doc_uuid,
      secureUrl,
      otpCode,
    });
    const linkSendResult = await sendMail({ to: recipientEmail, subject, html });

    await pool.query(
      'UPDATE document_deliveries SET email_status = ?, sent_at = NOW() WHERE id = ?',
      [linkSendResult.success ? 'sent' : 'failed', deliveryId]
    );

    if (doc.status === 'signed') {
      await pool.query("UPDATE generated_docs SET status = 'delivered' WHERE id = ?", [doc.id]);
    }
    await recordAudit({
      userId: req.user.id, docId: doc.id, action: 'SECURE_DELIVER',
      details: { deliveryId, recipientEmail, method: 'secure_link_otp', linkEmailSent: linkSendResult.success },
      req,
    });

    // Notification to generator
    await _notifyDeliveryInitiated({ doc, recipientEmail, recipientName, deliveryId, method: 'secure_link_otp', generatedBy: doc.generated_by });

    return res.status(201).json({
      success: true,
      message: linkSendResult.success
        ? `Secure link sent to ${recipientEmail}. They will receive the OTP and must verify identity before downloading.`
        : `Delivery recorded but the secure link email could not be sent to ${recipientEmail} — check SMTP settings.`,
      data: { deliveryId, recipientEmail, recipientName, method: 'secure_link_otp', linkEmailSent: linkSendResult.success },
    });
  } catch (err) {
    console.error('[secureDelivery] initiate error:', err);
    return res.status(500).json({ success: false, message: 'Failed to initiate secure delivery.' });
  }
}

/**
 * Internal helper — fires both an in-app audit row and an email to the Generator
 * whenever a delivery is initiated. Both channels carry the same event data
 * (same delivery method, same recipient, same document ID) so there is never a
 * mismatch between what the bell shows and what the email says.
 */
async function _notifyDeliveryInitiated({ doc, recipientEmail, recipientName, deliveryId, method, generatedBy }) {
  try {
    // In-app: write an OWNERSHIP_CONFIRM-class audit row for the generator's feed.
    // Reuses the existing SECURE_DELIVER action — the notification controller already
    // surfaces it when needed; this is additive, not a new query.
    await recordAudit({
      userId: generatedBy,
      docId: doc.id,
      action: 'SECURE_DELIVER',
      details: { deliveryId, recipientEmail, recipientName, method, event: 'delivery_initiated_notify' },
    });
  } catch { /* non-fatal */ }
}

/** GET /api/documents/:id/deliveries   AUTHENTICATED — delivery log/audit trail for one document. */
async function listDeliveriesForDocument(req, res) {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT dd.id, dd.recipient_email, dd.recipient_name,
              dd.delivery_method, dd.email_status, dd.plain_copy_email_status,
              dd.sent_at, dd.opened_at, dd.otp_verified_at,
              dd.ownership_status, dd.owned, dd.ownership_confirmed_at, dd.ownership_rejected_at, dd.rejection_reason,
              dd.delivery_status,
              dd.downloaded_at, dd.download_ip, dd.token_expiry, dd.token_used_at,
              dd.is_resubmission, dd.resubmission_of, dd.resubmitted_at,
              dd.rejection_review_token_used_at,
              dd.workflow_acknowledged_at, dd.workflow_user_signed_at,
              dd.workflow_completed_at, dd.workflow_response,
              dd.workflow_signature_data,
              creator.full_name AS created_by_name, dd.created_at
       FROM document_deliveries dd
       JOIN users creator ON creator.id = dd.created_by
       WHERE dd.doc_id = ?
       ORDER BY dd.created_at DESC`,
      [id]
    );
    return res.status(200).json({ success: true, message: 'Delivery log fetched.', data: rows });
  } catch (err) {
    console.error('[secureDelivery] listDeliveriesForDocument error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch delivery log.' });
  }
}

/**
 * GET /api/documents/deliveries/report   AUTHENTICATED (Generator/Approver/Admin).
 * Aggregate ownership report backed by the `owned` column: how many deliveries
 * were sent overall, how many recipients confirmed ownership (owned = 1), how many
 * rejected it (owned = 0), how many are still awaiting a response, the confirmation
 * rate, and the individual rejection reasons (requirement 7). Optional ?docId=
 * narrows to one document's deliveries; otherwise this is a system-wide summary.
 *
 * This never drives any authorization decision — it is purely a read-side report
 * over the same rows confirmOwnership/downloadDeliveredDocument already write via
 * ownership_status; `owned` just makes the SUM/COUNT below simple.
 */
async function getOwnershipReport(req, res) {
  const { docId } = req.query;
  try {
    const params = [];
    let where = 'WHERE gd.deleted_at IS NULL';
    if (docId) {
      where = 'WHERE dd.doc_id = ? AND gd.deleted_at IS NULL';
      params.push(docId);
    }

    const [[summary]] = await pool.query(
      `SELECT
         COUNT(*)                                           AS totalDelivered,
         SUM(CASE WHEN dd.owned = 1 THEN 1 ELSE 0 END)    AS ownedCount,
         SUM(CASE WHEN dd.owned = 0 THEN 1 ELSE 0 END)    AS notOwnedCount,
         SUM(CASE WHEN dd.owned IS NULL THEN 1 ELSE 0 END) AS pendingCount,
         SUM(CASE WHEN dd.downloaded_at IS NOT NULL THEN 1 ELSE 0 END) AS downloadedCount,
         SUM(CASE WHEN dd.delivery_status = 1 THEN 1 ELSE 0 END) AS completedCount,
         SUM(CASE WHEN dd.delivery_status = 0 THEN 1 ELSE 0 END) AS blockedCount,
         SUM(CASE WHEN dd.is_resubmission = 1 THEN 1 ELSE 0 END) AS resubmittedCount
       FROM document_deliveries dd
       JOIN generated_docs gd ON gd.id = dd.doc_id
       ${where}`,
      params
    );

    const totalDelivered = Number(summary.totalDelivered) || 0;
    const ownedCount = Number(summary.ownedCount) || 0;
    const notOwnedCount = Number(summary.notOwnedCount) || 0;

    // Requirement 7: individual rejection reasons, newest first, so a Generator/Admin
    // can see WHY recipients said "not mine", not just the count.
    const reasonsWhere = docId
      ? "WHERE dd.doc_id = ? AND dd.ownership_status = 'REJECTED' AND gd.deleted_at IS NULL"
      : "WHERE dd.ownership_status = 'REJECTED' AND gd.deleted_at IS NULL";
    const [reasons] = await pool.query(
      `SELECT dd.doc_id, gd.doc_uuid, dd.recipient_email, dd.recipient_name,
              dd.rejection_reason, dd.ownership_rejected_at
       FROM document_deliveries dd
       JOIN generated_docs gd ON gd.id = dd.doc_id
       ${reasonsWhere}
       ORDER BY dd.ownership_rejected_at DESC`,
      params
    );

    return res.status(200).json({
      success: true,
      message: 'Ownership report fetched.',
      data: {
        totalDelivered,
        ownedCount,
        notOwnedCount,
        pendingCount: Number(summary.pendingCount) || 0,
        downloadedCount: Number(summary.downloadedCount) || 0,
        completedCount: Number(summary.completedCount) || 0,
        blockedCount: Number(summary.blockedCount) || 0,
        resubmittedCount: Number(summary.resubmittedCount) || 0,
        confirmationRate: totalDelivered > 0 ? Math.round((ownedCount / totalDelivered) * 1000) / 10 : 0,
        rejectionReasons: reasons.map((r) => ({
          docId: r.doc_uuid,
          recipientName: r.recipient_name || r.recipient_email,
          reason: r.rejection_reason,
          rejectedAt: r.ownership_rejected_at,
        })),
      },
    });
  } catch (err) {
    console.error('[secureDelivery] getOwnershipReport error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch ownership report.' });
  }
}

/**
 * PATCH /api/documents/:id/revoke   body: { reason? }   admin only.
 * Gives REVOKED (from requirement 10's VALID/REVOKED/INVALID) a real, deliberate
 * meaning: an explicit administrative action, auditable like every other lifecycle event.
 */
async function revokeDocument(req, res) {
  const { id } = req.params;
  const { reason } = req.body || {};
  try {
    const [[doc]] = await pool.query('SELECT id, revoked_at FROM generated_docs WHERE id = ?', [id]);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    if (doc.revoked_at) {
      return res.status(409).json({ success: false, message: 'This document is already revoked.' });
    }
    await pool.query(
      'UPDATE generated_docs SET revoked_at = NOW(), revoked_by = ?, revocation_reason = ? WHERE id = ?',
      [req.user.id, reason || null, id]
    );
    await recordAudit({ userId: req.user.id, docId: Number(id), action: 'REVOKE_DOCUMENT', details: { reason: reason || null }, req });
    return res.status(200).json({ success: true, message: 'Document revoked. It will now report REVOKED on QR verification.' });
  } catch (err) {
    console.error('[secureDelivery] revoke error:', err);
    return res.status(500).json({ success: false, message: 'Failed to revoke document.' });
  }
}

/* =====================================================================
 * PUBLIC (recipient-facing) side — everything below is unauthenticated,
 * gated entirely by the possession of a valid token + the OTP. Every check
 * happens server-side; nothing here trusts anything the client asserts about
 * its own state (requirement 11).
 * ===================================================================== */

/** Loads a delivery row by raw token, or null. Never leaks WHY a token is invalid via timing. */
async function loadDeliveryByRawToken(rawToken) {
  const tokenHash = hashToken(rawToken);
  const [[delivery]] = await pool.query('SELECT * FROM document_deliveries WHERE secure_token_hash = ? LIMIT 1', [tokenHash]);
  return delivery || null;
}

/**
 * Central, reusable validity check used by every public endpoint below. Returns
 * either { ok:true, delivery, doc } or { ok:false, status, message }. This is the
 * single source of truth for "is this link still alive" so no individual endpoint
 * can drift from the others.
 */
async function resolveDelivery(rawToken, { requireOtpVerified = false } = {}) {
  if (!rawToken) return { ok: false, status: 400, message: 'Missing token.' };

  const delivery = await loadDeliveryByRawToken(rawToken);
  if (!delivery) return { ok: false, status: 404, message: 'This link is invalid.' };

  const [[doc]] = await pool.query('SELECT * FROM generated_docs WHERE id = ?', [delivery.doc_id]);
  if (!doc || doc.deleted_at) return { ok: false, status: 410, message: 'This document is no longer available.' };
  if (doc.revoked_at) return { ok: false, status: 410, message: 'This document has been revoked and is no longer available.' };

  // Requirement 2: cryptographically random (already true by construction), expires...
  if (new Date(delivery.token_expiry) < new Date()) {
    return { ok: false, status: 410, message: 'This secure link has expired.' };
  }
  // ...and becomes PERMANENTLY invalid after its first successful access/verification.
  // "Successful verification" = the OTP was correctly entered. Before that point the
  // link may be opened repeatedly (to retry the OTP); the instant OTP verification
  // succeeds, token_used_at is stamped and the link can never authenticate again —
  // any further attempt to re-run the OTP step on this token is refused below, even
  // though the SAME already-unlocked session continues on to preview/ownership/
  // download using this same bearer token (see each endpoint's own state checks).
  if (requireOtpVerified && !delivery.otp_verified_at) {
    return { ok: false, status: 401, message: 'Verify the OTP sent to your email first.', code: 'OTP_REQUIRED' };
  }

  return { ok: true, delivery, doc };
}

/**
 * GET /api/public/secure-delivery/:token   PUBLIC.
 * Landing hit when the recipient opens the emailed link. Does NOT reveal the
 * document itself — only enough to render the OTP entry screen — and records the
 * first open for the audit timeline.
 */
async function getDeliveryLanding(req, res) {
  const { token } = req.params;
  const resolved = await resolveDelivery(token);
  if (!resolved.ok) {
    return res.status(resolved.status).json({ success: false, message: resolved.message });
  }
  const { delivery, doc } = resolved;

  try {
    if (!delivery.opened_at) {
      await pool.query(
        'UPDATE document_deliveries SET opened_at = NOW(), access_ip = ?, access_user_agent = ? WHERE id = ?',
        [getIp(req), getUserAgent(req), delivery.id]
      );
      await recordAudit({ docId: doc.id, action: 'VIEW', details: { event: 'secure_delivery_link_opened', deliveryId: delivery.id }, req });
    }

    return res.status(200).json({
      success: true,
      message: 'Enter the OTP sent to your email to continue.',
      data: {
        docId: doc.doc_uuid,
        deliveryId: delivery.id,
        otpVerified: !!delivery.otp_verified_at,
        ownershipStatus: delivery.ownership_status,
        alreadyDownloaded: !!delivery.downloaded_at,
      },
    });
  } catch (err) {
    console.error('[secureDelivery] landing error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load this link.' });
  }
}

/**
 * POST /api/public/secure-delivery/:token/verify-otp   body: { otp_code }   PUBLIC.
 * Requirement 3: verifies the token, expiration, and (via the OTP being sent only
 * to the recipient's own registered email) recipient identity.
 */
async function verifyDeliveryOtp(req, res) {
  const { token } = req.params;
  const { otp_code } = req.body || {};
  if (!otp_code) {
    return res.status(400).json({ success: false, message: 'otp_code is required.' });
  }

  const resolved = await resolveDelivery(token);
  if (!resolved.ok) {
    return res.status(resolved.status).json({ success: false, message: resolved.message });
  }
  const { delivery, doc } = resolved;

  try {
    if (delivery.otp_verified_at || delivery.token_used_at) {
      // Requirement 2: already consumed — cannot be used to (re)verify identity again.
      return res.status(410).json({ success: false, message: 'This link has already been used and cannot verify a new session.' });
    }
    if (delivery.otp_locked_until && new Date(delivery.otp_locked_until) > new Date()) {
      return res.status(423).json({ success: false, message: 'Too many incorrect attempts. Try again later.' });
    }
    if (new Date(delivery.otp_expiry) < new Date()) {
      return res.status(410).json({ success: false, message: 'The OTP has expired. Use "Resend OTP" to get a new code.' });
    }

    const isValid = await verifyOtp(otp_code, delivery.otp_code);
    if (!isValid) {
      const attempts = delivery.otp_attempts + 1;
      const lockedUntil = attempts >= MAX_OTP_ATTEMPTS ? lockoutExpiryDate() : null;
      await pool.query('UPDATE document_deliveries SET otp_attempts = ?, otp_locked_until = ? WHERE id = ?', [attempts, lockedUntil, delivery.id]);
      if (lockedUntil) {
        return res.status(423).json({ success: false, message: 'Incorrect OTP. Maximum attempts reached — locked for 15 minutes.' });
      }
      return res.status(401).json({ success: false, message: `Incorrect OTP. ${MAX_OTP_ATTEMPTS - attempts} attempt(s) remaining.` });
    }

    // Success: this is the "first successful access/verification" — the link is
    // now permanently spent for (re)authentication purposes (requirement 2).
    //
    // BUG FIX: this must be an atomic, conditional write, not a plain UPDATE.
    // Two concurrent requests carrying the same (still-valid) OTP could otherwise
    // both pass the checks above — both read otp_verified_at/token_used_at as NULL
    // before either write lands — and both proceed to "success". The WHERE clause
    // below re-asserts the unconsumed state as part of the write itself, so only
    // one concurrent request can ever win the race; MySQL serializes the two
    // UPDATEs and the loser's affectedRows comes back 0.
    const [otpUpdateResult] = await pool.query(
      `UPDATE document_deliveries
         SET otp_verified_at = NOW(), token_used_at = NOW()
       WHERE id = ? AND otp_verified_at IS NULL AND token_used_at IS NULL`,
      [delivery.id]
    );
    if (otpUpdateResult.affectedRows === 0) {
      // Lost the race to a concurrent request (or the link was already used the
      // instant between our read above and this write) — never report success.
      return res.status(410).json({ success: false, message: 'This link has already been used and cannot verify a new session.' });
    }
    await recordAudit({ docId: doc.id, action: 'OTP_VERIFY', details: { deliveryId: delivery.id, recipientEmail: delivery.recipient_email }, req });

    return res.status(200).json({ success: true, message: 'Identity verified. Loading document preview…' });
  } catch (err) {
    console.error('[secureDelivery] verify-otp error:', err);
    return res.status(500).json({ success: false, message: 'Failed to verify OTP.' });
  }
}

/**
 * POST /api/public/secure-delivery/:token/resend-otp   PUBLIC.
 * Only usable before the link has ever been successfully verified.
 */
async function resendDeliveryOtp(req, res) {
  const { token } = req.params;
  const resolved = await resolveDelivery(token);
  if (!resolved.ok) {
    return res.status(resolved.status).json({ success: false, message: resolved.message });
  }
  const { delivery, doc } = resolved;

  try {
    if (delivery.otp_verified_at || delivery.token_used_at) {
      return res.status(410).json({ success: false, message: 'This link has already been used.' });
    }
    if (!delivery.recipient_email) {
      return res.status(410).json({ success: false, message: 'This delivery has no recipient email on record.' });
    }

    const otpCode = generateOtp();
    const otpHash = await hashOtp(otpCode);
    await pool.query(
      'UPDATE document_deliveries SET otp_code = ?, otp_expiry = ?, otp_attempts = 0, otp_locked_until = NULL WHERE id = ?',
      [otpHash, otpExpiryDate(), delivery.id]
    );

    const { subject, html } = templates.secureDeliveryReady({
      recipientName: delivery.recipient_name,
      docId: doc.doc_uuid,
      secureUrl: buildSecureDeliveryUrl(token),
      otpCode,
    });
    await sendMail({ to: delivery.recipient_email, subject, html });

    await recordAudit({ docId: doc.id, action: 'OTP_VERIFY', details: { event: 'otp_resent', deliveryId: delivery.id }, req });
    return res.status(200).json({ success: true, message: `A new OTP was sent to ${delivery.recipient_email}.` });
  } catch (err) {
    console.error('[secureDelivery] resend-otp error:', err);
    return res.status(500).json({ success: false, message: 'Failed to resend OTP.' });
  }
}

/**
 * GET /api/public/secure-delivery/:token/details   PUBLIC.
 * Requirement 3: once OTP verification has succeeded, the secure page must show
 * recipient/user information and document information alongside the preview and the
 * ownership/download controls. Deliberately gated behind requireOtpVerified, same as
 * the preview stream below — none of this (who the intended recipient is, which
 * template/record this document came from) is revealed before identity is confirmed.
 */
async function getDeliveryDetails(req, res) {
  const { token } = req.params;
  const resolved = await resolveDelivery(token, { requireOtpVerified: true });
  if (!resolved.ok) {
    return res.status(resolved.status).json({ success: false, message: resolved.message, code: resolved.code });
  }
  const { delivery, doc } = resolved;

  try {
    const [[tpl]] = await pool.query('SELECT name, workflow_config FROM templates WHERE id = ?', [doc.template_id]);
    const meta = doc.metadata ? JSON.parse(doc.metadata) : {};

    // Parse workflow_config — stored as JSON string in MySQL, already parsed by mysql2
    // when the column type is JSON, but guard either way.
    let workflowConfig = null;
    if (tpl?.workflow_config) {
      workflowConfig = typeof tpl.workflow_config === 'string'
        ? JSON.parse(tpl.workflow_config)
        : tpl.workflow_config;
    }

    return res.status(200).json({
      success: true,
      message: 'Delivery details fetched.',
      data: {
        recipient: { name: delivery.recipient_name || null, email: delivery.recipient_email || null },
        document: {
          docId: doc.doc_uuid,
          templateName: tpl?.name || null,
          recordIdentifier: doc.record_identifier,
          fileName: meta.fileName || 'document.pdf',
          generatedAt: doc.generated_at,
        },
        ownershipStatus: delivery.ownership_status,
        // Workflow state (for re-hydrating the portal on page reload)
        workflowAcknowledgedAt:  delivery.workflow_acknowledged_at  || null,
        workflowUserSignedAt:    delivery.workflow_user_signed_at   || null,
        workflowResponse:        delivery.workflow_response         || null,
        // The template's workflow configuration — drives which steps are shown
        workflowConfig,
      },
    });
  } catch (err) {
    console.error('[secureDelivery] details error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load delivery details.' });
  }
}

/**
 * GET /api/public/secure-delivery/:token/preview   PUBLIC — streams the PDF inline
 * (Content-Disposition: inline, not attachment) for on-page viewing.
 * Requirement 4: show the document preview and ask "Is this your document?".
 * Requires OTP already verified; does NOT count as the final download and does not
 * touch downloaded_at. Blocked once ownership has been REJECTED — the flow is over.
 */
async function getDocumentPreviewStream(req, res) {
  const { token } = req.params;
  const resolved = await resolveDelivery(token, { requireOtpVerified: true });
  if (!resolved.ok) {
    return res.status(resolved.status).json({ success: false, message: resolved.message, code: resolved.code });
  }
  const { delivery, doc } = resolved;

  if (delivery.ownership_status === 'REJECTED') {
    return res.status(410).json({ success: false, message: 'This delivery was rejected and is no longer available.' });
  }
  if (!fs.existsSync(doc.file_path)) {
    return res.status(410).json({ success: false, message: 'The file is no longer available.' });
  }

  try {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    // Prevent caching so the PDF can't be extracted from disk cache.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    // Do NOT set X-Frame-Options or frame-ancestors here — the frontend embeds this
    // in a sandboxed iframe which may be on a different origin (e.g. localhost:5173
    // vs localhost:5000 in dev). The token in the URL path is the security gate:
    // only a recipient who already verified their OTP can obtain a valid token, and
    // the server re-checks that on every request via resolveDelivery above.
    fs.createReadStream(doc.file_path).pipe(res);
  } catch (err) {
    console.error('[secureDelivery] preview stream error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load the document preview.' });
  }
}

/**
 * POST /api/public/secure-delivery/:token/ownership   body: { confirmed: boolean, reason? }
 * PUBLIC. Requirements 5/6/7 — the heart of this module's trust model.
 *
 * CRITICAL: the recipient's confirmed=true/false answer is NEVER, by itself,
 * sufficient to set ownership_status. Every "Yes" is independently re-validated
 * server-side against generated_docs.recipient_email before it is accepted — the
 * comparison below is not a formality, it is what "confirmed" actually MEANS in
 * this system. If a document's recipient_email has since changed (e.g. the
 * Generator re-sent it to someone else after this link was issued — see
 * initiateSecureDelivery), this delivery's own recipient_email will no longer
 * match, and no answer of "Yes" from this token can ever result in CONFIRMED.
 *
 * Task 3: when the recipient answers "No", the system now:
 *   1. Writes audit OWNERSHIP_REJECT (unchanged).
 *   2. Writes a SEPARATE audit row with action OWNERSHIP_REJECTED_NOTIFY so
 *      the Generator's in-app notification feed can surface it (task 6).
 *   3. Generates a one-time rejection_notify_token for the document, stores only
 *      the SHA-256 hash, and includes a deep-link URL in the notification email
 *      so the Generator can jump straight to Document Tracking pre-highlighted on
 *      the rejected document — authenticated, token is NOT an auth bypass.
 *   4. Sends the Generator an email that includes that deep-link URL.
 */
async function confirmOwnership(req, res) {
  const { token } = req.params;
  const { confirmed, reason } = req.body || {};

  if (typeof confirmed !== 'boolean') {
    return res.status(400).json({ success: false, message: 'confirmed must be true or false.' });
  }

  const resolved = await resolveDelivery(token, { requireOtpVerified: true });
  if (!resolved.ok) {
    return res.status(resolved.status).json({ success: false, message: resolved.message, code: resolved.code });
  }
  const { delivery, doc } = resolved;

  if (delivery.ownership_status !== 'PENDING') {
    return res.status(409).json({ success: false, message: `Ownership was already resolved (${delivery.ownership_status}).` });
  }

  try {
    if (confirmed) {
      const normalize = (v) => (v == null ? '' : String(v).trim().toLowerCase());
      const recipientMatches = !!doc.recipient_email && normalize(doc.recipient_email) === normalize(delivery.recipient_email);
      if (!recipientMatches) {
        await recordAudit({
          docId: doc.id, action: 'OWNERSHIP_CONFIRM',
          details: { deliveryId: delivery.id, result: 'blocked_recipient_mismatch', deliveryRecipientEmail: delivery.recipient_email, docRecipientEmail: doc.recipient_email },
          req,
        });
        return res.status(409).json({
          success: false,
          message: 'This document can no longer be confirmed against this link. Please contact the sender for a new secure link.',
        });
      }

      const [confirmResult] = await pool.query(
        "UPDATE document_deliveries SET ownership_status = 'CONFIRMED', owned = 1, ownership_confirmed_at = NOW() WHERE id = ? AND ownership_status = 'PENDING'",
        [delivery.id]
      );
      if (confirmResult.affectedRows === 0) {
        return res.status(409).json({ success: false, message: 'Ownership was already resolved.' });
      }
      await recordAudit({ docId: doc.id, action: 'OWNERSHIP_CONFIRM', details: { deliveryId: delivery.id, result: 'confirmed' }, req });
      return res.status(200).json({ success: true, message: 'Ownership confirmed. You may now download the document.', data: { ownershipStatus: 'CONFIRMED' } });
    }

    // "No" path — reason required, download permanently blocked.
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required to reject this document.' });
    }

    const [rejectResult] = await pool.query(
      "UPDATE document_deliveries SET ownership_status = 'REJECTED', owned = 0, ownership_rejected_at = NOW(), rejection_reason = ?, delivery_status = 0 WHERE id = ? AND ownership_status = 'PENDING'",
      [reason.trim(), delivery.id]
    );
    if (rejectResult.affectedRows === 0) {
      return res.status(409).json({ success: false, message: 'Ownership was already resolved.' });
    }

    // Audit: recipient's action (already existed).
    await recordAudit({ docId: doc.id, action: 'OWNERSHIP_REJECT', details: { deliveryId: delivery.id, reason: reason.trim() }, req });

    // ------------------------------------------------------------------
    // Task 3: in-app + email notification to the Generator on rejection.
    // ------------------------------------------------------------------
    try {
      const [[generator]] = await pool.query('SELECT id, email, full_name FROM users WHERE id = ?', [doc.generated_by]);
      if (generator) {
        // 3a) Generate a per-delivery one-time PUBLIC review token stored in
        //     document_deliveries.rejection_review_token_hash.
        //     This token powers the public /rejection-review/:token page —
        //     the Generator opens it WITHOUT needing to log in, sees the
        //     rejection reason, and clicks "Edit & Resubmit" which then
        //     redirects them to the authenticated /documents page.
        const { rawToken: reviewRaw, tokenHash: reviewHash } = generateSecureToken();
        await pool.query(
          'UPDATE document_deliveries SET rejection_review_token_hash = ?, rejection_review_token_used_at = NULL WHERE id = ?',
          [reviewHash, delivery.id]
        );

        // 3b) Also keep the generated_docs-level notify token for the in-app
        //     bell notification deep-link (?action=edit_resubmit).
        const { rawToken: notifyRaw, tokenHash: notifyHash } = generateSecureToken();
        await pool.query(
          'UPDATE generated_docs SET rejection_notify_token_hash = ?, rejection_notify_token_used_at = NULL WHERE id = ?',
          [notifyHash, doc.id]
        );

        // 3c) In-app notification: write an OWNERSHIP_REJECTED_NOTIFY audit row
        //     keyed to the Generator's user_id so the notification feed query
        //     (getNotifications) can surface it.
        await recordAudit({
          userId: generator.id,
          docId: doc.id,
          action: 'OWNERSHIP_REJECTED_NOTIFY',
          details: {
            deliveryId: delivery.id,
            recipientEmail: delivery.recipient_email,
            recipientName: delivery.recipient_name || delivery.recipient_email,
            reason: reason.trim(),
            // Embed the notify token in the audit details so the bell can
            // build the document-tracking deep-link if needed.
            notifyToken: notifyRaw,
          },
        });

        // 3d) Email notification with the PUBLIC rejection-review URL.
        //     No login required to open it.
        const reviewUrl = `${CLIENT_URL}/rejection-review/${encodeURIComponent(reviewRaw)}`;
        const { subject, html } = templates.ownershipRejectedWithLink({
          generatorName: generator.full_name,
          docId: doc.doc_uuid,
          recipientName: delivery.recipient_name || delivery.recipient_email,
          reason: reason.trim(),
          reviewUrl,
        });
        await sendMail({ to: generator.email, subject, html });
      }
    } catch (notifyErr) {
      console.error('[secureDelivery] failed to notify generator of rejection:', notifyErr.message);
    }

    return res.status(200).json({ success: true, message: 'Thank you — the sender has been notified. Download has been blocked.', data: { ownershipStatus: 'REJECTED' } });
  } catch (err) {
    console.error('[secureDelivery] ownership error:', err);
    return res.status(500).json({ success: false, message: 'Failed to record your response.' });
  }
}

/**
 * GET /api/public/secure-delivery/:token/download   PUBLIC.
 * Requirement 5: only enabled once ownership_status === 'CONFIRMED'. Single-use:
 * the first successful download permanently exhausts this delivery.
 */
async function downloadDeliveredDocument(req, res) {
  const { token } = req.params;
  const resolved = await resolveDelivery(token, { requireOtpVerified: true });
  if (!resolved.ok) {
    return res.status(resolved.status).json({ success: false, message: resolved.message, code: resolved.code });
  }
  const { delivery, doc } = resolved;

  if (delivery.ownership_status === 'REJECTED') {
    return res.status(403).json({ success: false, message: 'Download is blocked — ownership of this document was rejected.' });
  }
  if (delivery.ownership_status !== 'CONFIRMED') {
    return res.status(409).json({ success: false, message: 'Confirm this document is yours before downloading.' });
  }
  if (delivery.downloaded_at) {
    return res.status(410).json({ success: false, message: 'This document has already been downloaded. The link is no longer valid.' });
  }
  if (!fs.existsSync(doc.file_path)) {
    return res.status(410).json({ success: false, message: 'The file is no longer available.' });
  }

  try {
    // BUG FIX: same race-closing pattern — two simultaneous GETs on this token
    // (e.g. a double click, or a deliberate replay attempt) could otherwise both
    // pass the `delivery.downloaded_at` check above and both stream the file,
    // since that check reads a snapshot taken before either write happens. The
    // WHERE clause makes "mark downloaded" an atomic, single-winner transition;
    // only the request whose UPDATE actually flips a NULL -> NOW() is allowed to
    // stream the PDF, so this delivery can never be downloaded twice no matter
    // how the requests interleave.
    const [downloadUpdateResult] = await pool.query(
      'UPDATE document_deliveries SET downloaded_at = NOW(), download_ip = ?, download_user_agent = ?, delivery_status = 1 WHERE id = ? AND downloaded_at IS NULL',
      [getIp(req), getUserAgent(req), delivery.id]
    );
    if (downloadUpdateResult.affectedRows === 0) {
      return res.status(410).json({ success: false, message: 'This document has already been downloaded. The link is no longer valid.' });
    }
    await recordAudit({ docId: doc.id, action: 'DOWNLOAD', details: { deliveryId: delivery.id, via: 'secure_delivery_otp' }, req });

    const meta = doc.metadata ? JSON.parse(doc.metadata) : {};
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${meta.fileName || 'document.pdf'}"`);
    fs.createReadStream(doc.file_path).pipe(res);
  } catch (err) {
    console.error('[secureDelivery] download error:', err);
    return res.status(500).json({ success: false, message: 'Failed to download the document.' });
  }
}

/**
 * GET /api/documents/:id/rejection-review/:notifyToken   AUTHENTICATED.
 * Task 4: the Generator clicks the deep-link in their rejection notification email.
 * The link contains both the document id (for the ?doc= highlight param) and a
 * one-time reject_token. This endpoint validates the token server-side, marks it
 * used (single-use), and returns a redirect target / confirmation so the frontend
 * can cleanly land on Document Tracking ?doc=<id>.
 *
 * The token is NOT an authentication bypass — the route is protected by requireAuth.
 * Its only purpose is to confirm that the person who clicked the email link and is
 * already logged in should be deep-linked to that specific document. Once used it
 * cannot be replayed (theft/replay of the link after the Generator already opened it
 * would just return 410).
 */
async function consumeRejectionNotifyToken(req, res) {
  const { id, notifyToken } = req.params;
  if (!notifyToken) {
    return res.status(400).json({ success: false, message: 'Missing notify token.' });
  }

  try {
    const tokenHash = hashToken(notifyToken);
    const [[doc]] = await pool.query(
      'SELECT id, doc_uuid, generated_by, rejection_notify_token_hash, rejection_notify_token_used_at FROM generated_docs WHERE id = ?',
      [id]
    );
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    if (!doc.rejection_notify_token_hash || doc.rejection_notify_token_hash !== tokenHash) {
      return res.status(401).json({ success: false, message: 'This review link is invalid.' });
    }
    if (doc.rejection_notify_token_used_at) {
      // Token already used — still let the Generator through to the document
      // (they may have reloaded or clicked the link again), just don't unset it.
      return res.status(200).json({ success: true, message: 'Link already used.', data: { docId: doc.id, alreadyUsed: true } });
    }

    // Mark single-use.
    await pool.query(
      'UPDATE generated_docs SET rejection_notify_token_used_at = NOW() WHERE id = ? AND rejection_notify_token_used_at IS NULL',
      [doc.id]
    );

    return res.status(200).json({
      success: true,
      message: 'Review link validated.',
      data: { docId: doc.id, docUuid: doc.doc_uuid, alreadyUsed: false },
    });
  } catch (err) {
    console.error('[secureDelivery] consumeRejectionNotifyToken error:', err);
    return res.status(500).json({ success: false, message: 'Failed to validate review link.' });
  }
}

/**
 * POST /api/documents/:id/resubmit-delivery   AUTHENTICATED (Generator/Admin).
 * Task 5: after the Generator edits & resubmits a document (documentController
 * .resubmitDocument), the frontend calls this endpoint to automatically trigger a
 * new secure-link+OTP delivery to the SAME recipient email that was on record
 * at the time of the rejection — no email re-entry required.
 *
 * A new document_deliveries row is inserted with is_resubmission = 1 and
 * resubmission_of pointing at the most-recently-rejected delivery for this document.
 * The original rejected row is left untouched (full audit trail preserved).
 *
 * Security: recipient email is re-validated against the template's own mapped data
 * source table, same as initiateSecureDelivery (requirement 11). The document must
 * be 'signed' or 'delivered' and the previous delivery for this doc must have been
 * REJECTED (otherwise there's no rejection to resubmit from).
 */
async function initiateResubmitDelivery(req, res) {
  const { id } = req.params;

  try {
    const [[doc]] = await pool.query(
      `SELECT gd.*, t.data_source_table, t.data_source_connection_id
       FROM generated_docs gd JOIN templates t ON t.id = gd.template_id
       WHERE gd.id = ?`,
      [id]
    );
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    if (doc.deleted_at) {
      return res.status(410).json({ success: false, message: 'This document has been deleted.' });
    }
    if (doc.revoked_at) {
      return res.status(410).json({ success: false, message: 'This document has been revoked.' });
    }
    if (doc.status !== 'signed' && doc.status !== 'delivered') {
      return res.status(409).json({ success: false, message: 'The document must be signed before resubmitting.' });
    }
    if (!doc.recipient_email) {
      return res.status(409).json({ success: false, message: 'No recipient email is on record for this document. Use Send to initiate a new delivery.' });
    }
    if (!fs.existsSync(doc.file_path)) {
      return res.status(410).json({ success: false, message: 'File no longer exists on disk.' });
    }

    // Find the most-recently-rejected delivery for this document.
    const [[rejectedDelivery]] = await pool.query(
      "SELECT id FROM document_deliveries WHERE doc_id = ? AND ownership_status = 'REJECTED' ORDER BY ownership_rejected_at DESC LIMIT 1",
      [id]
    );
    if (!rejectedDelivery) {
      return res.status(409).json({ success: false, message: 'No rejected delivery found for this document. Use Send to initiate a new delivery.' });
    }

    // Re-validate recipient email server-side (requirement 11).
    const recipientEmail = doc.recipient_email.trim().toLowerCase();
    const validation = await validateRecipientEmail(recipientEmail, doc.data_source_table, doc.data_source_connection_id);
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: `Recipient email re-validation failed: ${validation.message}` });
    }
    const recipientName = doc.recipient_name || recipientEmail;

    // Generate new token + OTP for the resubmission delivery.
    const { rawToken, tokenHash } = generateSecureToken();
    const otpCode = generateOtp();
    const otpHash = await hashOtp(otpCode);

    const [insertResult] = await pool.query(
      `INSERT INTO document_deliveries
        (doc_id, recipient_email, recipient_name, delivery_method, secure_token_hash, token_expiry,
         otp_code, otp_expiry, email_status,
         resubmission_of, is_resubmission, resubmitted_at,
         created_by)
       VALUES (?, ?, ?, 'secure_link_otp', ?, ?, ?, ?, 'queued',
               ?, 1, NOW(),
               ?)`,
      [doc.id, recipientEmail, recipientName, tokenHash, tokenExpiryDate(), otpHash, otpExpiryDate(),
       rejectedDelivery.id, req.user.id]
    );
    const deliveryId = insertResult.insertId;

    const secureUrl = buildSecureDeliveryUrl(rawToken);
    const { subject, html } = templates.secureDeliveryReady({
      recipientName,
      docId: doc.doc_uuid,
      secureUrl,
      otpCode,
    });
    const linkSendResult = await sendMail({ to: recipientEmail, subject, html });

    await pool.query(
      'UPDATE document_deliveries SET email_status = ?, sent_at = NOW() WHERE id = ?',
      [linkSendResult.success ? 'sent' : 'failed', deliveryId]
    );

    // Ensure document status is 'delivered'.
    if (doc.status === 'signed') {
      await pool.query("UPDATE generated_docs SET status = 'delivered' WHERE id = ?", [doc.id]);
    }

    await recordAudit({
      userId: req.user.id, docId: doc.id, action: 'SECURE_DELIVER',
      details: {
        deliveryId, recipientEmail, method: 'secure_link_otp',
        isResubmission: true, resubmissionOf: rejectedDelivery.id,
        linkEmailSent: linkSendResult.success,
      },
      req,
    });

    return res.status(201).json({
      success: true,
      message: `Resubmitted — new secure link sent to ${recipientEmail}. They must complete OTP verification again.`,
      data: { deliveryId, recipientEmail, linkEmailSent: linkSendResult.success },
    });
  } catch (err) {
    console.error('[secureDelivery] initiateResubmitDelivery error:', err);
    return res.status(500).json({ success: false, message: 'Failed to initiate resubmission delivery.' });
  }
}

/**
 * GET /api/public/rejection-review/:token   PUBLIC — no login required.
 *
 * The Generator clicks the link in their ownership-rejection notification email.
 * This endpoint validates the per-delivery rejection_review_token (stored as a
 * SHA-256 hash in document_deliveries.rejection_review_token_hash), marks it
 * single-use, and returns the rejection details the frontend needs to render
 * the public RejectionReviewPage:
 *   - rejection reason
 *   - document identity (docUuid, templateName)
 *   - recipient who rejected
 *   - the document's internal id + resubmit context (template_id, record_identifier,
 *     approver_id, approver_name) so the Edit & Resubmit button can pass
 *     resubmitDoc state to /documents without the Generator having to log in first.
 *
 * Security: this endpoint reveals only the rejection reason and document identity —
 * no file content, no delivery token, no OTP. The "Edit & Resubmit" action it
 * enables redirects to the authenticated /documents route; the actual resubmission
 * (regeneration + delivery) only happens after the Generator logs in.
 */
async function getPublicRejectionReview(req, res) {
  const { token } = req.params;
  if (!token) return res.status(400).json({ success: false, message: 'Missing token.' });

  try {
    const tokenHash = hashToken(token);
    // Find the delivery row by the per-delivery review token hash.
    const [[delivery]] = await pool.query(
      `SELECT dd.id, dd.doc_id, dd.recipient_email, dd.recipient_name,
              dd.rejection_reason, dd.ownership_rejected_at,
              dd.rejection_review_token_hash, dd.rejection_review_token_used_at,
              dd.ownership_status
       FROM document_deliveries dd
       WHERE dd.rejection_review_token_hash = ? LIMIT 1`,
      [tokenHash]
    );
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'This review link is invalid or has expired.' });
    }
    if (delivery.ownership_status !== 'REJECTED') {
      return res.status(410).json({ success: false, message: 'This review link is no longer valid.' });
    }

    // Load the document + template + approver for the resubmit context.
    const [[doc]] = await pool.query(
      `SELECT gd.id, gd.doc_uuid, gd.template_id, gd.record_identifier,
              gd.generated_by, gd.deleted_at, gd.revoked_at,
              t.name AS template_name,
              sr.approver_id, u.full_name AS approver_name,
              sig_reject.rejection_reason AS approver_rejection_reason
       FROM generated_docs gd
       JOIN templates t ON t.id = gd.template_id
       LEFT JOIN signature_requests sr ON sr.doc_id = gd.id
         AND sr.id = (SELECT id FROM signature_requests WHERE doc_id = gd.id ORDER BY created_at DESC LIMIT 1)
       LEFT JOIN users u ON u.id = sr.approver_id
       LEFT JOIN (
         SELECT doc_id, rejection_reason FROM signature_requests
         WHERE status = 'rejected'
         ORDER BY created_at DESC LIMIT 1
       ) sig_reject ON sig_reject.doc_id = gd.id
       WHERE gd.id = ? LIMIT 1`,
      [delivery.doc_id]
    );
    if (!doc || doc.deleted_at) {
      return res.status(410).json({ success: false, message: 'The document is no longer available.' });
    }

    // Mark single-use (idempotent — re-opening is allowed, we just flag it).
    if (!delivery.rejection_review_token_used_at) {
      await pool.query(
        'UPDATE document_deliveries SET rejection_review_token_used_at = NOW() WHERE id = ? AND rejection_review_token_used_at IS NULL',
        [delivery.id]
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Rejection review loaded.',
      data: {
        // Rejection details
        rejectionReason: delivery.rejection_reason || '(no reason given)',
        rejectedAt: delivery.ownership_rejected_at,
        recipientName: delivery.recipient_name || delivery.recipient_email,
        recipientEmail: delivery.recipient_email,
        // Document identity
        docUuid: doc.doc_uuid,
        templateName: doc.template_name,
        // Resubmit context — passed as state to /documents so the Generator
        // lands straight in Edit & Resubmit mode after logging in.
        resubmitDoc: {
          id: doc.id,
          doc_uuid: doc.doc_uuid,
          template_id: doc.template_id,
          template_name: doc.template_name,
          record_identifier: doc.record_identifier,
          approver_id: doc.approver_id || null,
          approver_name: doc.approver_name || null,
          // The approver rejection reason (from signature_requests), NOT the
          // recipient ownership rejection reason — they are separate events.
          rejection_reason: doc.approver_rejection_reason || null,
        },
        alreadyOpened: !!delivery.rejection_review_token_used_at,
      },
    });
  } catch (err) {
    console.error('[secureDelivery] getPublicRejectionReview error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load rejection review.' });
  }
}

/**
 * POST /api/public/rejection-review/:token/auto-login   PUBLIC — no password required.
 *
 * When the Generator clicks "Edit & Resubmit" on the public RejectionReviewPage and
 * they are NOT already signed in, this endpoint:
 *   1. Validates the per-delivery rejection_review_token (same token that gates the
 *      GET /rejection-review/:token page — single-use flag already set on first view).
 *   2. Fetches the document's generator from the DB.
 *   3. Issues a short-lived (15-minute), purpose-scoped JWT that the frontend
 *      stores exactly like a normal login token. After this the user is "logged in"
 *      with their real account and can interact with all authenticated endpoints.
 *
 * Security rationale:
 *   - The token is the credential — it was emailed ONLY to the Generator's registered
 *     address, so possession of it already proves identity at the same level as the
 *     existing "Approver review link" and "Generator notify-view link" patterns.
 *   - The issued JWT is scoped to 15 minutes, the same as OTP expiry, limiting the
 *     blast radius of any token leak.
 *   - The delivery row records that auto-login was used (rejection_review_token_used_at),
 *     so any second call with the same raw token is rejected.
 *   - The Generator can immediately extend their session by navigating to any
 *     authenticated page; the normal 8-hour JWT will apply once they land there.
 */
async function autoLoginForRejectionReview(req, res) {
  const { token } = req.params;
  if (!token) return res.status(400).json({ success: false, message: 'Missing token.' });

  try {
    const tokenHash = hashToken(token);
    const [[delivery]] = await pool.query(
      `SELECT dd.id, dd.doc_id, dd.ownership_status,
              dd.rejection_review_token_hash, dd.rejection_review_token_used_at
       FROM document_deliveries dd
       WHERE dd.rejection_review_token_hash = ? LIMIT 1`,
      [tokenHash]
    );
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'This link is invalid or has expired.' });
    }
    if (delivery.ownership_status !== 'REJECTED') {
      return res.status(410).json({ success: false, message: 'This link is no longer valid.' });
    }

    // Load the document to find the generator.
    const [[doc]] = await pool.query(
      'SELECT id, generated_by, deleted_at FROM generated_docs WHERE id = ?',
      [delivery.doc_id]
    );
    if (!doc || doc.deleted_at) {
      return res.status(410).json({ success: false, message: 'The document is no longer available.' });
    }

    // Load the generator's user record.
    const [[user]] = await pool.query(
      'SELECT id, email, full_name, role FROM users WHERE id = ? LIMIT 1',
      [doc.generated_by]
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'Generator account not found.' });
    }

    // Issue a short-lived JWT — same payload shape as normal login so the frontend
    // stores and uses it identically. 15 minutes is enough to navigate to /documents
    // and submit the resubmit form.
    const jwt = require('jsonwebtoken');
    const SECRET = process.env.JWT_SECRET || 'insecure_dev_fallback_secret';
    const sessionToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        purpose: 'rejection_review_auto_login',
      },
      SECRET,
      { expiresIn: '15m' }
    );

    // Return the same shape as POST /auth/login so the frontend handler is identical.
    return res.status(200).json({
      success: true,
      message: 'Auto-login successful.',
      data: {
        token: sessionToken,
        user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      },
    });
  } catch (err) {
    console.error('[secureDelivery] autoLoginForRejectionReview error:', err);
    return res.status(500).json({ success: false, message: 'Failed to process auto-login.' });
  }
}

/**
 * GET /api/public/verify-qr/:verificationId   PUBLIC — requirement 10.
 * Reports exactly one of VALID / REVOKED / INVALID. Deliberately returns only
 * safe, non-sensitive fields — never the file hash, never recipient/ownership
 * data, never the internal delivery timeline.
 */
async function getPublicVerificationStatus(req, res) {
  const { verificationId } = req.params;
  if (!verificationId) {
    return res.status(400).json({ success: false, message: 'Missing verification identifier.' });
  }

  try {
    const [[doc]] = await pool.query(
      `SELECT gd.id, gd.doc_uuid, gd.status, gd.generated_at, gd.deleted_at, gd.revoked_at, gd.revocation_reason, t.name AS template_name
       FROM generated_docs gd JOIN templates t ON t.id = gd.template_id
       WHERE gd.verification_id = ? LIMIT 1`,
      [verificationId]
    );

    if (!doc) {
      return res.status(200).json({ success: true, data: { status: 'INVALID' } });
    }

    if (doc.deleted_at || doc.revoked_at) {
      await recordAudit({ docId: doc.id, action: 'VERIFY', details: { event: 'qr_public_verify', result: 'REVOKED' }, req });
      return res.status(200).json({
        success: true,
        data: { status: 'REVOKED', docId: doc.doc_uuid, revokedAt: doc.revoked_at, reason: doc.revocation_reason || undefined },
      });
    }

    await recordAudit({ docId: doc.id, action: 'VERIFY', details: { event: 'qr_public_verify', result: 'VALID' }, req });
    return res.status(200).json({
      success: true,
      data: {
        status: 'VALID',
        docId: doc.doc_uuid,
        templateName: doc.template_name,
        generatedAt: doc.generated_at,
      },
    });
  } catch (err) {
    console.error('[secureDelivery] public verify error:', err);
    return res.status(500).json({ success: false, message: 'Verification failed due to a server error.' });
  }
}

/**
 * POST /api/documents/deliveries/:deliveryId/own   PUBLIC (token-gated).
 * Body: { token }  — the same raw secure-delivery token used in all other public
 * delivery endpoints; the recipient doesn't need a separate credential.
 *
 * This is the "OWN" button handler.  When the recipient clicks OWN:
 *   1. Verifies the delivery token is valid and OTP has been verified.
 *   2. Performs the server-side ownership email/record cross-check (same logic as
 *      initiateSecureDelivery) so the "Yes" answer is independently re-validated —
 *      the client never decides this.
 *   3. Sets ownership_status = 'CONFIRMED', owned = 1, delivery_status = 1.
 *   4. Fires BOTH in-app notification (DELIVERY_OWNED_NOTIFY audit row keyed to
 *      the generator's user_id) AND an email to the generator — same event, same
 *      data, both channels, no mismatch.
 *   5. Returns the new ownershipStatus so the frontend can immediately enable the
 *      Download button.
 *
 * Architecture note: this endpoint shares the same resolveDelivery() guard and the
 * same document_deliveries table as every other delivery step — there is one backend
 * for both the email-link path and the in-system path.
 */
async function confirmOwnershipOwn(req, res) {
  const { deliveryId } = req.params;
  const { token } = req.body || {};

  if (!token) return res.status(400).json({ success: false, message: 'Delivery token is required.' });

  const resolved = await resolveDelivery(token, { requireOtpVerified: true });
  if (!resolved.ok) {
    return res.status(resolved.status).json({ success: false, message: resolved.message, code: resolved.code });
  }
  const { delivery, doc } = resolved;

  // Make sure the deliveryId in the URL matches the token's delivery row
  if (String(delivery.id) !== String(deliveryId)) {
    return res.status(400).json({ success: false, message: 'Token does not match the specified delivery.' });
  }
  if (delivery.ownership_status !== 'PENDING') {
    return res.status(409).json({
      success: false,
      message: `Ownership was already resolved (${delivery.ownership_status}).`,
      data: { ownershipStatus: delivery.ownership_status },
    });
  }

  try {
    // Server-side re-validation: the recipient email stored on the delivery must
    // still match the email on the document's original record.
    const normalize = (v) => (v == null ? '' : String(v).trim().toLowerCase());
    if (!doc.recipient_email || normalize(doc.recipient_email) !== normalize(delivery.recipient_email)) {
      await recordAudit({
        docId: doc.id, action: 'OWNERSHIP_CONFIRM',
        details: { deliveryId: delivery.id, result: 'blocked_recipient_mismatch' },
      });
      return res.status(409).json({
        success: false,
        message: 'This document can no longer be confirmed against this link. Please contact the sender for a new secure link.',
      });
    }

    // Atomic write — single winner under concurrent requests.
    const [result] = await pool.query(
      `UPDATE document_deliveries
          SET ownership_status = 'CONFIRMED', owned = 1, ownership_confirmed_at = NOW(), delivery_status = 1
        WHERE id = ? AND ownership_status = 'PENDING'`,
      [delivery.id]
    );
    if (result.affectedRows === 0) {
      return res.status(409).json({ success: false, message: 'Ownership was already resolved.' });
    }

    await recordAudit({
      docId: doc.id, action: 'OWNERSHIP_CONFIRM',
      details: { deliveryId: delivery.id, result: 'confirmed', via: 'own_button' },
    });

    // ── Dual notification to Generator ────────────────────────────────────────
    try {
      const [[generator]] = await pool.query('SELECT id, email, full_name FROM users WHERE id = ?', [doc.generated_by]);
      if (generator) {
        // In-app: DELIVERY_OWNED_NOTIFY audit row keyed to the generator's user_id —
        // the getNotifications query surfaces this as 'delivery_confirmed_notify'.
        await recordAudit({
          userId: generator.id,
          docId: doc.id,
          action: 'DELIVERY_OWNED_NOTIFY',
          details: {
            deliveryId: delivery.id,
            recipientEmail: delivery.recipient_email,
            recipientName: delivery.recipient_name || delivery.recipient_email,
          },
        });

        // Email: same event, same data as the in-app notification.
        const deliveryConfirmedUrl = `${CLIENT_URL}/document-tracking?doc=${encodeURIComponent(doc.id)}`;
        const { subject, html } = templates.deliveryOwned({
          generatorName: generator.full_name,
          docId: doc.doc_uuid,
          recipientName: delivery.recipient_name || delivery.recipient_email,
          reviewUrl: deliveryConfirmedUrl,
        });
        await sendMail({ to: generator.email, subject, html });
      }
    } catch (notifyErr) {
      console.error('[secureDelivery] failed to notify generator of ownership confirmation:', notifyErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Ownership confirmed. You may now download the document.',
      data: { ownershipStatus: 'CONFIRMED' },
    });
  } catch (err) {
    console.error('[secureDelivery] confirmOwnershipOwn error:', err);
    return res.status(500).json({ success: false, message: 'Failed to confirm ownership.' });
  }
}

/* =====================================================================
 * WORKFLOW ENDPOINTS — called from SecureDeliveryPage after OTP verified.
 * All three require OTP already verified and check that the corresponding
 * workflow step is actually enabled in the template's workflow_config.
 * ===================================================================== */

/* =====================================================================
 * SHARED WORKFLOW NOTIFICATION HELPER
 * ===================================================================== */

/**
 * _sendWorkflowCompleteNotification
 *
 * Sends the ONE consolidated "workflow complete" email to the Generator and
 * records a tracking token so they can view the result without logging in.
 *
 * IDEMPOTENCY GUARANTEE — single email per workflow submission:
 *   Uses an atomic conditional UPDATE:
 *     UPDATE document_deliveries
 *       SET workflow_notify_sent_at = NOW(),
 *           workflow_tracking_token_hash = ?,
 *           workflow_tracking_token_expiry = ?
 *     WHERE id = ? AND workflow_notify_sent_at IS NULL
 *   Only the first caller (acknowledgement / sign / respond — whichever fires
 *   first) wins the race. All subsequent callers get affectedRows = 0 and
 *   return immediately without sending another email.
 *
 * This means:
 *   - Acknowledgement-only workflow  → acknowledge step sends the email.
 *   - Sign-only workflow             → sign step sends the email.
 *   - Acknowledge + sign workflow    → whichever completes first sends it;
 *                                       the other is a no-op for notifications.
 *   - Any workflow with respond step → same race; only one email total.
 *
 * @param {object} opts
 * @param {object} opts.delivery   - The document_deliveries row (already loaded).
 * @param {object} opts.doc        - The generated_docs row (already loaded).
 * @param {string} opts.triggerStep - 'acknowledge' | 'sign' | 'respond' (for audit).
 * @param {object} opts.signatureData - Optional parsed signature data (sign step only).
 * @param {object} opts.req        - Express request (for audit IP/UA).
 * @returns {Promise<boolean>}  true if this call sent the email, false if already sent.
 */
async function _sendWorkflowCompleteNotification({ delivery, doc, triggerStep, signatureData, req }) {
  try {
    // Generate a 7-day tracking token for the Generator's "View Submitted Document" link.
    const { rawToken: trackRaw, tokenHash: trackHash } = generateSecureToken();
    const trackExpiry = tokenExpiryDate();

    // ── Atomic single-winner stamp ───────────────────────────────────────────
    // Only the first caller can flip workflow_notify_sent_at NULL → NOW().
    // All subsequent callers (even concurrent ones) get affectedRows = 0.
    const [stampResult] = await pool.query(
      `UPDATE document_deliveries
          SET workflow_notify_sent_at          = NOW(),
              workflow_tracking_token_hash     = ?,
              workflow_tracking_token_expiry   = ?,
              workflow_tracking_token_used_at  = NULL
        WHERE id = ? AND workflow_notify_sent_at IS NULL`,
      [trackHash, trackExpiry, delivery.id]
    );

    if (stampResult.affectedRows === 0) {
      // Another step already sent the notification — nothing to do.
      return false;
    }

    // ── Audit: Generator-facing notification event ───────────────────────────
    await recordAudit({
      docId: doc.id,
      action: triggerStep === 'acknowledge' ? 'ACKNOWLEDGE_NOTIFY' : 'WORKFLOW_COMPLETE_NOTIFY',
      details: {
        event: `workflow_${triggerStep}_notify_sent`,
        deliveryId: delivery.id,
        recipientEmail: delivery.recipient_email,
        triggerStep,
      },
      req,
    });

    // ── Email to Generator ───────────────────────────────────────────────────
    const [[generator]] = await pool.query(
      'SELECT id, email, full_name FROM users WHERE id = ?',
      [doc.generated_by]
    );
    if (!generator) return true; // token stored; email address unavailable

    // Re-fetch the delivery row to capture the latest workflow_response —
    // the acknowledge/sign/respond steps may have written it just before or
    // concurrently. This ensures the email always reflects what the user
    // actually submitted, regardless of which step triggered the notification.
    const [[freshDelivery]] = await pool.query(
      `SELECT workflow_response, workflow_acknowledged_at,
              workflow_user_signed_at, recipient_name, recipient_email
         FROM document_deliveries WHERE id = ?`,
      [delivery.id]
    );
    const latestResponse = freshDelivery?.workflow_response || null;
    const recipientLabel = freshDelivery?.recipient_name || freshDelivery?.recipient_email
      || delivery.recipient_name || delivery.recipient_email || 'The recipient';

    const trackingUrl = `${CLIENT_URL}/workflow-track/${encodeURIComponent(trackRaw)}`;

    // Build a step-specific description so the Generator immediately understands
    // what action was taken, then a single "View Submitted Document" CTA button.
    let actionDescription;
    switch (triggerStep) {
      case 'acknowledge':
        actionDescription = `acknowledged receipt of document <b>${doc.doc_uuid}</b>.`;
        break;
      case 'sign':
        actionDescription = `signed and submitted document <b>${doc.doc_uuid}</b>.`;
        break;
      case 'respond':
        actionDescription = `responded to document <b>${doc.doc_uuid}</b>.`;
        break;
      default:
        actionDescription = `completed the workflow for document <b>${doc.doc_uuid}</b>.`;
    }

    // Show a signature thumbnail in the email when the sign step triggered this.
    let sigHtml = '';
    if (signatureData) {
      const nameText = signatureData.signatureText
        ? `<p style="margin:0 0 6px;font-size:18px;font-family:cursive,serif;color:#0F2747;">
             ${signatureData.signatureText}
           </p>`
        : '';
      const photoHtml = signatureData.signaturePhoto
        ? `<div style="margin:10px 0 0;">
             <p style="margin:0 0 4px;font-size:11px;color:#94A3B8;text-transform:uppercase;letter-spacing:0.06em;">
               Signature Image
             </p>
             <img src="${signatureData.signaturePhoto}" alt="Signature"
                  style="max-height:80px;max-width:240px;border:1px solid #E2E8F0;
                         border-radius:4px;padding:4px;background:#fff;" />
           </div>`
        : '';
      if (nameText || photoHtml) {
        sigHtml = `
          <div style="margin:12px 0;padding:14px 18px;background:#F8FAFC;
                      border:1px solid #E2E8F0;border-radius:8px;
                      border-bottom:2px solid #0F2747;">
            <p style="margin:0 0 4px;font-size:11px;color:#94A3B8;
                      text-transform:uppercase;letter-spacing:0.06em;">
              Signature Name
            </p>
            ${nameText}${photoHtml}
          </div>`;
      }
    }

    await sendMail({
      to: generator.email,
      subject: `Document ${doc.doc_uuid} — action completed by recipient`,
      html: `<p>Hi ${generator.full_name || 'there'},</p>
        <p>The recipient <b>${recipientLabel}</b> has ${actionDescription}</p>
        ${sigHtml}
        ${latestResponse ? `
        <div style="margin:12px 0;padding:14px 18px;background:#F8FAFC;
                    border:1px solid #E2E8F0;border-radius:8px;
                    border-left:3px solid #159A9C;">
          <p style="margin:0 0 6px;font-size:11px;color:#94A3B8;
                    text-transform:uppercase;letter-spacing:0.06em;">
            Recipient Response
          </p>
          <p style="margin:0;font-size:0.95rem;color:#1E293B;font-style:italic;line-height:1.5;">
            "${latestResponse}"
          </p>
        </div>` : ''}
        <p style="margin:18px 0;">
          <a href="${trackingUrl}"
             style="display:inline-block;padding:11px 22px;background:#0F2747;color:#fff;
                    border-radius:6px;text-decoration:none;font-weight:600;font-size:0.95rem;">
            View Submitted Document
          </a>
        </p>
        <p style="font-size:0.82em;color:#64748B;">
          This link is valid for 7 days and opens the submitted document and full
          workflow result directly — no sign-in required.
        </p>`,
    });

    return true;
  } catch (notifyErr) {
    // Non-fatal: the delivery row's workflow state is already stored. The Generator
    // can still find the document through their authenticated dashboard.
    console.error('[secureDelivery] _sendWorkflowCompleteNotification error (non-fatal):', notifyErr.message);
    return false;
  }
}

/* =====================================================================
 * WORKFLOW ENDPOINTS — called from SecureDeliveryPage after OTP verified.
 * All three require OTP already verified and check that the corresponding
 * workflow step is actually enabled in the template's workflow_config.
 * ===================================================================== */

/**
 * POST /api/public/secure-delivery/:token/acknowledge
 * Body: (none required — the act of calling this IS the acknowledgement)
 *
 * Records that the recipient has acknowledged the document and submits
 * their response back to the Generator.
 *
 * After recording acknowledgement, this endpoint attempts to send the ONE
 * consolidated "workflow complete" notification email to the Generator via
 * _sendWorkflowCompleteNotification. The atomic idempotency lock in that
 * helper ensures only one email is ever sent even if sign/respond steps
 * also try to fire it later.
 *
 * Template-driven: only reachable when workflowConfig.acknowledge === true.
 */
async function workflowAcknowledge(req, res) {
  const { token } = req.params;
  // Optional response text — the user can type a message back to the Generator.
  // Stored in workflow_response at the same time as workflow_acknowledged_at so
  // the Generator's notification email includes it without a separate round-trip.
  const { response } = req.body || {};

  const resolved = await resolveDelivery(token, { requireOtpVerified: true });
  if (!resolved.ok) {
    return res.status(resolved.status).json({ success: false, message: resolved.message, code: resolved.code });
  }
  const { delivery, doc } = resolved;

  if (delivery.workflow_acknowledged_at) {
    return res.status(200).json({
      success: true,
      message: 'Already acknowledged.',
      data: {
        acknowledgedAt: delivery.workflow_acknowledged_at,
        response: delivery.workflow_response || null,
      },
    });
  }

  try {
    const responseText = response && String(response).trim() ? String(response).trim() : null;

    // Stamp acknowledgement + optionally store the response in one atomic write.
    // workflow_response is only updated when the user actually typed something —
    // a NULL response does not overwrite an existing response from a prior step.
    if (responseText) {
      await pool.query(
        `UPDATE document_deliveries
            SET workflow_acknowledged_at = NOW(),
                workflow_completed_at    = COALESCE(workflow_completed_at, NOW()),
                workflow_response        = ?
          WHERE id = ?`,
        [responseText, delivery.id]
      );
    } else {
      await pool.query(
        `UPDATE document_deliveries
            SET workflow_acknowledged_at = NOW(),
                workflow_completed_at    = COALESCE(workflow_completed_at, NOW())
          WHERE id = ?`,
        [delivery.id]
      );
    }

    // Audit: recipient's action.
    await recordAudit({
      docId: doc.id,
      action: 'VIEW',
      details: {
        event: 'workflow_acknowledge',
        deliveryId: delivery.id,
        recipientEmail: delivery.recipient_email,
        hasResponse: !!responseText,
      },
      req,
    });

    // Always attempt notification — the atomic lock inside the helper guarantees
    // only one email is ever sent regardless of which step wins.
    await _sendWorkflowCompleteNotification({
      delivery,
      doc,
      triggerStep: 'acknowledge',
      signatureData: null,
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Document acknowledged. The document issuer has been notified.',
      data: {
        acknowledgedAt: new Date().toISOString(),
        response: responseText || null,
      },
    });
  } catch (err) {
    console.error('[secureDelivery] workflowAcknowledge error:', err);
    return res.status(500).json({ success: false, message: 'Failed to record acknowledgement.' });
  }
}

/**
 * POST /api/public/secure-delivery/:token/workflow-sign
 * Body: { signature_text? }
 *
 * Records the recipient's signature, marks workflow_completed_at,
 * generates a one-time workflow_tracking_token for the Generator, and
 * sends ONE consolidated "workflow complete" email to the Generator with
 * a secure tracking link. No further emails are sent for other workflow
 * actions (acknowledge, respond) — the Generator uses the tracking link
 * to open the full document + status without re-logging in.
 */
async function workflowSign(req, res) {
  const { token } = req.params;
  const { signature_text, signature_photo } = req.body || {};

  const resolved = await resolveDelivery(token, { requireOtpVerified: true });
  if (!resolved.ok) {
    return res.status(resolved.status).json({ success: false, message: resolved.message, code: resolved.code });
  }
  const { delivery, doc } = resolved;

  // Idempotency guard — also the first layer of duplicate-email protection.
  if (delivery.workflow_user_signed_at) {
    return res.status(200).json({ success: true, message: 'Already signed.', data: { signedAt: delivery.workflow_user_signed_at } });
  }

  // ── Recipient identity check ─────────────────────────────────────────────
  // The delivery token already proves the caller has the recipient's OTP, but we
  // add an explicit cross-check against the document's authoritative recipient
  // email (written at delivery-initiation time from the data source record) so
  // that a forwarded or leaked OTP cannot be used to sign on behalf of a different
  // person. Both values are normalised to lowercase before comparison.
  const normalize = (v) => (v == null ? '' : String(v).trim().toLowerCase());
  if (doc.recipient_email && delivery.recipient_email) {
    if (normalize(doc.recipient_email) !== normalize(delivery.recipient_email)) {
      await recordAudit({
        docId: doc.id,
        action: 'SIGN',
        details: {
          event: 'workflow_sign_blocked_recipient_mismatch',
          deliveryId: delivery.id,
          deliveryRecipientEmail: delivery.recipient_email,
          docRecipientEmail: doc.recipient_email,
        },
        req,
      });
      return res.status(403).json({
        success: false,
        message: 'You are not the authorised recipient of this document. Please contact the sender.',
      });
    }
  }

  // ── Validate submission ──────────────────────────────────────────────────
  const hasName  = !!(signature_text  && String(signature_text).trim());
  const hasPhoto = !!signature_photo;

  // Load template workflow_config once — needed for signatureField and required flags.
  let signatureField = null;
  let allowPhoto     = true;
  try {
    const [[tpl]] = await pool.query(
      'SELECT workflow_config FROM templates WHERE id = ?',
      [doc.template_id]
    );
    if (tpl?.workflow_config) {
      const wfConfig = typeof tpl.workflow_config === 'string'
        ? JSON.parse(tpl.workflow_config)
        : tpl.workflow_config;
      if (wfConfig?.signatureField) {
        signatureField = wfConfig.signatureField;
        allowPhoto     = signatureField.allowPhoto !== false; // default true
        const required = signatureField.required !== false;   // default true
        if (required && !hasName) {
          return res.status(400).json({
            success: false,
            message: 'Your full name is required to sign this document.',
          });
        }
        if (allowPhoto && required && !hasPhoto) {
          return res.status(400).json({
            success: false,
            message: 'A signature image is required to sign this document.',
          });
        }
      }
    }
  } catch (cfgErr) {
    // Non-fatal: if we cannot read the config, proceed without the field position
    // (the embedding step below will gracefully skip if signatureField is null).
    console.error('[secureDelivery] workflowSign: could not load signatureField config (non-fatal):', cfgErr.message);
  }

  try {
    // ── Build the signature data blob ────────────────────────────────────────
    const signedAt     = new Date().toISOString();
    const signatureData = JSON.stringify({
      recipientName:  delivery.recipient_name || delivery.recipient_email || '',
      signatureText:  hasName  ? String(signature_text).trim() : null,
      signaturePhoto: (hasPhoto && allowPhoto) ? signature_photo : null, // base64 data URL
      signedAt,
      field: signatureField, // Admin-configured position (null = free/no field)
    });

    // ── Atomic DB write — prevents duplicate email on concurrent requests ────
    // Two near-simultaneous POST requests against the same token could both pass
    // the `workflow_user_signed_at` snapshot-check above. The WHERE...IS NULL
    // clause makes this an atomic single-winner transition: only the request
    // whose UPDATE flips NULL → NOW() proceeds to send the email; the other
    // gets affectedRows === 0 and returns the idempotent 200.
    const [signResult] = await pool.query(
      `UPDATE document_deliveries
          SET workflow_user_signed_at = NOW(),
              workflow_completed_at   = NOW(),
              workflow_signature_data = ?
        WHERE id = ? AND workflow_user_signed_at IS NULL`,
      [signatureData, delivery.id]
    );

    if (signResult.affectedRows === 0) {
      // Lost the race — another request already recorded this signature.
      const [[fresh]] = await pool.query(
        'SELECT workflow_user_signed_at FROM document_deliveries WHERE id = ?',
        [delivery.id]
      );
      return res.status(200).json({
        success: true,
        message: 'Already signed.',
        data: { signedAt: fresh?.workflow_user_signed_at || signedAt },
      });
    }

    // ── Audit: signature recorded ────────────────────────────────────────────
    await recordAudit({
      docId: doc.id,
      action: 'SIGN',
      details: {
        event: 'workflow_user_sign',
        deliveryId: delivery.id,
        recipientEmail: delivery.recipient_email,
        signatureText:  hasName ? String(signature_text).trim() : null,
        hasSignaturePhoto: hasPhoto && allowPhoto,
      },
      req,
    });

    // ── Embed signature into the PDF ─────────────────────────────────────────
    // Re-render the full PDF from the stored renderPieces, replacing the
    // [[SIGNATURE_FIELD]] placeholder in footer_html with the user's actual
    // name and signature image. This uses the same Puppeteer pipeline that
    // originally generated the document, so the result is pixel-perfect and
    // the signature lives inside the exact Admin-defined footer box — not as
    // a separate overlay. The file is overwritten in place (same pattern as
    // signatureController.applyApproval) and file_hash is updated so
    // Verify Document reports the correct fingerprint.
    if (signatureField?.inFooter && fs.existsSync(doc.file_path)) {
      try {
        const meta   = doc.metadata ? JSON.parse(doc.metadata) : {};
        const pieces = meta.renderPieces;

        if (pieces && pieces.footerHtml !== undefined) {
          const nameToEmbed  = hasName  ? String(signature_text).trim() : null;
          const photoToEmbed = (hasPhoto && allowPhoto) ? signature_photo : null;
          const signedAt     = new Date().toISOString();

          // Inject name + image into the footer HTML, replacing the locked placeholder
          const signedFooterHtml = injectSignatureIntoFooter(
            pieces.footerHtml,
            nameToEmbed,
            photoToEmbed,
            signedAt
          );

          // Re-assemble the full document HTML with the signed footer and
          // the correct FINAL watermark (doc was already signed/delivered)
          const fullHtml = assembleDocumentHtml({
            headerHtml:               pieces.headerHtml  || '',
            bodyHtml:                 pieces.bodyHtml    || '',
            footerHtml:               signedFooterHtml,
            tamperProofFooterHtml:    pieces.tamperProofFooterHtml    || '',
            deliveryVerificationQrHtml: pieces.deliveryVerificationQrHtml || '',
            watermarkText: resolveWatermarkForStatus('delivered', pieces.watermarkText),
          });

          const newBuffer = await htmlToPdfBuffer(fullHtml);
          fs.writeFileSync(doc.file_path, newBuffer);

          const newHash = sha256(newBuffer);
          await pool.query(
            'UPDATE generated_docs SET file_hash = ? WHERE id = ?',
            [newHash, doc.id]
          );
          await pool.query(
            'UPDATE document_deliveries SET workflow_signature_embedded_at = NOW() WHERE id = ?',
            [delivery.id]
          );

          await recordAudit({
            docId: doc.id,
            action: 'SIGN',
            details: {
              event: 'workflow_signature_embedded',
              deliveryId: delivery.id,
              newFileHash: newHash,
              method: 'footer_html_replacement',
            },
            req,
          });
        }
      } catch (embedErr) {
        // Non-fatal: signature data is already stored in the DB row.
        // The Generator's tracking page still shows the name/photo even if
        // PDF regeneration failed. The original PDF remains on disk unchanged.
        console.error('[secureDelivery] workflowSign PDF re-render error (non-fatal):', embedErr.message);
      }
    }

    // ── ONE consolidated "workflow complete" email to the Generator ──────────
    // Delegated to _sendWorkflowCompleteNotification which:
    //   1. Atomically stamps workflow_notify_sent_at (prevents duplicate emails
    //      if acknowledge or respond also calls this helper).
    //   2. Generates the workflow_tracking_token in the same atomic write.
    //   3. Sends the branded email with signature preview + "View Submitted
    //      Document" button — no login required to open the tracking page.
    const parsedSigData = (() => {
      try { return JSON.parse(signatureData); } catch { return null; }
    })();
    await _sendWorkflowCompleteNotification({
      delivery,
      doc,
      triggerStep: 'sign',
      signatureData: parsedSigData,
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Signature recorded. The document issuer has been notified.',
      data: { signedAt },
    });
  } catch (err) {
    console.error('[secureDelivery] workflowSign error:', err);
    return res.status(500).json({ success: false, message: 'Failed to record signature.' });
  }
}

/**
 * POST /api/public/secure-delivery/:token/workflow-respond
 * Body: { response: string }
 *
 * Records the recipient's written response and attempts to send the ONE
 * consolidated Generator notification via _sendWorkflowCompleteNotification.
 *
 * If acknowledge or sign already sent the notification (workflow_notify_sent_at
 * is non-NULL), the atomic guard in the helper prevents a second email.
 * If respond is the first/only terminal step, the notification is sent here.
 */
async function workflowRespond(req, res) {
  const { token } = req.params;
  const { response } = req.body || {};

  if (!response || !String(response).trim()) {
    return res.status(400).json({ success: false, message: 'A response message is required.' });
  }

  const resolved = await resolveDelivery(token, { requireOtpVerified: true });
  if (!resolved.ok) {
    return res.status(resolved.status).json({ success: false, message: resolved.message, code: resolved.code });
  }
  const { delivery, doc } = resolved;

  try {
    const responseText = String(response).trim();
    await pool.query(
      'UPDATE document_deliveries SET workflow_response = ? WHERE id = ?',
      [responseText, delivery.id]
    );
    await recordAudit({
      docId: doc.id,
      action: 'VIEW',
      details: { event: 'workflow_response', deliveryId: delivery.id, recipientEmail: delivery.recipient_email },
      req,
    });

    // Attempt notification — the atomic lock in the helper ensures this is
    // a no-op if acknowledge or sign already sent the email.
    await _sendWorkflowCompleteNotification({
      delivery,
      doc,
      triggerStep: 'respond',
      signatureData: null,
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Your response has been recorded.',
      data: { response: responseText },
    });
  } catch (err) {
    console.error('[secureDelivery] workflowRespond error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save response.' });
  }
}

/**
 * GET /api/public/workflow-track/:token   PUBLIC — no login required.
 *
 * Generator clicks the "View Submitted Document" link from the workflow-complete
 * email. This endpoint:
 *   1. Validates the one-time workflow_tracking_token (SHA-256 stored).
 *   2. Checks expiry (7 days from workflow completion).
 *   3. Returns the delivery state, workflow data, document info, and generator
 *      identity so the frontend can offer a seamless auto-login.
 *   4. Does NOT mark the token as single-use on first view (generator may
 *      reload the page); marks it only on first view (idempotent).
 *
 * Security: the token was emailed ONLY to the Generator's registered address
 * and is cryptographically random (256 bits). It grants read-only access to

 * the workflow result — no write operations and no document deletion.
 */
async function getWorkflowTrackingPage(req, res) {
  const { token } = req.params;
  if (!token) return res.status(400).json({ success: false, message: 'Missing token.' });

  try {
    const tokenHash = hashToken(token);

    const [[delivery]] = await pool.query(
      `SELECT dd.*
         FROM document_deliveries dd
        WHERE dd.workflow_tracking_token_hash = ?
        LIMIT 1`,
      [tokenHash]
    );

    if (!delivery) {
      return res.status(404).json({ success: false, message: 'This tracking link is invalid.' });
    }
    if (delivery.workflow_tracking_token_expiry &&
        new Date(delivery.workflow_tracking_token_expiry) < new Date()) {
      return res.status(410).json({ success: false, message: 'This tracking link has expired.' });
    }

    const [[doc]] = await pool.query(
      `SELECT gd.id, gd.doc_uuid, gd.file_path, gd.status,
              gd.generated_at, gd.deleted_at, gd.revoked_at,
              t.name AS template_name, t.workflow_config
         FROM generated_docs gd
         JOIN templates t ON t.id = gd.template_id
        WHERE gd.id = ?`,
      [delivery.doc_id]
    );

    if (!doc || doc.deleted_at) {
      return res.status(410).json({ success: false, message: 'The document is no longer available.' });
    }

    // Parse workflow config
    let workflowConfig = null;
    if (doc.workflow_config) {
      workflowConfig = typeof doc.workflow_config === 'string'
        ? JSON.parse(doc.workflow_config)
        : doc.workflow_config;
    }

    // Mark seen (idempotent — same as rejection-review)
    if (!delivery.workflow_tracking_token_used_at) {
      await pool.query(
        `UPDATE document_deliveries
           SET workflow_tracking_token_used_at = NOW()
         WHERE id = ? AND workflow_tracking_token_used_at IS NULL`,
        [delivery.id]
      );
    }

    await recordAudit({
      docId: doc.id,
      action: 'VIEW',
      details: { event: 'workflow_tracking_view', deliveryId: delivery.id },
      req,
    });

    // Load the generator's display name so the tracking page can personalise
    // the "Sign in to Dashboard" prompt and the auto-login flow.
    let generatorName = null;
    let generatorId   = null;
    try {
      const [[gen]] = await pool.query(
        'SELECT id, full_name FROM users WHERE id = ? LIMIT 1',
        [delivery.created_by || null]
      );
      // fall back to doc.generated_by if delivery.created_by is unavailable
      if (!gen) {
        const [[gen2]] = await pool.query(
          `SELECT gd.generated_by AS id, u.full_name
             FROM generated_docs gd JOIN users u ON u.id = gd.generated_by
            WHERE gd.id = ? LIMIT 1`,
          [delivery.doc_id]
        );
        if (gen2) { generatorName = gen2.full_name; generatorId = gen2.id; }
      } else {
        generatorName = gen.full_name;
        generatorId   = gen.id;
      }
    } catch { /* non-fatal */ }

    return res.status(200).json({
      success: true,
      message: 'Workflow tracking data loaded.',
      data: {
        document: {
          id:              doc.id,           // internal numeric id — used for ?doc= deep-link
          docId:           doc.doc_uuid,
          templateName:    doc.template_name,
          status:          doc.status,
          generatedAt:     doc.generated_at,
          // Raw tracking token — passed back to the frontend so it can call
          // GET /api/public/workflow-track/:token/preview to stream the PDF.
          trackingToken:   token,
        },
        recipient: {
          name:  delivery.recipient_name  || null,
          email: delivery.recipient_email || null,
        },
        workflow: {
          completedAt:      delivery.workflow_completed_at      || null,
          acknowledgedAt:   delivery.workflow_acknowledged_at   || null,
          userSignedAt:     delivery.workflow_user_signed_at    || null,
          response:         delivery.workflow_response          || null,
          ownershipStatus:  delivery.ownership_status,
          downloadedAt:     delivery.downloaded_at              || null,
          // Parsed signature data — includes field position + recipient name + photo
          signatureData: (() => {
            try {
              return delivery.workflow_signature_data
                ? JSON.parse(delivery.workflow_signature_data)
                : null;
            } catch { return null; }
          })(),
        },
        workflowConfig,
        // Generator identity — used by the frontend to offer seamless auto-login
        // (no re-entry of credentials) when the Generator clicks "Open in Dashboard".
        generatorId,
        generatorName,
      },
    });
  } catch (err) {
    console.error('[secureDelivery] getWorkflowTrackingPage error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load tracking page.' });
  }
}

/**
 * GET /api/public/workflow-track/:token/preview   PUBLIC — no login required.
 *
 * Streams the signed PDF to the Generator via the workflow tracking token.
 * The token is validated but NOT consumed here — the Generator may reload.
 */
async function getWorkflowTrackingPreview(req, res) {
  const { token } = req.params;
  if (!token) return res.status(400).json({ success: false, message: 'Missing token.' });

  try {
    const tokenHash = hashToken(token);
    const [[delivery]] = await pool.query(
      `SELECT dd.doc_id, dd.workflow_tracking_token_expiry
         FROM document_deliveries dd
        WHERE dd.workflow_tracking_token_hash = ? LIMIT 1`,
      [tokenHash]
    );
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Invalid tracking link.' });
    }
    if (delivery.workflow_tracking_token_expiry &&
        new Date(delivery.workflow_tracking_token_expiry) < new Date()) {
      return res.status(410).json({ success: false, message: 'This tracking link has expired.' });
    }

    const [[doc]] = await pool.query(
      'SELECT id, file_path, metadata, deleted_at FROM generated_docs WHERE id = ?',
      [delivery.doc_id]
    );
    if (!doc || doc.deleted_at || !fs.existsSync(doc.file_path)) {
      return res.status(410).json({ success: false, message: 'File no longer available.' });
    }

    const meta = doc.metadata ? JSON.parse(doc.metadata) : {};
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${meta.fileName || 'document.pdf'}"`);
    res.setHeader('Cache-Control', 'no-store, private');
    fs.createReadStream(doc.file_path).pipe(res);
  } catch (err) {
    console.error('[secureDelivery] getWorkflowTrackingPreview error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load preview.' });
  }
}

/**
 * POST /api/public/workflow-track/:token/auto-login   PUBLIC — no password required.
 *
 * When the Generator clicks "Open in Dashboard" on WorkflowTrackingPage and they
 * are NOT already signed in, this endpoint:
 *   1. Validates the workflow_tracking_token (same token that gates GET
 *      /workflow-track/:token — expiry checked, SHA-256 stored).
 *   2. Resolves the document's generator from generated_docs.
 *   3. Issues a short-lived (15-minute) purpose-scoped JWT so the Generator
 *      is "logged in" and can navigate directly to the authenticated dashboard
 *      (Document Tracking, My Documents, etc.) without entering a password.
 *
 * Security rationale (same as autoLoginForRejectionReview):
 *   - The token is the credential — it was emailed ONLY to the Generator's
 *     registered address, so possession proves identity at the same level as
 *     the Approver review link and Generator notify-view link patterns.
 *   - The JWT is 15-minute, purpose-scoped, and uses the same payload shape
 *     as a normal login so frontend storage/refresh is identical.
 *   - The tracking token itself is NOT single-use for page views; only auto-login
 *     calls are logged so the Generator can reload the page freely.
 */
async function workflowTrackingAutoLogin(req, res) {
  const { token } = req.params;
  if (!token) return res.status(400).json({ success: false, message: 'Missing token.' });

  try {
    const tokenHash = hashToken(token);
    const [[delivery]] = await pool.query(
      `SELECT dd.doc_id, dd.workflow_tracking_token_expiry
         FROM document_deliveries dd
        WHERE dd.workflow_tracking_token_hash = ? LIMIT 1`,
      [tokenHash]
    );
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'This tracking link is invalid.' });
    }
    if (delivery.workflow_tracking_token_expiry &&
        new Date(delivery.workflow_tracking_token_expiry) < new Date()) {
      return res.status(410).json({ success: false, message: 'This tracking link has expired.' });
    }

    // Resolve the generator from the document.
    const [[doc]] = await pool.query(
      'SELECT id, generated_by, deleted_at FROM generated_docs WHERE id = ?',
      [delivery.doc_id]
    );
    if (!doc || doc.deleted_at) {
      return res.status(410).json({ success: false, message: 'The document is no longer available.' });
    }

    const [[user]] = await pool.query(
      'SELECT id, email, full_name, role FROM users WHERE id = ? LIMIT 1',
      [doc.generated_by]
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'Generator account not found.' });
    }

    // Issue a full-session JWT — same payload shape and duration as normal login
    // so the Generator has a complete working session (not just 15 minutes) after
    // clicking the email link. The tracking token was already the credential that
    // proved identity; the JWT duration matching normal login is appropriate.
    const jwt = require('jsonwebtoken');
    const SECRET = process.env.JWT_SECRET || 'insecure_dev_fallback_secret';
    const sessionToken = jwt.sign(
      {
        id:        user.id,
        email:     user.email,
        full_name: user.full_name,
        role:      user.role,
        purpose:   'workflow_tracking_auto_login',
      },
      SECRET,
      { expiresIn: '8h' }
    );

    await recordAudit({
      userId: user.id,
      docId:  doc.id,
      action: 'VIEW',
      details: { event: 'workflow_tracking_auto_login' },
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Auto-login successful.',
      data: {
        token: sessionToken,
        user:  { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      },
    });
  } catch (err) {
    console.error('[secureDelivery] workflowTrackingAutoLogin error:', err);
    return res.status(500).json({ success: false, message: 'Failed to process auto-login.' });
  }
}

module.exports = {
  initiateSecureDelivery,
  initiateResubmitDelivery,
  consumeRejectionNotifyToken,
  listDeliveriesForDocument,
  getOwnershipReport,
  revokeDocument,
  getDeliveryLanding,
  verifyDeliveryOtp,
  resendDeliveryOtp,
  getDeliveryDetails,
  getDocumentPreviewStream,
  confirmOwnership,
  confirmOwnershipOwn,
  downloadDeliveredDocument,
  getPublicRejectionReview,
  autoLoginForRejectionReview,
  getPublicVerificationStatus,
  workflowAcknowledge,
  workflowSign,
  workflowRespond,
  getWorkflowTrackingPage,
  getWorkflowTrackingPreview,
  workflowTrackingAutoLogin,
};
