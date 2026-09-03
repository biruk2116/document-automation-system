-- Migration: add CREATE_USER, UPDATE_USER to audit_logs.action enum
-- Run this only if your database predates user management (Point 1).
-- Fresh installs from schema.sql already include this.

ALTER TABLE audit_logs
  MODIFY COLUMN action ENUM(
    'PREVIEW','GENERATE','SIGN','REJECT','DELIVER','VERIFY','DOWNLOAD',
    'LOGIN','LOGOUT','CREATE_TEMPLATE','UPDATE_TEMPLATE','DELETE_TEMPLATE','ARCHIVE_TEMPLATE',
    'CREATE_USER','UPDATE_USER'
  ) NOT NULL;
