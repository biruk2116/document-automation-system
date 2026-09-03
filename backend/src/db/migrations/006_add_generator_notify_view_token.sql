-- Migration: mirrors 004_add_signature_view_token.sql but for the Generator side.
-- When a document is signed or rejected, the Generator's email notification now
-- carries the same kind of secure, one-time "review in browser, no login required"
-- link the Approver already gets (FR-022 pattern). This column tracks whether that
-- link has been opened yet, so it can be invalidated after first use. Run this only
-- if your database predates this feature — fresh installs from schema.sql already
-- include this column.

ALTER TABLE generated_docs
  ADD COLUMN notify_view_token_used_at DATETIME NULL AFTER metadata;
