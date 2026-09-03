-- Migration: Secure Document Delivery & Ownership Verification module.
--
-- Adds:
--   1. generated_docs.recipient_id       — the intended recipient (a registered
--      users row), the ground truth every ownership confirmation is checked
--      against (never trust the recipient's own Yes/No alone).
--   2. generated_docs.verification_id    — opaque, cryptographically random public
--      identifier embedded in the PDF's QR code. Deliberately NOT the doc_uuid and
--      NOT the file hash — scanning it can only ever reveal VALID/REVOKED/INVALID
--      plus a few safe display fields, never anything that could help forge or
--      look up the document by other means.
--   3. generated_docs.revoked_at/revoked_by/revocation_reason — lets an admin
--      explicitly revoke a document; the QR verification page reports REVOKED.
--   4. document_deliveries — one row per secure-link+OTP delivery attempt: full
--      timeline (sent/opened/OTP-verified/ownership-confirmed/downloaded),
--      ownership_status as a real PENDING/CONFIRMED/REJECTED enum (never a
--      boolean), rejection_reason, and access/audit metadata (IP, user agent).
--
-- Also applied automatically on boot by config/db.js's ensureSchema() self-heal,
-- same idempotent pattern as every other migration in this project — running this
-- file by hand is only needed if that self-heal is ever disabled.

ALTER TABLE generated_docs
  ADD COLUMN IF NOT EXISTS recipient_id INT NULL AFTER generated_by,
  ADD COLUMN IF NOT EXISTS verification_id VARCHAR(40) NULL AFTER doc_uuid,
  ADD COLUMN IF NOT EXISTS revoked_at DATETIME NULL AFTER deleted_at,
  ADD COLUMN IF NOT EXISTS revoked_by INT NULL AFTER revoked_at,
  ADD COLUMN IF NOT EXISTS revocation_reason VARCHAR(255) NULL AFTER revoked_by;

ALTER TABLE generated_docs
  ADD CONSTRAINT fk_docs_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_docs_revoked_by FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD UNIQUE KEY uq_docs_verification_id (verification_id),
  ADD INDEX idx_docs_recipient (recipient_id);

CREATE TABLE IF NOT EXISTS document_deliveries (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  doc_id                  INT NOT NULL,
  recipient_id            INT NOT NULL,                 -- registered user this delivery was issued to
  delivery_method         ENUM('secure_link_otp') NOT NULL DEFAULT 'secure_link_otp',

  -- The link itself: only a SHA-256 hash of the raw token is ever stored (same
  -- pattern as users.reset_token) so a database read alone can never yield a
  -- usable link. Cryptographically random (32 bytes / 256 bits), expires, and
  -- token_used_at is set the moment OTP verification first succeeds — after that
  -- the link can never be used to (re)authenticate again, no matter how many
  -- times it's opened.
  secure_token_hash       CHAR(64) NOT NULL,
  token_expiry            DATETIME NOT NULL,
  token_used_at           DATETIME NULL,

  -- OTP — bcrypt-hashed, short-lived, rate-limited (same policy as the existing
  -- Approver e-sign OTP: 5 minutes, 3 attempts, 15 minute lockout).
  otp_code                VARCHAR(255) NOT NULL,
  otp_expiry              DATETIME NOT NULL,
  otp_attempts            TINYINT NOT NULL DEFAULT 0,
  otp_locked_until        DATETIME NULL,

  -- Full delivery timeline (FR: sent/opened/OTP-verified/ownership-confirmed/downloaded).
  sent_at                 DATETIME NULL,
  opened_at               DATETIME NULL,
  access_ip               VARCHAR(64) NULL,
  access_user_agent       VARCHAR(500) NULL,
  otp_verified_at         DATETIME NULL,

  -- Ownership is a tri-state, never a boolean — PENDING until the recipient
  -- answers, and even then the answer alone never sets this: it is only ever
  -- written after the backend independently confirms document_deliveries
  -- .recipient_id === generated_docs.recipient_id (see secureDeliveryController
  -- .confirmOwnership).
  ownership_status         ENUM('PENDING','CONFIRMED','REJECTED') NOT NULL DEFAULT 'PENDING',
  -- Reporting-friendly boolean mirror of ownership_status (see migration 017's
  -- comment / db.js's self-heal block for why this exists alongside the enum).
  owned                    TINYINT(1) NULL DEFAULT NULL,
  ownership_confirmed_at   DATETIME NULL,
  ownership_rejected_at    DATETIME NULL,
  rejection_reason         TEXT NULL,

  downloaded_at            DATETIME NULL,
  download_ip              VARCHAR(64) NULL,
  download_user_agent      VARCHAR(500) NULL,

  email_status              ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  plain_copy_email_status   ENUM('not_sent','queued','sent','failed') NOT NULL DEFAULT 'not_sent',

  created_by                INT NOT NULL,                -- Generator/Approver/Admin who initiated this delivery
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_docdeliv_doc FOREIGN KEY (doc_id) REFERENCES generated_docs(id) ON DELETE CASCADE,
  CONSTRAINT fk_docdeliv_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_docdeliv_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_docdeliv_token_hash (secure_token_hash),
  INDEX idx_docdeliv_doc (doc_id),
  INDEX idx_docdeliv_recipient (recipient_id),
  INDEX idx_docdeliv_ownership (ownership_status),
  INDEX idx_docdeliv_owned (owned)
) ENGINE=InnoDB;

-- New audit_logs.action values for this module's events.
ALTER TABLE audit_logs
  MODIFY COLUMN action ENUM(
    'PREVIEW','GENERATE','SIGN','REJECT','DELIVER','VERIFY','DOWNLOAD','VIEW',
    'LOGIN','LOGOUT','CREATE_TEMPLATE','UPDATE_TEMPLATE',
    'DELETE_TEMPLATE','ARCHIVE_TEMPLATE','CREATE_USER','UPDATE_USER',
    'DELETE_USER','PASSWORD_RESET_REQUEST','PASSWORD_RESET_COMPLETE',
    'DELETE_DOCUMENT',
    'SECURE_DELIVER','OTP_VERIFY','OWNERSHIP_CONFIRM','OWNERSHIP_REJECT','REVOKE_DOCUMENT'
  ) NOT NULL;
