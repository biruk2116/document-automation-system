-- Migration 019: Document Delivery Workflow Improvements
--
-- Adds:
--   1. document_deliveries.delivery_method extended to include 'email_attachment'
--      — Generator now chooses between emailing the PDF directly (no OTP/ownership
--      flow) or sending a one-time secure link + OTP. Both paths are recorded in
--      document_deliveries so every delivery is in one audit table.
--
--   2. document_deliveries.resubmission_of — FK to the original delivery that was
--      rejected, so the full "reject → edit & resubmit → new delivery" chain is
--      visible in one query.
--
--   3. document_deliveries.is_resubmission / resubmitted_at — boolean flag + timestamp
--      for the reporting query (total resubmissions).
--
--   4. generated_docs.ownership_rejection_notify_token / _token_hash /
--      _token_used_at — one-time token that lets the Generator click a link in the
--      rejection notification email and land directly on Document Tracking, highlighted
--      on the rejected document, without having to log in first to find it.
--      Same SHA-256-hash-only-in-DB pattern as secure_token_hash.
--
--   5. audit_logs.action extended: OWNERSHIP_REJECTED_NOTIFY added so the in-app
--      notification feed can surface ownership rejections to the Generator.

-- 1. Extend delivery_method ENUM to include 'email_attachment'
ALTER TABLE document_deliveries
  MODIFY COLUMN delivery_method
    ENUM('email_attachment','secure_link_otp') NOT NULL DEFAULT 'secure_link_otp';

-- 2. Resubmission linkage
ALTER TABLE document_deliveries
  ADD COLUMN IF NOT EXISTS resubmission_of INT NULL AFTER created_by,
  ADD COLUMN IF NOT EXISTS is_resubmission TINYINT(1) NOT NULL DEFAULT 0 AFTER resubmission_of,
  ADD COLUMN IF NOT EXISTS resubmitted_at DATETIME NULL AFTER is_resubmission;

ALTER TABLE document_deliveries
  ADD INDEX IF NOT EXISTS idx_docdeliv_resubmission_of (resubmission_of);

-- 3. One-time review token on generated_docs so the Generator can open the
--    rejection notification email link and land on Document Tracking pre-filtered
--    to the rejected document (authenticated — requires a valid login session,
--    the token is just a single-use deep-link parameter, not an auth bypass).
ALTER TABLE generated_docs
  ADD COLUMN IF NOT EXISTS rejection_notify_token_hash CHAR(64) NULL AFTER revocation_reason,
  ADD COLUMN IF NOT EXISTS rejection_notify_token_used_at DATETIME NULL AFTER rejection_notify_token_hash;

ALTER TABLE generated_docs
  ADD INDEX IF NOT EXISTS idx_docs_rejection_notify_token (rejection_notify_token_hash);

-- 4. Audit action for ownership rejection notification to Generator (in-app feed)
--    Note: the audit_logs.action ENUM already contains OWNERSHIP_REJECT (the
--    recipient's action). OWNERSHIP_REJECTED_NOTIFY is the Generator-facing event
--    written at the same time so the notification feed query can find it.
ALTER TABLE audit_logs
  MODIFY COLUMN action
    ENUM(
      'PREVIEW','GENERATE','SIGN','REJECT','DELIVER','VERIFY','DOWNLOAD','VIEW',
      'LOGIN','LOGOUT','CREATE_TEMPLATE','UPDATE_TEMPLATE',
      'DELETE_TEMPLATE','ARCHIVE_TEMPLATE','CREATE_USER','UPDATE_USER',
      'DELETE_USER','PASSWORD_RESET_REQUEST','PASSWORD_RESET_COMPLETE',
      'DELETE_DOCUMENT',
      'SECURE_DELIVER','OTP_VERIFY','OWNERSHIP_CONFIRM','OWNERSHIP_REJECT',
      'OWNERSHIP_REJECTED_NOTIFY',
      'REVOKE_DOCUMENT'
    ) NOT NULL;
