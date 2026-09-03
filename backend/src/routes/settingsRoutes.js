const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../utils/roles');
const {
  getSettings, putSettings, getDbConnectionInfo, testDbConnection, updateDbConnection,
} = require('../controllers/settingsController');

// RBAC matrix: "Manage System Settings & DB Connections" — super_admin ONLY
const superAdminOnly = requireRole(ROLES.SUPER_ADMIN);

router.get('/', requireAuth, superAdminOnly, getSettings);
router.put('/', requireAuth, superAdminOnly, putSettings);
router.get('/database', requireAuth, superAdminOnly, getDbConnectionInfo);
router.post('/database/test', requireAuth, superAdminOnly, testDbConnection);
router.put('/database', requireAuth, superAdminOnly, updateDbConnection);

module.exports = router;
