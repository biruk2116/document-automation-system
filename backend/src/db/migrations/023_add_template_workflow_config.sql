-- Migration 023: Add workflow_config to templates for dynamic recipient workflows
--
-- Adds:
--   templates.workflow_config (JSON) — stores the recipient workflow configuration:
--     {
--       "enabled": true/false,
--       "steps": [
--         {
--           "type": "acknowledge",
--           "order": 1,
--           "required": true,
--           "label": "Please acknowledge receipt"
--         },
--         {
--           "type": "sign",
--           "order": 2,
--           "required": true,
--           "label": "Sign the document",
--           "signatureField": "recipient_signature"
--         },
--         {
--           "type": "respond",
--           "order": 3,
--           "required": false,
--           "label": "Add your comments"
--         }
--       ]
--     }
--
--   When workflow_config.enabled = true, the recipient must complete the configured
--   steps in order after OTP verification. The signature is embedded into the PDF
--   at the specified signatureField location if configured.
--
--   When workflow_config.enabled = false or NULL, the recipient only confirms
--   ownership (the original flow).

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS workflow_config JSON NULL
    COMMENT 'Recipient workflow configuration: steps (acknowledge/sign/respond), order, labels, signature fields'
    AFTER data_source_connection_id;

ALTER TABLE templates
  ADD INDEX IF NOT EXISTS idx_templates_workflow_enabled 
    ((CAST(workflow_config->>'$.enabled' AS UNSIGNED)));

-- Add workflow step tracking columns to document_deliveries
ALTER TABLE document_deliveries
  ADD COLUMN IF NOT EXISTS workflow_acknowledged_at DATETIME NULL
    COMMENT 'Timestamp when recipient acknowledged receipt'
    AFTER otp_verified_at,
  ADD COLUMN IF NOT EXISTS workflow_signed_at DATETIME NULL
    COMMENT 'Timestamp when recipient signed the document'
    AFTER workflow_acknowledged_at,
  ADD COLUMN IF NOT EXISTS workflow_responded_at DATETIME NULL
    COMMENT 'Timestamp when recipient provided response'
    AFTER workflow_signed_at,
  ADD COLUMN IF NOT EXISTS workflow_response TEXT NULL
    COMMENT 'Recipient response text/comments'
    AFTER workflow_responded_at;

-- Add indexes for workflow tracking
ALTER TABLE document_deliveries
  ADD INDEX IF NOT EXISTS idx_dd_workflow_ack (workflow_acknowledged_at),
  ADD INDEX IF NOT EXISTS idx_dd_workflow_signed (workflow_signed_at),
  ADD INDEX IF NOT EXISTS idx_dd_workflow_responded (workflow_responded_at);
