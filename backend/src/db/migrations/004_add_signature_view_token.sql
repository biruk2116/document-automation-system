-- Migration: track single-use consumption of the secure PDF review link sent to
-- Approvers (FR-022). The link itself is a signed, expiring JWT (not stored), but we
-- still need one row per signature_request to know whether that link has already been
-- opened, so it can be invalidated after first use. Run this only if your database
-- predates the "secure one-time review link" feature. Fresh installs from schema.sql
-- already include this column.

ALTER TABLE signature_requests
  ADD COLUMN view_token_used_at DATETIME NULL AFTER otp_expiry;
