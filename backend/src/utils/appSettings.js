const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'appSettings.json');

const DEFAULTS = {
  escalationHours: 72,       // FR-027 (informational here — BR-004/FR-027 fix the business rule; admins can tune the reminder cadence)
  archiveYears: 2,           // FR-040
  minutesSavedPerDoc: 15,    // used in FR-038 monthly report estimate
};

function ensureConfigFile() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2));
  }
}

function getAppSettings() {
  ensureConfigFile();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function updateAppSettings(partial) {
  const current = getAppSettings();
  const next = { ...current, ...partial };
  ensureConfigFile();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

module.exports = { getAppSettings, updateAppSettings, DEFAULTS };
