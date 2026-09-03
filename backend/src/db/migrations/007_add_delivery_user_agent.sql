-- Migration: FR-029 requires the secure download link to log the recipient's IP,
-- browser, and timestamp when they click it. IP + timestamp were already captured
-- (delivery_logs.downloaded_ip / downloaded_at); this adds the missing "browser"
-- piece (the User-Agent header) alongside it. Run this only if your database
-- predates this column — fresh installs from schema.sql already include it.

ALTER TABLE delivery_logs
  ADD COLUMN downloaded_user_agent VARCHAR(500) NULL AFTER downloaded_ip;
