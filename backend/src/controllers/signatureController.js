const fs = require('fs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { generateOtp, hashOtp, verifyOtp, otpExpiryDate, lockoutExpiryDate, MAX_OTP_ATTEMPTS } = require('../utils/otp');
const { computeSignatureHmac } = require('../utils/hmac');
const { getSyncedTime } = require('../utils/ntpTime');
const { sha256 } = require('../utils/documentIntegrity');
const { assembleDocumentHtml, resolveWatermarkForStatus } = require('../utils/documentAssembler');
const { htmlToPdfBuffer } = require('../utils/pdfGenerator');
const { sendMail, templates } = require('../utils/emailService');
const { recordAudit } = require('../utils/auditLog');
require('dotenv').config();

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const JWT_SECRET = process.env.JWT_SECRET || 'insecure_dev_fallback_secret';
const VIEW_TOKEN_EXPIRY_HOURS = 24;

/**
 * FR-022: the email/in-app notification carries a "secure, one-time link" the
 * Approver can open to review the PDF in the browser BEFORE entering the OTP —
 * i.e. no login should be required just to look at the document. The link is a
 * signed, short-lived JWT scoped to exactly one signature_request; single-use is
 * enforced at open-time via signature_requests.view_token_used_at (see
 * viewDocumentByToken below), the same pattern already used for delivery
 * download links in deliveryController.js.
 */
function buildViewToken(signatureRequestId) {
  return jwt.sign(
    { sigReqId: signatureRequestId, purpose: 'signature_view' },
    JWT_SECRET,
    { expiresIn: `${VIEW_TOKEN_EXPIRY_HOURS}h` }
  );
}

function buildReviewUrl(signatureRequestId) {
  const token = buildViewToken(signatureRequestId);
  return `${CLIENT_URL}/review/${encodeURIComponent(token)}`;
}

/**
 * Generator-side counterpart to buildViewToken/buildReviewUrl above. Sent in the
 * docSigned/docRejected notification emails so the Generator gets "the same way"
 * of reviewing the outcome as the Approver did: a secure, one-time, no-login link
 * that opens the PDF inline in the browser. Enforced single-use via
 * generated_docs.notify_view_token_used_at (see documentController.viewDocumentByNotifyToken).
 */
function buildDocNotifyToken(docId) {
  return jwt.sign(
    { docId, purpose: 'doc_notify_view' },
    JWT_SECRET,
    { expiresIn: `${VIEW_TOKEN_EXPIRY_HOURS}h` }
  );
}

function buildDocNotifyUrl(docId) {
  const token = buildDocNotifyToken(docId);
  return `${CLIENT_URL}/document-view/${encodeURIComponent(token)}`;
}

/**
 * Core "create a signature request + notify the approver" logic, shared by the
 * authenticated HTTP handler below and by documentController's Edit & Resubmit
 * flow (which needs to send a freshly-regenerated document straight to an
 * approver without going through this route a second time).
 *
 * @param note  Optional "what was fixed" text supplied on a resubmission — folded
 *              into the approver's notification email so they know what changed
 *              without having to dig through the rejection reason themselves.
 */
async function runInitiateSignature({ docId, approverId, userId, req, note }) {
  const [[doc]] = await pool.query('SELECT * FROM generated_docs WHERE id = ?', [docId]);
  if (!doc) {
    return { ok: false, status: 404, message: 'Document not found.' };
  }
  if (doc.status !== 'draft') {
    return { ok: false, status: 409, message: `Document is already "${doc.status}" — cannot initiate signing.` };
  }

  // BR-003: an approver cannot approve their own generated document
  if (doc.generated_by === Number(approverId)) {
    return { ok: false, status: 403, message: 'Self-approval is not allowed: the approver cannot be the document generator.' };
  }

  const [[approver]] = await pool.query('SELECT id, email, phone, full_name, role FROM users WHERE id = ?', [approverId]);
  if (!approver || approver.role !== 'approver') {
    return { ok: false, status: 400, message: 'Selected user is not a valid approver.' };
  }

  const otpCode = generateOtp();
  const otpHash = await hashOtp(otpCode);

  const [result] = await pool.query(
    `INSERT INTO signature_requests (doc_id, approver_id, otp_code, otp_expiry, otp_attempts, status)
     VALUES (?, ?, ?, ?, 0, 'pending')`,
    [docId, approverId, otpHash, otpExpiryDate()]
  );

  await pool.query('UPDATE generated_docs SET status = ? WHERE id = ?', ['pending', docId]);

  const { subject, html } = templates.docReadyForSigning({
    approverName: approver.full_name,
    docId: doc.doc_uuid,
    otpNote: `Enter this one-time code on the review page to unlock and view the document: <b>${otpCode}</b> (expires in 5 minutes).`,
    reviewUrl: buildReviewUrl(result.insertId),
    resubmitNote: note && note.trim() ? note.trim() : null,
  });
  await sendMail({ to: approver.email, subject, html });

  await recordAudit({ userId, docId, action: 'SIGN', details: { event: 'initiated', signatureRequestId: result.insertId }, req });

  return { ok: true, signatureRequestId: result.insertId, approverName: approver.full_name };
}

/**
 * POST /api/signatures   body: { doc_id, approver_id }
 * FR-021, BR-003 (self-approval blocked)
 */
async function initiateSignatureRequest(req, res) {
  const { doc_id, approver_id } = req.body;

  if (!doc_id || !approver_id) {
    return res.status(400).json({ success: false, message: 'doc_id and approver_id are required.' });
  }

  try {
    const result = await runInitiateSignature({ docId: doc_id, approverId: approver_id, userId: req.user.id, req });
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    return res.status(201).json({
      success: true,
      message: `Signature request sent to ${result.approverName}.`,
      data: { signatureRequestId: result.signatureRequestId },
    });
  } catch (err) {
    console.error('[signatures] initiate error:', err);
    return res.status(500).json({ success: false, message: 'Failed to initiate signature request.' });
  }
}

/** GET /api/signatures/pending — requests awaiting the logged-in approver. */
async function listPendingForApprover(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT sr.id, sr.doc_id, sr.status, sr.otp_expiry, sr.created_at,
              gd.doc_uuid, gd.record_identifier, gd.file_path, t.name AS template_name,
              u.full_name AS generator_name
       FROM signature_requests sr
       JOIN generated_docs gd ON gd.id = sr.doc_id
       JOIN templates t ON t.id = gd.template_id
       JOIN users u ON u.id = gd.generated_by
       WHERE sr.approver_id = ? AND sr.status = 'pending'
       ORDER BY sr.created_at DESC`,
      [req.user.id]
    );

    // A signature request can outlive its underlying file (deleted from disk,
    // moved to cold storage, etc.). There is nothing left for the approver to
    // view/approve in that case, so those rows are filtered out here rather
    // than shown as a dead end — same "file must exist on disk" rule the
    // /view endpoint already enforces (see viewPendingDocument above).
    const existing = rows
      .filter((r) => r.file_path && fs.existsSync(r.file_path))
      .map(({ file_path, ...rest }) => rest); // don't leak the on-disk path to the client

    return res.status(200).json({ success: true, message: 'Pending approvals fetched.', data: existing });
  } catch (err) {
    console.error('[signatures] list pending error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch pending approvals.' });
  }
}

/**
 * GET /api/signatures/:id/view — approver clicks the link from their email/notification
 * and views the PDF in the browser BEFORE entering the OTP. Streams the file inline
 * (not as an attachment/download) and is restricted to the approver assigned to this
 * specific request (or an admin) — this is a view step, not the general download route.
 */
async function viewPendingDocument(req, res) {
  const { id } = req.params;
  try {
    const [[sigReq]] = await pool.query('SELECT * FROM signature_requests WHERE id = ?', [id]);
    if (!sigReq) {
      return res.status(404).json({ success: false, message: 'Signature request not found.' });
    }

    const isAssignedApprover = sigReq.approver_id === req.user.id;
    const isAdmin = ['super_admin', 'system_admin'].includes(req.user.role);
    if (!isAssignedApprover && !isAdmin) {
      return res.status(403).json({ success: false, message: 'This request is not assigned to you.' });
    }

    const [[doc]] = await pool.query('SELECT * FROM generated_docs WHERE id = ?', [sigReq.doc_id]);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    if (!fs.existsSync(doc.file_path)) {
      return res.status(410).json({ success: false, message: 'File no longer exists on disk.' });
    }

    const meta = doc.metadata ? JSON.parse(doc.metadata) : {};
    res.setHeader('Content-Type', 'application/pdf');
    // inline (not attachment): opens/renders in the browser rather than triggering a download
    res.setHeader('Content-Disposition', `inline; filename="${meta.fileName || 'document.pdf'}"`);

    await recordAudit({ userId: req.user.id, docId: doc.id, action: 'VIEW', details: { via: 'signature_request', signatureRequestId: sigReq.id }, req });

    fs.createReadStream(doc.file_path).pipe(res);
  } catch (err) {
    console.error('[signatures] view error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load document for viewing.' });
  }
}

/**
 * GET /api/signatures/review/:token   PUBLIC — no login required.
 * FR-022: the "secure, one-time link" from the notification email/in-app alert.
 * Opening it streams the PDF inline (review-in-browser, same as viewPendingDocument)
 * without requiring the Approver to sign in first. Single-use: the first successful
 * open marks the request's view_token_used_at, and every later hit on the same token
 * — even though the JWT itself is still cryptographically valid until it expires —
 * is rejected with a clear "already used, sign in to review again" message. Approving
 * or rejecting still requires the authenticated /api/signatures/:id/approve|reject
 * routes, so this endpoint only ever grants read-only viewing.
 */
async function viewDocumentByToken(req, res) {
  const { token } = req.params;

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'This review link is invalid or has expired.' });
  }
  if (decoded.purpose !== 'signature_view' || !decoded.sigReqId) {
    return res.status(401).json({ success: false, message: 'This review link is invalid.' });
  }

  try {
    const [[sigReq]] = await pool.query('SELECT * FROM signature_requests WHERE id = ?', [decoded.sigReqId]);
    if (!sigReq) {
      return res.status(404).json({ success: false, message: 'Signature request not found.' });
    }
    if (sigReq.status !== 'pending') {
      return res.status(410).json({ success: false, message: `This document is no longer pending review (status: ${sigReq.status}).` });
    }
    if (sigReq.view_token_used_at) {
      return res.status(410).json({
        success: false,
        message: 'This secure link has expired or has already been used.',
      });
    }
    // Gate: the Approver must enter and verify the OTP sent by email BEFORE the PDF
    // is ever served — verified via POST /signatures/review/:token/verify-otp, which
    // sets otp_verified_at. Without that, this endpoint refuses to stream the file
    // (and does NOT consume the one-time link — only actually viewing the PDF does).
    if (!sigReq.otp_verified_at) {
      return res.status(403).json({
        success: false,
        message: 'Enter the OTP sent to your email to unlock this document.',
        code: 'OTP_REQUIRED',
      });
    }

    const [[doc]] = await pool.query('SELECT * FROM generated_docs WHERE id = ?', [sigReq.doc_id]);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    if (!fs.existsSync(doc.file_path)) {
      return res.status(410).json({ success: false, message: 'File no longer exists on disk.' });
    }

    await pool.query('UPDATE signature_requests SET view_token_used_at = NOW() WHERE id = ?', [sigReq.id]);

    const meta = doc.metadata ? JSON.parse(doc.metadata) : {};
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${meta.fileName || 'document.pdf'}"`);

    await recordAudit({ docId: doc.id, action: 'VIEW', details: { via: 'signature_review_link', signatureRequestId: sigReq.id }, req });

    fs.createReadStream(doc.file_path).pipe(res);
  } catch (err) {
    console.error('[signatures] viewDocumentByToken error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load document for viewing.' });
  }
}

/**
 * POST /api/signatures/review/:token/verify-otp   body: { otp_code }   PUBLIC — no login required.
 * MAIN REQUIREMENT: the Approver must enter the OTP sent to their email BEFORE the
 * PDF behind the secure one-time link is ever revealed. This endpoint only checks the
 * OTP and, on success, records signature_requests.otp_verified_at — it never streams
 * the document and never marks the link as "used" (that only happens once the PDF is
 * actually fetched via GET /signatures/review/:token, right after this succeeds).
 * Shares the same hash/attempts/lockout rules as the final approve step.
 */
async function verifyOtpForReviewToken(req, res) {
  const { token } = req.params;
  const { otp_code } = req.body;

  if (!otp_code) {
    return res.status(400).json({ success: false, message: 'otp_code is required.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'This review link is invalid or has expired.' });
  }
  if (decoded.purpose !== 'signature_view' || !decoded.sigReqId) {
    return res.status(401).json({ success: false, message: 'This review link is invalid.' });
  }

  try {
    const [[sigReq]] = await pool.query('SELECT * FROM signature_requests WHERE id = ?', [decoded.sigReqId]);
    if (!sigReq) {
      return res.status(404).json({ success: false, message: 'Signature request not found.' });
    }
    if (sigReq.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Request already ${sigReq.status}.` });
    }
    if (sigReq.view_token_used_at) {
      return res.status(410).json({ success: false, message: 'This secure link has expired or has already been used.' });
    }
    if (sigReq.locked_until && new Date(sigReq.locked_until) > new Date()) {
      return res.status(423).json({ success: false, message: `Too many failed attempts. Try again after ${sigReq.locked_until}.` });
    }
    if (new Date(sigReq.otp_expiry) < new Date()) {
      return res.status(410).json({ success: false, message: 'OTP has expired. Use "Resend OTP" to get a new code.' });
    }

    const isValid = await verifyOtp(otp_code, sigReq.otp_code);
    if (!isValid) {
      const attempts = sigReq.otp_attempts + 1;
      const lockedUntil = attempts >= MAX_OTP_ATTEMPTS ? lockoutExpiryDate() : null;
      await pool.query('UPDATE signature_requests SET otp_attempts = ?, locked_until = ? WHERE id = ?', [attempts, lockedUntil, sigReq.id]);

      if (lockedUntil) {
        return res.status(423).json({ success: false, message: 'Incorrect OTP. Maximum attempts reached — locked for 15 minutes.' });
      }
      return res.status(401).json({ success: false, message: `Incorrect OTP. ${MAX_OTP_ATTEMPTS - attempts} attempt(s) remaining.` });
    }

    await pool.query('UPDATE signature_requests SET otp_verified_at = NOW() WHERE id = ?', [sigReq.id]);

    await recordAudit({
      userId: sigReq.approver_id,
      docId: sigReq.doc_id,
      action: 'SIGN',
      details: { event: 'otp_verified', signatureRequestId: sigReq.id, via: 'public_review_link' },
      req,
    });

    return res.status(200).json({ success: true, message: 'OTP verified. Loading document…' });
  } catch (err) {
    console.error('[signatures] verifyOtpForReviewToken error:', err);
    return res.status(500).json({ success: false, message: 'Failed to verify OTP.' });
  }
}

/**
 * POST /api/signatures/:id/resend-otp
 * Generates a fresh OTP and re-sends it (email + SMS) for a pending request, resetting
 * the 5-minute expiry and the failed-attempt counter. Needed because the OTP is only
 * ever issued once by default (at initiateSignatureRequest) — without this, an Approver
 * whose original email never arrived (e.g. SMTP not configured) or whose code expired
 * before they got to the Approvals page had no way to get a working code, and clicking
 * "Approve" alone never sent anything.
 */
async function resendOtp(req, res) {
  const { id } = req.params;

  try {
    const [[sigReq]] = await pool.query('SELECT * FROM signature_requests WHERE id = ?', [id]);
    if (!sigReq) {
      return res.status(404).json({ success: false, message: 'Signature request not found.' });
    }
    if (sigReq.approver_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'This request is not assigned to you.' });
    }
    if (sigReq.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Request already ${sigReq.status}.` });
    }
    if (sigReq.locked_until && new Date(sigReq.locked_until) > new Date()) {
      return res.status(423).json({ success: false, message: `Too many failed attempts. Try again after ${sigReq.locked_until}.` });
    }

    const [[doc]] = await pool.query('SELECT doc_uuid FROM generated_docs WHERE id = ?', [sigReq.doc_id]);
    const [[approver]] = await pool.query('SELECT email, phone, full_name FROM users WHERE id = ?', [req.user.id]);

    const otpCode = generateOtp();
    const otpHash = await hashOtp(otpCode);

    // Reset the attempt counter too — a brand-new code deserves a fresh 3 tries, not
    // whatever was left over from the previous (possibly expired/never-received) one.
    // Also reset view_token_used_at: a re-sent request gets a fresh one-time review
    // link, so a previously-opened (and thus spent) link doesn't strand the approver.
    await pool.query(
      'UPDATE signature_requests SET otp_code = ?, otp_expiry = ?, otp_attempts = 0, view_token_used_at = NULL, otp_verified_at = NULL WHERE id = ?',
      [otpHash, otpExpiryDate(), id]
    );

    const { subject, html } = templates.docReadyForSigning({
      approverName: approver.full_name,
      docId: doc.doc_uuid,
      otpNote: `Enter this one-time code on the review page to unlock and view the document: <b>${otpCode}</b> (expires in 5 minutes).`,
      reviewUrl: buildReviewUrl(id),
    });
    await sendMail({ to: approver.email, subject, html });

    await recordAudit({ userId: req.user.id, docId: sigReq.doc_id, action: 'SIGN', details: { event: 'otp_resent', signatureRequestId: sigReq.id }, req });

    return res.status(200).json({ success: true, message: `A new OTP was sent to ${approver.email}.` });
  } catch (err) {
    console.error('[signatures] resendOtp error:', err);
    return res.status(500).json({ success: false, message: 'Failed to resend OTP.' });
  }
}

/**
 * The actual digital-signing side effects — PDF re-stamp, hash, HMAC, DB updates,
 * generator notification — with NO OTP check of its own. Called only after the
 * caller has already established the Approver's identity, either by validating the
 * OTP code right here in the same request (runApproval, below) or by relying on an
 * OTP verification that already happened earlier in this same one-time link's
 * lifetime (runApprovalPreVerified, below — the OTP-before-view gate).
 */
async function applyApproval(sigReq) {
  const [[doc]] = await pool.query('SELECT * FROM generated_docs WHERE id = ?', [sigReq.doc_id]);
  const [[approver]] = await pool.query('SELECT id, full_name FROM users WHERE id = ?', [sigReq.approver_id]);

  const { timestamp } = await getSyncedTime(); // FR-026
  const visualSignatureText = `Digitally Approved by ${approver.full_name} on ${timestamp.toISOString()}`;

  const meta = doc.metadata ? JSON.parse(doc.metadata) : {};
  const pieces = meta.renderPieces || {};

  const signatureHtml = `<p class="visual-signature" style="margin-top:10px;font-style:italic;">${visualSignatureText}</p>`;
  const stampedHtml = assembleDocumentHtml({
    ...pieces,
    watermarkText: resolveWatermarkForStatus('signed', pieces.watermarkText), // FR-017: DRAFT -> FINAL/CONFIDENTIAL on approval
    signatureHtml,
  });
  const pdfBuffer = await htmlToPdfBuffer(stampedHtml);
  const newHash = sha256(pdfBuffer);

  fs.writeFileSync(doc.file_path, pdfBuffer); // overwrite in place — same doc, now signed

  const cryptoHmac = computeSignatureHmac(newHash, timestamp.toISOString()); // FR-024

  await pool.query(
    `INSERT INTO digital_signatures (doc_id, signer_id, signature_timestamp, crypto_hmac, visual_signature_text)
     VALUES (?, ?, ?, ?, ?)`,
    [doc.id, approver.id, timestamp, cryptoHmac, visualSignatureText]
  );

  await pool.query('UPDATE generated_docs SET status = ?, file_hash = ?, metadata = ? WHERE id = ?', [
    'signed', newHash, JSON.stringify({ ...meta, signedAt: timestamp.toISOString() }), doc.id,
  ]);
  await pool.query('UPDATE signature_requests SET status = ?, approved_at = ? WHERE id = ?', ['approved', timestamp, sigReq.id]);

  const [[generator]] = await pool.query('SELECT email, full_name FROM users WHERE id = ?', [doc.generated_by]);
  const { subject, html } = templates.docSigned({
    generatorName: generator.full_name,
    docId: doc.doc_uuid,
    reviewUrl: buildDocNotifyUrl(doc.id),
  });
  await sendMail({ to: generator.email, subject, html });

  return {
    ok: true,
    docId: doc.id,
    approverId: approver.id,
    signedAt: timestamp.toISOString(),
    hmac: cryptoHmac,
  };
}

/**
 * Core OTP-check + digital-signing logic used by the authenticated route
 * (POST /api/signatures/:id/approve) — validates the OTP code passed in the request
 * body against the stored hash, then applies the signature via applyApproval.
 */
async function runApproval({ sigReq, otpCode }) {
  if (sigReq.status !== 'pending') {
    return { ok: false, status: 409, message: `Request already ${sigReq.status}.` };
  }
  if (sigReq.locked_until && new Date(sigReq.locked_until) > new Date()) {
    return { ok: false, status: 423, message: `Too many failed attempts. Try again after ${sigReq.locked_until}.` };
  }
  if (new Date(sigReq.otp_expiry) < new Date()) {
    return { ok: false, status: 410, message: 'OTP has expired. Ask the generator to re-initiate signing.' };
  }

  const isValid = await verifyOtp(otpCode, sigReq.otp_code);
  if (!isValid) {
    const attempts = sigReq.otp_attempts + 1;
    const lockedUntil = attempts >= MAX_OTP_ATTEMPTS ? lockoutExpiryDate() : null;
    await pool.query('UPDATE signature_requests SET otp_attempts = ?, locked_until = ? WHERE id = ?', [attempts, lockedUntil, sigReq.id]);

    if (lockedUntil) {
      return { ok: false, status: 423, message: 'Incorrect OTP. Maximum attempts reached — locked for 15 minutes.' };
    }
    return { ok: false, status: 401, message: `Incorrect OTP. ${MAX_OTP_ATTEMPTS - attempts} attempt(s) remaining.` };
  }

  return applyApproval(sigReq);
}

/**
 * Used by the PUBLIC token-based route (POST /api/signatures/review/:token/approve).
 * The Approver already proved their identity earlier in this same one-time link's
 * lifetime via POST /signatures/review/:token/verify-otp (which set otp_verified_at)
 * before the PDF was ever revealed — so approving/rejecting from this point on does
 * not ask for the OTP a second time. Still re-checks status/lockout, and — belt and
 * braces — refuses if otp_verified_at was never actually set.
 */
async function runApprovalPreVerified(sigReq) {
  if (sigReq.status !== 'pending') {
    return { ok: false, status: 409, message: `Request already ${sigReq.status}.` };
  }
  if (sigReq.locked_until && new Date(sigReq.locked_until) > new Date()) {
    return { ok: false, status: 423, message: `Too many failed attempts. Try again after ${sigReq.locked_until}.` };
  }
  if (!sigReq.otp_verified_at) {
    return { ok: false, status: 403, message: 'Verify the OTP and open the document before approving it.' };
  }

  return applyApproval(sigReq);
}

/**
 * POST /api/signatures/:id/approve   body: { otp_code }   AUTHENTICATED.
 * FR-023, FR-024, FR-026, BR-004
 */
async function approveSignature(req, res) {
  const { id } = req.params;
  const { otp_code } = req.body;

  if (!otp_code) {
    return res.status(400).json({ success: false, message: 'otp_code is required.' });
  }

  try {
    const [[sigReq]] = await pool.query('SELECT * FROM signature_requests WHERE id = ?', [id]);
    if (!sigReq) {
      return res.status(404).json({ success: false, message: 'Signature request not found.' });
    }
    if (sigReq.approver_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'This request is not assigned to you.' });
    }

    const result = await runApproval({ sigReq, otpCode: otp_code });
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    await recordAudit({ userId: req.user.id, docId: result.docId, action: 'SIGN', details: { event: 'approved', hmac: result.hmac }, req });

    return res.status(200).json({
      success: true,
      message: 'Document approved and digitally signed.',
      data: { docId: result.docId, status: 'signed', signedAt: result.signedAt },
    });
  } catch (err) {
    console.error('[signatures] approve error:', err);
    return res.status(500).json({ success: false, message: 'Failed to approve signature.' });
  }
}

/**
 * POST /api/signatures/review/:token/approve   PUBLIC — no login required.
 * The Approver's whole OTP -> view -> approve flow, finished right from the one-time
 * email link, same self-contained pattern as the Generator's notify-view page.
 * Authorization comes from the signed JWT (scopes to exactly one pending
 * signature_request) plus the OTP already verified earlier in this link's lifetime
 * (see verifyOtpForReviewToken) — no OTP code is taken here, since re-entering it
 * would just be re-proving something already proven before the PDF was shown.
 */
async function approveSignatureByToken(req, res) {
  const { token } = req.params;

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'This review link is invalid or has expired.' });
  }
  if (decoded.purpose !== 'signature_view' || !decoded.sigReqId) {
    return res.status(401).json({ success: false, message: 'This review link is invalid.' });
  }

  try {
    const [[sigReq]] = await pool.query('SELECT * FROM signature_requests WHERE id = ?', [decoded.sigReqId]);
    if (!sigReq) {
      return res.status(404).json({ success: false, message: 'Signature request not found.' });
    }

    // Identity already confirmed by OTP before the document was revealed (see
    // verifyOtpForReviewToken) — no second OTP prompt at the approve step.
    const result = await runApprovalPreVerified(sigReq);
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    await recordAudit({
      userId: result.approverId,
      docId: result.docId,
      action: 'SIGN',
      details: { event: 'approved', hmac: result.hmac, via: 'public_review_link' },
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Document approved and digitally signed.',
      data: { docId: result.docId, status: 'signed', signedAt: result.signedAt },
    });
  } catch (err) {
    console.error('[signatures] approveByToken error:', err);
    return res.status(500).json({ success: false, message: 'Failed to approve signature.' });
  }
}

/**
 * Who is even ELIGIBLE to be told a document was rejected: the person who
 * generated it, plus both Admins (super_admin/system_admin) — UNLESS the
 * generator IS one of those admins, in which case that one admin already covers
 * it and there's no separate "generator" candidate or second admin to list.
 * Shared by the recipient-picker endpoints below (so the Approver sees exactly
 * who they're choosing between) and by runRejection itself (so a client can never
 * smuggle in a recipient who was never a legitimate candidate).
 *
 * Returns candidates shaped for the UI: { id, name, role, isGenerator }.
 */
async function getRejectionCandidates(doc, generator) {
  const ADMIN_ROLES = ['super_admin', 'system_admin'];
  if (ADMIN_ROLES.includes(generator.role)) {
    // Document generated by an admin -> that one admin is the only candidate.
    return [{ id: generator.id, name: generator.full_name, role: generator.role, isGenerator: true }];
  }

  const [admins] = await pool.query(
    'SELECT id, full_name, role FROM users WHERE role IN (?, ?) ORDER BY full_name ASC LIMIT 2',
    ['super_admin', 'system_admin']
  );
  return [
    ...admins.map((a) => ({ id: a.id, name: a.full_name, role: a.role, isGenerator: false })),
    { id: generator.id, name: generator.full_name, role: generator.role, isGenerator: true },
  ];
}

/** Shared lookup used by both the reject-recipients endpoints and runRejection. */
async function loadDocAndGeneratorForSigReq(sigReq) {
  const [[doc]] = await pool.query('SELECT id, doc_uuid, generated_by FROM generated_docs WHERE id = ?', [sigReq.doc_id]);
  const [[generator]] = await pool.query('SELECT id, email, full_name, role FROM users WHERE id = ?', [doc.generated_by]);
  return { doc, generator };
}

/**
 * Core reject logic shared by the authenticated route and the public
 * token-based route, mirroring runApproval above.
 *
 * @param recipientIds  Which of the eligible candidates (see getRejectionCandidates)
 *                       the Approver actually chose to notify. Required in practice —
 *                       both callers below always send it — but falls back to "notify
 *                       everyone eligible" if omitted, so this stays backward-compatible
 *                       with any other internal caller.
 */
async function runRejection({ sigReq, reason, recipientIds }) {
  if (sigReq.status !== 'pending') {
    return { ok: false, status: 409, message: `Request already ${sigReq.status}.` };
  }

  await pool.query('UPDATE signature_requests SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', reason.trim(), sigReq.id]);
  await pool.query('UPDATE generated_docs SET status = ? WHERE id = ?', ['draft', sigReq.doc_id]);

  const { doc, generator } = await loadDocAndGeneratorForSigReq(sigReq);
  const candidates = await getRejectionCandidates(doc, generator);

  // Only ever notify candidates that are BOTH legitimate (in `candidates`) AND
  // chosen (in `recipientIds`) — a client can never smuggle in an arbitrary user id.
  const chosenIds = Array.isArray(recipientIds) && recipientIds.length > 0
    ? recipientIds.map(Number)
    : null; // null = no selection supplied -> notify every eligible candidate
  const targets = chosenIds ? candidates.filter((c) => chosenIds.includes(c.id)) : candidates;

  // IMPORTANT: buildDocNotifyUrl's link is single-use PER DOCUMENT (generated_docs.
  // notify_view_token_used_at), not per-recipient — so it can only ever be handed to
  // ONE person, or whoever opens it first locks the rest out with "already used".
  // The Generator still gets that no-login one-time link (the original design).
  // Admins are already authenticated app users, so they instead get a normal
  // sign-in-required deep link to Document Tracking — same URL the in-app
  // notification bell already uses, and it never touches the single-use flag.
  const adminReviewUrl = `${CLIENT_URL}/document-tracking?doc=${doc.id}`;
  for (const target of targets) {
    if (target.isGenerator) {
      const generatorMail = templates.docRejected({
        generatorName: generator.full_name,
        docId: doc.doc_uuid,
        reason: reason.trim(),
        reviewUrl: buildDocNotifyUrl(doc.id),
      });
      await sendMail({ to: generator.email, subject: generatorMail.subject, html: generatorMail.html });
    } else {
      const [[admin]] = await pool.query('SELECT email FROM users WHERE id = ?', [target.id]);
      const adminMail = templates.docRejected({
        generatorName: `${target.name} (as Admin — generated by ${generator.full_name})`,
        docId: doc.doc_uuid,
        reason: reason.trim(),
        reviewUrl: adminReviewUrl,
        requiresLogin: true,
      });
      await sendMail({ to: admin.email, subject: adminMail.subject, html: adminMail.html });
    }
  }

  return { ok: true, docId: sigReq.doc_id, notified: targets.map((t) => ({ id: t.id, name: t.name })) };
}

/**
 * GET /api/signatures/:id/reject-recipients   AUTHENTICATED (must be the assigned Approver).
 * Lets the Approver's reject dialog show exactly who a rejection can be sent to,
 * BEFORE they submit: the document's generator plus up to 2 Admins — or, if the
 * generator IS an Admin, just that one person. See getRejectionCandidates.
 */
async function getRejectRecipients(req, res) {
  const { id } = req.params;
  try {
    const [[sigReq]] = await pool.query('SELECT * FROM signature_requests WHERE id = ?', [id]);
    if (!sigReq) {
      return res.status(404).json({ success: false, message: 'Signature request not found.' });
    }
    if (sigReq.approver_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'This request is not assigned to you.' });
    }
    if (sigReq.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Request already ${sigReq.status}.` });
    }

    const { doc, generator } = await loadDocAndGeneratorForSigReq(sigReq);
    const candidates = await getRejectionCandidates(doc, generator);
    return res.status(200).json({ success: true, message: 'Recipients fetched.', data: candidates });
  } catch (err) {
    console.error('[signatures] reject-recipients error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load rejection recipients.' });
  }
}

/**
 * POST /api/signatures/:id/reject   body: { reason, recipientIds }   AUTHENTICATED.
 * FR-025: mandatory reason, reverts doc to Draft, notifies the chosen recipient(s)
 * (see getRejectRecipients — the Approver picks from the generator + up to 2 Admins,
 * or just the one Admin if they generated it themselves).
 */
async function rejectSignature(req, res) {
  const { id } = req.params;
  const { reason, recipientIds } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ success: false, message: 'A rejection reason is required.' });
  }
  if (recipientIds !== undefined && (!Array.isArray(recipientIds) || recipientIds.length === 0)) {
    return res.status(400).json({ success: false, message: 'Select at least one person to send the rejection to.' });
  }

  try {
    const [[sigReq]] = await pool.query('SELECT * FROM signature_requests WHERE id = ?', [id]);
    if (!sigReq) {
      return res.status(404).json({ success: false, message: 'Signature request not found.' });
    }
    if (sigReq.approver_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'This request is not assigned to you.' });
    }

    const result = await runRejection({ sigReq, reason, recipientIds });
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    await recordAudit({
      userId: req.user.id,
      docId: result.docId,
      action: 'REJECT',
      details: { reason: reason.trim(), notified: result.notified },
      req,
    });

    return res.status(200).json({ success: true, message: 'Document rejected and reverted to Draft.' });
  } catch (err) {
    console.error('[signatures] reject error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reject signature.' });
  }
}

/** Shared token decode + lookup for the two token-based endpoints just below. */
async function loadSigReqFromReviewToken(token) {
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return { error: { status: 401, message: 'This review link is invalid or has expired.' } };
  }
  if (decoded.purpose !== 'signature_view' || !decoded.sigReqId) {
    return { error: { status: 401, message: 'This review link is invalid.' } };
  }
  const [[sigReq]] = await pool.query('SELECT * FROM signature_requests WHERE id = ?', [decoded.sigReqId]);
  if (!sigReq) {
    return { error: { status: 404, message: 'Signature request not found.' } };
  }
  if (!sigReq.otp_verified_at) {
    return { error: { status: 403, message: 'Verify the OTP and open the document before continuing.' } };
  }
  return { sigReq };
}

/**
 * GET /api/signatures/review/:token/reject-recipients   PUBLIC (token-gated).
 * Token-based counterpart of getRejectRecipients above, for the Approver's
 * one-time email review link — same OTP-verified gate as reject/approve.
 */
async function getRejectRecipientsByToken(req, res) {
  const { token } = req.params;
  try {
    const { sigReq, error } = await loadSigReqFromReviewToken(token);
    if (error) return res.status(error.status).json({ success: false, message: error.message });
    if (sigReq.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Request already ${sigReq.status}.` });
    }

    const { doc, generator } = await loadDocAndGeneratorForSigReq(sigReq);
    const candidates = await getRejectionCandidates(doc, generator);
    return res.status(200).json({ success: true, message: 'Recipients fetched.', data: candidates });
  } catch (err) {
    console.error('[signatures] reject-recipients (token) error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load rejection recipients.' });
  }
}

/**
 * POST /api/signatures/review/:token/reject   body: { reason, recipientIds }   PUBLIC — no login required.
 * Same as rejectSignature but authorized by the one-time review-link JWT instead
 * of a logged-in session — lets the Approver reject right from the email link.
 */
async function rejectSignatureByToken(req, res) {
  const { token } = req.params;
  const { reason, recipientIds } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ success: false, message: 'A rejection reason is required.' });
  }
  if (recipientIds !== undefined && (!Array.isArray(recipientIds) || recipientIds.length === 0)) {
    return res.status(400).json({ success: false, message: 'Select at least one person to send the rejection to.' });
  }

  try {
    const { sigReq, error } = await loadSigReqFromReviewToken(token);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const result = await runRejection({ sigReq, reason, recipientIds });
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    await recordAudit({
      userId: sigReq.approver_id,
      docId: result.docId,
      action: 'REJECT',
      details: { reason: reason.trim(), via: 'public_review_link', notified: result.notified },
      req,
    });

    return res.status(200).json({ success: true, message: 'Document rejected and reverted to Draft.' });
  } catch (err) {
    console.error('[signatures] rejectByToken error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reject signature.' });
  }
}

/**
 * POST /api/signatures/review/:token/resend-otp   PUBLIC — no login required.
 * Same as resendOtp but authorized by the one-time review-link JWT instead of a
 * logged-in session, so an Approver who lost or let their OTP expire isn't
 * forced to sign in just to get a new code — the whole flow stays on the
 * public link. Also clears view_token_used_at, same as the authenticated
 * version, so the (now re-sent) link is viewable again too.
 */
async function resendOtpByToken(req, res) {
  const { token } = req.params;

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'This review link is invalid or has expired.' });
  }
  if (decoded.purpose !== 'signature_view' || !decoded.sigReqId) {
    return res.status(401).json({ success: false, message: 'This review link is invalid.' });
  }

  const id = decoded.sigReqId;
  try {
    const [[sigReq]] = await pool.query('SELECT * FROM signature_requests WHERE id = ?', [id]);
    if (!sigReq) {
      return res.status(404).json({ success: false, message: 'Signature request not found.' });
    }
    if (sigReq.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Request already ${sigReq.status}.` });
    }
    if (sigReq.locked_until && new Date(sigReq.locked_until) > new Date()) {
      return res.status(423).json({ success: false, message: `Too many failed attempts. Try again after ${sigReq.locked_until}.` });
    }

    const [[doc]] = await pool.query('SELECT doc_uuid FROM generated_docs WHERE id = ?', [sigReq.doc_id]);
    const [[approver]] = await pool.query('SELECT email, phone, full_name FROM users WHERE id = ?', [sigReq.approver_id]);

    const otpCode = generateOtp();
    const otpHash = await hashOtp(otpCode);

    await pool.query(
      'UPDATE signature_requests SET otp_code = ?, otp_expiry = ?, otp_attempts = 0, view_token_used_at = NULL, otp_verified_at = NULL WHERE id = ?',
      [otpHash, otpExpiryDate(), id]
    );

    const { subject, html } = templates.docReadyForSigning({
      approverName: approver.full_name,
      docId: doc.doc_uuid,
      otpNote: `Enter this one-time code on the review page to unlock and view the document: <b>${otpCode}</b> (expires in 5 minutes).`,
      reviewUrl: buildReviewUrl(id),
    });
    await sendMail({ to: approver.email, subject, html });

    await recordAudit({
      userId: sigReq.approver_id,
      docId: sigReq.doc_id,
      action: 'SIGN',
      details: { event: 'otp_resent', signatureRequestId: sigReq.id, via: 'public_review_link' },
      req,
    });

    return res.status(200).json({ success: true, message: `A new OTP was sent to ${approver.email}.` });
  } catch (err) {
    console.error('[signatures] resendOtpByToken error:', err);
    return res.status(500).json({ success: false, message: 'Failed to resend OTP.' });
  }
}

const { getAppSettings } = require('../utils/appSettings');

/**
 * FR-027: escalation — if unsigned for >72h (configurable via Settings), remind both
 * generator and approver. Called periodically by the scheduler (utils/scheduler.js).
 */
async function checkEscalations() {
  try {
    const { escalationHours } = getAppSettings();
    const [rows] = await pool.query(
      `SELECT sr.id, sr.approver_id, sr.created_at, gd.doc_uuid, gd.generated_by
       FROM signature_requests sr
       JOIN generated_docs gd ON gd.id = sr.doc_id
       WHERE sr.status = 'pending' AND sr.created_at < (NOW() - INTERVAL ? HOUR)`,
      [escalationHours]
    );

    for (const row of rows) {
      const [[approver]] = await pool.query('SELECT email, full_name FROM users WHERE id = ?', [row.approver_id]);
      const [[generator]] = await pool.query('SELECT email, full_name FROM users WHERE id = ?', [row.generated_by]);

      const { subject, html } = templates.escalation72h({
        generatorName: generator.full_name, approverName: approver.full_name, docId: row.doc_uuid,
      });
      await sendMail({ to: approver.email, subject, html });
      await sendMail({ to: generator.email, subject, html });

      await recordAudit({ action: 'SIGN', docId: null, details: { event: 'escalation_72h', signatureRequestId: row.id } });
    }

    if (rows.length > 0) console.log(`[scheduler] Sent ${rows.length} 72h escalation reminder(s).`);
  } catch (err) {
    console.error('[scheduler] checkEscalations error:', err.message);
  }
}

/**
 * FR-030/FR-027: 24-hour reminder — the template existed but was never triggered
 * until this fix. Dedup via audit_logs (no schema change needed): skip a request
 * if a 'reminder_24h' event was already logged for it.
 */
async function checkReminders() {
  try {
    const [rows] = await pool.query(
      `SELECT sr.id, sr.approver_id, sr.created_at, gd.doc_uuid
       FROM signature_requests sr
       JOIN generated_docs gd ON gd.id = sr.doc_id
       WHERE sr.status = 'pending'
         AND sr.created_at < (NOW() - INTERVAL 24 HOUR)
         AND sr.created_at > (NOW() - INTERVAL 72 HOUR)
         AND NOT EXISTS (
           SELECT 1 FROM audit_logs al
           WHERE al.action = 'SIGN'
             AND JSON_EXTRACT(al.action_details, '$.event') = 'reminder_24h'
             AND JSON_EXTRACT(al.action_details, '$.signatureRequestId') = sr.id
         )`
    );

    for (const row of rows) {
      const [[approver]] = await pool.query('SELECT email, full_name FROM users WHERE id = ?', [row.approver_id]);
      const { subject, html } = templates.reminder24h({ approverName: approver.full_name, docId: row.doc_uuid });
      await sendMail({ to: approver.email, subject, html });
      await recordAudit({ action: 'SIGN', docId: null, details: { event: 'reminder_24h', signatureRequestId: row.id } });
    }

    if (rows.length > 0) console.log(`[scheduler] Sent ${rows.length} 24h reminder(s).`);
  } catch (err) {
    console.error('[scheduler] checkReminders error:', err.message);
  }
}

module.exports = {
  initiateSignatureRequest,
  runInitiateSignature,
  listPendingForApprover,
  viewPendingDocument,
  viewDocumentByToken,
  verifyOtpForReviewToken,
  resendOtp,
  resendOtpByToken,
  approveSignature,
  approveSignatureByToken,
  rejectSignature,
  rejectSignatureByToken,
  getRejectRecipients,
  getRejectRecipientsByToken,
  checkEscalations,
  checkReminders,
  buildDocNotifyToken,
  buildDocNotifyUrl,
};
