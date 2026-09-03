-- Migration 020: Add delivery_status to document_deliveries for reporting.
--
-- delivery_status is a reporting-friendly integer flag that summarises the
-- overall outcome of a delivery row in one column — useful for COUNT/SUM
-- aggregates on the Delivery Logs report without joining ownership_status:
--
--   NULL  — delivery is still in progress (sent, OTP not yet verified,
--            or ownership decision still pending).
--   1     — delivery completed successfully: ownership CONFIRMED and document
--            downloaded.
--   0     — delivery blocked: ownership REJECTED by the recipient.
--
-- Like the existing `owned` column, this is purely a read-side reporting
-- mirror. The authoritative state for any access decision is always
-- ownership_status (ENUM PENDING/CONFIRMED/REJECTED) — never this column.
--
-- Also adds document_deliveries.rejection_review_token_hash / _used_at:
-- a one-time public token (no login required) included in the rejection
-- notification email so the Generator can open a branded public page that
-- shows the rejection reason and provides an "Edit & Resubmit" button that
-- redirects to the authenticated /documents page.
-- SHA-256 hash only stored in DB (same pattern as secure_token_hash).

ALTER TABLE document_deliveries
  ADD COLUMN IF NOT EXISTS delivery_status TINYINT(1) NULL DEFAULT NULL
    COMMENT '1=completed (owned+downloaded), 0=rejected, NULL=in-progress'
    AFTER owned,
  ADD COLUMN IF NOT EXISTS rejection_review_token_hash CHAR(64) NULL
    AFTER resubmitted_at,
  ADD COLUMN IF NOT EXISTS rejection_review_token_used_at DATETIME NULL
    AFTER rejection_review_token_hash;

ALTER TABLE document_deliveries
  ADD INDEX IF NOT EXISTS idx_docdeliv_delivery_status (delivery_status),
  ADD INDEX IF NOT EXISTS idx_docdeliv_rejection_review_token (rejection_review_token_hash);
