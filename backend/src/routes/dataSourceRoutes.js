const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../utils/roles');
const { listDataSources, listDataSourceFields, listRecordsForTable } = require('../controllers/dataSourceController');

const canManageTemplates = requireRole(ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN);
// Generation-facing roles also need to browse records for the multi-select bulk picker
const canGenerate = requireRole(ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN, ROLES.GENERATOR, ROLES.APPROVER);

router.get('/', requireAuth, canManageTemplates, listDataSources);
// Field/column names are needed to render the mapped-data table for Generator + Approver
// too (not just Admin authoring a template), so this uses the same canGenerate matrix as
// the records endpoint below — canGenerate is a superset of canManageTemplates.
router.get('/:table/fields', requireAuth, canGenerate, listDataSourceFields);
router.get('/:table/records', requireAuth, canGenerate, listRecordsForTable);

module.exports = router;
