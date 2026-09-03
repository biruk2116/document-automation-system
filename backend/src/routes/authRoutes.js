const express = require('express');
const router = express.Router();
const { login, me, logout, requestPasswordReset, resetPasswordWithToken } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

router.post('/login', login);
router.get('/me', requireAuth, me);
router.post('/logout', requireAuth, logout);

// Self-service "Forgot password" — public, available to every role except Super
// Admin (enforced inside the controller, not here, so the response never leaks
// which case applied).
router.post('/forgot-password', requestPasswordReset);
router.post('/reset-password', resetPasswordWithToken);

module.exports = router;
