-- =====================================================================
-- Automated Dynamic PDF/Report Generation Engine (with E-Sign)
-- ProjID: 01311CIS2026 — Database Schema (MySQL 8+ / XAMPP compatible)
-- =====================================================================

CREATE DATABASE IF NOT EXISTS doc_automation
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE doc_automation;

-- ---------------------------------------------------------------------
-- 1. users
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  reset_token     VARCHAR(255) NULL,     -- self-service "Forgot password" (see migration 011)
  reset_token_expires DATETIME NULL,
  full_name       VARCHAR(255) NOT NULL,
  role            ENUM('super_admin','system_admin','generator','approver','recipient')
                    NOT NULL DEFAULT 'generator',
  phone           VARCHAR(32)  NULL,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role (role),
  INDEX idx_users_reset_token (reset_token)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. templates  (FR-001..FR-008)
-- ---------------------------------------------------------------------
CREATE TABLE templates (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  category        ENUM('HR','Finance','Academic','Procurement','General')
                    NOT NULL,
  description     TEXT NULL,
  version         INT NOT NULL DEFAULT 1,
  parent_template_id INT NULL,          -- links a version back to its lineage (FR-006)
  header_html     LONGTEXT NULL,
  body_html       LONGTEXT NULL,
  footer_html     LONGTEXT NULL,
  watermark_text  VARCHAR(255) NULL,     -- e.g. DRAFT / CONFIDENTIAL / FINAL (FR-017)
  logo_path       VARCHAR(500) NULL,     -- FR-008: uploaded logo/signature image
  data_source_table VARCHAR(128) NULL,   -- FR-009: e.g. "employees"
  status          ENUM('active','archived') NOT NULL DEFAULT 'active', -- FR-007
  created_by      INT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_templates_parent FOREIGN KEY (parent_template_id)
    REFERENCES templates(id) ON DELETE SET NULL,
  CONSTRAINT fk_templates_creator FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_templates_status (status),
  INDEX idx_templates_category (category)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. template_placeholders  (FR-003, FR-004, FR-005)
-- ---------------------------------------------------------------------
CREATE TABLE template_placeholders (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  template_id     INT NOT NULL,
  field_path      VARCHAR(255) NOT NULL,   -- e.g. "employee.salary"
  data_type       ENUM('string','number','date','boolean') NOT NULL DEFAULT 'string',
  is_loopable     TINYINT(1) NOT NULL DEFAULT 0,   -- FR-005 looping blocks
  default_value   VARCHAR(255) NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_placeholders_template FOREIGN KEY (template_id)
    REFERENCES templates(id) ON DELETE CASCADE,
  INDEX idx_placeholders_template (template_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. generated_docs  (FR-014..FR-019)
-- ---------------------------------------------------------------------
CREATE TABLE generated_docs (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  doc_uuid          VARCHAR(64) NOT NULL UNIQUE,   -- DOC-YYYYMMDD-XXXXX (FR-015)
  verification_id   VARCHAR(40) NULL UNIQUE,        -- opaque public QR identifier (secure delivery module)
  template_id       INT NOT NULL,
  generated_by      INT NOT NULL,
  recipient_id      INT NULL,                       -- legacy: intended recipient as a registered user (old flow only)
  recipient_email   VARCHAR(255) NULL,               -- current ownership ground truth: validated against the
                                                      -- template's mapped data source table (see recipientValidation.js)
  recipient_name    VARCHAR(255) NULL,               -- best-effort display name for recipient_email
  record_identifier VARCHAR(128) NOT NULL,          -- e.g. Employee ID
  file_path         VARCHAR(500) NOT NULL,
  file_hash         CHAR(64) NOT NULL,               -- SHA-256 hex (FR-016)
  status            ENUM('draft','pending','signed','rejected','delivered')
                      NOT NULL DEFAULT 'draft',
  archive_status    ENUM('active','archived') NOT NULL DEFAULT 'active', -- FR-040
  archived_at       DATETIME NULL,                                       -- FR-040: when it was moved to cold storage
  deleted_at        DATETIME NULL,     -- soft delete (Document Tracking "Delete"); row + hash kept for Verify Document
  revoked_at        DATETIME NULL,     -- explicit admin revocation (secure delivery module — QR reports REVOKED)
  revoked_by        INT NULL,
  revocation_reason VARCHAR(255) NULL,
  metadata          JSON NULL,
  notify_view_token_used_at DATETIME NULL,  -- one-time PDF review link sent in Generator notification emails (signed/rejected)
  generated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_docs_template FOREIGN KEY (template_id)
    REFERENCES templates(id) ON DELETE RESTRICT,
  CONSTRAINT fk_docs_generator FOREIGN KEY (generated_by)
    REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_docs_recipient FOREIGN KEY (recipient_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_docs_revoked_by FOREIGN KEY (revoked_by)
    REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_docs_status (status),
  INDEX idx_docs_template (template_id),
  INDEX idx_docs_hash (file_hash),
  INDEX idx_docs_archive_status (archive_status),
  INDEX idx_docs_deleted_at (deleted_at),
  INDEX idx_docs_recipient (recipient_id),
  INDEX idx_docs_recipient_email (recipient_email)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. signature_requests  (FR-020..FR-027, BR-003, BR-004)
-- ---------------------------------------------------------------------
CREATE TABLE signature_requests (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  doc_id          INT NOT NULL,
  approver_id     INT NOT NULL,
  otp_code        VARCHAR(255) NOT NULL,   -- store hashed, never plaintext
  otp_expiry      DATETIME NOT NULL,
  view_token_used_at DATETIME NULL,        -- one-time PDF review link: set on first open
  otp_verified_at DATETIME NULL,           -- OTP must be verified before the link will serve the PDF
  otp_attempts    TINYINT NOT NULL DEFAULT 0,   -- max 3 (BR-004)
  locked_until    DATETIME NULL,                -- 15 min lockout (BR-004)
  status          ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  rejection_reason TEXT NULL,
  approved_at     DATETIME NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sigreq_doc FOREIGN KEY (doc_id)
    REFERENCES generated_docs(id) ON DELETE CASCADE,
  CONSTRAINT fk_sigreq_approver FOREIGN KEY (approver_id)
    REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_sigreq_status (status),
  INDEX idx_sigreq_doc (doc_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. digital_signatures  (FR-024)
-- ---------------------------------------------------------------------
CREATE TABLE digital_signatures (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  doc_id              INT NOT NULL,
  signer_id           INT NOT NULL,
  signature_timestamp DATETIME NOT NULL,   -- NTP-synced (FR-026)
  crypto_hmac         CHAR(64) NOT NULL,   -- HMAC-SHA256 hex
  visual_signature_text VARCHAR(255) NOT NULL,  -- "Digitally Approved by X on Y"
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sig_doc FOREIGN KEY (doc_id)
    REFERENCES generated_docs(id) ON DELETE CASCADE,
  CONSTRAINT fk_sig_signer FOREIGN KEY (signer_id)
    REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_sig_doc (doc_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. delivery_logs  (FR-028..FR-031, NFR-002)
-- ---------------------------------------------------------------------
CREATE TABLE delivery_logs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  doc_id          INT NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  sent_at         TIMESTAMP NULL,
  download_token  VARCHAR(500) NOT NULL,   -- JWT, single-use
  token_expiry    DATETIME NOT NULL,        -- 7 days (FR-028c)
  downloaded_at   DATETIME NULL,
  downloaded_ip   VARCHAR(64) NULL,
  downloaded_user_agent VARCHAR(500) NULL,  -- FR-029: "logs their IP, browser, and timestamp"
  email_status    ENUM('queued','sent','failed','opened') NOT NULL DEFAULT 'queued',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_delivery_doc FOREIGN KEY (doc_id)
    REFERENCES generated_docs(id) ON DELETE CASCADE,
  INDEX idx_delivery_doc (doc_id),
  INDEX idx_delivery_token (download_token(191))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7b. document_deliveries — secure-link + OTP delivery & ownership verification
-- (see migrations/016_add_secure_delivery_module.sql for full column notes)
-- ---------------------------------------------------------------------
CREATE TABLE document_deliveries (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  doc_id                  INT NOT NULL,
  recipient_id            INT NULL,                   -- legacy: registered-user recipient (old flow only)
  recipient_email         VARCHAR(255) NULL,           -- current ground truth: validated against the mapped data source table
  recipient_name          VARCHAR(255) NULL,           -- best-effort display name for recipient_email
  delivery_method         ENUM('secure_link_otp') NOT NULL DEFAULT 'secure_link_otp',
  secure_token_hash       CHAR(64) NOT NULL,
  token_expiry            DATETIME NOT NULL,
  token_used_at           DATETIME NULL,
  otp_code                VARCHAR(255) NOT NULL,
  otp_expiry              DATETIME NOT NULL,
  otp_attempts            TINYINT NOT NULL DEFAULT 0,
  otp_locked_until        DATETIME NULL,
  sent_at                 DATETIME NULL,
  opened_at               DATETIME NULL,
  access_ip               VARCHAR(64) NULL,
  access_user_agent       VARCHAR(500) NULL,
  otp_verified_at         DATETIME NULL,
  ownership_status        ENUM('PENDING','CONFIRMED','REJECTED') NOT NULL DEFAULT 'PENDING',
  -- Reporting-friendly boolean mirror of ownership_status — NULL while PENDING,
  -- 1 once CONFIRMED, 0 once REJECTED. Never used for authorization decisions;
  -- ownership_status is still the single source of truth for those. Exists only
  -- so "how many deliveries were owned vs not" is a plain COUNT/SUM query.
  owned                   TINYINT(1) NULL DEFAULT NULL,
  ownership_confirmed_at  DATETIME NULL,
  ownership_rejected_at   DATETIME NULL,
  rejection_reason        TEXT NULL,
  downloaded_at           DATETIME NULL,
  download_ip             VARCHAR(64) NULL,
  download_user_agent     VARCHAR(500) NULL,
  email_status             ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  plain_copy_email_status  ENUM('not_sent','queued','sent','failed') NOT NULL DEFAULT 'not_sent',
  created_by               INT NOT NULL,
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_docdeliv_doc FOREIGN KEY (doc_id)
    REFERENCES generated_docs(id) ON DELETE CASCADE,
  CONSTRAINT fk_docdeliv_recipient FOREIGN KEY (recipient_id)
    REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_docdeliv_creator FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_docdeliv_token_hash (secure_token_hash),
  INDEX idx_docdeliv_doc (doc_id),
  INDEX idx_docdeliv_recipient (recipient_id),
  INDEX idx_docdeliv_recipient_email (recipient_email),
  INDEX idx_docdeliv_ownership (ownership_status),
  INDEX idx_docdeliv_owned (owned)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 8. audit_logs  (FR-036, immutable forensic log)
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NULL,
  doc_id          INT NULL,
  action          ENUM('PREVIEW','GENERATE','SIGN','REJECT','DELIVER','VERIFY','DOWNLOAD','VIEW',
                        'LOGIN','LOGOUT','CREATE_TEMPLATE','UPDATE_TEMPLATE',
                        'DELETE_TEMPLATE','ARCHIVE_TEMPLATE','CREATE_USER','UPDATE_USER',
                        'DELETE_USER','PASSWORD_RESET_REQUEST','PASSWORD_RESET_COMPLETE',
                        'DELETE_DOCUMENT',
                        'SECURE_DELIVER','OTP_VERIFY','OWNERSHIP_CONFIRM','OWNERSHIP_REJECT','REVOKE_DOCUMENT') NOT NULL,
  action_details  JSON NULL,
  ip_address      VARCHAR(64) NULL,
  user_agent      VARCHAR(500) NULL,
  timestamp       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_doc FOREIGN KEY (doc_id)
    REFERENCES generated_docs(id) ON DELETE SET NULL,
  INDEX idx_audit_doc (doc_id),
  INDEX idx_audit_user (user_id),
  INDEX idx_audit_action (action)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 9. notification_reads — tracks which in-app bell notifications a user has
-- already opened, so the unread badge count only reflects what's genuinely
-- unseen (notifications themselves are still derived live from audit_logs;
-- this table just remembers "seen" state per user).
-- ---------------------------------------------------------------------
CREATE TABLE notification_reads (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id           INT NOT NULL,
  notification_key  VARCHAR(80) NOT NULL,   -- e.g. "your_document_approved-123"
  read_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifread_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_notifread_user_key (user_id, notification_key)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Seed: one user per role for testing (password for all = "Passw0rd!")
-- Hash below is bcrypt for "Passw0rd!" — replace before using in prod.
-- ---------------------------------------------------------------------
INSERT INTO users (email, password_hash, full_name, role) VALUES
('superadmin@example.com', '$2b$10$enSBt4rEV13mz5AXVUiH.OIoKox7eAUBzR6ibNBqXGzS4YsgIm6lm', 'Super Admin', 'super_admin'),
('sysadmin@example.com',   '$2b$10$enSBt4rEV13mz5AXVUiH.OIoKox7eAUBzR6ibNBqXGzS4YsgIm6lm', 'System Admin', 'system_admin'),
('hr@example.com',         '$2b$10$enSBt4rEV13mz5AXVUiH.OIoKox7eAUBzR6ibNBqXGzS4YsgIm6lm', 'HR Officer', 'generator'),
('director@example.com',   '$2b$10$enSBt4rEV13mz5AXVUiH.OIoKox7eAUBzR6ibNBqXGzS4YsgIm6lm', 'Finance Director', 'approver'),
('recipient@example.com',  '$2b$10$enSBt4rEV13mz5AXVUiH.OIoKox7eAUBzR6ibNBqXGzS4YsgIm6lm', 'Abebe Kebede', 'recipient');

-- =====================================================================
-- DEMO / TESTING DATA SOURCE — a real business table for admins to bind
-- templates to (Point 3.6). Swap this out for your organization's real
-- tables later; this is here purely so field mapping, conditional blocks
-- ({{#if employee.salary > 5000}}), and looping blocks
-- ({{#each employee.leave_history}}) all have real data to render against.
-- =====================================================================
CREATE TABLE employees (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  employee_id     VARCHAR(20) NOT NULL UNIQUE,   -- e.g. EMP001 — used as the "record ID" at generation time
  full_name       VARCHAR(255) NOT NULL,
  department      VARCHAR(100) NOT NULL,
  position        VARCHAR(100) NOT NULL,
  salary          DECIMAL(12,2) NOT NULL,
  email           VARCHAR(255) NULL,
  hire_date       DATE NOT NULL,
  status          VARCHAR(30) NOT NULL DEFAULT 'active',
  -- JSON arrays so template looping blocks have real tabular data to iterate:
  salary_breakdown JSON NULL,   -- e.g. [{"label":"Base","amount":40000}, {"label":"Bonus","amount":5000}]
  leave_history    JSON NULL,   -- e.g. [{"year":2025,"note":"12 days taken"}, {"year":2026,"note":"5 days taken"}]
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO employees (employee_id, full_name, department, position, salary, email, hire_date, status, salary_breakdown, leave_history) VALUES
('EMP001', 'Abebe Kebede', 'Human Resources', 'HR Officer', 6200.00, 'abebe.kebede@example.com', '2022-03-14', 'active',
  JSON_ARRAY(JSON_OBJECT('label','Base Salary','amount',5000), JSON_OBJECT('label','Bonus','amount',1200)),
  JSON_ARRAY(JSON_OBJECT('year',2025,'note','12 days taken, 8 remaining'), JSON_OBJECT('year',2026,'note','3 days taken, 17 remaining'))),
('EMP002', 'Sara Tesfaye', 'Finance', 'Accountant', 4800.00, 'sara.tesfaye@example.com', '2021-07-01', 'active',
  JSON_ARRAY(JSON_OBJECT('label','Base Salary','amount',4500), JSON_OBJECT('label','Bonus','amount',300)),
  JSON_ARRAY(JSON_OBJECT('year',2025,'note','9 days taken, 11 remaining'))),
('EMP003', 'Dawit Getachew', 'Engineering', 'Software Engineer', 7500.00, 'dawit.getachew@example.com', '2020-01-20', 'active',
  JSON_ARRAY(JSON_OBJECT('label','Base Salary','amount',6500), JSON_OBJECT('label','Bonus','amount',1000)),
  JSON_ARRAY(JSON_OBJECT('year',2025,'note','20 days taken, 0 remaining'), JSON_OBJECT('year',2026,'note','2 days taken, 18 remaining'))),
('EMP004', 'Marta Alemu', 'Procurement', 'Junior Officer', 3200.00, 'marta.alemu@example.com', '2023-09-05', 'active',
  JSON_ARRAY(JSON_OBJECT('label','Base Salary','amount',3200)),
  JSON_ARRAY(JSON_OBJECT('year',2025,'note','4 days taken, 16 remaining')));
