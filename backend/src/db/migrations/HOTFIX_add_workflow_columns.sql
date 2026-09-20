-- HOTFIX: Add missing workflow columns to document_deliveries
-- This should be run immediately on production database

-- Add workflow step tracking columns
ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_acknowledged_at TIMESTAMP;
ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_signed_at TIMESTAMP;
ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS workflow_responded_at TIMESTAMP;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_dd_workflow_ack ON document_deliveries(workflow_acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_dd_workflow_signed ON document_deliveries(workflow_signed_at);
CREATE INDEX IF NOT EXISTS idx_dd_workflow_responded ON document_deliveries(workflow_responded_at);

-- Verify columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'document_deliveries' 
  AND column_name LIKE 'workflow%'
ORDER BY column_name;
