-- Migration: add PASSWORD_RESET_REQUEST, PASSWORD_RESET_COMPLETE to audit_logs.action
-- enum, for the self-service "Forgot password" flow (see migration 011 and
-- authController.requestPasswordReset / resetPasswordWithToken).
-- Run this only if your database predates this feature. Fresh installs from
-- schema.sql already include this.

ALTER TABLE audit_logs
  MODIFY COLUMN action ENUM(
    'PREVIEW','GENERATE','SIGN','REJECT','DELIVER','VERIFY','DOWNLOAD','VIEW',
    'LOGIN','LOGOUT','CREATE_TEMPLATE','UPDATE_TEMPLATE',
    'DELETE_TEMPLATE','ARCHIVE_TEMPLATE','CREATE_USER','UPDATE_USER',
    'DELETE_USER','PASSWORD_RESET_REQUEST','PASSWORD_RESET_COMPLETE'
  ) NOT NULL;
