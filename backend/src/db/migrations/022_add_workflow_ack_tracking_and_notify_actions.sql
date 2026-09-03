-- Migration 022: Acknowledgement workflow tracking + consolidated notification
--
-- Adds:
--   1. document_deliveries.workflow_tracking_token_hash/expiry/used_at
--      — already added in db.js self-heal (migration 022 block) for workflowSign.
--      This migration file documents the same columns for completeness.
--      All ADD COLUMN IF NOT EXISTS so running it twice is safe.
--   2. document_deliveries.workflow_completed_at — same.
--   3. document_deliveries.workflow_signature_data — same.
--   4. document_deliveries.workflow_signature_embedded_at — migration 021.
--   5. NEW: document_deliveries.workflow_notify_sent_at
--      — stamped (atomic WHERE ... IS NULL) the instant the ONE consolidated
--      "workflow complete" email is sent to the Generator. Acts as the global
--      idempotency lock: regardless of which step (acknowledge / sign / respond)
--      triggers the notification, only the first one can ever stamp this column,
--      so exactly one email is sent per workflow submission.
--
--   6. NEW: audit_logs.action values added:
--        WORKFLOW_COMPLETE_NOTIFY  — the Generator-facing event written when the
--                                    consolidated email is sent.
--        DELIVERY_OWNED_NOTIFY     — the Generator-facing event written when the
--                                    OWN button fires the dual notification.
--        ACKNOWLEDGE_NOTIFY        — written when the acknowledgement step
--                                    triggers the consolidated email.
--
-- Applied automatically on boot by config/db.js ensureSchema() (see migration 022
-- block). Running this file by hand is only needed if that self-heal is disabled.

-- Tracking token columns (idempotent — same as db.js self-heal)
ALTER TABLE document_deliveries
  ADD COLUMN IF NOT EXISTS workflow_tracking_token_hash   CHAR(64)  NULL AFTER workflow_response,
  ADD COLUMN IF NOT EXISTS workflow_tracking_token_expiry  DATETIME  NULL AFTER workflow_tracking_token_hash,
  ADD COLUMN IF NOT EXISTS workflow_tracking_token_used_at DATETIME  NULL AFTER workflow_tracking_token_expiry,
  ADD COLUMN IF NOT EXISTS workflow_completed_at           DATETIME  NULL AFTER workflow_tracking_token_used_at,
  ADD COLUMN IF NOT EXISTS workflow_signature_data         MEDIUMTEXT NULL AFTER workflow_completed_at,
  ADD COLUMN IF NOT EXISTS workflow_signature_embedded_at  DATETIME  NULL AFTER workflow_signature_data;

-- NEW: global idempotency lock for the consolidated Generator notification email.
-- NULL = not yet sent. NOT NULL = already sent (timestamp of first send).
-- workflowAcknowledge / workflowSign / workflowRespond all race to stamp this with
-- an atomic WHERE workflow_notify_sent_at IS NULL UPDATE; only one can win.
ALTER TABLE document_deliveries
  ADD COLUMN IF NOT EXISTS workflow_notify_sent_at DATETIME NULL
    COMMENT 'Stamped atomically when the ONE consolidated Generator notification email is sent. Prevents duplicate emails regardless of which workflow step triggers it.'
    AFTER workflow_signature_embedded_at;

-- Indexes
ALTER TABLE document_deliveries
  ADD INDEX IF NOT EXISTS idx_dd_wf_track_token   (workflow_tracking_token_hash),
  ADD INDEX IF NOT EXISTS idx_dd_wf_completed_at  (workflow_completed_at),
  ADD INDEX IF NOT EXISTS idx_dd_wf_notify_sent   (workflow_notify_sent_at);

-- Extend audit_logs.action enum with all notification events used by the
-- workflow module.  This MODIFY replaces the entire ENUM — all existing values
-- are preserved, new ones added.  Idempotent (MySQL silently re-applies if
-- the values already exist).
ALTER TABLE audit_logs
  MODIFY COLUMN action ENUM(
    'PREVIEW','GENERATE','SIGN','REJECT','DELIVER','VERIFY','DOWNLOAD','VIEW',
    'LOGIN','LOGOUT','CREATE_TEMPLATE','UPDATE_TEMPLATE',
    'DELETE_TEMPLATE','ARCHIVE_TEMPLATE','CREATE_USER','UPDATE_USER',
    'DELETE_USER','PASSWORD_RESET_REQUEST','PASSWORD_RESET_COMPLETE',
    'DELETE_DOCUMENT',
    'SECURE_DELIVER','OTP_VERIFY','OWNERSHIP_CONFIRM','OWNERSHIP_REJECT',
    'OWNERSHIP_REJECTED_NOTIFY',
    'REVOKE_DOCUMENT',
    'DELIVERY_OWNED_NOTIFY',
    'WORKFLOW_COMPLETE_NOTIFY',
    'ACKNOWLEDGE_NOTIFY'
  ) NOT NULL;
