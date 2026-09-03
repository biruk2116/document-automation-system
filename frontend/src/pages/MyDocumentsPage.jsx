import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { templateService, documentService } from '../services/templateService';
import { signatureService, deliveryService } from '../services/workflowService';
import { useToast } from '../hooks/useToast';
import TemplateViewer from '../components/templates/TemplateViewer';
import ApproverSelectModal from '../components/common/ApproverSelectModal';
import BulkGenerationPanel from './BulkGenerationPanel';

const MODES = [
  {
    id: 'single',
    title: 'Single Record ID',
    desc: 'Generate one document from a single Record ID.',
  },
  {
    id: 'multiple',
    title: 'Multiple Record IDs',
    desc: 'Paste several Record IDs — comma or newline separated.',
  },
  {
    id: 'bulk',
    title: 'Bulk (.csv) File',
    desc: 'Upload a .csv file of Record IDs to generate in one batch.',
  },
];

/** Small document-style icon, matches the look every template card gets elsewhere (Template Management). */
function DocumentIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 15.5h6M9 8.5h2" />
    </svg>
  );
}

/**
 * "Edit & Resubmit" landing spot — reached from Document Tracking's Edit & Resubmit
 * button or from the public RejectionReviewPage (email link). Handles both:
 *   A) Approver-rejected document (status='draft'): regenerate, skip approver, send
 *      directly to the on-record recipient.
 *   B) Recipient-rejected delivery (status='delivered'): same — regenerate, send
 *      directly to the same recipient. No second approval round in either case.
 */
function ResubmitPanel({ resubmitDoc, onDone, onCancel }) {
  const { showToast } = useToast();
  const [recordId, setRecordId] = useState(resubmitDoc.record_identifier || '');
  const [note, setNote] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState('form'); // 'form' | 'redelivering' | 'done'
  const [deliveryResult, setDeliveryResult] = useState(null);

  const handlePreview = async () => {
    if (!recordId.trim()) {
      showToast('Enter a record ID first.', 'error');
      return;
    }
    setLoadingPreview(true);
    try {
      const res = await documentService.preview({ template_id: resubmitDoc.template_id, record_id: recordId.trim() });
      setPreviewData(res.data);
    } catch (err) {
      showToast(err.message || 'Preview failed.', 'error');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleSubmit = async () => {
    if (!recordId.trim()) {
      showToast('Enter a record ID.', 'error');
      return;
    }
    if (!note.trim()) {
      showToast('Write a short note on what was fixed before resubmitting.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      // Step 1: regenerate PDF (marks it signed directly — no approver step).
      const res = await documentService.resubmit(resubmitDoc.id, {
        record_identifier: recordId.trim(),
        note: note.trim(),
      });
      showToast(res.message || 'Corrected document generated.', 'success');

      // Step 2: send new secure-link+OTP delivery to the original recipient.
      setPhase('redelivering');
      let delivery = null;
      try {
        const newDocId = res.data?.id || res.data?.docId || resubmitDoc.id;
        const delivRes = await deliveryService.resubmitDelivery(newDocId);
        delivery = delivRes.data;
      } catch (delivErr) {
        // Non-fatal: document was regenerated; Generator can use Send from Document
        // Tracking if the automatic delivery fails (e.g. no prior rejected delivery).
        console.warn('[ResubmitPanel] resubmit-delivery failed (non-fatal):', delivErr.message);
      }
      setDeliveryResult(delivery);
      setPhase('done');
    } catch (err) {
      showToast(err.message || 'Failed to resubmit document.', 'error');
      setPhase('form');
    } finally {
      setSubmitting(false);
    }
  };

  // Done screen
  if (phase === 'done') {
    return (
      <div className="my-documents-page">
        <h1>Resubmitted Successfully</h1>
        <div className="send-doc-verify send-doc-verify-ok" style={{ flexDirection: 'column', gap: 10, maxWidth: 560, marginTop: 16 }}>
          <div>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            Corrected document regenerated
          </div>
          {deliveryResult ? (
            <>
              <div>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                Sent directly to <b>{deliveryResult.recipientEmail}</b>
              </div>
              <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: 4 }}>
                The recipient will receive a new secure link and must complete OTP
                verification again before downloading. No approver step was needed.
              </div>
            </>
          ) : (
            <div style={{ fontSize: '0.82rem', color: '#64748B', marginTop: 4 }}>
              Delivery could not be sent automatically — use the <b>Send</b> button in
              Document Tracking to send it to the recipient.
            </div>
          )}
        </div>
        <div className="template-form-actions" style={{ marginTop: 20 }}>
          <button type="button" onClick={onDone} className="btn-primary">Go to Document Tracking</button>
        </div>
      </div>
    );
  }

  return (
    <div className="my-documents-page">
      <h1>Edit &amp; Resubmit</h1>
      <p style={{ color: '#64748B', marginTop: -8 }}>
        Fixing <b>{resubmitDoc.doc_uuid}</b> ({resubmitDoc.template_name}) — the corrected document
        will be sent <b>directly to the recipient</b> once you submit. No approver step required.
      </p>

      {resubmitDoc.rejection_reason && (
        <p className="approver-required-banner" style={{ display: 'block' }}>
          <b>Rejection reason:</b> {resubmitDoc.rejection_reason}
        </p>
      )}

      <div className="template-form" style={{ maxWidth: 560 }}>
        <div className="form-field">
          <label>Template</label>
          <p style={{ margin: '4px 0', fontWeight: 600 }}>{resubmitDoc.template_name}</p>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748B' }}>
            The current (possibly just-fixed) version of the template is used automatically.
            If the template itself was the problem, fix it in Templates first, then resubmit here.
          </p>
        </div>

        <div className="form-field">
          <label htmlFor="resubmit-record-id">Record ID</label>
          <input
            id="resubmit-record-id"
            value={recordId}
            onChange={(e) => { setRecordId(e.target.value); setPreviewData(null); }}
            placeholder="e.g. EMP001"
            autoFocus
            disabled={submitting}
          />
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748B' }}>
            Pre-filled with the original entry — change it if the wrong record was the problem.
          </p>
        </div>

        <div className="form-field">
          <label htmlFor="resubmit-note">What was fixed? (required)</label>
          <textarea
            id="resubmit-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="e.g. Corrected the employee's salary figure in the source record."
            disabled={submitting}
          />
        </div>

        <p style={{ fontSize: '0.82rem', color: '#475569', margin: '0 0 12px' }}>
          Submitting regenerates the document and sends a new secure link + OTP
          directly to the recipient — they must verify their identity again before downloading.
        </p>

        <div className="template-form-actions">
          <button type="button" onClick={handlePreview} disabled={loadingPreview || submitting} className="btn-secondary">
            {loadingPreview ? 'Loading…' : 'Preview'}
          </button>
          <button type="button" onClick={handleSubmit} disabled={submitting || !recordId.trim()} className="btn-primary">
            {phase === 'redelivering' ? 'Sending to recipient…' : submitting ? 'Regenerating…' : 'Regenerate & Send to Recipient'}
          </button>
          <button type="button" onClick={onCancel} disabled={submitting} className="btn-secondary">
            Cancel
          </button>
        </div>
      </div>

      {previewData && (
        <div style={{ marginTop: 24 }}>
          <h2>Preview</h2>
          <TemplateViewer data={previewData} />
        </div>
      )}
    </div>
  );
}

/**
 * Generation-only page: pick a template, then pick exactly ONE way to supply
 * Record ID(s) — Single / Multiple / Bulk .csv — laid out as a horizontal card
 * grid (same look as Template Management). Only the selected mode's input is
 * shown and can hold data; switching modes always starts that mode empty, so
 * a Record ID can never be entered into more than one of the three at once.
 * Every mode follows the same Preview -> Generate flow, then the (mandatory)
 * approver assignment.
 *
 * Also doubles as the "Edit & Resubmit" landing page (see ResubmitPanel above)
 * when arriving from Document Tracking with a rejected document's context in
 * navigation state — that mode replaces this generation UI entirely.
 */
export default function MyDocumentsPage() {
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [resubmitDoc, setResubmitDoc] = useState(location.state?.resubmitDoc || null);

  const [templates, setTemplates] = useState([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [mode, setMode] = useState('single');

  // Single-record mode state.
  const [recordId, setRecordId] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Approver-assignment modal, opened immediately after a successful Generate —
  // a freshly generated document is unusable until an approver is assigned.
  const [approverModalDoc, setApproverModalDoc] = useState(null); // { id, doc_uuid }

  useEffect(() => {
    templateService.getAll({ status: 'active' })
      .then((res) => setTemplates(res.data))
      .catch((err) => showToast(err.message || 'Failed to load templates.', 'error'))
      .finally(() => setTemplatesLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTemplateChange = (id) => {
    setSelectedTemplateId(id);
    setMode('single');
    setRecordId('');
    setPreviewData(null);
  };

  /** Switching modes always starts the newly-chosen mode empty — see file header. */
  const handleModeChange = (nextMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setRecordId('');
    setPreviewData(null);
  };

  const handlePreview = async () => {
    if (!selectedTemplateId || !recordId) {
      showToast('Select a template and enter a record ID.', 'error');
      return;
    }
    setLoadingPreview(true);
    try {
      const res = await documentService.preview({ template_id: selectedTemplateId, record_id: recordId });
      setPreviewData(res.data);
    } catch (err) {
      showToast(err.message || 'Preview failed.', 'error');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedTemplateId || !recordId) return;
    setGenerating(true);
    try {
      const res = await documentService.generate({ template_id: selectedTemplateId, record_id: recordId });
      showToast(res.message || 'Document generated.', 'success');
      // Mandatory next step: pick who approves it. Opens immediately — the document
      // is unusable (can't be approved, rejected, or e-signed) until this happens.
      setApproverModalDoc({ id: res.data.id, doc_uuid: res.data.docUuid });
    } catch (err) {
      showToast(err.message || 'Generation failed.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleAssignApprover = async (approverId) => {
    try {
      const res = await signatureService.initiate(approverModalDoc.id, approverId);
      showToast(res.message || 'Signature request sent — track it from Document Tracking.', 'success');
      setApproverModalDoc(null);
    } catch (err) {
      showToast(err.message || 'Failed to send signature request.', 'error');
    }
  };

  if (resubmitDoc) {
    const clearResubmit = () => {
      setResubmitDoc(null);
      navigate(location.pathname, { replace: true, state: {} });
    };
    return (
      <ResubmitPanel
        resubmitDoc={resubmitDoc}
        onDone={() => navigate('/document-tracking', { replace: true })}
        onCancel={clearResubmit}
      />
    );
  }

  return (
    <div className="my-documents-page">
      <h1>Generate a Document</h1>

      {templatesLoaded && templates.length === 0 && (
        <p className="approver-required-banner" style={{ display: 'block' }}>
          No <strong>Active</strong> templates yet — single and bulk/CSV generation (below) only work
          against a template whose status is Active. Ask an admin to create or activate one in Templates.
        </p>
      )}

      {templates.length > 0 && (
        <div className="template-card-grid doc-template-picker" role="tablist" aria-label="Choose a template">
          {templates.map((t) => {
            const selected = String(selectedTemplateId) === String(t.id);
            return (
              <button
                type="button"
                key={t.id}
                role="tab"
                aria-selected={selected}
                className={`template-card doc-template-card${selected ? ' doc-template-card-selected' : ''}`}
                onClick={() => handleTemplateChange(t.id)}
              >
                <div className="template-card-top">
                  <div className="template-card-icon"><DocumentIcon /></div>
                  <div className="template-card-title-wrap">
                    <h3 className="template-card-name" title={t.name}>{t.name}</h3>
                    <span className="template-card-category">{t.category}</span>
                  </div>
                  {selected && <span className="gen-mode-card-check">✓</span>}
                </div>
                <div className="template-card-meta">
                  <span className="template-card-meta-item"><strong>Version</strong> v{t.version}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedTemplateId && (
        <>
          <div className="gen-mode-grid" role="tablist" aria-label="Record ID input mode">
            {MODES.map((m) => {
              const selected = mode === m.id;
              return (
                <button
                  type="button"
                  key={m.id}
                  role="tab"
                  aria-selected={selected}
                  className={`gen-mode-card${selected ? ' gen-mode-selected' : ''}`}
                  onClick={() => handleModeChange(m.id)}
                >
                  <div className="gen-mode-card-top">
                    <h3 className="gen-mode-card-title">{m.title}</h3>
                    {selected && <span className="gen-mode-card-check">✓</span>}
                  </div>
                  <p className="gen-mode-card-desc">{m.desc}</p>
                </button>
              );
            })}
          </div>

          {mode === 'single' && (
            <div className="template-form" style={{ maxWidth: 560 }}>
              <div className="form-field">
                <label htmlFor="doc-record-id">Record ID</label>
                <input id="doc-record-id" value={recordId} onChange={(e) => setRecordId(e.target.value)} placeholder="e.g. EMP001" autoFocus />
              </div>

              <div className="template-form-actions">
                <button type="button" onClick={handlePreview} disabled={loadingPreview} className="btn-secondary">
                  {loadingPreview ? 'Loading…' : 'Preview'}
                </button>
                <button type="button" onClick={handleGenerate} disabled={generating || !recordId} className="btn-primary">
                  {generating ? 'Generating…' : 'Generate PDF'}
                </button>
              </div>
            </div>
          )}

          {previewData && mode === 'single' && (
            <div style={{ marginTop: 24 }}>
              <h2>Preview</h2>
              <TemplateViewer data={previewData} />
            </div>
          )}

          {(mode === 'multiple' || mode === 'bulk') && (
            <BulkGenerationPanel key={`${selectedTemplateId}-${mode}`} templateId={selectedTemplateId} mode={mode} />
          )}
        </>
      )}

      {approverModalDoc && (
        <ApproverSelectModal
          title="Select an Approver"
          description={`Document ${approverModalDoc.doc_uuid} needs an approver. Choose who should review, OTP-confirm, and e-sign it — only an Approver can approve, reject, or e-sign.`}
          submitLabel="Send Signature Request"
          onSubmit={handleAssignApprover}
          onSkip={() => setApproverModalDoc(null)}
        />
      )}
    </div>
  );
}
