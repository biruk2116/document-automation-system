/**
 * Generic confirmation dialog used for the module's destructive/impactful actions
 * (archive-now sweep, CSV export of a large range). Deliberately separate from the
 * app-wide .modal-* classes so Module 7 keeps its own institutional look.
 */
export default function ConfirmDialog({ title, description, confirmLabel = 'Confirm', tone = 'primary', busy, onConfirm, onCancel }) {
  return (
    <div className="ar-modal-overlay" onClick={onCancel}>
      <div className="ar-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ar-modal-header">
          <div className="ar-modal-icon-warn" aria-hidden="true" />
          <h3>{title}</h3>
        </div>
        <div className="ar-modal-body">{description}</div>
        <div className="ar-modal-footer">
          <button type="button" className="ar-btn ar-btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`ar-btn ${tone === 'danger' ? 'ar-btn-navy' : 'ar-btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
