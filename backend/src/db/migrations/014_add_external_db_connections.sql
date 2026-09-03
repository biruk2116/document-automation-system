-- Adds commercial-tier external database connections (MySQL / MongoDB / PostgreSQL /
-- SQLite) as a data source option for templates, without touching this app's own
-- DB_* connection.
-- Also applied automatically on boot by config/db.js's ensureSchema() self-heal, so
-- running this by hand is only needed if that self-heal is ever disabled.

CREATE TABLE IF NOT EXISTS external_db_connections (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(150) NOT NULL UNIQUE,
  db_type         ENUM('mysql','mongodb','postgresql','sqlite') NOT NULL,
  host            VARCHAR(255) NULL,
  port            INT NULL,
  db_user         VARCHAR(150) NULL,
  db_password_encrypted TEXT NULL,
  database_name   VARCHAR(500) NULL,
  ssl_enabled     TINYINT(1) NOT NULL DEFAULT 0,
  status          ENUM('untested','connected','failed') NOT NULL DEFAULT 'untested',
  last_tested_at  DATETIME NULL,
  created_by      INT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_extdb_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

ALTER TABLE templates
  ADD COLUMN data_source_connection_id INT NULL AFTER data_source_table,
  ADD CONSTRAINT fk_templates_ext_connection FOREIGN KEY (data_source_connection_id)
    REFERENCES external_db_connections(id) ON DELETE SET NULL;
