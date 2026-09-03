require('dotenv').config();

const SUPPORTED_TYPES = new Set(['mongodb', 'postgresql', 'mysql', 'sqlite']);

/**
 * Safety guard (per FR: "must not conflict with the doc_automation database").
 * An admin could — accidentally or not — point a new "external" connection at this
 * same app's own MySQL instance/database. If that were allowed, the data-source
 * browser below would start listing (and later, generation would read from) this
 * system's own internal tables — users, templates, audit_logs, password hashes,
 * etc. — as if they were an ordinary external business table. So this is checked
 * BEFORE any external connection is ever opened, for every db type:
 *   - postgresql/mongodb/mysql: reject if host+port+database name all match this app's
 *     own DB_HOST/DB_PORT/DB_NAME. (Different engines on the same host/port is still
 *     fine and common — only an exact host+port+name match is blocked. This matters
 *     most for mysql, since the app's OWN internal database also runs on MySQL/XAMPP —
 *     e.g. localhost:3306 — so it's easy for an admin to accidentally point an
 *     "external" MySQL connection right back at doc_automation itself.)
 *   - sqlite: reject if the file path resolves to something inside this backend's own
 *     project directory, so a connection can never be pointed at this app's source
 *     tree or storage folder.
 */
function assertNoConflictWithInternalDb(config) {
  const internalHost = (process.env.DB_HOST || 'localhost').toLowerCase();
  const internalPort = String(process.env.DB_PORT || 3306);
  const internalName = (process.env.DB_NAME || 'doc_automation').toLowerCase();

  if (config.dbType === 'postgresql' || config.dbType === 'mongodb' || config.dbType === 'mysql') {
    const host = String(config.host || '').toLowerCase();
    const port = String(config.port || '');
    const database = String(config.database || '').toLowerCase();
    if (host === internalHost && port === internalPort && database === internalName) {
      throw new Error(
        "This connection points at the same host, port, and database name as this system's own database. "
        + 'Choose a different external database to avoid any conflict with doc_automation.'
      );
    }
  }

  if (config.dbType === 'sqlite') {
    const path = require('path');
    const backendRoot = path.resolve(__dirname, '..', '..'); // .../backend
    const resolved = path.resolve(config.filePath || '');
    if (resolved.startsWith(backendRoot)) {
      throw new Error('The SQLite file path cannot be inside this application\'s own backend directory.');
    }
  }
}

/** Builds a normalized config object from the raw request body, shared by test/save/list. */
function normalizeConfig(body) {
  const dbType = String(body.db_type || body.dbType || '').toLowerCase();
  if (!SUPPORTED_TYPES.has(dbType)) {
    throw new Error(`Unsupported database type. Must be one of: ${[...SUPPORTED_TYPES].join(', ')}.`);
  }
  return {
    dbType,
    host: body.host || null,
    port: body.port ? Number(body.port) : null,
    username: body.username || body.user || null,
    password: body.password || '',
    database: body.database || body.database_name || null,
    filePath: body.file_path || body.filePath || null,
    ssl: Boolean(body.ssl),
  };
}

/** Opens a short-lived connection, verifies it responds, then always closes it. Read-only intent throughout. */
async function testConnection(config) {
  assertNoConflictWithInternalDb(config);

  if (config.dbType === 'mongodb') return testMongo(config);
  if (config.dbType === 'postgresql') return testPostgres(config);
  if (config.dbType === 'mysql') return testMysql(config);
  return testSqlite(config);
}

async function testMongo(config) {
  if (!config.host || !config.database) throw new Error('Host and database name are required for MongoDB.');
  const { MongoClient } = require('mongodb');
  const uri = buildMongoUri(config);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
  try {
    await client.connect();
    await client.db(config.database).command({ ping: 1 });
  } finally {
    await client.close();
  }
}

async function testPostgres(config) {
  if (!config.host || !config.database || !config.username) {
    throw new Error('Host, database, and username are required for PostgreSQL.');
  }
  const { Client } = require('pg');
  const client = new Client({
    host: config.host,
    port: config.port || 5432,
    user: config.username,
    password: config.password || '',
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end();
  }
}

// MySQL (e.g. a local XAMPP install) — same shape/timeouts as the Postgres test above.
async function testMysql(config) {
  if (!config.host || !config.database || !config.username) {
    throw new Error('Host, database, and username are required for MySQL.');
  }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: config.host,
    port: config.port || 3306,
    user: config.username,
    password: config.password || '',
    database: config.database,
    ssl: config.ssl ? {} : undefined,
    connectTimeout: 5000,
  });
  try {
    await conn.query('SELECT 1');
  } finally {
    await conn.end();
  }
}

async function testSqlite(config) {
  if (!config.filePath) throw new Error('A file path is required for SQLite.');
  const fs = require('fs');
  if (!fs.existsSync(config.filePath)) {
    throw new Error(`SQLite file not found at "${config.filePath}".`);
  }
  const Database = require('better-sqlite3');
  // fileMustExist + readonly: this feature only ever reads external data — it must
  // never be able to create/modify a database file on disk.
  const db = new Database(config.filePath, { readonly: true, fileMustExist: true });
  try {
    db.prepare('SELECT 1').get();
  } finally {
    db.close();
  }
}

function buildMongoUri(config) {
  const auth = config.username
    ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password || '')}@`
    : '';
  const port = config.port ? `:${config.port}` : '';
  return `mongodb://${auth}${config.host}${port}/${encodeURIComponent(config.database)}`;
}

/** Lists tables (Postgres/SQLite) or collections (MongoDB) that live in the external database ONLY. */
async function listTables(config) {
  assertNoConflictWithInternalDb(config);
  if (config.dbType === 'mongodb') return listMongoCollections(config);
  if (config.dbType === 'postgresql') return listPostgresTables(config);
  if (config.dbType === 'mysql') return listMysqlTables(config);
  return listSqliteTables(config);
}

async function listMongoCollections(config) {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(buildMongoUri(config), { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const collections = await client.db(config.database).listCollections({}, { nameOnly: true }).toArray();
    return collections.map((c) => c.name).filter((name) => !name.startsWith('system.')).sort();
  } finally {
    await client.close();
  }
}

async function listPostgresTables(config) {
  const { Client } = require('pg');
  const client = new Client({
    host: config.host, port: config.port || 5432, user: config.username,
    password: config.password || '', database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
    );
    return rows.map((r) => r.table_name);
  } finally {
    await client.end();
  }
}

async function listMysqlTables(config) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: config.host, port: config.port || 3306, user: config.username,
    password: config.password || '', database: config.database,
    ssl: config.ssl ? {} : undefined, connectTimeout: 5000,
  });
  try {
    const [rows] = await conn.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name`,
      [config.database]
    );
    return rows.map((r) => r.table_name || r.TABLE_NAME);
  } finally {
    await conn.end();
  }
}

async function listSqliteTables(config) {
  const Database = require('better-sqlite3');
  const db = new Database(config.filePath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all();
    return rows.map((r) => r.name);
  } finally {
    db.close();
  }
}

/** Lists field/column names + a best-effort type for one table/collection in the external database. */
async function listFields(config, table) {
  assertNoConflictWithInternalDb(config);
  if (config.dbType === 'mongodb') return listMongoFields(config, table);
  if (config.dbType === 'postgresql') return listPostgresFields(config, table);
  if (config.dbType === 'mysql') return listMysqlFields(config, table);
  return listSqliteFields(config, table);
}

// MongoDB is schemaless, so "fields" are inferred by sampling a handful of documents
// and unioning their top-level keys — the same approach the mongo shell / Compass use.
async function listMongoFields(config, table) {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(buildMongoUri(config), { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const docs = await client.db(config.database).collection(table).find({}).limit(20).toArray();
    const fieldNames = new Set();
    docs.forEach((doc) => Object.keys(doc).forEach((k) => { if (k !== '_id') fieldNames.add(k); }));
    return [...fieldNames].sort().map((name) => ({ field_name: name, data_type: 'mixed' }));
  } finally {
    await client.close();
  }
}

async function listPostgresFields(config, table) {
  const { Client } = require('pg');
  const client = new Client({
    host: config.host, port: config.port || 5432, user: config.username,
    password: config.password || '', database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [table]
    );
    return rows.map((r) => ({ field_name: r.column_name, data_type: r.data_type }));
  } finally {
    await client.end();
  }
}

async function listMysqlFields(config, table) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: config.host, port: config.port || 3306, user: config.username,
    password: config.password || '', database: config.database,
    ssl: config.ssl ? {} : undefined, connectTimeout: 5000,
  });
  try {
    const [rows] = await conn.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
      [config.database, table]
    );
    return rows.map((r) => ({
      field_name: r.column_name || r.COLUMN_NAME,
      data_type: r.data_type || r.DATA_TYPE,
    }));
  } finally {
    await conn.end();
  }
}

async function listSqliteFields(config, table) {
  const Database = require('better-sqlite3');
  const db = new Database(config.filePath, { readonly: true, fileMustExist: true });
  try {
    // table_info is a pragma, not user input concatenation of a WHERE value — but the
    // table name itself must still be validated against sqlite_master first (guards
    // against a crafted table param that isn't really a table in this file).
    const known = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!known) throw new Error(`Table "${table}" not found.`);
    const rows = db.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(table)})`).all();
    return rows.map((r) => ({ field_name: r.name, data_type: r.type || 'text' }));
  } finally {
    db.close();
  }
}

// PRAGMA doesn't support parameter binding for the table name, so this only ever runs
// after the exact name has already been verified against sqlite_master (see caller).
function quoteSqliteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Fetches one row/document from a table/collection that lives on a SAVED EXTERNAL
 * connection (as opposed to fetchRecordById in dataSourceController.js, which only
 * ever reads this app's own internal doc_automation database). This is what makes
 * Preview/Generate actually work for a template whose "Source Database" is an
 * external MongoDB/PostgreSQL/MySQL/SQLite connection instead of "This System".
 *
 * Same [singular]_id business-key convention as the internal lookup (e.g. "students"
 * -> "student_id"), falling back to "id" (SQL) / "_id" (Mongo) when that column/field
 * doesn't exist on the table.
 */
async function fetchRecordById(config, table, recordId) {
  assertNoConflictWithInternalDb(config);
  if (config.dbType === 'mongodb') return fetchMongoRecordById(config, table, recordId);
  if (config.dbType === 'postgresql') return fetchPostgresRecordById(config, table, recordId);
  if (config.dbType === 'mysql') return fetchExternalMysqlRecordById(config, table, recordId);
  return fetchSqliteRecordById(config, table, recordId);
}

/**
 * Fetches up to `limit` rows/documents from a table/collection on a saved external
 * connection — the external-DB counterpart of listRecordsForTable in
 * dataSourceController.js (powers the same "mapped data" browse/reference view, and
 * the bulk multi-select picker, for templates whose data source is external).
 */
async function fetchRecords(config, table, { limit = 500 } = {}) {
  assertNoConflictWithInternalDb(config);
  if (config.dbType === 'mongodb') return fetchMongoRecords(config, table, limit);
  if (config.dbType === 'postgresql') return fetchPostgresRecords(config, table, limit);
  if (config.dbType === 'mysql') return fetchExternalMysqlRecords(config, table, limit);
  return fetchSqliteRecords(config, table, limit);
}

async function fetchMongoRecordById(config, table, recordId) {
  const { MongoClient, ObjectId } = require('mongodb');
  const client = new MongoClient(buildMongoUri(config), { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const collection = client.db(config.database).collection(table);
    const businessKey = `${table.replace(/s$/, '')}_id`;

    // Prefer a business-key field (e.g. "student_id") if any document has one; only
    // fall back to Mongo's own "_id" (as an ObjectId, when it looks like one) so
    // record IDs typed by a Generator (e.g. "STU001") behave the same way they do
    // against the internal MySQL tables.
    const sample = await collection.findOne({ [businessKey]: { $exists: true } });
    let doc;
    if (sample) {
      doc = await collection.findOne({ [businessKey]: recordId });
    } else if (ObjectId.isValid(recordId) && String(new ObjectId(recordId)) === String(recordId)) {
      doc = await collection.findOne({ _id: new ObjectId(recordId) });
    } else {
      doc = await collection.findOne({ _id: recordId });
    }
    return doc || null;
  } finally {
    await client.close();
  }
}

async function fetchMongoRecords(config, table, limit) {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(buildMongoUri(config), { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const docs = await client.db(config.database).collection(table).find({}).limit(limit).toArray();
    const businessKey = `${table.replace(/s$/, '')}_id`;
    return docs.map((d) => ({ ...d, id: d[businessKey] ?? String(d._id) }));
  } finally {
    await client.close();
  }
}

/** Looks up columnNames + the business-key column, shared by the Postgres record helpers below. */
async function resolvePostgresLookupColumn(client, table) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  const columnNames = rows.map((r) => r.column_name);
  if (columnNames.length === 0) throw new Error(`Table "${table}" not found.`);
  const businessKeyColumn = `${table.replace(/s$/, '')}_id`;
  return columnNames.includes(businessKeyColumn) ? businessKeyColumn : 'id';
}

async function fetchPostgresRecordById(config, table, recordId) {
  const { Client } = require('pg');
  const client = new Client({
    host: config.host, port: config.port || 5432, user: config.username,
    password: config.password || '', database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const lookupColumn = await resolvePostgresLookupColumn(client, table);
    const { rows } = await client.query(
      `SELECT * FROM "${table}" WHERE "${lookupColumn}" = $1 LIMIT 1`,
      [recordId]
    );
    return rows[0] || null;
  } finally {
    await client.end();
  }
}

async function fetchPostgresRecords(config, table, limit) {
  const { Client } = require('pg');
  const client = new Client({
    host: config.host, port: config.port || 5432, user: config.username,
    password: config.password || '', database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const lookupColumn = await resolvePostgresLookupColumn(client, table);
    const { rows } = await client.query(`SELECT * FROM "${table}" LIMIT $1`, [limit]);
    return rows.map((r) => ({ ...r, id: r[lookupColumn] }));
  } finally {
    await client.end();
  }
}

async function resolveMysqlLookupColumn(conn, config, table) {
  const [columns] = await conn.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`,
    [config.database, table]
  );
  const columnNames = columns.map((c) => c.column_name || c.COLUMN_NAME);
  if (columnNames.length === 0) throw new Error(`Table "${table}" not found.`);
  const businessKeyColumn = `${table.replace(/s$/, '')}_id`;
  return columnNames.includes(businessKeyColumn) ? businessKeyColumn : 'id';
}

async function fetchExternalMysqlRecordById(config, table, recordId) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: config.host, port: config.port || 3306, user: config.username,
    password: config.password || '', database: config.database,
    ssl: config.ssl ? {} : undefined, connectTimeout: 5000,
  });
  try {
    const lookupColumn = await resolveMysqlLookupColumn(conn, config, table);
    const [rows] = await conn.query(
      `SELECT * FROM \`${table}\` WHERE \`${lookupColumn}\` = ? LIMIT 1`,
      [recordId]
    );
    return rows[0] || null;
  } finally {
    await conn.end();
  }
}

async function fetchExternalMysqlRecords(config, table, limit) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: config.host, port: config.port || 3306, user: config.username,
    password: config.password || '', database: config.database,
    ssl: config.ssl ? {} : undefined, connectTimeout: 5000,
  });
  try {
    const lookupColumn = await resolveMysqlLookupColumn(conn, config, table);
    const [rows] = await conn.query(`SELECT * FROM \`${table}\` LIMIT ?`, [limit]);
    return rows.map((r) => ({ ...r, id: r[lookupColumn] }));
  } finally {
    await conn.end();
  }
}

function resolveSqliteLookupColumn(db, table) {
  const known = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!known) throw new Error(`Table "${table}" not found.`);
  const columns = db.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(table)})`).all().map((c) => c.name);
  const businessKeyColumn = `${table.replace(/s$/, '')}_id`;
  return columns.includes(businessKeyColumn) ? businessKeyColumn : 'id';
}

async function fetchSqliteRecordById(config, table, recordId) {
  const Database = require('better-sqlite3');
  const db = new Database(config.filePath, { readonly: true, fileMustExist: true });
  try {
    const lookupColumn = resolveSqliteLookupColumn(db, table);
    const row = db.prepare(
      `SELECT * FROM ${quoteSqliteIdentifier(table)} WHERE ${quoteSqliteIdentifier(lookupColumn)} = ? LIMIT 1`
    ).get(recordId);
    return row || null;
  } finally {
    db.close();
  }
}

async function fetchSqliteRecords(config, table, limit) {
  const Database = require('better-sqlite3');
  const db = new Database(config.filePath, { readonly: true, fileMustExist: true });
  try {
    const lookupColumn = resolveSqliteLookupColumn(db, table);
    const rows = db.prepare(`SELECT * FROM ${quoteSqliteIdentifier(table)} LIMIT ?`).all(limit);
    return rows.map((r) => ({ ...r, id: r[lookupColumn] }));
  } finally {
    db.close();
  }
}

/** Finds a field on `table` whose name looks like an email field (e.g. "email", "contact_email"). */
async function findEmailField(config, table) {
  const fields = await listFields(config, table);
  const match = fields.find((f) => /email/i.test(f.field_name));
  return match ? match.field_name : null;
}

/**
 * Checks whether a row/document with a matching (case-insensitive) email value exists
 * on a table/collection that lives on a SAVED EXTERNAL connection — the external-DB
 * counterpart of the internal email lookup in recipientValidation.js. This is what
 * makes recipient validation check the SAME database/table a document was actually
 * generated from (e.g. a "students" table on an external "students_db" MySQL
 * connection) instead of always falling back to this app's own internal database.
 *
 * Returns { emailColumn: string|null, found: boolean }. `emailColumn` is null when the
 * table has no email-like field at all, distinct from `found: false` (field exists,
 * no matching row) so callers can give an accurate error message either way.
 */
async function findRecordByEmail(config, table, email) {
  assertNoConflictWithInternalDb(config);
  const emailColumn = await findEmailField(config, table);
  if (!emailColumn) {
    return { emailColumn: null, found: false };
  }

  let match;
  if (config.dbType === 'mongodb') match = await findMongoRecordByEmail(config, table, emailColumn, email);
  else if (config.dbType === 'postgresql') match = await findPostgresRecordByEmail(config, table, emailColumn, email);
  else if (config.dbType === 'mysql') match = await findMysqlRecordByEmail(config, table, emailColumn, email);
  else match = await findSqliteRecordByEmail(config, table, emailColumn, email);

  return { emailColumn, found: Boolean(match) };
}

async function findMongoRecordByEmail(config, table, emailColumn, email) {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(buildMongoUri(config), { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    // Escape regex metacharacters, then anchor + case-insensitive match so this behaves
    // like the LOWER(...) = ... comparison used against the SQL engines below.
    const escaped = String(email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const doc = await client.db(config.database).collection(table)
      .findOne({ [emailColumn]: { $regex: `^${escaped}$`, $options: 'i' } });
    return doc || null;
  } finally {
    await client.close();
  }
}

async function findPostgresRecordByEmail(config, table, emailColumn, email) {
  const { Client } = require('pg');
  const client = new Client({
    host: config.host, port: config.port || 5432, user: config.username,
    password: config.password || '', database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT 1 FROM "${table}" WHERE LOWER("${emailColumn}") = $1 LIMIT 1`,
      [email]
    );
    return rows[0] || null;
  } finally {
    await client.end();
  }
}

async function findMysqlRecordByEmail(config, table, emailColumn, email) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: config.host, port: config.port || 3306, user: config.username,
    password: config.password || '', database: config.database,
    ssl: config.ssl ? {} : undefined, connectTimeout: 5000,
  });
  try {
    const [rows] = await conn.query(
      `SELECT 1 FROM \`${table}\` WHERE LOWER(\`${emailColumn}\`) = ? LIMIT 1`,
      [email]
    );
    return rows[0] || null;
  } finally {
    await conn.end();
  }
}

async function findSqliteRecordByEmail(config, table, emailColumn, email) {
  const Database = require('better-sqlite3');
  const db = new Database(config.filePath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare(
      `SELECT 1 FROM ${quoteSqliteIdentifier(table)} WHERE LOWER(${quoteSqliteIdentifier(emailColumn)}) = ? LIMIT 1`
    ).get(email);
    return row || null;
  } finally {
    db.close();
  }
}

module.exports = {
  SUPPORTED_TYPES,
  normalizeConfig,
  assertNoConflictWithInternalDb,
  testConnection,
  listTables,
  listFields,
  fetchRecordById,
  fetchRecords,
  findRecordByEmail,
};
