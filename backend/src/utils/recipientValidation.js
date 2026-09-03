const { pool } = require('../config/db');
const { findRecordByEmail } = require('./externalDbClients');
require('dotenv').config();

// Lazily required below (inside validateAgainstExternalTable) to avoid a load-order
// cycle: externalDbController.js -> config/db.js/utils/encryption.js only, so a plain
// top-level require would be safe today, but this file is a low-level util that
// several controllers import, so we keep the controller import deferred on purpose.
let _loadConnectionConfig = null;
function loadConnectionConfig(id) {
  if (!_loadConnectionConfig) {
    _loadConnectionConfig = require('../controllers/externalDbController').loadConnectionConfig;
  }
  return _loadConnectionConfig(id);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  system_admin: 'System Admin',
  generator: 'Generator',
  approver: 'Approver',
  recipient: 'Recipient',
};

/** Finds a column on `table` whose name looks like an email field (e.g. "email", "contact_email"). */
async function findEmailColumn(table) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [process.env.DB_NAME || 'doc_automation', table]
  );
  const match = cols.find((c) => /email/i.test(c.COLUMN_NAME));
  return match ? match.COLUMN_NAME : null;
}

/** Confirms `table` is a real base table before it's ever interpolated into SQL. */
async function isRealTable(table) {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [process.env.DB_NAME || 'doc_automation', table]
  );
  return rows.length > 0;
}

/** Validates against this app's own internal doc_automation database/table. */
async function validateAgainstInternalTable(normalized, dataSourceTable) {
  if (!(await isRealTable(dataSourceTable))) {
    return { ok: false, message: 'This document\'s data source table could not be found.' };
  }

  const emailColumn = await findEmailColumn(dataSourceTable);
  if (!emailColumn) {
    return { ok: false, message: `The "${dataSourceTable}" data source has no email field to validate against.` };
  }

  const [[match]] = await pool.query(
    `SELECT 1 FROM \`${dataSourceTable}\` WHERE LOWER(\`${emailColumn}\`) = ? LIMIT 1`,
    [normalized]
  );
  if (!match) {
    return { ok: false, message: `This email is not registered in "${dataSourceTable}". Enter a valid recipient email.` };
  }

  return { ok: true };
}

/**
 * Validates against the SAVED EXTERNAL connection (MySQL/PostgreSQL/MongoDB/SQLite)
 * that the template is actually mapped to — e.g. a "students" table living on a
 * separate "students_db" MySQL connection, not this app's own internal database.
 */
async function validateAgainstExternalTable(normalized, dataSourceTable, dataSourceConnectionId) {
  const config = await loadConnectionConfig(dataSourceConnectionId);
  if (!config) {
    return { ok: false, message: 'The external database connection this document is mapped to no longer exists.' };
  }

  let result;
  try {
    result = await findRecordByEmail(config, dataSourceTable, normalized);
  } catch (err) {
    return { ok: false, message: `Could not validate the recipient against "${dataSourceTable}": ${err.message}` };
  }

  if (!result.emailColumn) {
    return { ok: false, message: `The "${dataSourceTable}" data source has no email field to validate against.` };
  }
  if (!result.found) {
    return { ok: false, message: `This email is not registered in "${dataSourceTable}". Enter a valid recipient email.` };
  }

  return { ok: true };
}

/**
 * Validates that `email` is a legitimate recipient for a document generated against
 * `dataSourceTable` (e.g. "employees" or "students") — i.e. the exact database AND
 * table the document was actually generated from, not any arbitrary address and never
 * a staff/system account.
 *
 * Returns { ok: true, recipientName? } or { ok: false, message }.
 */
async function validateRecipientEmail(email, dataSourceTable, dataSourceConnectionId = null) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !EMAIL_REGEX.test(normalized)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }

  const [[staffUser]] = await pool.query('SELECT role FROM users WHERE LOWER(email) = ?', [normalized]);
  if (staffUser) {
    const roleLabel = ROLE_LABELS[staffUser.role] || staffUser.role;
    return {
      ok: false,
      message: `You entered a ${roleLabel} account email. This document can only be sent to the recipient's own email address, not a system user account.`,
    };
  }

  if (!dataSourceTable) {
    return { ok: false, message: 'This document has no linked data source, so the recipient email cannot be validated.' };
  }

  if (dataSourceConnectionId) {
    return validateAgainstExternalTable(normalized, dataSourceTable, dataSourceConnectionId);
  }
  return validateAgainstInternalTable(normalized, dataSourceTable);
}

/**
 * Cross-checks that the entered email BELONGS to the specific record that was used
 * to generate the document (identified by record_identifier / the business key).
 *
 * This is the "email and ID must match" gate: the Generator enters both the
 * recipient's email AND the document's record ID is already known from the doc
 * itself — we fetch that record and confirm the email column matches what was
 * entered. If they don't match, delivery is blocked with a specific error.
 *
 * Returns { ok: true, recipientName } or { ok: false, message }.
 */
async function validateEmailMatchesRecord(email, recordIdentifier, dataSourceTable, dataSourceConnectionId = null) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !EMAIL_REGEX.test(normalized)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }
  if (!dataSourceTable || !recordIdentifier) {
    return { ok: false, message: 'Cannot validate — document has no data source or record ID on file.' };
  }

  try {
    let record = null;
    let emailColumn = null;
    let nameColumn = null;

    if (dataSourceConnectionId) {
      // External connection
      const config = await loadConnectionConfig(dataSourceConnectionId);
      if (!config) {
        return { ok: false, message: 'The external database connection this document is mapped to no longer exists.' };
      }
      // fetchRecordById is the correct export name in externalDbClients.js
      const { fetchRecordById } = require('./externalDbClients');
      const rawRecord = await fetchRecordById(config, dataSourceTable, recordIdentifier);
      if (!rawRecord) {
        return { ok: false, message: `Record "${recordIdentifier}" not found in "${dataSourceTable}".` };
      }
      // Find email column in record keys
      const keys = Object.keys(rawRecord);
      emailColumn = keys.find((k) => /email/i.test(k)) || null;
      nameColumn = keys.find((k) => /^(full_?name|name|first_?name)$/i.test(k)) || null;
      record = rawRecord;
    } else {
      // Internal table
      if (!(await isRealTable(dataSourceTable))) {
        return { ok: false, message: `Data source table "${dataSourceTable}" not found.` };
      }
      // Discover columns
      const [cols] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [process.env.DB_NAME || 'doc_automation', dataSourceTable]
      );
      const colNames = cols.map((c) => c.COLUMN_NAME);
      emailColumn = colNames.find((c) => /email/i.test(c)) || null;
      nameColumn = colNames.find((c) => /^(full_?name|name|first_?name)$/i.test(c)) || null;

      if (!emailColumn) {
        return { ok: false, message: `The "${dataSourceTable}" data source has no email field to validate against.` };
      }

      // Fetch the specific record by its business key
      const singularKey = `${dataSourceTable.replace(/s$/, '')}_id`; // e.g. employees -> employee_id
      const lookupCol = colNames.includes(singularKey) ? singularKey : 'id';
      const [[row]] = await pool.query(
        `SELECT * FROM \`${dataSourceTable}\` WHERE \`${lookupCol}\` = ? LIMIT 1`,
        [recordIdentifier]
      );
      if (!row) {
        return { ok: false, message: `Record "${recordIdentifier}" not found in "${dataSourceTable}".` };
      }
      record = row;
    }

    if (!emailColumn || !record) {
      return { ok: false, message: 'Could not locate the record or its email field.' };
    }

    const recordEmail = String(record[emailColumn] || '').trim().toLowerCase();
    if (!recordEmail) {
      return { ok: false, message: `Record "${recordIdentifier}" has no email address on file.` };
    }

    if (recordEmail !== normalized) {
      return {
        ok: false,
        message: `The user's email and ID do not match. Please enter the correct email for the assigned user.`,
      };
    }

    const recipientName = nameColumn && record[nameColumn] ? String(record[nameColumn]) : null;
    return { ok: true, recipientName };
  } catch (err) {
    console.error('[recipientValidation] validateEmailMatchesRecord error:', err.message);
    return { ok: false, message: `Validation failed: ${err.message}` };
  }
}

module.exports = { validateRecipientEmail, validateEmailMatchesRecord };
