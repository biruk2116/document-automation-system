const { pool } = require('../config/db');
require('dotenv').config();

// Tables that are part of this system's own machinery — never offer them as a "data source"
const SYSTEM_TABLES = new Set([
  'users', 'templates', 'template_placeholders', 'generated_docs',
  'signature_requests', 'digital_signatures', 'delivery_logs', 'audit_logs',
]);

// This endpoint only ever lists tables from THIS app's own doc_automation database
// (the seeded "employees" table). Tables from a commercial external connection
// (MongoDB/PostgreSQL/SQLite, added on the Database Connections page) are a separate,
// per-connection browse — see GET /api/external-db/:id/tables in externalDbController.js —
// and are never merged into this allow-list, so a template's data source is always
// unambiguously either "this internal table" or "this table on that external connection".
const DATA_SOURCE_ALLOW_LIST_FOR_NOW = new Set(['employees']);

/**
 * GET /api/data-sources
 * FR-009: lists candidate business tables (e.g. employees, students, suppliers)
 * that admins can bind a template to.
 */
async function listDataSources(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT TABLE_NAME AS table_name
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [process.env.DB_NAME || 'doc_automation']
    );

    const dataSources = rows
      .map((r) => r.table_name)
      .filter((name) => !SYSTEM_TABLES.has(name))
      .filter((name) => DATA_SOURCE_ALLOW_LIST_FOR_NOW.has(name));

    return res.status(200).json({
      success: true,
      message: 'Data sources fetched successfully.',
      data: dataSources,
    });
  } catch (err) {
    console.error('[dataSources] list error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch data sources.' });
  }
}

/**
 * GET /api/data-sources/:table/fields
 * FR-003: auto-fetches column names/types for drag-and-drop field mapping.
 */
async function listDataSourceFields(req, res) {
  const { table } = req.params;

  if (SYSTEM_TABLES.has(table)) {
    return res.status(403).json({ success: false, message: 'This table is not a valid data source.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME AS field_name, DATA_TYPE AS data_type
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [process.env.DB_NAME || 'doc_automation', table]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: `Table "${table}" not found.` });
    }

    return res.status(200).json({
      success: true,
      message: 'Fields fetched successfully.',
      data: rows.map((r) => ({
        field_path: `${table}.${r.field_name}`,
        field_name: r.field_name,
        data_type: r.data_type,
      })),
    });
  } catch (err) {
    console.error('[dataSources] fields error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch fields.' });
  }
}

/**
 * GET /api/data-sources/:table/records/:recordId
 * Fetches one row, used to feed the preview/generation engine.
 * NOTE: table name is validated against information_schema first — never interpolate
 * user input directly into SQL identifiers without this check (SQL injection guard).
 *
 * Looks up by a business key column first (e.g. "employee_id" for the "employees" table,
 * matching the [singular]_id convention), falling back to the numeric `id` column.
 * This matters because record IDs used at generation time (e.g. "EMP001") are almost
 * never the internal auto-increment id.
 */
async function fetchRecordById(table, recordId) {
  const [tableCheck] = await pool.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [process.env.DB_NAME || 'doc_automation', table]
  );
  if (tableCheck.length === 0 || SYSTEM_TABLES.has(table)) {
    throw new Error(`Invalid data source table: ${table}`);
  }

  const [columns] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [process.env.DB_NAME || 'doc_automation', table]
  );
  const columnNames = columns.map((c) => c.COLUMN_NAME);
  const businessKeyColumn = `${table.replace(/s$/, '')}_id`; // e.g. "employees" -> "employee_id"
  const lookupColumn = columnNames.includes(businessKeyColumn) ? businessKeyColumn : 'id';

  const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE \`${lookupColumn}\` = ? LIMIT 1`, [recordId]);
  return rows[0] || null;
}

/**
 * GET /api/data-sources/:table/records
 * FR-010: powers the "multi-select" alternative to CSV upload for bulk generation.
 * Also powers the "mapped data table" view (Generator + Approver, per the RBAC matrix
 * on this route) so both roles can see exactly the same admin-mapped source data —
 * e.g. the "employees" table behind an Employee Certificate template — instead of only
 * a bare id/label pair. Returns:
 *   - top-level `columns`: every column name on the table, in DB order (for table headers)
 *   - `data[]`: one entry per row — recordId, a friendly label, and `values` holding
 *     every column's raw value (for rendering the full row).
 */
async function listRecordsForTable(req, res) {
  const { table } = req.params;

  if (SYSTEM_TABLES.has(table)) {
    return res.status(403).json({ success: false, message: 'This table is not a valid data source.' });
  }

  try {
    const [tableCheck] = await pool.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [process.env.DB_NAME || 'doc_automation', table]
    );
    if (tableCheck.length === 0) {
      return res.status(404).json({ success: false, message: `Table "${table}" not found.` });
    }

    const [columns] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [process.env.DB_NAME || 'doc_automation', table]
    );
    const columnNames = columns.map((c) => c.COLUMN_NAME);
    const businessKeyColumn = `${table.replace(/s$/, '')}_id`;
    const idColumn = columnNames.includes(businessKeyColumn) ? businessKeyColumn : 'id';
    const labelColumn = ['full_name', 'name', 'title'].find((c) => columnNames.includes(c));

    // Cap at 500 rows — this is a browse/reference view, not a full export.
    const [rows] = await pool.query(`SELECT * FROM \`${table}\` LIMIT 500`);

    return res.status(200).json({
      success: true,
      message: 'Records fetched.',
      columns: columnNames,
      idColumn,
      data: rows.map((r) => ({
        recordId: r[idColumn],
        label: r[labelColumn] ? `${r[idColumn]} — ${r[labelColumn]}` : `Record ${r[idColumn]}`,
        values: r,
      })),
    });
  } catch (err) {
    console.error('[dataSources] listRecords error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch records.' });
  }
}

module.exports = { listDataSources, listDataSourceFields, listRecordsForTable, fetchRecordById, SYSTEM_TABLES };
