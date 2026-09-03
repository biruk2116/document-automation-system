const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getNotifications, markNotificationRead } = require('../controllers/notificationController');

router.get('/', requireAuth, getNotifications);
router.post('/:type/:id/read', requireAuth, markNotificationRead);

module.exports = router;
