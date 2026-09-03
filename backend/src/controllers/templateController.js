const { pool } = require('../config/db');
const { extractPlaceholders, guessDataType } = require('../utils/placeholderParser');
const { recordAudit } = require('../utils/auditLog');

/**
 * FR-017: "DRAFT" is not a valid template-level watermark choice — it's an automatic,
 * status-driven watermark the system stamps onto any unapproved document regardless of
 * template config (see resolveWatermarkForStatus in documentAssembler.js). If an admin
 * (or a direct API call bypassing the UI, which no longer offers "DRAFT" as an option —
 * see TemplateForm.jsx) saved "DRAFT" as a template's permanent watermark, a signed/
 * final document would still show "DRAFT" forever, since that literal value would be
 * carried straight through post-approval. Reject it outright here so the bad value can
 * never even reach the database, whichever client sent the request.
 */
function normalizeWatermarkText(watermarkText) {
  if (!watermarkText) return { ok: true, value: null };
  const trimmed = String(watermarkText).trim();
  if (trimmed.toUpperCase() === 'DRAFT') {
    return {
      ok: false,
      message: '"DRAFT" can\'t be set as a template\'s watermark — it\'s applied automatically to every unapproved document. Choose CONFIDENTIAL, FINAL, or leave it unset.',
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * GET /api/templates
 * Returns only the LATEST version in each template lineage.
 * A row is "latest" if no other row points to it via parent_template_id.
 * (FR-006: editing creates a new version; list should show current versions.)
 */
async function listTemplates(req, res) {
  try {
    const { category, status } = req.query;

    const conditions = [
      `NOT EXISTS (SELECT 1 FROM templates child WHERE child.parent_template_id = t.id)`,
    ];
    const params = [];

    if (category) {
      conditions.push('t.category = ?');
      params.push(category);
    }
    if (status) {
      conditions.push('t.status = ?');
      params.push(status);
    }

    const [rows] = await pool.query(
      `SELECT t.id, t.name, t.category, t.description, t.version, t.status,
              t.watermark_text, t.data_source_table, t.data_source_connection_id,
              t.created_at, t.updated_at, u.full_name AS created_by_name
       FROM templates t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.updated_at DESC`,
      params
    );

    return res.status(200).json({
      success: true,
      message: 'Templates fetched successfully.',
      data: rows,
    });
  } catch (err) {
    console.error('[templates] list error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch templates.' });
  }
}

/**
 * GET /api/templates/:id
 * Full structured data for View and for Edit-mode prefill.
 */
async function getTemplateById(req, res) {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      `SELECT t.*, u.full_name AS created_by_name
       FROM templates t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.id = ? LIMIT 1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }

    const [placeholders] = await pool.query(
      `SELECT id, field_path, data_type, is_loopable, default_value
       FROM template_placeholders WHERE template_id = ?`,
      [id]
    );

    return res.status(200).json({
      success: true,
      message: 'Template fetched successfully.',
      data: { ...rows[0], placeholders },
    });
  } catch (err) {
    console.error('[templates] getById error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch template.' });
  }
}

// These are injected automatically at render time (see templateRenderer.js withAutoDates)
// and are never mapped to a data source column, so they should never be stored as
// template_placeholders rows — doing so would make them show up as "missing field"
// in the bulk validation report even though they're always auto-filled.
// Note: there is no auto-injected "effective_date" — only the generation date
// (Gregorian and Ethiopian calendar) is ever auto-filled.
const AUTO_INJECTED_FIELDS = new Set(['generation_date', 'generation_date_gc', 'generation_date_ec']);

/**
 * Template names must be unique (case-insensitive, whitespace-trimmed) so the same
 * document type — e.g. "Employee Certificate" — never gets created twice.
 * Matches across ALL rows (any version/status), because versioning goes through
 * updateTemplate (which reuses the same name on purpose) rather than createTemplate.
 * `excludeIds`, when given, exempts a specific set of row ids from the check — used by
 * updateTemplate so renaming a template doesn't collide with its own version lineage.
 */
async function findDuplicateTemplateName(connection, name, excludeIds = []) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;

  let sql = 'SELECT id, name, version, status FROM templates WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))';
  const params = [trimmed];
  if (excludeIds.length > 0) {
    sql += ` AND id NOT IN (${excludeIds.map(() => '?').join(',')})`;
    params.push(...excludeIds);
  }
  sql += ' LIMIT 1';

  const [rows] = await connection.query(sql, params);
  return rows[0] || null;
}

/**
 * Walks a template's full version lineage (both older and newer versions, following
 * parent_template_id in both directions) and returns every row id in it. Used so an
 * edit/rename can be checked against *other* templates without flagging itself or its
 * own past/future versions as a "duplicate". Versioning in this app is a linear chain,
 * but this walks defensively in case that ever changes.
 */
async function getLineageIds(connection, startId) {
  const ids = new Set([startId]);

  // Walk upward through parents.
  let current = startId;
  for (let i = 0; i < 100; i++) {
    const [[row]] = await connection.query(
      'SELECT parent_template_id FROM templates WHERE id = ?',
      [current]
    );
    if (!row || !row.parent_template_id || ids.has(row.parent_template_id)) break;
    ids.add(row.parent_template_id);
    current = row.parent_template_id;
  }

  // Walk downward through children, repeatedly, until no new rows are found.
  let grew = true;
  while (grew) {
    grew = false;
    const idList = Array.from(ids);
    const [children] = await connection.query(
      `SELECT id FROM templates WHERE parent_template_id IN (${idList.map(() => '?').join(',')})`,
      idList
    );
    for (const child of children) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        grew = true;
      }
    }
  }

  return Array.from(ids);
}

/**
 * Rolls back a transaction defensively. If the underlying connection has already
 * died (e.g. MySQL reset it mid-query because the payload exceeded max_allowed_packet),
 * connection.rollback() itself throws — and if that throw isn't caught here, the
 * caller's catch block never reaches its res.status(...).json(...) line, so the
 * client never gets a response and the UI hangs forever (e.g. stuck on "Saving").
 * This must ALWAYS be called from inside a try/catch in the caller, never bare.
 */
async function safeRollback(connection, context) {
  try {
    await connection.rollback();
  } catch (rollbackErr) {
    console.error(`[templates] ${context}: rollback failed (connection likely already lost):`, rollbackErr.message);
  }
}

/**
 * Turns a raw DB error into a message that actually tells the user what to do.
 * A dropped connection (ECONNRESET / PROTOCOL_CONNECTION_LOST) during a template
 * save is, in practice, almost always caused by an embedded image (logo/signature)
 * in the header/body/footer HTML being large enough to exceed MySQL's
 * max_allowed_packet, which makes the server kill the connection outright.
 */
function describeSaveError(err) {
  const isConnectionLoss =
    err.code === 'ECONNRESET' ||
    err.code === 'PROTOCOL_CONNECTION_LOST' ||
    err.code === 'ER_NET_PACKET_TOO_LARGE' ||
    err.fatal === true;

  if (isConnectionLoss) {
    return 'The database connection was reset while saving. This usually means an inserted image (logo/signature) is too large — try using a smaller image, or ask an admin to increase MySQL\'s max_allowed_packet setting.';
  }
  return null; // caller falls back to its own generic message
}

async function savePlaceholders(connection, templateId, headerHtml, bodyHtml, footerHtml) {
  const fieldPaths = extractPlaceholders(headerHtml, bodyHtml, footerHtml)
    .filter((fp) => !AUTO_INJECTED_FIELDS.has(fp));
  if (fieldPaths.length === 0) return;

  const values = fieldPaths.map((fp) => [
    templateId,
    fp,
    guessDataType(fp),
    fp.includes('[]') || fp.toLowerCase().includes('each') ? 1 : 0,
    null,
  ]);

  await connection.query(
    `INSERT INTO template_placeholders (template_id, field_path, data_type, is_loopable, default_value)
     VALUES ?`,
    [values]
  );
}

/**
 * POST /api/templates  (FR-001, FR-002, FR-008)
 */
async function createTemplate(req, res) {
  const {
    name, category, description, header_html, body_html, footer_html,
    watermark_text, data_source_table, data_source_connection_id, logo_path,
    workflow_config,
  } = req.body;

  if (!name || !category) {
    return res.status(400).json({ success: false, message: 'Name and category are required.' });
  }

  const watermarkCheck = normalizeWatermarkText(watermark_text);
  if (!watermarkCheck.ok) {
    return res.status(400).json({ success: false, message: watermarkCheck.message });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // BR-003: no two templates may share a name (case-insensitive, trimmed) — checked
    // inside the same transaction as the insert to keep the race window as small as possible.
    const duplicate = await findDuplicateTemplateName(connection, name);
    if (duplicate) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: `A template named "${duplicate.name}" already exists (v${duplicate.version}, ${duplicate.status}). Choose a different name, or edit/reactivate the existing one instead.`,
      });
    }

    // Data source is either an internal table (data_source_table only) or a table that
    // lives inside a saved external connection (both fields set — see externalDbController.js).
    // Verified against the connection itself, inside the same transaction, so a template
    // can never be saved pointing at a connection id that doesn't exist (or was deleted
    // moments ago) with just a generic FK error.
    if (data_source_connection_id) {
      const [[conn]] = await connection.query(
        'SELECT id FROM external_db_connections WHERE id = ?', [data_source_connection_id]
      );
      if (!conn) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'The selected external database connection no longer exists.' });
      }
    }

    const [result] = await connection.query(
      `INSERT INTO templates
        (name, category, description, version, header_html, body_html, footer_html,
         watermark_text, data_source_table, data_source_connection_id, logo_path,
         workflow_config, status, created_by)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [name, category, description || null, header_html || '', body_html || '', footer_html || '',
        watermarkCheck.value, data_source_table || null, data_source_connection_id || null,
        logo_path || null,
        workflow_config ? JSON.stringify(workflow_config) : null,
        req.user.id]
    );

    const newId = result.insertId;
    await savePlaceholders(connection, newId, header_html, body_html, footer_html);
    await connection.commit();

    await recordAudit({ userId: req.user.id, docId: null, action: 'CREATE_TEMPLATE', details: { templateId: newId, name }, req });

    return res.status(201).json({
      success: true,
      message: 'Template created successfully.',
      data: { id: newId, version: 1 },
    });
  } catch (err) {
    await safeRollback(connection, 'create');
    console.error('[templates] create error:', err);
    return res.status(500).json({
      success: false,
      message: describeSaveError(err) || 'Failed to create template.',
    });
  } finally {
    connection.release();
  }
}

/**
 * PUT /api/templates/:id  (FR-006: editing creates a NEW VERSION, doesn't mutate the old one)
 * The old row is preserved untouched (existing generated_docs keep pointing at it).
 * A new row is inserted with version + 1 and parent_template_id = old id.
 */
async function updateTemplate(req, res) {
  const { id } = req.params;
  const {
    name, category, description, header_html, body_html, footer_html,
    watermark_text, data_source_table, data_source_connection_id, logo_path,
    workflow_config,
  } = req.body;

  if (!name || !category) {
    return res.status(400).json({ success: false, message: 'Name and category are required.' });
  }

  const watermarkCheck = normalizeWatermarkText(watermark_text);
  if (!watermarkCheck.ok) {
    return res.status(400).json({ success: false, message: watermarkCheck.message });
  }

  const connection = await pool.getConnection();
  try {
    if (data_source_connection_id) {
      const [[conn]] = await connection.query(
        'SELECT id FROM external_db_connections WHERE id = ?', [data_source_connection_id]
      );
      if (!conn) {
        connection.release();
        return res.status(400).json({ success: false, message: 'The selected external database connection no longer exists.' });
      }
    }

    const [existingRows] = await connection.query('SELECT * FROM templates WHERE id = ? LIMIT 1', [id]);
    if (existingRows.length === 0) {
      connection.release();
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }
    const existing = existingRows[0];

    await connection.beginTransaction();

    // BR-003: same uniqueness rule as create, but exempt this template's own version
    // lineage — re-saving with the same name (the normal case) must not self-collide.
    const lineageIds = await getLineageIds(connection, existing.id);
    const duplicate = await findDuplicateTemplateName(connection, name, lineageIds);
    if (duplicate) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: `A template named "${duplicate.name}" already exists (v${duplicate.version}, ${duplicate.status}). Choose a different name.`,
      });
    }

    const [result] = await connection.query(
      `INSERT INTO templates
        (name, category, description, version, parent_template_id, header_html, body_html, footer_html,
         watermark_text, data_source_table, data_source_connection_id, logo_path,
         workflow_config, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, category, description || null,
        existing.version + 1, existing.id,
        header_html || '', body_html || '', footer_html || '',
        watermarkCheck.value, data_source_table || null, data_source_connection_id || null,
        logo_path || null,
        workflow_config ? JSON.stringify(workflow_config) : null,
        existing.status,
        req.user.id,
      ]
    );

    const newId = result.insertId;
    await savePlaceholders(connection, newId, header_html, body_html, footer_html);
    await connection.commit();

    await recordAudit({
      userId: req.user.id, action: 'UPDATE_TEMPLATE',
      details: { previousTemplateId: existing.id, newTemplateId: newId, newVersion: existing.version + 1 },
      req,
    });

    return res.status(200).json({
      success: true,
      message: `Template updated — new version v${existing.version + 1} created.`,
      data: { id: newId, version: existing.version + 1, previousId: existing.id },
    });
  } catch (err) {
    await safeRollback(connection, 'update');
    console.error('[templates] update error:', err);
    return res.status(500).json({
      success: false,
      message: describeSaveError(err) || 'Failed to update template.',
    });
  } finally {
    connection.release();
  }
}

/**
 * DELETE /api/templates/:id
 * Blocked if any document has ever been generated from this version (audit integrity).
 */
async function deleteTemplate(req, res) {
  const { id } = req.params;
  try {
    const [[{ docCount }]] = (await pool.query(
      'SELECT COUNT(*) AS docCount FROM generated_docs WHERE template_id = ?',
      [id]
    ));

    if (docCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete: ${docCount} document(s) were generated from this template. Archive it instead.`,
      });
    }

    const [result] = await pool.query('DELETE FROM templates WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }

    await recordAudit({ userId: req.user.id, action: 'DELETE_TEMPLATE', details: { templateId: Number(id) }, req });

    return res.status(200).json({ success: true, message: 'Template deleted successfully.' });
  } catch (err) {
    console.error('[templates] delete error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete template.' });
  }
}

/**
 * PATCH /api/templates/:id/status   body: { status: 'active' | 'archived' }  (FR-007)
 */
async function updateTemplateStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'archived'].includes(status)) {
    return res.status(400).json({ success: false, message: "Status must be 'active' or 'archived'." });
  }

  try {
    const [result] = await pool.query('UPDATE templates SET status = ? WHERE id = ?', [status, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }

    await recordAudit({
      userId: req.user.id,
      action: status === 'archived' ? 'ARCHIVE_TEMPLATE' : 'UPDATE_TEMPLATE',
      details: { templateId: Number(id), status },
      req,
    });

    return res.status(200).json({ success: true, message: `Template marked as ${status}.`, data: { id: Number(id), status } });
  } catch (err) {
    console.error('[templates] status update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update template status.' });
  }
}

module.exports = {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  updateTemplateStatus,
};
