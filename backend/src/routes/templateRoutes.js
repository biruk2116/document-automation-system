const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../utils/roles');
const {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  updateTemplateStatus,
} = require('../controllers/templateController');
const { logoUpload, handleLogoUpload } = require('../controllers/uploadController');

// Both super_admin and system_admin can manage (create/edit/archive) templates (RBAC matrix row 2)
const canManageTemplates = requireRole(ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN);
// Reading the template list/detail must be open to all 4 generate-capable roles —
// Generator and Approver both need it just to pick a template (MyDocumentsPage,
// ApprovalsPage's reference-data picker), not only Admin authoring one.
const canView = requireRole(ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN, ROLES.GENERATOR, ROLES.APPROVER);

router.get('/', requireAuth, canView, listTemplates);
router.post('/upload-logo', requireAuth, canManageTemplates, logoUpload.single('logo'), handleLogoUpload); // FR-008
router.get('/:id', requireAuth, canView, getTemplateById);
router.post('/', requireAuth, canManageTemplates, createTemplate);
router.put('/:id', requireAuth, canManageTemplates, updateTemplate);
router.delete('/:id', requireAuth, canManageTemplates, deleteTemplate);
router.patch('/:id/status', requireAuth, canManageTemplates, updateTemplateStatus);

module.exports = router;
