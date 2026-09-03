-- Migration: soft-delete support for generated_docs, powering the Document Tracking
-- page's "Delete" button. Deleting a document removes its PDF from disk and sets
-- deleted_at, but the row itself (doc_uuid, file_hash, status) is kept forever —
-- Verify Document (FR-033..035) only ever compares against the DB-persisted hash and
-- must keep working for a document after it has been deleted from tracking.
-- Also adds DELETE_DOCUMENT to the audit_logs.action enum so the deletion itself is
-- recorded in the audit trail like every other lifecycle event.
-- Run this only if your database predates this feature. Fresh installs from
-- schema.sql already include both changes.

ALTER TABLE generated_docs
  ADD COLUMN deleted_at DATETIME NULL AFTER archived_at,
  ADD INDEX idx_docs_deleted_at (deleted_at);

ALTER TABLE audit_logs
  MODIFY COLUMN action ENUM(
    'PREVIEW','GENERATE','SIGN','REJECT','DELIVER','VERIFY','DOWNLOAD','VIEW',
    'LOGIN','LOGOUT','CREATE_TEMPLATE','UPDATE_TEMPLATE',
    'DELETE_TEMPLATE','ARCHIVE_TEMPLATE','CREATE_USER','UPDATE_USER',
    'DELETE_USER','PASSWORD_RESET_REQUEST','PASSWORD_RESET_COMPLETE',
    'DELETE_DOCUMENT'
  ) NOT NULL;
