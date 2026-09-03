const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../utils/roles');
const {
  testExternalConnection, createExternalConnection, listExternalConnections,
  deleteExternalConnection, listExternalTables, listExternalTableFields,
  listExternalRecords,
} = require('../controllers/externalDbController');

// Credentials are sensitive — creating/testing/deleting a connection is super_admin
// only, matching the existing "Manage System Settings & DB Connections" RBAC entry
// (see settingsRoutes.js). Template authors only ever need to BROWSE tables/fields on
// an already-saved connection, never the raw credentials, so that's opened up to the
// same roles that manage templates.
const superAdminOnly = requireRole(ROLES.SUPER_ADMIN);
const canManageTemplates = requireRole(ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN);
// Same matrix as GET /api/data-sources/:table/records (dataSourceRoutes.js) — Generator
// and Approver also need to browse the actual rows behind an externally-mapped
// template, not just Admin authoring it.
const canGenerate = requireRole(ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN, ROLES.GENERATOR, ROLES.APPROVER);

router.post('/test', requireAuth, superAdminOnly, testExternalConnection);
router.post('/', requireAuth, superAdminOnly, createExternalConnection);
router.get('/', requireAuth, canManageTemplates, listExternalConnections);
router.delete('/:id', requireAuth, superAdminOnly, deleteExternalConnection);
router.get('/:id/tables', requireAuth, canManageTemplates, listExternalTables);
router.get('/:id/tables/:table/fields', requireAuth, canManageTemplates, listExternalTableFields);
router.get('/:id/tables/:table/records', requireAuth, canGenerate, listExternalRecords);

module.exports = router;
