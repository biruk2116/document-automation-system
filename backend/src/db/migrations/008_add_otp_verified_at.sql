-- Migration: gate the Approver's one-time PDF review link behind OTP entry (product
-- requirement: "The Approver must enter the OTP before accessing the document").
-- otp_verified_at is set the moment the OTP entered on the public /review/:token page
-- is confirmed valid; GET /api/signatures/review/:token (the endpoint that actually
-- streams the PDF) now refuses to serve the file until this is set. Run this only if
-- your database predates this feature. Fresh installs from schema.sql already include
-- this column.

ALTER TABLE signature_requests
  ADD COLUMN otp_verified_at DATETIME NULL AFTER view_token_used_at;
