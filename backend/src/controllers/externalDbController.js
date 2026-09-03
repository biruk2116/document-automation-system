const { pool } = require('../config/db');
const { encryptSecret, decryptSecret } = require('../utils/encryption');
const { normalizeConfig, testConnection, listTables, listFields, fetchRecords } = require('../utils/externalDbClients');
require('dotenv').config();

/** Loads one saved connection row and decrypts its password into the shape externalDbClients expects. */
async function loadConnectionConfig(id) {
  const [rows] = await pool.query('SELECT * FROM external_db_connections WHERE id = ?', [id]);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    dbType: row.db_type,
    host: row.host,
    port: row.port,
    username: row.db_user,
    password: decryptSecret(row.db_password_encrypted) || '',
    database: row.database_name,
    filePath: row.db_type === 'sqlite' ? row.database_name : null,
    ssl: Boolean(row.ssl_enabled),
  };
}

/** Never send stored credentials back to the browser — only what's needed to identify/manage the connection. */
function toPublicShape(row) {
  return {
    id: row.id,
    name: row.name,
    db_type: row.db_type,
    host: row.host,
    port: row.port,
    username: row.db_user,
    database: row.db_type === 'sqlite' ? undefined : row.database_name,
    file_path: row.db_type === 'sqlite' ? row.database_name : undefined,
    ssl: Boolean(row.ssl_enabled),
    status: row.status,
    last_tested_at: row.last_tested_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * POST /api/external-db/test
 * Verifies credentials the admin just typed in, WITHOUT saving anything.
 */
async function testExternalConnection(req, res) {
  try {
    const config = normalizeConfig(req.body);
    await testConnection(config);
    return res.status(200).json({ success: true, message: `Connection to "${config.database || config.filePath}" succeeded.` });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message || 'Connection test failed.' });
  }
}

/**
 * POST /api/external-db
 * Tests the connection, then — only if that succeeds — encrypts the password and
 * persists the connection so it can be reused as a data source on templates.
 */
async function createExternalConnection(req, res) {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'A name for this connection is required.' });
  }

  let config;
  try {
    config = normalizeConfig(req.body);
    await testConnection(config);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message || 'Connection test failed — not saved.' });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO external_db_connections
        (name, db_type, host, port, db_user, db_password_encrypted, database_name, ssl_enabled, status, last_tested_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'connected', NOW(), ?)`,
      [
        name.trim(), config.dbType, config.host, config.port, config.username,
        encryptSecret(config.password), config.dbType === 'sqlite' ? config.filePath : config.database,
        config.ssl ? 1 : 0, req.user.id,
      ]
    );
    const [rows] = await pool.query('SELECT * FROM external_db_connections WHERE id = ?', [result.insertId]);
    return res.status(201).json({ success: true, message: 'External database connection saved.', data: toPublicShape(rows[0]) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: `A connection named "${name.trim()}" already exists.` });
    }
    console.error('[externalDb] create error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save connection.' });
  }
}

/** GET /api/external-db — list saved connections (credentials never included). */
async function listExternalConnections(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM external_db_connections ORDER BY name ASC');
    return res.status(200).json({ success: true, message: 'Connections fetched.', data: rows.map(toPublicShape) });
  } catch (err) {
    console.error('[externalDb] list error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch connections.' });
  }
}

/** DELETE /api/external-db/:id */
async function deleteExternalConnection(req, res) {
  try {
    // Templates referencing this connection fall back to being unmapped rather than
    // silently pointing at a dangling id — see schema migration (ON DELETE SET NULL).
    const [result] = await pool.query('DELETE FROM external_db_connections WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Connection not found.' });
    }
    return res.status(200).json({ success: true, message: 'Connection deleted.' });
  } catch (err) {
    console.error('[externalDb] delete error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete connection.' });
  }
}

/**
 * GET /api/external-db/:id/tables
 * FR (data source map): lists ONLY the tables/collections that exist inside this one
 * external database — never anything from this app's own doc_automation database.
 */
async function listExternalTables(req, res) {
  try {
    const config = await loadConnectionConfig(req.params.id);
    if (!config) return res.status(404).json({ success: false, message: 'Connection not found.' });
    const tables = await listTables(config);
    return res.status(200).json({ success: true, message: 'Tables fetched.', data: tables });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message || 'Failed to fetch tables.' });
  }
}

/** GET /api/external-db/:id/tables/:table/fields */
async function listExternalTableFields(req, res) {
  try {
    const config = await loadConnectionConfig(req.params.id);
    if (!config) return res.status(404).json({ success: false, message: 'Connection not found.' });
    const fields = await listFields(config, req.params.table);
    return res.status(200).json({
      success: true,
      message: 'Fields fetched.',
      data: fields.map((f) => ({ field_path: `${req.params.table}.${f.field_name}`, ...f })),
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message || 'Failed to fetch fields.' });
  }
}

/**
 * GET /api/external-db/:id/tables/:table/records
 * External-connection counterpart of GET /api/data-sources/:table/records
 * (listRecordsForTable in dataSourceController.js) — same response shape, so the
 * same "mapped data" browse view / bulk multi-select picker works whether a
 * template's data source is internal or an external connection.
 */
async function listExternalRecords(req, res) {
  try {
    const config = await loadConnectionConfig(req.params.id);
    if (!config) return res.status(404).json({ success: false, message: 'Connection not found.' });

    const records = await fetchRecords(config, req.params.table, { limit: 500 });
    const columns = records.length > 0 ? Object.keys(records[0]).filter((c) => c !== 'id') : [];
    const labelColumn = ['full_name', 'name', 'title'].find((c) => columns.includes(c));

    return res.status(200).json({
      success: true,
      message: 'Records fetched.',
      columns,
      idColumn: 'id',
      data: records.map((r) => ({
        recordId: r.id,
        label: labelColumn && r[labelColumn] ? `${r.id} — ${r[labelColumn]}` : `Record ${r.id}`,
        values: r,
      })),
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message || 'Failed to fetch records.' });
  }
}

module.exports = {
  testExternalConnection,
  createExternalConnection,
  listExternalConnections,
  deleteExternalConnection,
  listExternalTables,
  listExternalTableFields,
  listExternalRecords,
  loadConnectionConfig,
};
