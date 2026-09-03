const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../utils/roles');
const {
  markHandDelivered,
} = require('../controllers/deliveryController');
const {
  initiateSecureDelivery,
  initiateResubmitDelivery,
  consumeRejectionNotifyToken,
  listDeliveriesForDocument,
  getOwnershipReport,
  revokeDocument,
} = require('../controllers/secureDeliveryController');

const canDeliver = requireRole(ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN, ROLES.GENERATOR, ROLES.APPROVER);
const adminOnly = requireRole(ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN);

// SECURITY FIX: the old '/documents/:id/deliver' (direct email attachment, no
// verification) and '/documents/:id/secure-link' (link that served the PDF with no
// OTP/ownership check — literally "opens directly as a PDF") routes have been
// removed. Every recipient delivery now goes exclusively through
// '/documents/:id/secure-delivery' below (one-time link + OTP + ownership
// confirmation). See deliveryController.js's top-of-file note for details.
router.patch('/documents/:id/hand-delivered', requireAuth, canDeliver, markHandDelivered);

// Secure Document Delivery & Ownership Verification module (authenticated side).
// POST /documents/:id/secure-delivery — initiate delivery (email_attachment OR secure_link_otp).
router.post('/documents/:id/secure-delivery', requireAuth, canDeliver, initiateSecureDelivery);
// POST /documents/:id/resubmit-delivery — after edit & resubmit, auto-send new secure delivery.
router.post('/documents/:id/resubmit-delivery', requireAuth, canDeliver, initiateResubmitDelivery);
// GET /documents/:id/rejection-review/:notifyToken — validate one-time rejection notify token.
router.get('/documents/:id/rejection-review/:notifyToken', requireAuth, consumeRejectionNotifyToken);
router.get('/documents/:id/deliveries', requireAuth, canDeliver, listDeliveriesForDocument);
// Registered ahead of no conflicting param route, but kept explicit and separate
// from '/documents/:id/deliveries' above (different path shape: no :id segment)
// so this can never be shadowed by it. Reporting-only — see getOwnershipReport's
// docblock for why it never influences any authorization decision.
router.get('/documents/deliveries/report', requireAuth, canDeliver, getOwnershipReport);
router.patch('/documents/:id/revoke', requireAuth, adminOnly, revokeDocument);

module.exports = router;
