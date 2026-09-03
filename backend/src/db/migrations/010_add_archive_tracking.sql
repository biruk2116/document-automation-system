-- Migration: FR-040 archive tracking. Adds explicit archive lifecycle columns to
-- generated_docs so Module 7 (Archive Management) can show which documents are
-- approaching/over the 2-year retention window, when they were moved, and where
-- their file now lives — without having to infer any of that from file_path alone.
-- Run this only if your database predates the Audit & Reports module. Fresh installs
-- from schema.sql already include these columns.

ALTER TABLE generated_docs
  ADD COLUMN archive_status ENUM('active','archived') NOT NULL DEFAULT 'active' AFTER status,
  ADD COLUMN archived_at DATETIME NULL AFTER archive_status,
  ADD INDEX idx_docs_archive_status (archive_status);
