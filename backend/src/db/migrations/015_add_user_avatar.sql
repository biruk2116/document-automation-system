-- Adds users.avatar_url — powers the sidebar user-menu profile photo (self-service
-- upload via POST /api/users/me/avatar).
-- Also applied automatically on boot by config/db.js's ensureSchema() self-heal, so
-- running this by hand is only needed if that self-heal is ever disabled.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500) NULL AFTER phone;
