const fs = require('fs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { recordAudit } = require('../utils/auditLog');
require('dotenv').config();

const SECRET = process.env.JWT_SECRET || 'insecure_dev_fallback_secret';
const TOKEN_EXPIRY_DAYS = 7; // FR-028c, NFR-002
// Points at the BACKEND API, not the frontend app: this URL must land the recipient
// directly on GET /api/deliver/download?token=... (a raw application/pdf response),
// so clicking it in the email opens/downloads the PDF straight away — it must never
// route through the frontend app/login ("the system"). Previously this pointed at a
// frontend route (${CLIENT_URL}/verify-download) that didn't even exist, so every
// delivery/secure-link email silently sent a dead link. Configure API_BASE_URL in
// .env if the backend isn't reachable at the default http://localhost:<PORT>/api.
const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5000}/api`;

function buildDownloadToken(docId) {
  // Single-use is enforced at use-time by checking delivery_logs.downloaded_at, not by JWT jti tracking —
  // simpler for this scale, still correct: first successful download marks it used.
  return jwt.sign({ docId, purpose: 'download' }, SECRET, { expiresIn: `${TOKEN_EXPIRY_DAYS}d` });
}

function buildDownloadUrl(token) {
  return `${API_BASE_URL}/deliver/download?token=${encodeURIComponent(token)}`;
}

// NOTE — SECURITY FIX: this file used to also expose `deliverDocument` (emailed the
// raw signed PDF as an attachment, no verification at all) and `generateSecureLink`
// (a "secure" link that required no OTP and streamed the PDF to whoever opened it —
// i.e. exactly the "opens directly as a PDF" behavior this module now forbids). Both
// bypassed OTP verification, one-time-use-before-any-identity-check, and ownership
// confirmation entirely, in direct violation of the Secure Document Delivery module's
// requirements. They have been REMOVED as delivery actions — every recipient-facing
// "send this document" action in the app now goes exclusively through
// secureDeliveryController.initiateSecureDelivery (one-time link + OTP + ownership
// confirmation, backed by document_deliveries). See SecureDeliveryModal.jsx /
// DocumentTrackingPage.jsx on the frontend and deliveryRoutes.js on the backend.
//
// `downloadViaToken` and `buildDownloadToken`/`buildDownloadUrl` are kept here only
// because the separate Generator "notify-view" forwarding feature
// (documentController.sendSecureLinkViaNotifyToken) still issues these single-use
// download tokens for its own, narrower use case (a Generator resending a copy to an
// arbitrary validated business-data-source email, not necessarily a registered app
// user) — that is a distinct feature from recipient delivery/ownership verification
// and is unaffected by this fix.

/**
 * GET /api/deliver/download?token=...    PUBLIC — no login required.
 * FR-029: logs IP/browser/timestamp on access. Single-use: once downloaded, the same token 404s.
 */
async function downloadViaToken(req, res) {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ success: false, message: 'Missing token.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'This link is invalid or has expired.' });
  }

  try {
    const [[log]] = await pool.query('SELECT * FROM delivery_logs WHERE download_token = ? LIMIT 1', [token]);
    if (!log) {
      return res.status(404).json({ success: false, message: 'Link not found.' });
    }
    if (log.downloaded_at) {
      return res.status(410).json({ success: false, message: 'This link has already been used.' });
    }
    if (new Date(log.token_expiry) < new Date()) {
      return res.status(410).json({ success: false, message: 'This link has expired.' });
    }

    const [[doc]] = await pool.query('SELECT * FROM generated_docs WHERE id = ?', [decoded.docId]);
    if (!doc || !fs.existsSync(doc.file_path)) {
      return res.status(410).json({ success: false, message: 'The file is no longer available.' });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;
    await pool.query(
      'UPDATE delivery_logs SET downloaded_at = NOW(), downloaded_ip = ?, downloaded_user_agent = ?, email_status = ? WHERE id = ?',
      [ip, userAgent, 'opened', log.id]
    );

    const meta = doc.metadata ? JSON.parse(doc.metadata) : {};
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${meta.fileName || 'document.pdf'}"`);

    // FR-029: log the recipient's IP, browser, and timestamp — passing `req` here (not
    // just `ip` inside `details`) also populates audit_logs.ip_address/user_agent via
    // recordAudit's own extraction, so the browser is captured in both places.
    await recordAudit({ docId: doc.id, action: 'DOWNLOAD', details: { via: 'secure_link', ip, userAgent }, req });

    fs.createReadStream(doc.file_path).pipe(res);
  } catch (err) {
    console.error('[delivery] download error:', err);
    return res.status(500).json({ success: false, message: 'Failed to process download.' });
  }
}

/**
 * PATCH /api/documents/:id/hand-delivered
 * Records that a physical copy of the final, signed PDF was handed to the recipient.
 * Available to the document's own generator and to admins.
 * Accepts both 'signed' (not yet formally delivered) and 'delivered' (re-recording
 * a physical handover on an already-delivered document) — the database status is
 * set to 'delivered' in both cases, and the audit record distinguishes the event.
 */
async function markHandDelivered(req, res) {
  const { id } = req.params;
  try {
    const [[doc]] = await pool.query(
      'SELECT id, generated_by, status, deleted_at FROM generated_docs WHERE id = ?',
      [id]
    );
    if (!doc || doc.deleted_at) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    // Permission: the document's own generator OR an admin.
    const isOwner = doc.generated_by === req.user.id;
    const isAdmin = req.user.role === 'super_admin' || req.user.role === 'system_admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'You can only mark your own documents as hand-delivered.' });
    }
    if (!['signed', 'delivered'].includes(doc.status)) {
      return res.status(409).json({ success: false, message: 'Only signed or delivered documents can be marked as hand-delivered.' });
    }
    await pool.query(
      `UPDATE generated_docs SET status = 'delivered' WHERE id = ?`,
      [id]
    );
    await recordAudit({ userId: req.user.id, docId: Number(id), action: 'DELIVER', details: { event: 'hand_delivered' }, req });
    return res.status(200).json({ success: true, message: 'Marked as hand-delivered.' });
  } catch (err) {
    console.error('[delivery] hand-delivered error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update status.' });
  }
}

module.exports = {
  downloadViaToken, markHandDelivered,
  buildDownloadToken, buildDownloadUrl, TOKEN_EXPIRY_DAYS,
};
