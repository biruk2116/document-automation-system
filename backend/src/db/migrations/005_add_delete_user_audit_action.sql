-- Migration: add DELETE_USER to audit_logs.action enum, and add the
-- notification_reads table used to track which in-app notifications a user
-- has already opened (Manage Users delete button + notification "seen" state).
-- Run this only if your database predates these features. Fresh installs from
-- schema.sql already include both.

ALTER TABLE audit_logs
  MODIFY COLUMN action ENUM(
    'PREVIEW','GENERATE','SIGN','REJECT','DELIVER','VERIFY','DOWNLOAD','VIEW',
    'LOGIN','LOGOUT','CREATE_TEMPLATE','UPDATE_TEMPLATE','DELETE_TEMPLATE','ARCHIVE_TEMPLATE',
    'CREATE_USER','UPDATE_USER','DELETE_USER'
  ) NOT NULL;

CREATE TABLE IF NOT EXISTS notification_reads (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id           INT NOT NULL,
  notification_key  VARCHAR(80) NOT NULL,   -- e.g. "your_document_approved-123"
  read_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifread_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_notifread_user_key (user_id, notification_key)
) ENGINE=InnoDB;
