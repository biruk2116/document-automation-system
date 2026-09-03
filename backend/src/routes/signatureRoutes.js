const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../utils/roles');
const {
  initiateSignatureRequest,
  listPendingForApprover,
  viewPendingDocument,
  resendOtp,
  approveSignature,
  rejectSignature,
  getRejectRecipients,
} = require('../controllers/signatureController');

// RBAC matrix: "Initiate an E-Signature Request" — any of the 4 roles that can
// generate a document (super_admin, system_admin, generator, approver) may request
// signature on a document THEY generated. Self-approval is still blocked separately
// inside the controller (a generator — whichever role they hold — can never approve,
// reject, or e-sign a document they themselves generated).
const canInitiate = requireRole(ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN, ROLES.GENERATOR, ROLES.APPROVER);
// RBAC matrix: "Approve/Reject & Apply E-Sign" — admins + approver
const canApprove = requireRole(ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN, ROLES.APPROVER);

router.post('/', requireAuth, canInitiate, initiateSignatureRequest);
router.get('/pending', requireAuth, canApprove, listPendingForApprover);
router.get('/:id/view', requireAuth, canApprove, viewPendingDocument);
router.post('/:id/resend-otp', requireAuth, canApprove, resendOtp);
router.post('/:id/approve', requireAuth, canApprove, approveSignature);
router.get('/:id/reject-recipients', requireAuth, canApprove, getRejectRecipients);
router.post('/:id/reject', requireAuth, canApprove, rejectSignature);

module.exports = router;
