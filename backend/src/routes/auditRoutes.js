const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../utils/roles');
const {
  getAuditTrail,
  getAuditTrailCsv,
  getDashboardKpis,
  getDashboardTrends,
  getMonthlyReportCsv,
  getMonthlyReportPreview,
  searchDocuments,
  getReportFilterOptions,
  getArchiveOverview,
  runArchiveNow,
} = require('../controllers/auditController');

const adminOnly = requireRole(ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN);

router.get('/audit-logs', requireAuth, adminOnly, getAuditTrail);
// Full-information CSV export of the audit trail — registered as its own literal
// path (not /audit-logs/:id) so it can never collide with a future id-style route.
router.get('/audit-logs/export', requireAuth, adminOnly, getAuditTrailCsv);
router.get('/dashboard/kpis', requireAuth, adminOnly, getDashboardKpis);
router.get('/dashboard/trends', requireAuth, adminOnly, getDashboardTrends);
// NOTE: /reports/monthly/preview must be registered before /reports/monthly so
// Express doesn't need any special-casing — they're distinct literal paths, but kept
// in this order to mirror the CSV route immediately below it for readability.
router.get('/reports/monthly/preview', requireAuth, adminOnly, getMonthlyReportPreview);
router.get('/reports/monthly', requireAuth, adminOnly, getMonthlyReportCsv);
router.get('/reports/filter-options', requireAuth, adminOnly, getReportFilterOptions);
router.get('/documents/search', requireAuth, searchDocuments); // any authenticated role, scoped by their own filters client-side
router.get('/archive/overview', requireAuth, adminOnly, getArchiveOverview);
router.post('/archive/run', requireAuth, adminOnly, runArchiveNow);

module.exports = router;
