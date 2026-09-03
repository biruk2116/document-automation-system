-- Migration: adds document_deliveries.owned — a plain 1/0/NULL mirror of
-- ownership_status, kept ONLY to make "how many deliveries were owned vs not"
-- reportable with a simple COUNT/SUM instead of an ENUM comparison in every
-- report query.
--
-- ownership_status (PENDING/CONFIRMED/REJECTED) remains the single source of
-- truth for every trust/authorization decision in this module (requirement 9
-- still applies — this is not a replacement for the tri-state enum, it is a
-- convenience column derived from it):
--   ownership_status = 'PENDING'   -> owned = NULL (not yet decided)
--   ownership_status = 'CONFIRMED' -> owned = 1
--   ownership_status = 'REJECTED'  -> owned = 0
--
-- Also applied automatically on boot by config/db.js's ensureSchema() self-heal
-- (same idempotent pattern as every other migration in this project, including
-- backfilling `owned` for any deliveries that were already decided before this
-- column existed) — running this file by hand is only needed if that self-heal
-- is ever disabled.

ALTER TABLE document_deliveries
  ADD COLUMN IF NOT EXISTS owned TINYINT(1) NULL DEFAULT NULL AFTER ownership_status,
  ADD INDEX IF NOT EXISTS idx_docdeliv_owned (owned);

UPDATE document_deliveries SET owned = 1 WHERE ownership_status = 'CONFIRMED' AND owned IS NULL;
UPDATE document_deliveries SET owned = 0 WHERE ownership_status = 'REJECTED' AND owned IS NULL;
