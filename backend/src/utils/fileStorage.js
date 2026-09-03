const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// NFR-002: PDFs stored outside public webroot with randomized filenames component.
const STORAGE_ROOT = path.join(__dirname, '..', '..', 'storage', 'generated-docs');

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  }
}

function sanitizeForFilename(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** FR-018: the human-readable name shown to the user on download — [TemplateName]_[RecordID]_[Date].pdf */
function buildFileName(templateName, recordId, date = new Date()) {
  const dateStr = date.toISOString().slice(0, 10);
  return `${sanitizeForFilename(templateName)}_${sanitizeForFilename(recordId)}_${dateStr}.pdf`;
}

/**
 * NFR-002: the actual on-disk filename — intentionally unrelated to the friendly
 * name above, so a leaked file path can't be guessed from a doc ID or template name.
 * The friendly name only ever appears in the Content-Disposition header at download time.
 */
function buildRandomStorageFileName() {
  return `${crypto.randomBytes(24).toString('hex')}.pdf`;
}

function buildStoragePath(fileName) {
  ensureStorageDir();
  return path.join(STORAGE_ROOT, fileName);
}

module.exports = { buildFileName, buildRandomStorageFileName, buildStoragePath, ensureStorageDir, STORAGE_ROOT };
