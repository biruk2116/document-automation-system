/**
 * App-wide confirmation modal, used in place of the native window.confirm()
 * for destructive actions (delete template, delete user, etc). Native browser
 * confirm dialogs are unstyled and inconsistent across browsers/devices, so
 * this renders using the same .modal-* classes as the rest of the app.
 *
 * @param title        Short heading, e.g. "Delete template?"
 * @param message      Body text/description of what will happen.
 * @param itemName     Optional name of the item being acted on, shown emphasized.
 * @param confirmLabel Label for the confirm button (default "Delete").
 * @param cancelLabel  Label for the cancel button (default "Cancel").
 * @param tone         "danger" (red) or "primary" (green) — controls confirm button color.
 * @param busy         Disables buttons and shows a working state while a request is in flight.
 * @param onConfirm    () => void
 * @param onCancel     () => void
 */
export default function ConfirmModal({
  title = 'Are you sure?',
  message,
  itemName,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="confirm-modal-panel" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <div className={`confirm-modal-icon${tone === 'danger' ? '' : ' confirm-modal-icon-neutral'}`} aria-hidden="true" />
        <h3 id="confirm-modal-title" className="confirm-modal-title">{title}</h3>
        <p className="confirm-modal-message">
          {message || (itemName ? <>Delete <strong>"{itemName}"</strong>?</> : 'Delete this item?')}
        </p>
        <p className="confirm-modal-subtext">This action cannot be undone.</p>
        <div className="confirm-modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
