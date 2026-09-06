-- Migration 021: Add soft delete support for templates
-- This allows templates to be "deleted" even when documents reference them,
-- preserving referential integrity while hiding them from the UI.

ALTER TABLE templates 
ADD COLUMN deleted_at DATETIME NULL AFTER updated_at;

-- Index for filtering deleted templates efficiently
CREATE INDEX idx_templates_deleted_at ON templates(deleted_at);
