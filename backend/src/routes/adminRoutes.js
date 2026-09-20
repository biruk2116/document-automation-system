/**
 * adminRoutes.js - Administrative endpoints for system maintenance
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { ensureSchema } = require('../config/db');

/**
 * POST /api/admin/schema/update
 * Manually trigger database schema update
 * Requires: ADMIN role
 */
router.post('/schema/update', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    console.log('[admin] Manual schema update triggered by:', req.user.email);
    
    await ensureSchema();
    
    console.log('[admin] Schema update completed successfully');
    
    res.json({
      success: true,
      message: 'Database schema updated successfully. Check server logs for details.',
    });
  } catch (err) {
    console.error('[admin] Schema update failed:', err);
    res.status(500).json({
      success: false,
      message: 'Schema update failed: ' + err.message,
      error: err.stack,
    });
  }
});

/**
 * GET /api/admin/schema/verify
 * Verify database schema status
 * Requires: ADMIN role
 */
router.get('/schema/verify', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { pool } = require('../config/db');
    
    // Check workflow columns
    const [workflowCols] = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'document_deliveries' 
        AND column_name LIKE 'workflow%'
      ORDER BY column_name
    `);
    
    // Check templates workflow_config column
    const [templateCols] = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'templates' 
        AND column_name = 'workflow_config'
    `);
    
    const hasAllWorkflowColumns = workflowCols.length >= 10; // We expect at least 10 workflow columns
    const hasTemplateWorkflowConfig = templateCols.length > 0;
    
    res.json({
      success: true,
      schema: {
        document_deliveries: {
          workflow_columns: workflowCols.map(c => ({ name: c.column_name, type: c.data_type })),
          count: workflowCols.length,
          status: hasAllWorkflowColumns ? 'OK' : 'MISSING_COLUMNS',
        },
        templates: {
          workflow_config: hasTemplateWorkflowConfig ? 'EXISTS' : 'MISSING',
          columns: templateCols.map(c => ({ name: c.column_name, type: c.data_type })),
        },
      },
      overall_status: (hasAllWorkflowColumns && hasTemplateWorkflowConfig) ? 'HEALTHY' : 'NEEDS_UPDATE',
    });
  } catch (err) {
    console.error('[admin] Schema verification failed:', err);
    res.status(500).json({
      success: false,
      message: 'Schema verification failed: ' + err.message,
    });
  }
});

module.exports = router;
