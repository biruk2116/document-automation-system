-- Migration: add VIEW to audit_logs.action enum
-- Needed so an approver viewing a PDF in-browser (before entering the OTP) can be
-- logged distinctly from a DOWNLOAD. Run this only if your database predates the
-- "view PDF in browser" step. Fresh installs from schema.sql already include this.

ALTER TABLE audit_logs
  MODIFY COLUMN action ENUM(
    'PREVIEW','GENERATE','SIGN','REJECT','DELIVER','VERIFY','DOWNLOAD','VIEW',
    'LOGIN','LOGOUT','CREATE_TEMPLATE','UPDATE_TEMPLATE','DELETE_TEMPLATE','ARCHIVE_TEMPLATE',
    'CREATE_USER','UPDATE_USER'
  ) NOT NULL;
