-- Migration: add DOWNLOAD to audit_logs.action enum
-- Run this only if your database was created before this fix (FR-036 gap: downloads weren't being logged).
-- Fresh installs from schema.sql already include this.

ALTER TABLE audit_logs
  MODIFY COLUMN action ENUM(
    'PREVIEW','GENERATE','SIGN','REJECT','DELIVER','VERIFY','DOWNLOAD',
    'LOGIN','LOGOUT','CREATE_TEMPLATE','UPDATE_TEMPLATE','DELETE_TEMPLATE','ARCHIVE_TEMPLATE'
  ) NOT NULL;
