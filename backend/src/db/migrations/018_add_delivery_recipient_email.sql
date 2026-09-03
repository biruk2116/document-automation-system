-- Migration: Secure Document Delivery — validate recipients against the template's
-- own mapped data source table (by email) instead of a pre-registered `users` row.
--
-- Why: a Super Admin / System Admin has no legitimate way to "create" the real
-- recipient of a generated document (e.g. a specific employee/student). The actual
-- recipient is whoever's row the document was generated from in the template's
-- mapped data source (internal table, or a saved external MySQL/PostgreSQL/MongoDB/
-- SQLite connection) — identified by their email there, exactly like the existing
-- "email + secure link" flow in documentController.sendDocumentViaNotifyToken /
-- sendSecureLinkViaNotifyToken (see utils/recipientValidation.js). Requiring a
-- registered users row with role='recipient' made this module unusable in practice
-- since no such accounts are ever created by an admin.
--
-- generated_docs.recipient_id / document_deliveries.recipient_id are left in place
-- (now nullable) purely for any historical rows written by the old flow. Every new
-- delivery is identified by recipient_email (+ best-effort recipient_name) instead,
-- and ownership confirmation (secureDeliveryController.confirmOwnership) now compares
-- the delivery's recipient_email against generated_docs.recipient_email rather than
-- comparing user ids.

ALTER TABLE generated_docs
  ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(255) NULL AFTER recipient_id,
  ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(255) NULL AFTER recipient_email;

ALTER TABLE generated_docs
  MODIFY COLUMN recipient_id INT NULL;

ALTER TABLE document_deliveries
  ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(255) NULL AFTER recipient_id,
  ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(255) NULL AFTER recipient_email;

ALTER TABLE document_deliveries
  MODIFY COLUMN recipient_id INT NULL;

ALTER TABLE document_deliveries
  ADD INDEX idx_docdeliv_recipient_email (recipient_email);

ALTER TABLE generated_docs
  ADD INDEX idx_docs_recipient_email (recipient_email);
