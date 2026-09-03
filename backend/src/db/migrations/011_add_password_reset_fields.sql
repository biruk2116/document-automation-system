-- Migration: self-service "Forgot password" flow. Adds a single-use reset token +
-- expiry to users so a reset link can be verified and invalidated after use, the
-- same way other single-use links in this system (delivery/download tokens) are
-- tracked in their own table. Run this only if your database predates this feature.
-- Fresh installs from schema.sql already include these columns.

ALTER TABLE users
  ADD COLUMN reset_token VARCHAR(255) NULL AFTER password_hash,
  ADD COLUMN reset_token_expires DATETIME NULL AFTER reset_token,
  ADD INDEX idx_users_reset_token (reset_token);
