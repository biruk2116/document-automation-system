/**
 * Maps a raw audit_logs row (action + action_details) to the human lifecycle stage
 * shown in the Audit Trail timeline: Created -> Previewed -> Sent for Approval ->
 * Approved/Rejected -> Downloaded -> Delivered -> Verified.
 *
 * `tone` drives the colored timeline dot / status badge for that stage (see
 * AuditTrailTab.jsx, .ar-timeline-dot-<tone> in AuditReports.css) — no icon glyph
 * is needed on top of the color to tell stages apart.
 */
export function describeAuditEvent(log) {
  let details = {};
  try { details = log.action_details ? JSON.parse(log.action_details) : {}; } catch { /* ignore malformed json */ }

  switch (log.action) {
    case 'GENERATE':
      return { stage: 'Created', tone: 'blue' };
    case 'PREVIEW':
      return { stage: 'Previewed', tone: 'slate' };
    case 'SIGN':
      if (details.event === 'approved') return { stage: 'Approved', tone: 'green' };
      if (details.event === 'initiated') return { stage: 'Sent for Approval', tone: 'amber' };
      if (details.event === 'otp_resent') return { stage: 'Approval OTP Resent', tone: 'amber' };
      if (details.event === 'escalation_72h') return { stage: 'Approval Escalated', tone: 'red' };
      if (details.event === 'reminder_24h') return { stage: 'Approval Reminder Sent', tone: 'amber' };
      return { stage: 'Approval Activity', tone: 'amber' };
    case 'REJECT':
      return { stage: 'Rejected', tone: 'red' };
    case 'DOWNLOAD':
      return { stage: 'Downloaded', tone: 'blue' };
    case 'DELIVER':
      return { stage: 'Delivered', tone: 'blue' };
    case 'VERIFY':
      return { stage: 'Verified', tone: details.result === 'authentic' ? 'green' : 'red' };
    case 'VIEW':
      return { stage: 'Viewed', tone: 'slate' };
    case 'DELETE_DOCUMENT':
      return { stage: 'Deleted', tone: 'red' };
    default:
      return { stage: log.action, tone: 'slate' };
  }
}

export const AUDIT_ACTIONS = [
  '', 'PREVIEW', 'GENERATE', 'SIGN', 'REJECT', 'DELIVER', 'VERIFY', 'DOWNLOAD', 'VIEW',
  'LOGIN', 'LOGOUT', 'CREATE_TEMPLATE', 'UPDATE_TEMPLATE', 'DELETE_TEMPLATE', 'ARCHIVE_TEMPLATE',
  'DELETE_DOCUMENT',
];
