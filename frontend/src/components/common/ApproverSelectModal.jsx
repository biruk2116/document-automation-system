import { useEffect, useState } from 'react';
import { userService } from '../../services/userService';
import { useToast } from '../../hooks/useToast';

/**
 * FR-021 + explicit requirement: right after a document (or a bulk batch) is generated,
 * the Generator MUST select an Approver — without one, the document can never be
 * approved, rejected, or e-signed (FR-020..FR-027 all key off signature_requests, which
 * only exist once an Approver is chosen).
 *
 * This is presented as a required step, not a buried optional field: it opens
 * automatically right after generation and pulls real Approver accounts from the
 * server (role = approver) rather than asking the Generator to type a raw user ID.
 * "Later" is still offered (the Generator may want to double-check the PDF first),
 * but it's explicit and the caller is expected to keep showing a reminder until an
 * approver is actually assigned.
 *
 * @param title       Modal heading.
 * @param description One or two lines of context (e.g. which doc / how many docs).
 * @param submitLabel Label for the confirm button.
 * @param onSubmit    async (approverId) => void — called on confirm.
 * @param onSkip      () => void — called when the Generator explicitly defers.
 */
export default function ApproverSelectModal({ title, description, submitLabel, onSubmit, onSkip }) {
  const { showToast } = useToast();
  const [approvers, setApprovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approverId, setApproverId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    userService.listApprovers()
      .then((res) => { if (!cancelled) setApprovers(res.data || []); })
      .catch((err) => { if (!cancelled) showToast(err.message || 'Failed to load approvers.', 'error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async () => {
    if (!approverId) {
      showToast('Select an approver first.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(approverId);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
        </div>
        <div className="modal-body">
          <p>{description}</p>

          {loading ? (
            <p>Loading approvers…</p>
          ) : approvers.length === 0 ? (
            <p className="modal-error">No active Approver accounts exist yet. Ask a Super Admin to create one in User Management before this document can be signed.</p>
          ) : (
            <div className="form-field">
              <label htmlFor="approver-select">Approver (required — only they can approve, reject, or e-sign this document)</label>
              <select id="approver-select" value={approverId} onChange={(e) => setApproverId(e.target.value)}>
                <option value="">— select an approver —</option>
                {approvers.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            </div>
          )}

          <div className="template-form-actions" style={{ marginTop: 16 }}>
            <button type="button" onClick={onSkip} className="btn-secondary">I'll do this later</button>
            <button type="button" onClick={handleSubmit} disabled={submitting || loading || approvers.length === 0} className="btn-primary">
              {submitting ? 'Sending…' : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
