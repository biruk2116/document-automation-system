const { pool } = require('../config/db');

/**
 * Writes an immutable audit log row (FR-036).
 * Never throws — a logging failure must not break the calling request.
 */
async function recordAudit({ userId = null, docId = null, action, details = null, req = null }) {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null) : null;
    const userAgent = req ? req.headers['user-agent'] || null : null;

    await pool.query(
      `INSERT INTO audit_logs (user_id, doc_id, action, action_details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, docId, action, details ? JSON.stringify(details) : null, ip, userAgent]
    );
  } catch (err) {
    console.error('[audit] Failed to write audit log:', err.message);
  }
}

module.exports = { recordAudit };
