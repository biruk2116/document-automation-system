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
    // PostgreSQL JSON extraction: use ->> for text, ::jsonb for casting
    const [approverEvents] = await pool.query(
      `SELECT al.id, al.timestamp, al.action, al.action_details, gd.doc_uuid, gd.id AS doc_id,
              gd.file_path, sr.id AS signature_request_id,
              'awaiting_your_signature' AS notification_type
       FROM audit_logs al
       JOIN signature_requests sr
         ON sr.id = CAST((al.action_details->>'signatureRequestId') AS INTEGER)
       JOIN generated_docs gd ON gd.id = sr.doc_id
       WHERE al.action = 'SIGN'
         AND al.action_details->>'event' = 'initiated'
         AND sr.approver_id = $1
         AND sr.status = 'pending'
         AND gd.deleted_at IS NULL
       ORDER BY al.timestamp DESC
       LIMIT 20`,
      [req.user.id]
    );

    // Generator notifications: approvals and rejections
    const [generatorEvents] = await pool.query(
      `SELECT al.id, al.timestamp, al.action, al.action_details, gd.doc_uuid, gd.id AS doc_id,
              gd.file_path, gd.generated_by, NULL AS signature_request_id,
              CASE WHEN al.action = 'REJECT' THEN 'your_document_rejected' ELSE 'your_document_approved' END AS notification_type
       FROM audit_logs al
       JOIN generated_docs gd ON gd.id = al.doc_id
       JOIN users gen ON gen.id = gd.generated_by
       WHERE (al.action = 'REJECT' OR (al.action = 'SIGN' AND al.action_details->>'event' = 'approved'))
         AND gd.deleted_at IS NULL
         AND (
           gd.generated_by = $1
           OR (al.action = 'REJECT' AND $2 IN ('super_admin', 'system_admin') AND gen.role NOT IN ('super_admin', 'system_admin'))
         )
       ORDER BY al.timestamp DESC
       LIMIT 20`,
      [req.user.id, req.user.role]
    );

    // Ownership-rejection notifications for the Generator
    const [ownershipRejectedEvents] = await pool.query(
      `SELECT al.id, al.timestamp, al.action, al.action_details,
              gd.doc_uuid, gd.id AS doc_id, gd.file_path, gd.generated_by,
              NULL AS signature_request_id,
              'ownership_rejected_notify' AS notification_type
       FROM audit_logs al
       JOIN generated_docs gd ON gd.id = al.doc_id
       WHERE al.action = 'OWNERSHIP_REJECT'
         AND al.user_id = $1
         AND gd.deleted_at IS NULL
       ORDER BY al.timestamp DESC
       LIMIT 20`,
      [req.user.id]
    );

    // Ownership-confirmed (OWN button) notifications for the Generator
    const [ownedEvents] = await pool.query(
      `SELECT al.id, al.timestamp, al.action, al.action_details,
              gd.doc_uuid, gd.id AS doc_id, gd.file_path, gd.generated_by,
              NULL AS signature_request_id,
              'delivery_confirmed_notify' AS notification_type
       FROM audit_logs al
       JOIN generated_docs gd ON gd.id = al.doc_id
       WHERE al.action = 'OWNERSHIP_CONFIRM'
         AND al.user_id = $1
         AND gd.deleted_at IS NULL
       ORDER BY al.timestamp DESC
       LIMIT 20`,
      [req.user.id]
    );

    // Recipient response notifications for the Generator
    const [responseEvents] = await pool.query(
      `SELECT al.id, al.timestamp, al.action, al.action_details,
              gd.doc_uuid, gd.id AS doc_id, gd.file_path, gd.generated_by,
              NULL AS signature_request_id,
              'recipient_response_notify' AS notification_type
       FROM audit_logs al
       JOIN generated_docs gd ON gd.id = al.doc_id
       WHERE al.action = 'WORKFLOW_RESPONSE'
         AND gd.generated_by = $1
         AND gd.deleted_at IS NULL
       ORDER BY al.timestamp DESC
       LIMIT 20`,
      [req.user.id]
    );

    // Recipient signed notifications for the Generator
    const [recipientSignedEvents] = await pool.query(
      `SELECT al.id, al.timestamp, al.action, al.action_details,
              gd.doc_uuid, gd.id AS doc_id, gd.file_path, gd.generated_by,
              NULL AS signature_request_id,
              'recipient_signed_notify' AS notification_type
       FROM audit_logs al
       JOIN generated_docs gd ON gd.id = al.doc_id
       WHERE (al.action = 'RECIPIENT_SIGN' OR (al.action = 'SIGN' AND al.action_details->>'event' = 'workflow_signature_embedded'))
         AND gd.generated_by = $1
         AND gd.deleted_at IS NULL
       ORDER BY al.timestamp DESC
       LIMIT 20`,
      [req.user.id]
    );

    // Delivered document notifications for the Recipient
    let recipientDeliveryEvents = [];
    if (req.user.email) {
      const [delEvents] = await pool.query(
        `SELECT al.id, al.timestamp, al.action, al.action_details,
                gd.doc_uuid, gd.id AS doc_id, gd.file_path, gd.generated_by,
                NULL AS signature_request_id,
                'document_delivered_notify' AS notification_type
         FROM audit_logs al
         JOIN generated_docs gd ON gd.id = al.doc_id
         WHERE al.action = 'SECURE_DELIVER'
           AND (
             LOWER(gd.recipient_email) = LOWER($1)
             OR LOWER(CAST(al.action_details->>'recipientEmail' AS TEXT)) = LOWER($1)
           )
           AND gd.deleted_at IS NULL
         ORDER BY al.timestamp DESC
         LIMIT 20`,
        [req.user.email]
      );
      recipientDeliveryEvents = delEvents || [];
    }

    // Delivery initiated notifications for the Generator
    const [deliveryInitiatedEvents] = await pool.query(
      `SELECT al.id, al.timestamp, al.action, al.action_details,
              gd.doc_uuid, gd.id AS doc_id, gd.file_path, gd.generated_by,
              NULL AS signature_request_id,
              'delivery_initiated_notify' AS notification_type
       FROM audit_logs al
       JOIN generated_docs gd ON gd.id = al.doc_id
       WHERE al.action = 'SECURE_DELIVER'
         AND gd.generated_by = $1
         AND al.action_details->>'event' = 'delivery_initiated_notify'
         AND gd.deleted_at IS NULL
       ORDER BY al.timestamp DESC
       LIMIT 20`,
      [req.user.id]
    );

    // Password reset request / completion system notifications for the user
    const [passwordEvents] = await pool.query(
      `SELECT al.id, al.timestamp, al.action, al.action_details,
              NULL AS doc_uuid, NULL AS doc_id, NULL AS file_path, NULL AS generated_by,
              NULL AS signature_request_id,
              CASE WHEN al.action = 'PASSWORD_RESET_REQUEST' THEN 'password_reset_requested_notify' ELSE 'password_reset_completed_notify' END AS notification_type
       FROM audit_logs al
       WHERE al.action IN ('PASSWORD_RESET_REQUEST', 'PASSWORD_RESET_COMPLETE')
         AND al.user_id = $1
       ORDER BY al.timestamp DESC
       LIMIT 10`,
      [req.user.id]
    );

    // Drop notifications whose underlying document file no longer exists on disk
    // (deleted document, moved/removed from storage, etc.) — system notifications
    // without a file_path are kept.
    const combined = [
      ...approverEvents,
      ...generatorEvents,
      ...ownershipRejectedEvents,
      ...ownedEvents,
      ...responseEvents,
      ...recipientSignedEvents,
      ...recipientDeliveryEvents,
      ...deliveryInitiatedEvents,
      ...passwordEvents,
    ]
      .filter((n) => !n.file_path || fs.existsSync(n.file_path))
      .map(({ file_path, ...rest }) => rest) // never leak the on-disk path to the client
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 20);

    // Attach "seen" state: notification_reads is keyed by `${notification_type}-${id}`,
    // the same key the bell dropdown already uses as its React list key — a document
    // is only marked read once the user actually opens it in the in-app viewer
    // (see markNotificationRead), so the badge count only drops for things really seen.
    // Defensive: ensureSchema() (server.js, on boot) creates this table automatically,
    // Defensive: ensureSchema() (server.js, on boot) creates this table automatically,
    // but if it's still missing for any reason (e.g. a DB user without CREATE rights),
    // fall back to "nothing read yet" instead of 500ing the whole notifications feed.
    let readKeys = new Set();
    try {
      const [readRows] = await pool.query(
        'SELECT notification_key FROM notification_reads WHERE user_id = $1',
        [req.user.id]
      );
      readKeys = new Set(readRows.map((r) => r.notification_key));
    } catch (readErr) {
      if (readErr.code !== '42P01') throw readErr; // PostgreSQL: undefined_table
      console.warn('[notifications] notification_reads table missing — restart the server to auto-create it, or run migrations.');
    }

    const withReadState = combined.map((n) => ({
      ...n,
      is_read: readKeys.has(`${n.notification_type}-${n.id}`),
    }));

    console.log(`[notifications] Fetched ${withReadState.length} notifications for user ${req.user.id}`);

    return res.status(200).json({ success: true, message: 'Notifications fetched.', data: withReadState });
  } catch (err) {
    console.error('[notifications] fetch error:', err);
    console.error('[notifications] error stack:', err.stack);
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
    // PostgreSQL: Use ON CONFLICT DO NOTHING instead of INSERT IGNORE
    await pool.query(
      'INSERT INTO notification_reads (user_id, notification_key) VALUES ($1, $2) ON CONFLICT (user_id, notification_key) DO NOTHING',
      [req.user.id, notificationKey]
    );
    
    console.log(`[notifications] Marked as read: ${notificationKey} for user ${req.user.id}`);
    
    return res.status(200).json({ success: true, message: 'Notification marked as read.' });
  } catch (err) {
    if (err.code === '42P01') { // PostgreSQL: undefined_table
      console.warn('[notifications] notification_reads table missing — mark-as-read skipped.');
      return res.status(200).json({ success: true, message: 'Notification marked as read (not persisted — table missing).' });
    }
    console.error('[notifications] markRead error:', err);
    console.error('[notifications] error stack:', err.stack);
    return res.status(500).json({ success: false, message: 'Failed to mark notification as read.' });
  }
}

module.exports = { getNotifications, markNotificationRead };
