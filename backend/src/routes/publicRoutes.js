const express = require('express');
const multer = require('multer');
const router = express.Router();
const { downloadViaToken } = require('../controllers/deliveryController');
const { verifyDocument } = require('../controllers/verifyController');
const {
  viewDocumentByToken,
  verifyOtpForReviewToken,
  approveSignatureByToken,
  rejectSignatureByToken,
  getRejectRecipientsByToken,
  resendOtpByToken,
} = require('../controllers/signatureController');
const {
  viewDocumentByNotifyToken,
  getNotifyTokenMeta,
  downloadViaNotifyToken,
  sendSecureLinkViaNotifyToken,
  sendDocumentViaNotifyToken,
  deliverViaNotifyToken,
} = require('../controllers/documentController');
const {
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
} = require('../controllers/secureDeliveryController');

// PDFs only, in-memory (we hash the buffer directly, never need it on disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB cap on verify uploads
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are accepted.'));
    }
    cb(null, true);
  },
});

// FR-029: public single-use secure download link
router.get('/deliver/download', downloadViaToken);

// FR-022 / MAIN REQUIREMENT: public single-use secure link for an Approver to review
// a pending PDF in the browser — but the OTP must be verified FIRST (see the
// verify-otp route below); this endpoint refuses to stream the file otherwise. No
// login required at any point.
router.get('/signatures/review/:token', viewDocumentByToken);

// Must be called (successfully) before the GET above will ever serve the PDF —
// checks the OTP sent by email and records that this link's identity check passed.
router.post('/signatures/review/:token/verify-otp', verifyOtpForReviewToken);

// Approver's one-time review page action bar: approve, reject (with reason), and
// resend-OTP — all usable from that same public page without signing in, same
// self-contained pattern as the Generator's notify-view page above. Authorization is
// the JWT token (scoped to exactly one signature_request) plus the OTP verification
// that already happened above — this is what lets the Approver finish the whole
// OTP -> view -> approve/reject flow without ever visiting the login page.
router.post('/signatures/review/:token/approve', approveSignatureByToken);
router.get('/signatures/review/:token/reject-recipients', getRejectRecipientsByToken);
router.post('/signatures/review/:token/reject', rejectSignatureByToken);
router.post('/signatures/review/:token/resend-otp', resendOtpByToken);

// Generator-side counterpart: public single-use secure link (sent in the
// docSigned/docRejected notification emails) letting the Generator review the
// outcome in the browser without signing in first — same pattern as above.
router.get('/documents/notify-view/:token', viewDocumentByNotifyToken);

// Read-only outcome lookup (signed vs rejected + reason) — see getNotifyTokenMeta's
// docblock. Called by the page on load, before/alongside the PDF stream above, and
// never consumes the one-time view.
router.get('/documents/notify-view/:token/meta', getNotifyTokenMeta);

// Generator's one-time notify-view page action bar: download, send-secure-link-by-
// email, and send-document-directly-by-email — all usable from that same public page
// without signing in, all gated by recipient-email validation (see recipientValidation.js).
router.get('/documents/notify-view/:token/download', downloadViaNotifyToken);
router.post('/documents/notify-view/:token/secure-link', sendSecureLinkViaNotifyToken);
router.post('/documents/notify-view/:token/deliver', sendDocumentViaNotifyToken);
// Unified validated delivery endpoint — same cross-check as in-system SecureDeliveryModal.
// Accepts { email, delivery_method } and uses the notify JWT as the credential.
router.post('/documents/notify-view/:token/deliver-validated', deliverViaNotifyToken);

// FR-033: public "Verify Document" page — no login required
router.post('/verify', upload.single('pdf'), verifyDocument);

// --- Secure Document Delivery & Ownership Verification module (public side) ---
// The whole recipient-facing flow: open link -> verify OTP -> preview -> confirm/
// reject ownership -> download. Every step is re-validated server-side against the
// token + delivery/document state — see secureDeliveryController.resolveDelivery.
router.get('/secure-delivery/:token', getDeliveryLanding);
router.post('/secure-delivery/:token/verify-otp', verifyDeliveryOtp);
router.post('/secure-delivery/:token/resend-otp', resendDeliveryOtp);
// Requirement 3: recipient/user info + document info shown on the secure page,
// only after OTP verification (see getDeliveryDetails's docblock).
router.get('/secure-delivery/:token/details', getDeliveryDetails);
router.get('/secure-delivery/:token/preview', getDocumentPreviewStream);
router.post('/secure-delivery/:token/ownership', confirmOwnership);
// OWN button — sets owned=1, fires dual notification (in-app + email) to generator.
router.post('/secure-delivery/deliveries/:deliveryId/own', confirmOwnershipOwn);
router.get('/secure-delivery/:token/download', downloadDeliveredDocument);

// ── User Workflow steps (post-OTP, configuration-driven) ──────────────────
// All three require OTP already verified.  The frontend reads workflowConfig
// from GET /secure-delivery/:token/details and calls only the enabled steps.
router.post('/secure-delivery/:token/acknowledge',      workflowAcknowledge);
router.post('/secure-delivery/:token/workflow-sign',    workflowSign);
router.post('/secure-delivery/:token/workflow-respond', workflowRespond);

// Requirement 10: public QR verification page — VALID / REVOKED / INVALID only.
router.get('/verify-qr/:verificationId', getPublicVerificationStatus);

// ── Generator Workflow Tracking — no login required ───────────────────────
// The Generator receives a one-time tracking link in the workflow-complete email.
// GET  /workflow-track/:token            → delivery state + workflow summary
// GET  /workflow-track/:token/preview    → PDF stream (inline, no download)
// POST /workflow-track/:token/auto-login → issues short-lived JWT so Generator
//                                          can open Document Tracking without
//                                          a separate login prompt.
router.get('/workflow-track/:token',              getWorkflowTrackingPage);
router.get('/workflow-track/:token/preview',      getWorkflowTrackingPreview);
router.post('/workflow-track/:token/auto-login',  workflowTrackingAutoLogin);

// Public rejection-review page — no login required.
// Generator clicks the link in their rejection notification email, lands here,
// sees the rejection reason and document info, clicks Edit & Resubmit.
router.get('/rejection-review/:token', getPublicRejectionReview);
// Auto-login for rejection-review: issues a short-lived JWT for the Generator
// so they can proceed directly to Edit & Resubmit without a password prompt.
router.post('/rejection-review/:token/auto-login', autoLoginForRejectionReview);

module.exports = router;
