const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL connection pool
// Supports both DATABASE_URL (Neon/Render style) and individual params
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost') && !process.env.DATABASE_URL.includes('127.0.0.1'))
    ? { rejectUnauthorized: false }
    : (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined),
  // Fallback to individual params if DATABASE_URL not provided
  ...(!process.env.DATABASE_URL && {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'doc_automation',
  }),
  max: 10, // connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Converts MySQL-compatible SQL queries to PostgreSQL dialect
function convertQuery(sql, params) {
  let text = sql;

  // Auto-append RETURNING id for INSERT queries if not already returning
  if (/^\s*INSERT\s+INTO/i.test(text) && !/RETURNING/i.test(text)) {
    text = text.trim().replace(/;\s*$/, '') + ' RETURNING id';
  }

  // Convert MySQL CAST(... AS UNSIGNED) to CAST(... AS BIGINT)
  text = text.replace(/AS\s+UNSIGNED/gi, 'AS BIGINT');

  // Convert CURDATE() to CURRENT_DATE
  text = text.replace(/\bCURDATE\(\)/gi, 'CURRENT_DATE');

  // Convert MySQL INTERVAL ? UNIT to (? * INTERVAL '1 UNIT')
  text = text.replace(/INTERVAL\s+\?\s+(HOUR|DAY|MONTH|YEAR|MINUTE|SECOND)/gi, "(? * INTERVAL '1 $1')");

  // Convert MySQL INTERVAL <number> <unit> to INTERVAL '<number> <unit>'
  text = text.replace(/INTERVAL\s+(\d+)\s+(HOUR|DAY|MONTH|YEAR|MINUTE|SECOND)/gi, "INTERVAL '$1 $2'");

  // PostgreSQL uses $1, $2 style parameters instead of ?
  let paramIndex = 1;
  text = text.replace(/\?/g, () => `$${paramIndex++}`);

  return { text, values: params };
}

// Wrapper to make pool.query compatible with MySQL-style ? placeholders and [rows, fields] return format
const originalQuery = pool.query.bind(pool);
pool.query = async function(sql, params) {
  let result;
  
  if (typeof sql === 'string') {
    const { text, values } = convertQuery(sql, params || []);
    result = await originalQuery(text, values);
  } else {
    result = await originalQuery(sql, params);
  }
  
  // Normalize result format to match MySQL [rows, fields]
  if (result && result.rows) {
    const rows = result.rows;
    
    // For INSERT with RETURNING, attach insertId directly to the rows array
    if (rows.length > 0 && rows[0].id !== undefined) {
      rows.insertId = rows[0].id;
    } else {
      rows.insertId = 0;
    }
    
    // Add affectedRows alias for rowCount
    rows.affectedRows = result.rowCount || 0;
    rows.rowCount = result.rowCount || 0;
    
    // Return array format like MySQL: [rows, fields]
    return [rows, result.fields || []];
  }
  
  return result;
};

// Quick startup check
async function verifyConnection() {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('[db] PostgreSQL connection OK');
  } catch (err) {
    console.error('[db] PostgreSQL connection FAILED:', err.message);
    console.error('[db] Check .env DATABASE_URL or DB_* values.');
  }
}

/**
 * PostgreSQL Schema Creation & Migration
 * Creates all tables and columns idempotently
 */
async function ensureSchema() {
  try {
    console.log('[db] Starting PostgreSQL schema creation...');

    // 0. Compatibility helper functions
    await pool.query(`
      CREATE OR REPLACE FUNCTION JSON_EXTRACT(target text, path text)
      RETURNS text AS $$
      DECLARE
        clean_path text;
        json_val text;
      BEGIN
        IF target IS NULL THEN RETURN NULL; END IF;
        clean_path := regexp_replace(path, '^\\$\\.?', '');
        SELECT (target::json->>clean_path) INTO json_val;
        RETURN json_val;
      EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;

      CREATE OR REPLACE FUNCTION JSON_UNQUOTE(val text)
      RETURNS text AS $$
      BEGIN
        IF val IS NULL THEN RETURN NULL; END IF;
        IF val LIKE '"%"' AND length(val) >= 2 THEN
          RETURN substr(val, 2, length(val) - 2);
        END IF;
        RETURN val;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);
    
    // 1. Create action_type enum
    console.log('[db] Creating action_type enum...');
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE action_type AS ENUM (
          'PREVIEW', 'GENERATE', 'SIGN', 'REJECT', 'DELIVER', 'VERIFY', 'DOWNLOAD', 'VIEW',
          'LOGIN', 'LOGOUT', 'CREATE_TEMPLATE', 'UPDATE_TEMPLATE', 'DELETE_TEMPLATE', 'ARCHIVE_TEMPLATE',
          'CREATE_USER', 'UPDATE_USER', 'DELETE_USER', 'PASSWORD_RESET_REQUEST', 'PASSWORD_RESET_COMPLETE',
          'DELETE_DOCUMENT', 'SECURE_DELIVER', 'OTP_VERIFY', 'OWNERSHIP_CONFIRM', 'OWNERSHIP_REJECT',
          'OWNERSHIP_REJECTED_NOTIFY', 'DELIVERY_OWNED_NOTIFY', 'REVOKE_DOCUMENT',
          'WORKFLOW_COMPLETE_NOTIFY', 'ACKNOWLEDGE_NOTIFY'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('[db] ✓ action_type enum ready');

    // 2. Create users table
    console.log('[db] Creating users table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(100) NOT NULL,
        email VARCHAR(150) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        reset_token VARCHAR(255),
        reset_token_expires TIMESTAMP,
        role VARCHAR(50) NOT NULL DEFAULT 'generator',
        phone VARCHAR(32),
        is_active SMALLINT NOT NULL DEFAULT 1,
        avatar_url TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Drop outdated check constraints on role if present
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `);

    // Ensure columns exist on existing users table
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active SMALLINT NOT NULL DEFAULT 1;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)`);
    console.log('[db] ✓ users table ready');

    // 3. Create templates table
    console.log('[db] Creating templates table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        category VARCHAR(100),
        description TEXT,
        version INT NOT NULL DEFAULT 1,
        parent_template_id INT,
        header_html TEXT,
        body_html TEXT,
        footer_html TEXT,
        watermark_text VARCHAR(50),
        data_source_table VARCHAR(100),
        data_source_connection_id INT,
        logo_path VARCHAR(255),
        workflow_config TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_by INT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (parent_template_id) REFERENCES templates(id) ON DELETE SET NULL
      )
    `);

    // Ensure columns exist on existing templates table
    await pool.query(`
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS parent_template_id INT;
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_html TEXT;
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS body_html TEXT;
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS footer_html TEXT;
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS watermark_text VARCHAR(50);
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS data_source_table VARCHAR(100);
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS data_source_connection_id INT;
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS logo_path VARCHAR(255);
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS workflow_config TEXT;
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_templates_status ON templates(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_templates_deleted_at ON templates(deleted_at)`);
    console.log('[db] ✓ templates table ready');

    // 4. Create template_placeholders table
    console.log('[db] Creating template_placeholders table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS template_placeholders (
        id SERIAL PRIMARY KEY,
        template_id INT NOT NULL,
        field_path VARCHAR(255) NOT NULL,
        data_type VARCHAR(20) NOT NULL DEFAULT 'string',
        is_loopable SMALLINT NOT NULL DEFAULT 0,
        default_value VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_placeholders_template ON template_placeholders(template_id)`);
    console.log('[db] ✓ template_placeholders table ready');

    // 5. Create generated_docs table
    console.log('[db] Creating generated_docs table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_docs (
        id SERIAL PRIMARY KEY,
        doc_uuid VARCHAR(60) NOT NULL UNIQUE,
        verification_id VARCHAR(60) UNIQUE,
        template_id INT NOT NULL,
        generated_by INT NOT NULL,
        recipient_id INT,
        recipient_email VARCHAR(150),
        recipient_name VARCHAR(150),
        record_identifier VARCHAR(255),
        file_path VARCHAR(500) NOT NULL,
        file_hash VARCHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        archive_status VARCHAR(20) NOT NULL DEFAULT 'active',
        signature_data TEXT,
        signed_at TIMESTAMP,
        signed_by INT,
        metadata TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP,
        deleted_at TIMESTAMP,
        revoked_at TIMESTAMP,
        revoked_by INT,
        revocation_reason VARCHAR(255),
        notify_view_token_used_at TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
        FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (signed_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Ensure columns exist on existing generated_docs table
    await pool.query(`
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS verification_id VARCHAR(60);
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS recipient_id INT;
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(150);
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(150);
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS archive_status VARCHAR(20) NOT NULL DEFAULT 'active';
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS signature_data TEXT;
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP;
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS signed_by INT;
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS metadata TEXT;
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS revoked_by INT;
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS revocation_reason VARCHAR(255);
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS notify_view_token_used_at TIMESTAMP;
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_uuid ON generated_docs(doc_uuid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_verification_id ON generated_docs(verification_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_status ON generated_docs(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_deleted_at ON generated_docs(deleted_at)`);
    console.log('[db] ✓ generated_docs table ready');

    // 6. Create signature_requests table
    console.log('[db] Creating signature_requests table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS signature_requests (
        id SERIAL PRIMARY KEY,
        doc_id INT NOT NULL,
        approver_id INT NOT NULL,
        otp_code VARCHAR(255) NOT NULL,
        otp_expiry TIMESTAMP NOT NULL,
        view_token_used_at TIMESTAMP,
        otp_verified_at TIMESTAMP,
        otp_attempts SMALLINT NOT NULL DEFAULT 0,
        locked_until TIMESTAMP,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        rejection_reason TEXT,
        approved_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doc_id) REFERENCES generated_docs(id) ON DELETE CASCADE,
        FOREIGN KEY (approver_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sigreq_status ON signature_requests(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sigreq_doc ON signature_requests(doc_id)`);
    console.log('[db] ✓ signature_requests table ready');

    // 7. Create digital_signatures table
    console.log('[db] Creating digital_signatures table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS digital_signatures (
        id SERIAL PRIMARY KEY,
        doc_id INT NOT NULL,
        signer_id INT NOT NULL,
        signature_timestamp TIMESTAMP NOT NULL,
        crypto_hmac VARCHAR(64) NOT NULL,
        visual_signature_text VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doc_id) REFERENCES generated_docs(id) ON DELETE CASCADE,
        FOREIGN KEY (signer_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sig_doc ON digital_signatures(doc_id)`);
    console.log('[db] ✓ digital_signatures table ready');

    // 8. Create delivery_logs table
    console.log('[db] Creating delivery_logs table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS delivery_logs (
        id SERIAL PRIMARY KEY,
        doc_id INT NOT NULL,
        recipient_email VARCHAR(255) NOT NULL,
        sent_at TIMESTAMP,
        download_token TEXT NOT NULL,
        token_expiry TIMESTAMP NOT NULL,
        downloaded_at TIMESTAMP,
        downloaded_ip VARCHAR(64),
        downloaded_user_agent VARCHAR(500),
        email_status VARCHAR(20) NOT NULL DEFAULT 'queued',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doc_id) REFERENCES generated_docs(id) ON DELETE CASCADE
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_delivery_doc ON delivery_logs(doc_id)`);
    console.log('[db] ✓ delivery_logs table ready');

    // 9. Create audit_logs table
    console.log('[db] Creating audit_logs table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id INT,
        doc_id INT,
        action action_type NOT NULL,
        action_details TEXT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (doc_id) REFERENCES generated_docs(id) ON DELETE CASCADE
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_doc_id ON audit_logs(doc_id)`);
    console.log('[db] ✓ audit_logs table ready');

    // 10. Create notification_reads table
    console.log('[db] Creating notification_reads table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_reads (
        id BIGSERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        notification_key VARCHAR(80) NOT NULL,
        read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE (user_id, notification_key)
      )
    `);
    console.log('[db] ✓ notification_reads table ready');

    // 11. Create external_db_connections table
    console.log('[db] Creating external_db_connections table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS external_db_connections (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL UNIQUE,
        db_type VARCHAR(20) NOT NULL CHECK (db_type IN ('mysql', 'mongodb', 'postgresql', 'sqlite')),
        host VARCHAR(255),
        port INT,
        db_user VARCHAR(150),
        db_password_encrypted TEXT,
        database_name VARCHAR(500),
        ssl_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        status VARCHAR(20) NOT NULL DEFAULT 'untested' CHECK (status IN ('untested', 'connected', 'failed')),
        last_tested_at TIMESTAMP,
        created_by INT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    console.log('[db] ✓ external_db_connections table ready');

    // 12. Ensure data_source_connection_id column exists in templates before foreign key
    console.log('[db] Ensuring templates.data_source_connection_id column...');
    await pool.query(`
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS data_source_connection_id INT;
    `);

    // Add foreign key constraint safely
    console.log('[db] Adding templates foreign key...');
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_templates_ext_connection'
        ) THEN
          ALTER TABLE templates 
            ADD CONSTRAINT fk_templates_ext_connection 
            FOREIGN KEY (data_source_connection_id) 
            REFERENCES external_db_connections(id) ON DELETE SET NULL;
        END IF;
      EXCEPTION
        WHEN duplicate_object THEN null;
        WHEN OTHERS THEN null;
      END $$;
    `);
    console.log('[db] ✓ templates foreign key ready');

    // 13. Create document_deliveries table (Secure Delivery)
    console.log('[db] Creating document_deliveries table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_deliveries (
        id SERIAL PRIMARY KEY,
        doc_id INT NOT NULL,
        recipient_email VARCHAR(150) NOT NULL,
        recipient_name VARCHAR(150),
        delivery_method VARCHAR(20) NOT NULL DEFAULT 'email',
        recipient_phone VARCHAR(20),
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        token_expiry TIMESTAMP,
        otp_hash VARCHAR(64),
        otp_expiry TIMESTAMP,
        otp_verified_at TIMESTAMP,
        otp_user_agent TEXT,
        ownership_status VARCHAR(20) DEFAULT 'PENDING',
        owned BOOLEAN DEFAULT FALSE,
        ownership_confirmed_at TIMESTAMP,
        ownership_rejected_at TIMESTAMP,
        rejection_reason TEXT,
        rejection_review_token_hash VARCHAR(64),
        rejection_review_token_expiry TIMESTAMP,
        rejection_review_token_used_at TIMESTAMP,
        is_resubmission BOOLEAN DEFAULT FALSE,
        resubmission_of INT,
        resubmitted_at TIMESTAMP,
        delivery_status INT DEFAULT 0,
        workflow_acknowledged_at TIMESTAMP,
        workflow_user_signed_at TIMESTAMP,
        workflow_completed_at TIMESTAMP,
        workflow_response TEXT,
        workflow_signature_data TEXT,
        workflow_signature_embedded_at TIMESTAMP,
        workflow_tracking_token_hash VARCHAR(64),
        workflow_tracking_token_expiry TIMESTAMP,
        workflow_notify_sent_at TIMESTAMP,
        created_by INT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doc_id) REFERENCES generated_docs(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (resubmission_of) REFERENCES document_deliveries(id) ON DELETE SET NULL
      )
    `);

    // Ensure all delivery & workflow columns exist on existing table
    await pool.query(`
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS recipient_phone VARCHAR(20);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS rejection_review_token_hash VARCHAR(64);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS rejection_review_token_expiry TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS rejection_review_token_used_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS is_resubmission BOOLEAN DEFAULT FALSE;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS resubmission_of INT;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS resubmitted_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS delivery_status INT DEFAULT 0;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_acknowledged_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_user_signed_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_completed_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_response TEXT;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_signature_data TEXT;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_signature_embedded_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_tracking_token_hash VARCHAR(64);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_tracking_token_expiry TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_notify_sent_at TIMESTAMP;
    `);

    console.log('[db] Creating document_deliveries indexes...');
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_token_hash ON document_deliveries(token_hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_otp_hash ON document_deliveries(otp_hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_doc_id ON document_deliveries(doc_id)`);
    console.log('[db] ✓ document_deliveries indexes ready');

    // 14. Seed default test accounts if users table is empty
    const [userCount] = await pool.query('SELECT COUNT(*) AS count FROM users');
    if (parseInt(userCount[0]?.count || 0, 10) === 0) {
      console.log('[db] Seeding default test users...');
      await pool.query(`
        INSERT INTO users (email, password_hash, full_name, role) VALUES
        ('superadmin@example.com', '$2b$10$enSBt4rEV13mz5AXVUiH.OIoKox7eAUBzR6ibNBqXGzS4YsgIm6lm', 'Super Admin', 'super_admin'),
        ('sysadmin@example.com',   '$2b$10$enSBt4rEV13mz5AXVUiH.OIoKox7eAUBzR6ibNBqXGzS4YsgIm6lm', 'System Admin', 'system_admin'),
        ('generator@example.com',  '$2b$10$enSBt4rEV13mz5AXVUiH.OIoKox7eAUBzR6ibNBqXGzS4YsgIm6lm', 'Document Generator', 'generator'),
        ('approver@example.com',   '$2b$10$enSBt4rEV13mz5AXVUiH.OIoKox7eAUBzR6ibNBqXGzS4YsgIm6lm', 'Director Approver', 'approver'),
        ('recipient@example.com',  '$2b$10$enSBt4rEV13mz5AXVUiH.OIoKox7eAUBzR6ibNBqXGzS4YsgIm6lm', 'John Doe (Recipient)', 'recipient')
      `);
      console.log('[db] ✓ Default users seeded (password: Passw0rd!)');
    }

    console.log('[db] PostgreSQL schema ensured successfully');
  } catch (err) {
    console.error('[db] Could not ensure PostgreSQL schema:', err.message);
    console.error('[db] Full error:', err);
    throw err;
  }
}

module.exports = { pool, verifyConnection, ensureSchema };
