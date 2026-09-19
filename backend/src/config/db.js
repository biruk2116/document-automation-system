const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL connection pool
// Supports both DATABASE_URL (Neon/Render style) and individual params
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') 
    ? { rejectUnauthorized: false } 
    : undefined,
  // Fallback to individual params if DATABASE_URL not provided
  ...(!process.env.DATABASE_URL && {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'doc_automation',
  }),
  max: 10, // connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// PostgreSQL uses $1, $2 style parameters instead of ?
// Helper to convert MySQL-style queries to PostgreSQL
function convertQuery(sql, params) {
  let paramIndex = 1;
  const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
  return { text: convertedSql, values: params };
}

// Wrapper to make pool.query compatible with MySQL-style ? placeholders
// and return format
const originalQuery = pool.query.bind(pool);
pool.query = async function(sql, params) {
  let result;
  
  if (typeof sql === 'string' && params && params.length > 0) {
    const { text, values } = convertQuery(sql, params);
    result = await originalQuery(text, values);
  } else {
    result = await originalQuery(sql, params);
  }
  
  // Normalize result format to match MySQL
  // MySQL returns [rows, fields], PostgreSQL returns {rows, fields, rowCount}
  if (result.rows) {
    // For INSERT with RETURNING, add insertId to first row
    if (result.command === 'INSERT' && result.rows.length > 0 && result.rows[0].id) {
      result.insertId = result.rows[0].id;
    }
    
    // Add affectedRows alias for rowCount
    result.affectedRows = result.rowCount;
    
    // Return array format like MySQL: [rows, fields]
    return [result.rows, result.fields];
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
 * PostgreSQL Schema Creation
 * Creates all tables if they don't exist
 */
async function ensureSchema() {
  try {
    // Create action_type enum
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

    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(100) NOT NULL,
        email VARCHAR(150) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        reset_token VARCHAR(255),
        reset_token_expires TIMESTAMP,
        role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        avatar_url TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)`);

    // Create templates table
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
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'draft')),
        created_by INT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_template_id) REFERENCES templates(id) ON DELETE SET NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_templates_status ON templates(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_templates_deleted_at ON templates(deleted_at)`);

    // Create generated_docs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_docs (
        id SERIAL PRIMARY KEY,
        doc_uuid VARCHAR(60) NOT NULL UNIQUE,
        verification_id VARCHAR(60) NOT NULL UNIQUE,
        template_id INT NOT NULL,
        generated_by INT NOT NULL,
        recipient_email VARCHAR(150),
        record_identifier VARCHAR(255),
        file_path VARCHAR(500) NOT NULL,
        file_hash VARCHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected', 'delivered', 'revoked')),
        signature_data TEXT,
        signed_at TIMESTAMP,
        signed_by INT,
        metadata TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP,
        deleted_at TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
        FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (signed_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_uuid ON generated_docs(doc_uuid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_verification_id ON generated_docs(verification_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_status ON generated_docs(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_deleted_at ON generated_docs(deleted_at)`);

    // Create audit_logs table
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

    // Create notification_reads table
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

    // Create external_db_connections table
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

    // Add foreign key for templates.data_source_connection_id if not exists
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE templates 
          ADD CONSTRAINT fk_templates_ext_connection 
          FOREIGN KEY (data_source_connection_id) 
          REFERENCES external_db_connections(id) ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create document_deliveries table (Secure Delivery)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_deliveries (
        id SERIAL PRIMARY KEY,
        doc_id INT NOT NULL,
        recipient_email VARCHAR(150) NOT NULL,
        recipient_name VARCHAR(150),
        delivery_method VARCHAR(20) NOT NULL DEFAULT 'email' CHECK (delivery_method IN ('email', 'sms', 'link')),
        recipient_phone VARCHAR(20),
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        token_expiry TIMESTAMP,
        otp_hash VARCHAR(64),
        otp_expiry TIMESTAMP,
        otp_verified_at TIMESTAMP,
        otp_user_agent TEXT,
        ownership_status VARCHAR(20) DEFAULT 'PENDING' CHECK (ownership_status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
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
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_token_hash ON document_deliveries(token_hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_otp_hash ON document_deliveries(otp_hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_doc_id ON document_deliveries(doc_id)`);

    console.log('[db] PostgreSQL schema ensured successfully');
  } catch (err) {
    console.error('[db] Could not ensure PostgreSQL schema:', err.message);
    throw err;
  }
}

module.exports = { pool, verifyConnection, ensureSchema };
