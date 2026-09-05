const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'doc_automation',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
});

// Quick startup check so failures are loud, not silent
async function verifyConnection() {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log('[db] MySQL connection OK');
  } catch (err) {
    console.error('[db] MySQL connection FAILED:', err.message);
    console.error('[db] Check .env DB_* values and that MySQL/XAMPP is running.');
  }
}

/**
 * Self-healing schema check, run once at boot.
 * Existing databases (created before a given feature was added) never pick up new
 * tables/columns on their own — someone has to run the matching migration by hand,
 * and it's easy to forget (see migrations/005_*.sql). This makes the two additions
 * from that migration idempotent and automatic instead, so the app just fixes itself
 * on the next restart rather than crashing every request until someone notices the
 * log and runs SQL manually. Safe to run on every boot: both operations are no-ops
 * once already applied.
 */
async function ensureSchema() {
  const dbName = process.env.DB_NAME || 'doc_automation';

  // 1) notification_reads table (bell "seen" state) — powers the unread badge count.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_reads (
        id                BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id           INT NOT NULL,
        notification_key  VARCHAR(80) NOT NULL,
        read_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_notifread_user FOREIGN KEY (user_id)
          REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uq_notifread_user_key (user_id, notification_key)
      ) ENGINE=InnoDB
    `);
  } catch (err) {
    console.error('[db] Could not ensure notification_reads table exists:', err.message);
  }

  // 2) audit_logs.action enum — grown over time by several migrations (005, 012, and
  //    now the document soft-delete feature). Rebuilt from the full current list every
  //    boot and only actually ALTERed when something's missing, so this one block
  //    covers every value that's ever been added instead of needing a new near-
  //    duplicate block each time another action is introduced.
  const FULL_ACTION_ENUM = [
    'PREVIEW', 'GENERATE', 'SIGN', 'REJECT', 'DELIVER', 'VERIFY', 'DOWNLOAD', 'VIEW',
    'LOGIN', 'LOGOUT', 'CREATE_TEMPLATE', 'UPDATE_TEMPLATE', 'DELETE_TEMPLATE', 'ARCHIVE_TEMPLATE',
    'CREATE_USER', 'UPDATE_USER', 'DELETE_USER', 'PASSWORD_RESET_REQUEST', 'PASSWORD_RESET_COMPLETE',
    'DELETE_DOCUMENT',
    'SECURE_DELIVER', 'OTP_VERIFY', 'OWNERSHIP_CONFIRM', 'OWNERSHIP_REJECT',
    'OWNERSHIP_REJECTED_NOTIFY', 'DELIVERY_OWNED_NOTIFY', 'REVOKE_DOCUMENT',
  ];
  try {
    const [[col]] = await pool.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'action'`,
      [dbName]
    );
    const missing = col ? FULL_ACTION_ENUM.filter((a) => !col.COLUMN_TYPE.includes(`'${a}'`)) : [];
    if (missing.length > 0) {
      await pool.query(`
        ALTER TABLE audit_logs
          MODIFY COLUMN action ENUM(${FULL_ACTION_ENUM.map((a) => `'${a}'`).join(',')}) NOT NULL
      `);
      console.log(`[db] Added ${missing.join(', ')} to audit_logs.action enum.`);
    }
  } catch (err) {
    console.error('[db] Could not ensure audit_logs.action enum is up to date:', err.message);
  }

  // 3) users.reset_token / reset_token_expires (migration 011) — powers the
  //    self-service "Forgot password" flow. Missing on any database created before
  //    this feature shipped, which is exactly what was crashing every
  //    forgot-password request with ER_BAD_FIELD_ERROR.
  try {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME IN ('reset_token', 'reset_token_expires')`,
      [dbName]
    );
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    if (!have.has('reset_token') || !have.has('reset_token_expires')) {
      if (!have.has('reset_token')) {
        await pool.query(`ALTER TABLE users ADD COLUMN reset_token VARCHAR(255) NULL AFTER password_hash`);
      }
      if (!have.has('reset_token_expires')) {
        await pool.query(`ALTER TABLE users ADD COLUMN reset_token_expires DATETIME NULL AFTER reset_token`);
      }
      // Index creation isn't safely idempotent with IF NOT EXISTS on all MySQL/MariaDB
      // versions this project targets, so guard it via information_schema instead.
      const [[idx]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_reset_token'`,
        [dbName]
      );
      if (!idx || idx.cnt === 0) {
        await pool.query(`ALTER TABLE users ADD INDEX idx_users_reset_token (reset_token)`);
      }
      console.log('[db] Added reset_token/reset_token_expires to users.');
    }
  } catch (err) {
    console.error('[db] Could not ensure users.reset_token columns exist:', err.message);
  }

  // 4) generated_docs.deleted_at — soft-delete flag for Document Tracking's Delete
  //    button. Deliberately never removes the row itself (doc_uuid/file_hash/status
  //    all stay put) — Verify Document only ever checks those DB-persisted values, so
  //    a document must remain verifiable by Doc ID/hash even after it's been deleted.
  try {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'generated_docs' AND COLUMN_NAME = 'deleted_at'`,
      [dbName]
    );
    if (cols.length === 0) {
      await pool.query(`ALTER TABLE generated_docs ADD COLUMN deleted_at DATETIME NULL AFTER archived_at`);
      await pool.query(`ALTER TABLE generated_docs ADD INDEX idx_docs_deleted_at (deleted_at)`);
      console.log('[db] Added deleted_at to generated_docs.');
    }
  } catch (err) {
    console.error('[db] Could not ensure generated_docs.deleted_at exists:', err.message);
  }

  // 5) external_db_connections table + templates.data_source_connection_id (migration 014)
  //    — the commercial-tier "connect to an external MySQL/MongoDB/PostgreSQL/SQLite
  //    database" feature. Its own migration file claimed this was already self-healing;
  //    it wasn't, so any database provisioned before this feature shipped would 500 on
  //    every /api/external-db call and on any template save that tried to persist a
  //    connection id. Same idempotent pattern as the blocks above.
  try {
    const [tables] = await pool.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'external_db_connections'`,
      [dbName]
    );
    if (tables.length === 0) {
      await pool.query(`
        CREATE TABLE external_db_connections (
          id              INT AUTO_INCREMENT PRIMARY KEY,
          name            VARCHAR(150) NOT NULL UNIQUE,
          db_type         ENUM('mysql','mongodb','postgresql','sqlite') NOT NULL,
          host            VARCHAR(255) NULL,
          port            INT NULL,
          db_user         VARCHAR(150) NULL,
          db_password_encrypted TEXT NULL,
          database_name   VARCHAR(500) NULL,
          ssl_enabled     TINYINT(1) NOT NULL DEFAULT 0,
          status          ENUM('untested','connected','failed') NOT NULL DEFAULT 'untested',
          last_tested_at  DATETIME NULL,
          created_by      INT NULL,
          created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_extdb_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB
      `);
      console.log('[db] Created external_db_connections table.');
    }

    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'templates' AND COLUMN_NAME = 'data_source_connection_id'`,
      [dbName]
    );
    if (cols.length === 0) {
      await pool.query(`
        ALTER TABLE templates
          ADD COLUMN data_source_connection_id INT NULL AFTER data_source_table,
          ADD CONSTRAINT fk_templates_ext_connection FOREIGN KEY (data_source_connection_id)
            REFERENCES external_db_connections(id) ON DELETE SET NULL
      `);
      console.log('[db] Added data_source_connection_id to templates.');
    } else {
      // The column can exist WITHOUT pointing at the right table — an earlier version
      // of this feature named the table "external_connections" (no "_db_") before it
      // was renamed to "external_db_connections". Databases created back then still
      // carry a foreign key referencing that old, no-longer-created table name. The
      // block above only adds the column+FK when the column is entirely missing, so
      // it silently skips repairing this case, and every template save that sets a
      // real external connection id then fails with ER_NO_REFERENCED_ROW_2 even
      // though the id is perfectly valid in external_db_connections. Detect and
      // repoint (or add, if somehow missing entirely) the FK so it always targets
      // external_db_connections.
      const [[fk]] = await pool.query(
        `SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'templates' AND COLUMN_NAME = 'data_source_connection_id'
           AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [dbName]
      );
      if (fk && fk.REFERENCED_TABLE_NAME !== 'external_db_connections') {
        await pool.query(`ALTER TABLE templates DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
        await pool.query(`
          ALTER TABLE templates
            ADD CONSTRAINT fk_templates_ext_connection FOREIGN KEY (data_source_connection_id)
              REFERENCES external_db_connections(id) ON DELETE SET NULL
        `);
        console.log(`[db] Repointed templates.data_source_connection_id FK from "${fk.REFERENCED_TABLE_NAME}" to external_db_connections.`);
      } else if (!fk) {
        await pool.query(`
          ALTER TABLE templates
            ADD CONSTRAINT fk_templates_ext_connection FOREIGN KEY (data_source_connection_id)
              REFERENCES external_db_connections(id) ON DELETE SET NULL
        `);
        console.log('[db] Added missing FK on templates.data_source_connection_id.');
      }
    }

    // 'mysql' (XAMPP) was added as a supported external db_type after this table
    // first shipped, so any database created before that still has the narrower
    // ENUM('mongodb','postgresql','sqlite') and will reject a MySQL connection with
    // a truncation error at the DB layer even though the app layer allows it. Same
    // idempotent rebuild-and-only-ALTER-if-missing pattern as audit_logs.action above.
    const FULL_DB_TYPE_ENUM = ['mysql', 'mongodb', 'postgresql', 'sqlite'];
    const [[dbTypeCol]] = await pool.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'external_db_connections' AND COLUMN_NAME = 'db_type'`,
      [dbName]
    );
    const missingDbTypes = dbTypeCol ? FULL_DB_TYPE_ENUM.filter((t) => !dbTypeCol.COLUMN_TYPE.includes(`'${t}'`)) : [];
    if (missingDbTypes.length > 0) {
      await pool.query(`
        ALTER TABLE external_db_connections
          MODIFY COLUMN db_type ENUM(${FULL_DB_TYPE_ENUM.map((t) => `'${t}'`).join(',')}) NOT NULL
      `);
      console.log(`[db] Added ${missingDbTypes.join(', ')} to external_db_connections.db_type enum.`);
    }
  } catch (err) {
    console.error('[db] Could not ensure external_db_connections / templates.data_source_connection_id exist:', err.message);
  }

  // 6) users.avatar_url — powers the sidebar user-menu profile photo (self-service
  //    upload via POST /api/users/me/avatar). Missing on any database created before
  //    this feature shipped, so this makes it self-healing on boot exactly like the
  //    blocks above instead of requiring a manual ALTER.
  try {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'avatar_url'`,
      [dbName]
    );
    if (cols.length === 0) {
      await pool.query(`ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) NULL AFTER phone`);
      console.log('[db] Added avatar_url to users.');
    }

    // One-time data fix: strip any absolute-URL prefix from existing avatar_url values.
    // Old code stored "http://localhost:5000/uploads/avatars/<filename>" which breaks
    // in every deployed environment. Convert to the relative path "/uploads/avatars/<filename>".
    await pool.query(`
      UPDATE users
         SET avatar_url = CONCAT('/uploads/avatars/', SUBSTRING_INDEX(avatar_url, '/uploads/avatars/', -1))
       WHERE avatar_url IS NOT NULL
         AND avatar_url LIKE '%/uploads/avatars/%'
         AND avatar_url NOT LIKE '/uploads/avatars/%'
    `);
    // Same fix for any logos embedded in templates (header_html/body_html/footer_html).
    // These contain inline img src attributes with absolute URLs from the old code.
    // Replace http(s)://any-host/uploads/logos/ with /uploads/logos/ inside the HTML.
    await pool.query(`
      UPDATE templates
         SET header_html = REGEXP_REPLACE(header_html, 'https?://[^/]+/uploads/logos/', '/uploads/logos/'),
             body_html   = REGEXP_REPLACE(body_html,   'https?://[^/]+/uploads/logos/', '/uploads/logos/'),
             footer_html = REGEXP_REPLACE(footer_html, 'https?://[^/]+/uploads/logos/', '/uploads/logos/')
       WHERE header_html LIKE '%/uploads/logos/%'
          OR body_html   LIKE '%/uploads/logos/%'
          OR footer_html LIKE '%/uploads/logos/%'
    `);
  } catch (err) {
    console.error('[db] Could not ensure users.avatar_url exists:', err.message);
  }

  // 7) Secure Document Delivery & Ownership Verification module (migration 016):
  //    generated_docs.recipient_id/verification_id/revoked_* + the whole
  //    document_deliveries table + the new audit_logs.action values it uses.
  //    Same idempotent, column-by-column / CREATE-IF-MISSING pattern as every
  //    block above — missing on any database created before this feature shipped.
  try {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'generated_docs'
         AND COLUMN_NAME IN ('recipient_id','verification_id','revoked_at','revoked_by','revocation_reason')`,
      [dbName]
    );
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    if (!have.has('recipient_id')) {
      await pool.query(`ALTER TABLE generated_docs ADD COLUMN recipient_id INT NULL AFTER generated_by`);
      await pool.query(`
        ALTER TABLE generated_docs
          ADD CONSTRAINT fk_docs_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL
      `);
      await pool.query(`ALTER TABLE generated_docs ADD INDEX idx_docs_recipient (recipient_id)`);
      console.log('[db] Added recipient_id to generated_docs.');
    }
    if (!have.has('verification_id')) {
      await pool.query(`ALTER TABLE generated_docs ADD COLUMN verification_id VARCHAR(40) NULL AFTER doc_uuid`);
      await pool.query(`ALTER TABLE generated_docs ADD UNIQUE KEY uq_docs_verification_id (verification_id)`);
      console.log('[db] Added verification_id to generated_docs.');
    }
    if (!have.has('revoked_at')) {
      await pool.query(`
        ALTER TABLE generated_docs
          ADD COLUMN revoked_at DATETIME NULL AFTER deleted_at,
          ADD COLUMN revoked_by INT NULL AFTER revoked_at,
          ADD COLUMN revocation_reason VARCHAR(255) NULL AFTER revoked_by
      `);
      await pool.query(`
        ALTER TABLE generated_docs
          ADD CONSTRAINT fk_docs_revoked_by FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL
      `);
      console.log('[db] Added revoked_at/revoked_by/revocation_reason to generated_docs.');
    }

    const [tables] = await pool.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'document_deliveries'`,
      [dbName]
    );
    if (tables.length === 0) {
      await pool.query(`
        CREATE TABLE document_deliveries (
          id                      INT AUTO_INCREMENT PRIMARY KEY,
          doc_id                  INT NOT NULL,
          recipient_id            INT NOT NULL,
          delivery_method         ENUM('secure_link_otp') NOT NULL DEFAULT 'secure_link_otp',
          secure_token_hash       CHAR(64) NOT NULL,
          token_expiry            DATETIME NOT NULL,
          token_used_at           DATETIME NULL,
          otp_code                VARCHAR(255) NOT NULL,
          otp_expiry               DATETIME NOT NULL,
          otp_attempts            TINYINT NOT NULL DEFAULT 0,
          otp_locked_until        DATETIME NULL,
          sent_at                 DATETIME NULL,
          opened_at               DATETIME NULL,
          access_ip                VARCHAR(64) NULL,
          access_user_agent       VARCHAR(500) NULL,
          otp_verified_at         DATETIME NULL,
          ownership_status        ENUM('PENDING','CONFIRMED','REJECTED') NOT NULL DEFAULT 'PENDING',
          -- Reporting-friendly mirror of ownership_status: NULL while PENDING,
          -- 1 once CONFIRMED, 0 once REJECTED. ownership_status stays the single
          -- source of truth (and the tri-state one every trust decision is made
          -- from — see requirement 9); this column exists ONLY so "how many
          -- deliveries were owned vs not" can be answered with a plain
          -- COUNT(...)/SUM(owned) instead of an ENUM comparison in every report
          -- query. Always written in the same transaction as ownership_status,
          -- never read for any authorization decision.
          owned                   TINYINT(1) NULL DEFAULT NULL,
          ownership_confirmed_at  DATETIME NULL,
          ownership_rejected_at   DATETIME NULL,
          rejection_reason        TEXT NULL,
          downloaded_at           DATETIME NULL,
          download_ip              VARCHAR(64) NULL,
          download_user_agent     VARCHAR(500) NULL,
          email_status              ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
          plain_copy_email_status   ENUM('not_sent','queued','sent','failed') NOT NULL DEFAULT 'not_sent',
          created_by                INT NOT NULL,
          created_at                 TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_docdeliv_doc FOREIGN KEY (doc_id) REFERENCES generated_docs(id) ON DELETE CASCADE,
          CONSTRAINT fk_docdeliv_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE RESTRICT,
          CONSTRAINT fk_docdeliv_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
          UNIQUE KEY uq_docdeliv_token_hash (secure_token_hash),
          INDEX idx_docdeliv_doc (doc_id),
          INDEX idx_docdeliv_recipient (recipient_id),
          INDEX idx_docdeliv_ownership (ownership_status),
          INDEX idx_docdeliv_owned (owned)
        ) ENGINE=InnoDB
      `);
      console.log('[db] Created document_deliveries table.');
    }

    // 8) document_deliveries.owned — reporting column (migration 017), added on top
    //    of an already-existing document_deliveries table from an older boot.
    const [ownedCols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'document_deliveries' AND COLUMN_NAME = 'owned'`,
      [dbName]
    );
    if (ownedCols.length === 0) {
      await pool.query(`ALTER TABLE document_deliveries ADD COLUMN owned TINYINT(1) NULL DEFAULT NULL AFTER ownership_status`);
      await pool.query(`ALTER TABLE document_deliveries ADD INDEX idx_docdeliv_owned (owned)`);
      // Backfill existing rows from ownership_status so the report is correct
      // immediately for deliveries decided before this column existed.
      await pool.query(`UPDATE document_deliveries SET owned = 1 WHERE ownership_status = 'CONFIRMED'`);
      await pool.query(`UPDATE document_deliveries SET owned = 0 WHERE ownership_status = 'REJECTED'`);
      console.log('[db] Added owned to document_deliveries (backfilled from ownership_status).');
    }
  } catch (err) {
    console.error('[db] Could not ensure secure delivery module tables/columns exist:', err.message);
  }

  // 9) Secure Document Delivery — recipient identified by email from the template's
  //    mapped data source table (migration 018), not a pre-registered `users` row.
  //    recipient_id on both tables is widened to nullable (legacy rows only); new
  //    rows are written with recipient_email/recipient_name instead.
  try {
    const [docsCols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'generated_docs' AND COLUMN_NAME IN ('recipient_email','recipient_name')`,
      [dbName]
    );
    const haveDocsCols = new Set(docsCols.map((c) => c.COLUMN_NAME));
    if (!haveDocsCols.has('recipient_email')) {
      await pool.query(`ALTER TABLE generated_docs ADD COLUMN recipient_email VARCHAR(255) NULL AFTER recipient_id`);
      await pool.query(`ALTER TABLE generated_docs ADD COLUMN recipient_name VARCHAR(255) NULL AFTER recipient_email`);
      await pool.query(`ALTER TABLE generated_docs MODIFY COLUMN recipient_id INT NULL`);
      await pool.query(`ALTER TABLE generated_docs ADD INDEX idx_docs_recipient_email (recipient_email)`);
      console.log('[db] Added recipient_email/recipient_name to generated_docs.');
    }

    const [delivCols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'document_deliveries' AND COLUMN_NAME IN ('recipient_email','recipient_name')`,
      [dbName]
    );
    const haveDelivCols = new Set(delivCols.map((c) => c.COLUMN_NAME));
    if (!haveDelivCols.has('recipient_email')) {
      await pool.query(`ALTER TABLE document_deliveries ADD COLUMN recipient_email VARCHAR(255) NULL AFTER recipient_id`);
      await pool.query(`ALTER TABLE document_deliveries ADD COLUMN recipient_name VARCHAR(255) NULL AFTER recipient_email`);
      await pool.query(`ALTER TABLE document_deliveries MODIFY COLUMN recipient_id INT NULL`);
      await pool.query(`ALTER TABLE document_deliveries ADD INDEX idx_docdeliv_recipient_email (recipient_email)`);
      console.log('[db] Added recipient_email/recipient_name to document_deliveries.');
    }
  } catch (err) {
    console.error('[db] Could not ensure delivery recipient_email columns exist:', err.message);
  }

  // 10) Migration 019: delivery workflow improvements.
  //     a) document_deliveries.delivery_method ENUM extended to include 'email_attachment'.
  //     b) Resubmission tracking columns on document_deliveries.
  //     c) rejection_notify_token_hash / _used_at on generated_docs.
  //     d) OWNERSHIP_REJECTED_NOTIFY added to audit_logs.action enum.
  try {
    // a) Extend delivery_method to include 'email_attachment'
    const [[delivMethodCol]] = await pool.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'document_deliveries' AND COLUMN_NAME = 'delivery_method'`,
      [dbName]
    );
    if (delivMethodCol && !delivMethodCol.COLUMN_TYPE.includes("'email_attachment'")) {
      await pool.query(
        `ALTER TABLE document_deliveries
           MODIFY COLUMN delivery_method ENUM('email_attachment','secure_link_otp') NOT NULL DEFAULT 'secure_link_otp'`
      );
      console.log("[db] Added 'email_attachment' to document_deliveries.delivery_method enum.");
    }

    // b) Resubmission tracking columns
    const [resubCols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'document_deliveries'
         AND COLUMN_NAME IN ('resubmission_of','is_resubmission','resubmitted_at')`,
      [dbName]
    );
    const haveResub = new Set(resubCols.map((c) => c.COLUMN_NAME));
    if (!haveResub.has('resubmission_of')) {
      await pool.query(`ALTER TABLE document_deliveries ADD COLUMN resubmission_of INT NULL AFTER created_by`);
      await pool.query(`ALTER TABLE document_deliveries ADD INDEX idx_docdeliv_resubmission_of (resubmission_of)`);
      console.log('[db] Added resubmission_of to document_deliveries.');
    }
    if (!haveResub.has('is_resubmission')) {
      await pool.query(`ALTER TABLE document_deliveries ADD COLUMN is_resubmission TINYINT(1) NOT NULL DEFAULT 0 AFTER resubmission_of`);
      console.log('[db] Added is_resubmission to document_deliveries.');
    }
    if (!haveResub.has('resubmitted_at')) {
      await pool.query(`ALTER TABLE document_deliveries ADD COLUMN resubmitted_at DATETIME NULL AFTER is_resubmission`);
      console.log('[db] Added resubmitted_at to document_deliveries.');
    }

    // c) Rejection notify token on generated_docs
    const [notifyTokenCols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'generated_docs'
         AND COLUMN_NAME IN ('rejection_notify_token_hash','rejection_notify_token_used_at')`,
      [dbName]
    );
    const haveNotifyToken = new Set(notifyTokenCols.map((c) => c.COLUMN_NAME));
    if (!haveNotifyToken.has('rejection_notify_token_hash')) {
      await pool.query(`ALTER TABLE generated_docs ADD COLUMN rejection_notify_token_hash CHAR(64) NULL AFTER revocation_reason`);
      await pool.query(`ALTER TABLE generated_docs ADD INDEX idx_docs_rejection_notify_token (rejection_notify_token_hash)`);
      console.log('[db] Added rejection_notify_token_hash to generated_docs.');
    }
    if (!haveNotifyToken.has('rejection_notify_token_used_at')) {
      await pool.query(`ALTER TABLE generated_docs ADD COLUMN rejection_notify_token_used_at DATETIME NULL AFTER rejection_notify_token_hash`);
      console.log('[db] Added rejection_notify_token_used_at to generated_docs.');
    }

    // d) OWNERSHIP_REJECTED_NOTIFY / DELIVERY_OWNED_NOTIFY / WORKFLOW_COMPLETE_NOTIFY /
    //    ACKNOWLEDGE_NOTIFY audit actions (migration 019 / 022)
    const FULL_ACTION_ENUM_V2 = [
      'PREVIEW', 'GENERATE', 'SIGN', 'REJECT', 'DELIVER', 'VERIFY', 'DOWNLOAD', 'VIEW',
      'LOGIN', 'LOGOUT', 'CREATE_TEMPLATE', 'UPDATE_TEMPLATE', 'DELETE_TEMPLATE', 'ARCHIVE_TEMPLATE',
      'CREATE_USER', 'UPDATE_USER', 'DELETE_USER', 'PASSWORD_RESET_REQUEST', 'PASSWORD_RESET_COMPLETE',
      'DELETE_DOCUMENT',
      'SECURE_DELIVER', 'OTP_VERIFY', 'OWNERSHIP_CONFIRM', 'OWNERSHIP_REJECT',
      'OWNERSHIP_REJECTED_NOTIFY', 'DELIVERY_OWNED_NOTIFY',
      'REVOKE_DOCUMENT',
      'WORKFLOW_COMPLETE_NOTIFY', 'ACKNOWLEDGE_NOTIFY',
    ];
    const [[actionCol]] = await pool.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'action'`,
      [dbName]
    );
    const missingActions = actionCol
      ? FULL_ACTION_ENUM_V2.filter((a) => !actionCol.COLUMN_TYPE.includes(`'${a}'`))
      : [];
    if (missingActions.length > 0) {
      await pool.query(`
        ALTER TABLE audit_logs
          MODIFY COLUMN action ENUM(${FULL_ACTION_ENUM_V2.map((a) => `'${a}'`).join(',')}) NOT NULL
      `);
      console.log(`[db] Added ${missingActions.join(', ')} to audit_logs.action enum.`);
    }
  } catch (err) {
    console.error('[db] Could not apply migration 019 (delivery workflow improvements):', err.message);
  }

  // 11) Migration 020: delivery_status reporting column + rejection_review_token
  //     on document_deliveries.
  try {
    const [m020Cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'document_deliveries'
         AND COLUMN_NAME IN ('delivery_status','rejection_review_token_hash','rejection_review_token_used_at')`,
      [dbName]
    );
    const haveM020 = new Set(m020Cols.map((c) => c.COLUMN_NAME));

    if (!haveM020.has('delivery_status')) {
      await pool.query(
        `ALTER TABLE document_deliveries
           ADD COLUMN delivery_status TINYINT(1) NULL DEFAULT NULL AFTER owned`
      );
      await pool.query(`ALTER TABLE document_deliveries ADD INDEX idx_docdeliv_delivery_status (delivery_status)`);
      // Backfill: CONFIRMED + downloaded = 1, REJECTED = 0, else NULL.
      await pool.query(`UPDATE document_deliveries SET delivery_status = 1 WHERE ownership_status = 'CONFIRMED' AND downloaded_at IS NOT NULL`);
      await pool.query(`UPDATE document_deliveries SET delivery_status = 0 WHERE ownership_status = 'REJECTED'`);
      console.log('[db] Added delivery_status to document_deliveries (backfilled).');
    }
    if (!haveM020.has('rejection_review_token_hash')) {
      await pool.query(
        `ALTER TABLE document_deliveries
           ADD COLUMN rejection_review_token_hash CHAR(64) NULL AFTER resubmitted_at`
      );
      await pool.query(`ALTER TABLE document_deliveries ADD INDEX idx_docdeliv_rejection_review_token (rejection_review_token_hash)`);
      console.log('[db] Added rejection_review_token_hash to document_deliveries.');
    }
    if (!haveM020.has('rejection_review_token_used_at')) {
      await pool.query(
        `ALTER TABLE document_deliveries
           ADD COLUMN rejection_review_token_used_at DATETIME NULL AFTER rejection_review_token_hash`
      );
      console.log('[db] Added rejection_review_token_used_at to document_deliveries.');
    }
  } catch (err) {
    console.error('[db] Could not apply migration 020 (delivery_status + rejection_review_token):', err.message);
  }

  // ── User Workflow (migration 021) ────────────────────────────────────────
  // Adds workflow_config JSON to templates (stores the 9-toggle + user-type
  // configuration per template) and three state columns on document_deliveries
  // to record what the recipient did during the dynamic workflow portal.
  try {
    // templates.workflow_config
    const [wfCols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'templates' AND COLUMN_NAME = 'workflow_config'`,
      [dbName]
    );
    if (wfCols.length === 0) {
      await pool.query(`ALTER TABLE templates ADD COLUMN workflow_config JSON NULL AFTER footer_html`);
      console.log('[db] Added workflow_config to templates.');
    }

    // document_deliveries workflow state columns
    const [ddWfCols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'document_deliveries'
         AND COLUMN_NAME IN ('workflow_acknowledged_at','workflow_user_signed_at','workflow_response')`,
      [dbName]
    );
    const haveWf = new Set(ddWfCols.map((c) => c.COLUMN_NAME));
    if (!haveWf.has('workflow_acknowledged_at')) {
      await pool.query(`ALTER TABLE document_deliveries ADD COLUMN workflow_acknowledged_at DATETIME NULL AFTER delivery_status`);
      console.log('[db] Added workflow_acknowledged_at to document_deliveries.');
    }
    if (!haveWf.has('workflow_user_signed_at')) {
      await pool.query(`ALTER TABLE document_deliveries ADD COLUMN workflow_user_signed_at DATETIME NULL AFTER workflow_acknowledged_at`);
      console.log('[db] Added workflow_user_signed_at to document_deliveries.');
    }
    if (!haveWf.has('workflow_response')) {
      await pool.query(`ALTER TABLE document_deliveries ADD COLUMN workflow_response TEXT NULL AFTER workflow_user_signed_at`);
      console.log('[db] Added workflow_response to document_deliveries.');
    }
  } catch (err) {
    console.error('[db] Could not apply migration 021 (user workflow):', err.message);
  }

  // ── Workflow Generator Tracking (migration 022) ──────────────────────────
  // workflow_tracking_token_hash: one-time secure token stored as SHA-256 hash.
  //   The Generator receives the raw token in the workflow-complete notification
  //   email.  They click the link → GET /api/public/secure-delivery/workflow-track/:token
  //   → server validates, marks used, returns signed document URL + status.
  //   Never requires re-login. Single-use, 7-day expiry.
  //
  // workflow_completed_at: stamped when the recipient clicks "Submit" after signing
  //   (workflowSign), signalling that the user's side of the workflow is done and
  //   the Generator should review. Used for ordering/filtering in the tracking page.
  try {
    const [m022Cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'document_deliveries'
         AND COLUMN_NAME IN ('workflow_tracking_token_hash','workflow_tracking_token_expiry',
                             'workflow_tracking_token_used_at','workflow_completed_at')`,
      [dbName]
    );
    const have022 = new Set(m022Cols.map((c) => c.COLUMN_NAME));

    if (!have022.has('workflow_tracking_token_hash')) {
      await pool.query(
        `ALTER TABLE document_deliveries
           ADD COLUMN workflow_tracking_token_hash CHAR(64) NULL AFTER workflow_response`
      );
      await pool.query(
        `ALTER TABLE document_deliveries
           ADD INDEX idx_dd_wf_track_token (workflow_tracking_token_hash)`
      );
      console.log('[db] Added workflow_tracking_token_hash to document_deliveries.');
    }
    if (!have022.has('workflow_tracking_token_expiry')) {
      await pool.query(
        `ALTER TABLE document_deliveries
           ADD COLUMN workflow_tracking_token_expiry DATETIME NULL AFTER workflow_tracking_token_hash`
      );
      console.log('[db] Added workflow_tracking_token_expiry to document_deliveries.');
    }
    if (!have022.has('workflow_tracking_token_used_at')) {
      await pool.query(
        `ALTER TABLE document_deliveries
           ADD COLUMN workflow_tracking_token_used_at DATETIME NULL AFTER workflow_tracking_token_expiry`
      );
      console.log('[db] Added workflow_tracking_token_used_at to document_deliveries.');
    }
    if (!have022.has('workflow_completed_at')) {
      await pool.query(
        `ALTER TABLE document_deliveries
           ADD COLUMN workflow_completed_at DATETIME NULL AFTER workflow_tracking_token_used_at`
      );
      await pool.query(
        `ALTER TABLE document_deliveries
           ADD INDEX idx_dd_wf_completed_at (workflow_completed_at)`
      );
      console.log('[db] Added workflow_completed_at to document_deliveries.');
    }
  } catch (err) {
    console.error('[db] Could not apply migration 022 (workflow tracking token):', err.message);
  }

  // ── Workflow Signature Data (migration 023) ──────────────────────────────
  // workflow_signature_data: JSON blob storing everything about the user's signature
  // as submitted — field position (x,y,width,height,page from the template's
  // signatureField config), the recipient's name, the typed signature text, and
  // an optional base64 photo. Read back by WorkflowTrackingPage to overlay the
  // signature at the exact Admin-configured position.
  //
  // workflow_signature_embedded_at: stamped when the signature image+name were
  // physically embedded into the PDF bytes (file overwritten, file_hash updated).
  // NULL = data stored in DB but PDF not yet re-rendered; NOT NULL = PDF stamped.
  // Used by migration 021 SQL file; must exist before workflow_notify_sent_at.
  try {
    const [m023Cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'document_deliveries'
         AND COLUMN_NAME IN ('workflow_signature_data', 'workflow_signature_embedded_at')`,
      [dbName]
    );
    const have023 = new Set(m023Cols.map((c) => c.COLUMN_NAME));

    if (!have023.has('workflow_signature_data')) {
      await pool.query(
        `ALTER TABLE document_deliveries
           ADD COLUMN workflow_signature_data MEDIUMTEXT NULL AFTER workflow_completed_at`
      );
      console.log('[db] Added workflow_signature_data to document_deliveries.');
    }
    // workflow_signature_embedded_at MUST be added here — it is referenced by
    // workflowSign (UPDATE ... SET workflow_signature_embedded_at = NOW()) and is
    // also the AFTER anchor for workflow_notify_sent_at below.
    if (!have023.has('workflow_signature_embedded_at')) {
      await pool.query(
        `ALTER TABLE document_deliveries
           ADD COLUMN workflow_signature_embedded_at DATETIME NULL
           COMMENT 'Set when the signature image+name were embedded into the PDF bytes'
           AFTER workflow_signature_data`
      );
      console.log('[db] Added workflow_signature_embedded_at to document_deliveries.');
    }
  } catch (err) {
    console.error('[db] Could not apply migration 023 (workflow signature data/embedded):', err.message);
  }

  // ── Migration 022b: workflow_notify_sent_at — idempotency lock for the ONE
  //   consolidated Generator notification email.  Stamped atomically by whichever
  //   workflow step (acknowledge / sign / respond) fires first; prevents every
  //   subsequent step from sending a duplicate email.
  //
  //   IMPORTANT: this block runs AFTER migration 023 above so that
  //   workflow_signature_embedded_at is guaranteed to exist as the AFTER anchor.
  try {
    const [m022bCols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'document_deliveries'
         AND COLUMN_NAME = 'workflow_notify_sent_at'`,
      [dbName]
    );
    if (m022bCols.length === 0) {
      await pool.query(
        `ALTER TABLE document_deliveries
           ADD COLUMN workflow_notify_sent_at DATETIME NULL
           COMMENT 'Stamped atomically when the ONE consolidated Generator notification email is sent. Prevents duplicates.'
           AFTER workflow_signature_embedded_at`
      );
      // Index so the atomic WHERE workflow_notify_sent_at IS NULL UPDATE is fast.
      await pool.query(
        `ALTER TABLE document_deliveries
           ADD INDEX idx_dd_wf_notify_sent (workflow_notify_sent_at)`
      );
      console.log('[db] Added workflow_notify_sent_at to document_deliveries.');
    }
  } catch (err) {
    console.error('[db] Could not apply migration 022b (workflow_notify_sent_at):', err.message);
    // Re-throw so the server startup fails loudly rather than silently missing
    // the idempotency column and sending duplicate notification emails.
    throw err;
  }
}

module.exports = { pool, verifyConnection, ensureSchema };
