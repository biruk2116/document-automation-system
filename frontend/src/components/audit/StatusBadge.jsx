/**
 * Consistent status -> color mapping across every tab of Module 7, per the
 * institutional palette: green (approved/success), amber (pending/warning),
 * red (rejected/error), blue (informational), slate (neutral/archived).
 */
const STATUS_MAP = {
  // document lifecycle
  draft: { tone: 'slate', label: 'Draft' },
  pending: { tone: 'amber', label: 'Pending Approval' },
  signed: { tone: 'green', label: 'Approved' },
  approved: { tone: 'green', label: 'Approved' },
  rejected: { tone: 'red', label: 'Rejected' },
  delivered: { tone: 'blue', label: 'Delivered' },
  // audit trail stages
  created: { tone: 'blue', label: 'Created' },
  previewed: { tone: 'slate', label: 'Previewed' },
  sent_for_approval: { tone: 'amber', label: 'Sent for Approval' },
  downloaded: { tone: 'blue', label: 'Downloaded' },
  verified: { tone: 'green', label: 'Verified' },
  // archive
  active: { tone: 'blue', label: 'Active' },
  approaching: { tone: 'amber', label: 'Approaching Retention' },
  overdue: { tone: 'red', label: 'Overdue for Archive' },
  archived: { tone: 'slate', label: 'Archived' },
  indexed: { tone: 'green', label: 'Indexed' },
};

export default function StatusBadge({ status, label }) {
  const key = String(status || '').toLowerCase().replace(/\s+/g, '_');
  const entry = STATUS_MAP[key] || { tone: 'slate', label: label || status || 'Unknown' };
  return (
    <span className={`ar-badge ar-badge-${entry.tone}`}>
      <span className="ar-badge-dot" />
      {label || entry.label}
    </span>
  );
}
