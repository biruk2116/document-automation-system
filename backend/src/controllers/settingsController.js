const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { getAppSettings, updateAppSettings } = require('../utils/appSettings');
require('dotenv').config();

const ENV_PATH = path.join(__dirname, '..', '..', '.env');

/** GET /api/settings */
async function getSettings(req, res) {
  return res.status(200).json({ success: true, message: 'Settings fetched.', data: getAppSettings() });
}

/** PUT /api/settings   body: { escalationHours?, archiveYears?, minutesSavedPerDoc? } */
async function putSettings(req, res) {
  const { escalationHours, archiveYears, minutesSavedPerDoc } = req.body;
  const partial = {};
  if (escalationHours !== undefined) partial.escalationHours = Number(escalationHours);
  if (archiveYears !== undefined) partial.archiveYears = Number(archiveYears);
  if (minutesSavedPerDoc !== undefined) partial.minutesSavedPerDoc = Number(minutesSavedPerDoc);

  const updated = updateAppSettings(partial);
  return res.status(200).json({ success: true, message: 'Settings updated.', data: updated });
}

/** GET /api/settings/database — current connection info, password masked */
async function getDbConnectionInfo(req, res) {
  return res.status(200).json({
    success: true,
    message: 'Database connection info fetched.',
    data: {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD ? '••••••••' : '(empty)',
    },
  });
}

/** POST /api/settings/database/test — verify credentials without applying them */
async function testDbConnection(req, res) {
  const { host, port, user, password, database } = req.body;
  if (!host || !user || !database) {
    return res.status(400).json({ success: false, message: 'host, user, and database are required.' });
  }

  let connection;
  try {
    connection = await mysql.createConnection({ host, port: port || 3306, user, password: password || '', database });
    await connection.ping();
    return res.status(200).json({ success: true, message: 'Connection successful.' });
  } catch (err) {
    return res.status(400).json({ success: false, message: `Connection failed: ${err.message}` });
  } finally {
    if (connection) await connection.end();
  }
}

/** PUT /api/settings/database — persists new credentials to .env (requires a server restart to take effect) */
async function updateDbConnection(req, res) {
  const { host, port, user, password, database } = req.body;
  if (!host || !user || !database) {
    return res.status(400).json({ success: false, message: 'host, user, and database are required.' });
  }

  try {
    let envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';

    const setLine = (content, key, value) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const line = `${key}=${value}`;
      return regex.test(content) ? content.replace(regex, line) : `${content}\n${line}`;
    };

    envContent = setLine(envContent, 'DB_HOST', host);
    envContent = setLine(envContent, 'DB_PORT', port || 3306);
    envContent = setLine(envContent, 'DB_USER', user);
    envContent = setLine(envContent, 'DB_PASSWORD', password || '');
    envContent = setLine(envContent, 'DB_NAME', database);

    fs.writeFileSync(ENV_PATH, envContent);

    return res.status(200).json({
      success: true,
      message: 'Database connection saved. Restart the backend server for the change to take effect.',
    });
  } catch (err) {
    console.error('[settings] updateDbConnection error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save database connection.' });
  }
}

module.exports = { getSettings, putSettings, getDbConnectionInfo, testDbConnection, updateDbConnection };
