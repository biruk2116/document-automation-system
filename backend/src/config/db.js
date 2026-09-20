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
      CREATE OR REPLACE FUNCTION JSON_EXTRACT(target jsonb, path text)
      RETURNS text AS $$
      DECLARE
        clean_path text;
        path_parts text[];
        val text;
      BEGIN
        IF target IS NULL THEN RETURN NULL; END IF;
        clean_path := regexp_replace(path, '^\\$\\.?', '');
        IF clean_path = '' OR clean_path = '$' THEN
          RETURN target::text;
        END IF;
        clean_path := regexp_replace(clean_path, '\\[(\\d+)\\]', '.\\1', 'g');
        path_parts := string_to_array(clean_path, '.');
        val := target #>> path_parts;
        RETURN val;
      EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;

      CREATE OR REPLACE FUNCTION JSON_EXTRACT(target json, path text)
      RETURNS text AS $$
      BEGIN
        IF target IS NULL THEN RETURN NULL; END IF;
        RETURN JSON_EXTRACT(target::jsonb, path);
      EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;

      CREATE OR REPLACE FUNCTION JSON_EXTRACT(target text, path text)
      RETURNS text AS $$
      BEGIN
        IF target IS NULL THEN RETURN NULL; END IF;
        RETURN JSON_EXTRACT(target::jsonb, path);
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

      CREATE OR REPLACE FUNCTION JSON_UNQUOTE(val jsonb)
      RETURNS text AS $$
      BEGIN
        IF val IS NULL THEN RETURN NULL; END IF;
        RETURN val #>> '{}';
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;

      CREATE OR REPLACE FUNCTION JSON_UNQUOTE(val json)
      RETURNS text AS $$
      BEGIN
        IF val IS NULL THEN RETURN NULL; END IF;
        RETURN val::jsonb #>> '{}';
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;

      CREATE OR REPLACE FUNCTION text_equals_int(t text, i integer)
      RETURNS boolean AS $$
      BEGIN
        RETURN t::integer = i;
      EXCEPTION WHEN OTHERS THEN
        RETURN false;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;

      CREATE OR REPLACE FUNCTION int_equals_text(i integer, t text)
      RETURNS boolean AS $$
      BEGIN
        RETURN i = t::integer;
      EXCEPTION WHEN OTHERS THEN
        RETURN false;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;

      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_operator o
          JOIN pg_type t1 ON o.oprleft = t1.oid
          JOIN pg_type t2 ON o.oprright = t2.oid
          WHERE o.oprname = '=' AND t1.typname = 'text' AND t2.typname = 'int4'
        ) THEN
          CREATE OPERATOR = (
            PROCEDURE = text_equals_int,
            LEFTARG = text,
            RIGHTARG = integer,
            COMMUTATOR = =
          );
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_operator o
          JOIN pg_type t1 ON o.oprleft = t1.oid
          JOIN pg_type t2 ON o.oprright = t2.oid
          WHERE o.oprname = '=' AND t1.typname = 'int4' AND t2.typname = 'text'
        ) THEN
          CREATE OPERATOR = (
            PROCEDURE = int_equals_text,
            LEFTARG = integer,
            RIGHTARG = text,
            COMMUTATOR = =
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

      CREATE OR REPLACE FUNCTION DATEDIFF(date1 anyelement, date2 anyelement)
      RETURNS integer AS $$
      BEGIN
        RETURN (date1::date - date2::date);
      EXCEPTION WHEN OTHERS THEN
        RETURN 0;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;

      CREATE OR REPLACE FUNCTION DATE_FORMAT(dt anyelement, fmt text)
      RETURNS text AS $$
      DECLARE
        pg_fmt text;
      BEGIN
        IF dt IS NULL THEN RETURN NULL; END IF;
        pg_fmt := fmt;
        pg_fmt := replace(pg_fmt, '%Y', 'YYYY');
        pg_fmt := replace(pg_fmt, '%y', 'YY');
        pg_fmt := replace(pg_fmt, '%m', 'MM');
        pg_fmt := replace(pg_fmt, '%d', 'DD');
        pg_fmt := replace(pg_fmt, '%H', 'HH24');
        pg_fmt := replace(pg_fmt, '%i', 'MI');
        pg_fmt := replace(pg_fmt, '%s', 'SS');
        RETURN to_char(dt::timestamp, pg_fmt);
      EXCEPTION WHEN OTHERS THEN
        RETURN dt::text;
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

      -- Add new enum values if they don't exist (for existing enums)
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'OWNERSHIP_REJECTED_NOTIFY' AND enumtypid = 'action_type'::regtype) THEN
          ALTER TYPE action_type ADD VALUE 'OWNERSHIP_REJECTED_NOTIFY';
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
      
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DELIVERY_OWNED_NOTIFY' AND enumtypid = 'action_type'::regtype) THEN
          ALTER TYPE action_type ADD VALUE 'DELIVERY_OWNED_NOTIFY';
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
      
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'REVOKE_DOCUMENT' AND enumtypid = 'action_type'::regtype) THEN
          ALTER TYPE action_type ADD VALUE 'REVOKE_DOCUMENT';
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
      
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'WORKFLOW_COMPLETE_NOTIFY' AND enumtypid = 'action_type'::regtype) THEN
          ALTER TYPE action_type ADD VALUE 'WORKFLOW_COMPLETE_NOTIFY';
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
      
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ACKNOWLEDGE_NOTIFY' AND enumtypid = 'action_type'::regtype) THEN
          ALTER TYPE action_type ADD VALUE 'ACKNOWLEDGE_NOTIFY';
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
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

    // Ensure is_active is SMALLINT (converts legacy boolean column to SMALLINT)
    await pool.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'is_active' AND data_type = 'boolean'
        ) THEN
          ALTER TABLE users ALTER COLUMN is_active DROP DEFAULT;
          ALTER TABLE users ALTER COLUMN is_active TYPE SMALLINT USING (CASE WHEN is_active THEN 1 ELSE 0 END);
          ALTER TABLE users ALTER COLUMN is_active SET DEFAULT 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)`);
    
    // Create default admin user if no users exist
    const { rows: userCount } = await pool.query(`SELECT COUNT(*) as count FROM users`);
    if (parseInt(userCount[0]?.count || 0) === 0) {
      console.log('[db] No users found, creating default admin...');
      const bcrypt = require('bcryptjs');
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@123';
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      await pool.query(`
        INSERT INTO users (email, password, full_name, role, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, ['admin@example.com', hashedPassword, 'System Administrator', 'super_admin']);
      console.log('[db] ✓ Default admin created: admin@example.com / ' + defaultPassword);
    }
    
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
        rejection_notify_token_hash VARCHAR(64),
        rejection_notify_token_used_at TIMESTAMP,
        generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS record_identifier VARCHAR(255);
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
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS rejection_notify_token_hash VARCHAR(64);
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS rejection_notify_token_used_at TIMESTAMP;
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);

    // Sync generated_at and created_at
    await pool.query(`
      UPDATE generated_docs SET generated_at = created_at WHERE generated_at IS NULL AND created_at IS NOT NULL;
      UPDATE generated_docs SET created_at = generated_at WHERE created_at IS NULL AND generated_at IS NOT NULL;
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_uuid ON generated_docs(doc_uuid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_verification_id ON generated_docs(verification_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_status ON generated_docs(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_deleted_at ON generated_docs(deleted_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_rejection_notify_token ON generated_docs(rejection_notify_token_hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_recipient_email ON generated_docs(recipient_email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_docs_generated_at ON generated_docs(generated_at)`);
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
    await pool.query(`
      ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS view_token_used_at TIMESTAMP;
      ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS otp_verified_at TIMESTAMP;
      ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS otp_attempts SMALLINT NOT NULL DEFAULT 0;
      ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP;
      ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
      ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
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
    await pool.query(`
      ALTER TABLE delivery_logs ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMP;
      ALTER TABLE delivery_logs ADD COLUMN IF NOT EXISTS downloaded_ip VARCHAR(64);
      ALTER TABLE delivery_logs ADD COLUMN IF NOT EXISTS downloaded_user_agent VARCHAR(500);
      ALTER TABLE delivery_logs ADD COLUMN IF NOT EXISTS email_status VARCHAR(20) DEFAULT 'queued';
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

    // 13. Create employees table (business data source for templates)
    console.log('[db] Creating employees table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        employee_id VARCHAR(20) NOT NULL UNIQUE,
        full_name VARCHAR(255) NOT NULL,
        department VARCHAR(100) NOT NULL,
        position VARCHAR(100) NOT NULL,
        salary DECIMAL(12,2) NOT NULL,
        email VARCHAR(255),
        hire_date DATE NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'active',
        salary_breakdown JSONB,
        leave_history JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Seed sample employee data if table is empty
    const { rows: empCount } = await pool.query(`SELECT COUNT(*) as count FROM employees`);
    if (empCount && empCount.length > 0 && parseInt(empCount[0].count) === 0) {
      console.log('[db] Seeding employees table with sample data...');
      await pool.query(`
        INSERT INTO employees (employee_id, full_name, department, position, salary, email, hire_date, status, salary_breakdown, leave_history) VALUES
        ('EMP001', 'Abebe Kebede', 'Human Resources', 'HR Officer', 6200.00, 'abebe.kebede@example.com', '2022-03-14', 'active',
          '[{"label":"Base Salary","amount":5000}, {"label":"Bonus","amount":1200}]'::jsonb,
          '[{"year":2025,"note":"12 days taken, 8 remaining"}, {"year":2026,"note":"3 days taken, 17 remaining"}]'::jsonb),
        ('EMP002', 'Sara Tesfaye', 'Finance', 'Accountant', 4800.00, 'sara.tesfaye@example.com', '2021-07-01', 'active',
          '[{"label":"Base Salary","amount":4500}, {"label":"Bonus","amount":300}]'::jsonb,
          '[{"year":2025,"note":"9 days taken, 11 remaining"}]'::jsonb),
        ('EMP003', 'Dawit Getachew', 'Engineering', 'Software Engineer', 7500.00, 'dawit.getachew@example.com', '2020-01-20', 'active',
          '[{"label":"Base Salary","amount":6500}, {"label":"Bonus","amount":1000}]'::jsonb,
          '[{"year":2025,"note":"20 days taken, 0 remaining"}, {"year":2026,"note":"2 days taken, 18 remaining"}]'::jsonb),
        ('EMP004', 'Marta Alemu', 'Procurement', 'Junior Officer', 3200.00, 'marta.alemu@example.com', '2023-09-05', 'active',
          '[{"label":"Base Salary","amount":3200}]'::jsonb,
          '[{"year":2025,"note":"4 days taken, 16 remaining"}]'::jsonb)
      `);
      console.log('[db] ✓ Employees data seeded');
    }
    console.log('[db] ✓ employees table ready');

    // 14. Create document_deliveries table (Secure Delivery)
    console.log('[db] Creating document_deliveries table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_deliveries (
        id SERIAL PRIMARY KEY,
        doc_id INT NOT NULL,
        recipient_id INT,
        recipient_email VARCHAR(255),
        recipient_name VARCHAR(255),
        delivery_method VARCHAR(50) NOT NULL DEFAULT 'secure_link_otp',
        recipient_phone VARCHAR(30),
        secure_token_hash VARCHAR(64),
        token_hash VARCHAR(64),
        token_expiry TIMESTAMP,
        token_used_at TIMESTAMP,
        otp_code VARCHAR(255),
        otp_hash VARCHAR(255),
        otp_expiry TIMESTAMP,
        otp_attempts SMALLINT NOT NULL DEFAULT 0,
        otp_locked_until TIMESTAMP,
        sent_at TIMESTAMP,
        opened_at TIMESTAMP,
        access_ip VARCHAR(64),
        access_user_agent VARCHAR(500),
        otp_verified_at TIMESTAMP,
        otp_user_agent TEXT,
        ownership_status VARCHAR(20) DEFAULT 'PENDING',
        owned SMALLINT DEFAULT NULL,
        ownership_confirmed_at TIMESTAMP,
        ownership_rejected_at TIMESTAMP,
        rejection_reason TEXT,
        rejection_review_token_hash VARCHAR(64),
        rejection_review_token_expiry TIMESTAMP,
        rejection_review_token_used_at TIMESTAMP,
        is_resubmission SMALLINT DEFAULT 0,
        resubmission_of INT,
        resubmitted_at TIMESTAMP,
        delivery_status INT DEFAULT 0,
        downloaded_at TIMESTAMP,
        download_ip VARCHAR(64),
        download_user_agent VARCHAR(500),
        email_status VARCHAR(50) NOT NULL DEFAULT 'queued',
        plain_copy_email_status VARCHAR(50) NOT NULL DEFAULT 'not_sent',
        workflow_acknowledged_at TIMESTAMP,
        workflow_user_signed_at TIMESTAMP,
        workflow_completed_at TIMESTAMP,
        workflow_response TEXT,
        workflow_signature_data TEXT,
        workflow_signature_embedded_at TIMESTAMP,
        workflow_tracking_token_hash VARCHAR(64),
        workflow_tracking_token_expiry TIMESTAMP,
        workflow_tracking_token_used_at TIMESTAMP,
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
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS recipient_id INT;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(255);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(255);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS recipient_phone VARCHAR(30);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(50) DEFAULT 'secure_link_otp';
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS secure_token_hash VARCHAR(64);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS token_expiry TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS token_used_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS otp_code VARCHAR(255);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS otp_hash VARCHAR(255);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS otp_expiry TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS otp_attempts SMALLINT DEFAULT 0;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS otp_locked_until TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS access_ip VARCHAR(64);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS access_user_agent VARCHAR(500);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS otp_verified_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS otp_user_agent TEXT;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS ownership_status VARCHAR(20) DEFAULT 'PENDING';
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS owned SMALLINT DEFAULT NULL;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS ownership_confirmed_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS ownership_rejected_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS rejection_review_token_hash VARCHAR(64);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS rejection_review_token_expiry TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS rejection_review_token_used_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS is_resubmission SMALLINT DEFAULT 0;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS resubmission_of INT;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS resubmitted_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS delivery_status INT DEFAULT 0;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS download_ip VARCHAR(64);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS download_user_agent VARCHAR(500);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS email_status VARCHAR(50) DEFAULT 'queued';
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS plain_copy_email_status VARCHAR(50) DEFAULT 'not_sent';
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_acknowledged_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_user_signed_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_completed_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_response TEXT;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_signature_data TEXT;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_signature_embedded_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_tracking_token_hash VARCHAR(64);
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_tracking_token_expiry TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_tracking_token_used_at TIMESTAMP;
      ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_notify_sent_at TIMESTAMP;
    `);

    // Ensure owned and is_resubmission are SMALLINT (converts legacy boolean column to SMALLINT)
    await pool.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'document_deliveries' AND column_name = 'owned' AND data_type = 'boolean'
        ) THEN
          ALTER TABLE document_deliveries ALTER COLUMN owned DROP DEFAULT;
          ALTER TABLE document_deliveries ALTER COLUMN owned TYPE SMALLINT USING (CASE WHEN owned THEN 1 ELSE 0 END);
          ALTER TABLE document_deliveries ALTER COLUMN owned SET DEFAULT NULL;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'document_deliveries' AND column_name = 'is_resubmission' AND data_type = 'boolean'
        ) THEN
          ALTER TABLE document_deliveries ALTER COLUMN is_resubmission DROP DEFAULT;
          ALTER TABLE document_deliveries ALTER COLUMN is_resubmission TYPE SMALLINT USING (CASE WHEN is_resubmission THEN 1 ELSE 0 END);
          ALTER TABLE document_deliveries ALTER COLUMN is_resubmission SET DEFAULT 0;
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `);

    // Sync token_hash & secure_token_hash, otp_code & otp_hash
    await pool.query(`
      UPDATE document_deliveries SET secure_token_hash = token_hash WHERE secure_token_hash IS NULL AND token_hash IS NOT NULL;
      UPDATE document_deliveries SET token_hash = secure_token_hash WHERE token_hash IS NULL AND secure_token_hash IS NOT NULL;
      UPDATE document_deliveries SET otp_code = otp_hash WHERE otp_code IS NULL AND otp_hash IS NOT NULL;
      UPDATE document_deliveries SET otp_hash = otp_code WHERE otp_hash IS NULL AND otp_code IS NOT NULL;
    `);

    console.log('[db] Creating document_deliveries indexes...');
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_secure_token_hash ON document_deliveries(secure_token_hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_token_hash ON document_deliveries(token_hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_otp_code ON document_deliveries(otp_code)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_otp_hash ON document_deliveries(otp_hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_doc_id ON document_deliveries(doc_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_workflow_token ON document_deliveries(workflow_tracking_token_hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_rejection_token ON document_deliveries(rejection_review_token_hash)`);
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
