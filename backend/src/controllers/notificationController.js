const fs = require('fs');
const { pool } = require('../config/db');

/**
 * GET /api/notifications
 * FR-022 required "in-app notification" alongside email — this derives a feed
 * from the existing audit_logs table rather than adding a new notifications
 * table, since the audit trail already captures every event we need to surface.
 *
 * Returns:
 *  - as an approver: documents awaiting your signature
 *  - as a generator: your documents that were approved/rejected
 */
async function getNotifications(req, res) {
  try {
    const [approverEvents] = await pool.query(
      `SELECT al.id, al.timestamp, al.action, al.action_details, gd.doc_uuid, gd.id AS doc_id,
              gd.file_path, sr.id AS signature_request_id,
              'awaiting_your_signature' AS notification_type
       FROM audit_logs al
       JOIN signature_requests sr
         ON sr.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(al.action_details, '$.signatureRequestId')) AS UNSIGNED)
       JOIN generated_docs gd ON gd.id = sr.doc_id
       WHERE al.action = 'SIGN'
         AND JSON_UNQUOTE(JSON_EXTRACT(al.action_details, '$.event')) = 'initiated'
         AND sr.approver_id = ?
         AND sr.status = 'pending'
         AND gd.deleted_at IS NULL
       ORDER BY al.timestamp DESC
       LIMIT 20`,
      [req.user.id]
    );

    // "your_document_rejected"/"your_document_approved" notifications:
    //  - approvals are only ever shown to the actual generator of that doc.
    //  - rejections are shown to the generator AND to both Admins (super_admin +
    //    system_admin — so admins have visibility into every rejected document)
    //    UNLESS the generator themselves IS an admin, in which case only that one
    //    admin sees it (their own gd.generated_by = ? match below already covers
    //    them, so the "broadcast to all admins" clause is skipped to avoid a
    //    duplicate/extra notification going to the other admin for a doc they
    //    didn't generate).
    const [generatorEvents] = await pool.query(
      `SELECT al.id, al.timestamp, al.action, al.action_details, gd.doc_uuid, gd.id AS doc_id,
              gd.file_path, gd.generated_by, NULL AS signature_request_id,
              CASE WHEN al.action = 'REJECT' THEN 'your_document_rejected' ELSE 'your_document_approved' END AS notification_type
       FROM audit_logs al
       JOIN generated_docs gd ON gd.id = al.doc_id
       JOIN users gen ON gen.id = gd.generated_by
       WHERE (al.action = 'REJECT' OR (al.action = 'SIGN' AND JSON_UNQUOTE(JSON_EXTRACT(al.action_details, '$.event')) = 'approved'))
         AND gd.deleted_at IS NULL
         AND (
           gd.generated_by = ?
           OR (al.action = 'REJECT' AND ? IN ('super_admin', 'system_admin') AND gen.role NOT IN ('super_admin', 'system_admin'))
         )
       ORDER BY al.timestamp DESC
       LIMIT 20`,
      [req.user.id, req.user.role]
    );

    // Ownership-rejection notifications for the Generator: surfaced when a
    // recipient clicks "No, it's not mine" on the secure delivery page. Written
    // as OWNERSHIP_REJECTED_NOTIFY audit rows keyed to the Generator's user_id
    // (see secureDeliveryController.confirmOwnership task 3). Shown to the
    // Generator only — not broadcast to admins (unlike REJECT above).
    const [ownershipRejectedEvents] = await pool.query(
      `SELECT al.id, al.timestamp, al.action, al.action_details,
              gd.doc_uuid, gd.id AS doc_id, gd.file_path, gd.generated_by,
              NULL AS signature_request_id,
              'ownership_rejected_notify' AS notification_type
       FROM audit_logs al
       JOIN generated_docs gd ON gd.id = al.doc_id
       WHERE al.action = 'OWNERSHIP_REJECTED_NOTIFY'
         AND al.user_id = ?
         AND gd.deleted_at IS NULL
       ORDER BY al.timestamp DESC
       LIMIT 20`,
      [req.user.id]
    );

    // Ownership-confirmed (OWN button) notifications for the Generator.
    // Written as DELIVERY_OWNED_NOTIFY audit rows keyed to the Generator's user_id.
    const [ownedEvents] = await pool.query(
      `SELECT al.id, al.timestamp, al.action, al.action_details,
              gd.doc_uuid, gd.id AS doc_id, gd.file_path, gd.generated_by,
              NULL AS signature_request_id,
              'delivery_confirmed_notify' AS notification_type
       FROM audit_logs al
       JOIN generated_docs gd ON gd.id = al.doc_id
       WHERE al.action = 'DELIVERY_OWNED_NOTIFY'
         AND al.user_id = ?
         AND gd.deleted_at IS NULL
       ORDER BY al.timestamp DESC
       LIMIT 20`,
      [req.user.id]
    );

    // Drop notifications whose underlying document file no longer exists on disk
    // (deleted document, moved/removed from storage, etc.) — there's nothing left
    // to view for these, so they shouldn't sit in the bell as dead links. Same
    // on-disk check the approvals list and the /view endpoint already apply.
    const combined = [...approverEvents, ...generatorEvents, ...ownershipRejectedEvents, ...ownedEvents]
      .filter((n) => n.file_path && fs.existsSync(n.file_path))
      .map(({ file_path, ...rest }) => rest) // never leak the on-disk path to the client
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 20);

    // Attach "seen" state: notification_reads is keyed by `${notification_type}-${id}`,
    // the same key the bell dropdown already uses as its React list key — a document
    // is only marked read once the user actually opens it in the in-app viewer
    // (see markNotificationRead), so the badge count only drops for things really seen.
    // Defensive: ensureSchema() (server.js, on boot) creates this table automatically,
    // but if it's still missing for any reason (e.g. a DB user without CREATE rights),
    // fall back to "nothing read yet" instead of 500ing the whole notifications feed.
    let readKeys = new Set();
    try {
      const [readRows] = await pool.query(
        'SELECT notification_key FROM notification_reads WHERE user_id = ?',
        [req.user.id]
      );
      readKeys = new Set(readRows.map((r) => r.notification_key));
    } catch (readErr) {
      if (readErr.code !== 'ER_NO_SUCH_TABLE') throw readErr;
      console.warn('[notifications] notification_reads table missing — restart the server to auto-create it, or run migrations/005_add_delete_user_audit_action.sql manually.');
    }

    const withReadState = combined.map((n) => ({
      ...n,
      is_read: readKeys.has(`${n.notification_type}-${n.id}`),
    }));

    return res.status(200).json({ success: true, message: 'Notifications fetched.', data: withReadState });
  } catch (err) {
    console.error('[notifications] fetch error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch notifications.' });
  }
}

/**
 * POST /api/notifications/:type/:id/read
 * Marks one notification as seen (idempotent) so the unread bell badge count
 * drops by exactly one the next time notifications are fetched — fired when the
 * user opens that notification's document in the in-app viewer, not just on hover.
 */
async function markNotificationRead(req, res) {
  const { type, id } = req.params;
  const notificationKey = `${type}-${id}`;

  try {
    await pool.query(
      'INSERT IGNORE INTO notification_reads (user_id, notification_key) VALUES (?, ?)',
      [req.user.id, notificationKey]
    );
    return res.status(200).json({ success: true, message: 'Notification marked as read.' });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      // Table missing (see comment in getNotifications) — treat as a harmless no-op
      // rather than failing the click; the badge just won't persist across reloads
      // until the server restarts (which auto-creates the table) or the migration runs.
      console.warn('[notifications] notification_reads table missing — mark-as-read skipped.');
      return res.status(200).json({ success: true, message: 'Notification marked as read (not persisted — table missing).' });
    }
    console.error('[notifications] markRead error:', err);
    return res.status(500).json({ success: false, message: 'Failed to mark notification as read.' });
  }
}

module.exports = { getNotifications, markNotificationRead };
