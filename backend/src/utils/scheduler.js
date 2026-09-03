/**
 * Lightweight in-process scheduler using setInterval.
 * For production, prefer `node-cron` for precise cron expressions and
 * a proper job runner (e.g. Bull) if this needs to survive across multiple
 * server instances — see bulkJobTracker.js for the same caveat.
 */
const { checkEscalations, checkReminders } = require('../controllers/signatureController');
const { archiveOldDocuments } = require('../controllers/auditController');

const REMINDER_CHECK_INTERVAL_MS = 60 * 60 * 1000;    // hourly (24h reminders)
const ESCALATION_CHECK_INTERVAL_MS = 60 * 60 * 1000;  // hourly (72h escalations)
const ARCHIVE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

function startScheduler() {
  console.log('[scheduler] Starting background jobs (reminder/escalation checks hourly, archival daily).');

  setInterval(() => {
    checkReminders().catch((err) => console.error('[scheduler] reminder job crashed:', err));
  }, REMINDER_CHECK_INTERVAL_MS);

  setInterval(() => {
    checkEscalations().catch((err) => console.error('[scheduler] escalation job crashed:', err));
  }, ESCALATION_CHECK_INTERVAL_MS);

  setInterval(() => {
    archiveOldDocuments().catch((err) => console.error('[scheduler] archive job crashed:', err));
  }, ARCHIVE_CHECK_INTERVAL_MS);
}

module.exports = { startScheduler };
