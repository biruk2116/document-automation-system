-- Migration 021: Track when the user's signature has been physically embedded
-- into the PDF file (i.e. the PDF bytes were rewritten with the signature image
-- and typed name stamped at the Admin-configured signatureField position).
--
-- workflow_signature_embedded_at
--   NULL  — signature data stored in workflow_signature_data but PDF not yet stamped
--            (pre-migration rows, or a delivery where embedding failed non-fatally).
--   <ts>  — PDF on disk was successfully rewritten with the signature embedded;
--            generated_docs.file_hash updated to match the new bytes.
--
-- This column is purely informational (audit/tracking). The authoritative "did the
-- user sign?" flag is still workflow_user_signed_at — this is an additional
-- implementation-detail flag that lets ops confirm whether the physical file has
-- been stamped without having to diff the PDF bytes.

ALTER TABLE document_deliveries
  ADD COLUMN IF NOT EXISTS workflow_signature_embedded_at DATETIME NULL
    COMMENT 'Set when the signature image+name were embedded into the PDF bytes'
    AFTER workflow_completed_at;
