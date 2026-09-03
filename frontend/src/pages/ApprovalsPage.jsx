import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { signatureService } from '../services/workflowService';
import { documentService } from '../services/templateService';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ROLES } from '../utils/roles';
import RejectRecipientsPicker from '../components/common/RejectRecipientsPicker';
import '../pages/DocumentTracking.css';

const DATE_FILTER_OPTIONS = [
  { value: '', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

function withinDateFilter(req, dateFilter) {
  if (!dateFilter) return true;
  const created = new Date(req.created_at).getTime();
  const now = Date.now();
  const days = dateFilter === 'today' ? 1 : dateFilter === '7d' ? 7 : 30;
  const cutoff = dateFilter === 'today'
    ? new Date().setHours(0, 0, 0, 0)
    : now - days * 24 * 60 * 60 * 1000;
  return created >= cutoff;
}

/**
 * Pending Approvals — same page structure/visual language as Document Tracking.
 * Admins (super_admin / system_admin) see a Delete button on each card so they
 * can remove a document that was sent for approval by mistake. The backend
 * automatically cancels the pending signature request before soft-deleting.
 */
export default function ApprovalsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  // Deep link: ?open=<signatureRequestId> lands on the right card directly.
  const openId = searchParams.get('open');

  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeRequest, setActiveRequest] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [mode, setMode] = useState(null); // 'approve' | 'reject'
  const [submitting, setSubmitting] = useState(false);
  const [viewingPdf, setViewingPdf] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState(null); // request row awaiting confirm
  const [deleting, setDeleting] = useState(false);

  // Toolbar
  const [search, setSearch] = useState('');
  const [templateFilter, setTemplateFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  // Rejection recipients — fetched lazily when reject mode opens
  const [recipients, setRecipients] = useState([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState([]);

  // Only admins may delete — the backend enforces this too, this just hides the button
  // for approvers who don't own the document and can't delete it anyway.
  const isAdmin = user?.role === ROLES.SUPER_ADMIN || user?.role === ROLES.SYSTEM_ADMIN;

  const loadPending = async () => {
    setLoading(true);
    try {
      const res = await signatureService.listPending();
      setPending(res.data);
    } catch (err) {
      showToast(err.message || 'Failed to load pending approvals.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPending(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const deepLinkReq = openId ? pending.find((r) => String(r.id) === String(openId)) : null;
  const dismissDeepLink = () => setSearchParams({}, { replace: true });

  useEffect(() => {
    if (!loading && openId && !deepLinkReq) {
      showToast('That approval is no longer pending — showing your current approvals instead.', 'error');
      dismissDeepLink();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, openId, deepLinkReq]);

  const templateNames = useMemo(
    () => [...new Set(pending.map((r) => r.template_name))].sort(),
    [pending]
  );

  const visibleRequests = useMemo(() => {
    const term = search.trim().toLowerCase();
    return pending.filter((r) => {
      if (templateFilter && r.template_name !== templateFilter) return false;
      if (!withinDateFilter(r, dateFilter)) return false;
      if (!term) return true;
      return (
        r.doc_uuid?.toLowerCase().includes(term) ||
        r.template_name?.toLowerCase().includes(term) ||
        r.generator_name?.toLowerCase().includes(term) ||
        r.record_identifier?.toLowerCase().includes(term)
      );
    });
  }, [pending, search, templateFilter, dateFilter]);

  const hasActiveFilters = !!(search || templateFilter || dateFilter);
  const clearFilters = () => { setSearch(''); setTemplateFilter(''); setDateFilter(''); };

  const openApprove = (req) => {
    setActiveRequest(req);
    setMode('approve');
    setOtpCode('');
  };

  const openReject = (req) => {
    setActiveRequest(req);
    setMode('reject');
    setRejectReason('');
    setRecipients([]);
    setSelectedRecipientIds([]);
    setRecipientsLoading(true);
    signatureService.getRejectRecipients(req.id)
      .then((res) => {
        const data = res.data || [];
        setRecipients(data);
        setSelectedRecipientIds(data.map((c) => c.id));
      })
      .catch((err) => showToast(err.message || 'Failed to load recipients.', 'error'))
      .finally(() => setRecipientsLoading(false));
  };

  const closePanel = () => { setActiveRequest(null); setMode(null); };

  const handleSendOtp = async (signatureRequestId) => {
    setSendingOtp(true);
    try {
      const res = await signatureService.resendOtp(signatureRequestId);
      showToast(res.message || 'OTP sent.', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to send OTP.', 'error');
    } finally {
      setSendingOtp(false);
    }
  };

  const handleViewPdf = async (req) => {
    setViewingPdf(true);
    try {
      const url = await signatureService.viewPdfUrl(req.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      showToast(err.message || 'Failed to open the document.', 'error');
    } finally {
      setViewingPdf(false);
    }
  };

  const submitApprove = async () => {
    if (!otpCode.trim()) {
      showToast('Enter the OTP code sent to your email.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await signatureService.approve(activeRequest.id, otpCode.trim());
      showToast(res.message || 'Document approved and signed.', 'success');
      closePanel();
      dismissDeepLink();
      loadPending();
    } catch (err) {
      showToast(err.message || 'Approval failed.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const submitReject = async () => {
    if (!rejectReason.trim()) {
      showToast('A rejection reason is required.', 'error');
      return;
    }
    if (selectedRecipientIds.length === 0) {
      showToast('Select at least one person to send the rejection to.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await signatureService.reject(activeRequest.id, rejectReason.trim(), selectedRecipientIds);
      showToast(res.message || 'Document rejected.', 'success');
      closePanel();
      dismissDeepLink();
      loadPending();
    } catch (err) {
      showToast(err.message || 'Rejection failed.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await documentService.remove(deleteTarget.doc_id);
      showToast(res.message || 'Document deleted.', 'success');
      setDeleteTarget(null);
      loadPending();
    } catch (err) {
      showToast(err.message || 'Failed to delete document.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="doc-track"><p className="doc-track-loading">Loading pending approvals…</p></div>;

  return (
    <div className="doc-track">
      <div className="doc-track-header">
        <h1>Pending Approvals</h1>
      </div>
      <p className="doc-track-subtitle">Documents routed to you for review, OTP-confirmed approval, or rejection.</p>

      {pending.length > 0 && (
        <div className="doc-track-stats">
          <div className="doc-track-stat doc-track-stat-amber">
            <span className="doc-track-stat-value">{pending.length}</span>
            <span className="doc-track-stat-label">Awaiting You</span>
          </div>
          <div className="doc-track-stat">
            <span className="doc-track-stat-value">{templateNames.length}</span>
            <span className="doc-track-stat-label">Templates</span>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="doc-track-toolbar">
          <div className="doc-track-search">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Doc ID, template, or generator…"
            />
          </div>
          <select value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)}>
            <option value="">All templates</option>
            {templateNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
            {DATE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {hasActiveFilters && (
            <button type="button" className="doc-btn doc-btn-secondary" onClick={clearFilters}>Clear</button>
          )}
        </div>
      )}

      {deepLinkReq && (
        <div className="doc-card doc-card-highlighted" style={{ marginBottom: 20 }}>
          <div className="doc-card-top">
            <div className="doc-card-id-block">
              <span className="doc-card-template">Action Required</span>
              <span className="doc-card-id">{deepLinkReq.doc_uuid}</span>
              <div className="doc-card-meta">
                <span><b>Template:</b> {deepLinkReq.template_name}</span>
                <span><b>Generated by:</b> {deepLinkReq.generator_name}</span>
              </div>
            </div>
            <span className="doc-badge doc-badge-amber"><span className="doc-badge-dot" />Pending Approval</span>
          </div>
          <div className="doc-card-actions">
            <button type="button" onClick={() => handleViewPdf(deepLinkReq)} disabled={viewingPdf} className="doc-btn doc-btn-secondary">View PDF</button>
            <button type="button" onClick={() => openApprove(deepLinkReq)} className="doc-btn doc-btn-primary">Approve</button>
            <button type="button" onClick={() => openReject(deepLinkReq)} className="doc-btn doc-btn-danger">Reject</button>
            {isAdmin && (
              <button type="button" onClick={() => setDeleteTarget(deepLinkReq)} className="doc-btn doc-btn-danger" style={{ marginLeft: 'auto' }}>
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {pending.length === 0 ? (
        <div className="doc-track-empty">Nothing awaiting your signature right now.</div>
      ) : visibleRequests.length === 0 ? (
        <div className="doc-track-empty">No approvals match your search/filters. <button type="button" className="doc-track-link-btn" onClick={clearFilters}>Clear filters</button></div>
      ) : (
        <div className="doc-track-grid">
          {visibleRequests.map((req) => (
            <div className="doc-card" key={req.id}>
              <div className="doc-card-top">
                <div className="doc-card-id-block">
                  <span className="doc-card-template">{req.template_name}</span>
                  <span className="doc-card-id">{req.doc_uuid}</span>
                  <div className="doc-card-meta">
                    <span><b>Record:</b> {req.record_identifier}</span>
                    <span><b>Requested:</b> {new Date(req.created_at).toLocaleString()}</span>
                  </div>
                </div>
                <div>
                  <span className="doc-badge doc-badge-amber"><span className="doc-badge-dot" />Pending Approval</span>
                  <div className="doc-card-subline doc-card-subline-amber">From {req.generator_name}</div>
                </div>
              </div>

              <div className="doc-card-actions">
                <button type="button" onClick={() => handleViewPdf(req)} disabled={viewingPdf} className="doc-btn doc-btn-secondary">
                  {viewingPdf ? 'Opening…' : 'View PDF'}
                </button>
                <button type="button" onClick={() => openApprove(req)} className="doc-btn doc-btn-primary">Approve</button>
                <button type="button" onClick={() => openReject(req)} className="doc-btn doc-btn-danger">Reject</button>
                {isAdmin && (
                  <button type="button" onClick={() => setDeleteTarget(req)} className="doc-btn doc-btn-danger" style={{ marginLeft: 'auto' }}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Approve / Reject modal */}
      {activeRequest && (
        <div className="modal-overlay" onClick={closePanel}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{mode === 'approve' ? 'Enter OTP to Approve' : 'Reject Document'}</h2>
              <button type="button" onClick={closePanel} className="modal-close-btn" title="Close">×</button>
            </div>
            <div className="modal-body">
              <p>Document: <b>{activeRequest.doc_uuid}</b></p>

              {mode === 'approve' && (
                <div className="form-field">
                  <button type="button" onClick={() => handleViewPdf(activeRequest)} disabled={viewingPdf} className="btn-secondary" style={{ marginBottom: 12 }}>
                    {viewingPdf ? 'Opening…' : 'View PDF in Browser'}
                  </button>
                  <label htmlFor="otp-input">6-digit OTP (sent to your email, expires in 5 minutes)</label>
                  <div className="verify-input-row">
                    <input
                      id="otp-input"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      maxLength={6}
                      placeholder={sendingOtp ? 'Sending OTP…' : '123456'}
                    />
                    <button type="button" onClick={() => handleSendOtp(activeRequest.id)} disabled={sendingOtp} className="btn-secondary">
                      {sendingOtp ? 'Sending…' : 'Resend OTP'}
                    </button>
                  </div>
                  <button type="button" onClick={submitApprove} disabled={submitting || sendingOtp} className="btn-primary" style={{ marginTop: 10 }}>
                    {submitting ? 'Verifying…' : 'Confirm & Sign'}
                  </button>
                </div>
              )}

              {mode === 'reject' && (
                <div className="form-field">
                  <label htmlFor="reject-reason">Reason for rejection (required)</label>
                  <textarea
                    id="reject-reason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={3}
                  />
                  <RejectRecipientsPicker
                    candidates={recipients}
                    loading={recipientsLoading}
                    selectedIds={selectedRecipientIds}
                    onChange={setSelectedRecipientIds}
                  />
                  <button type="button" onClick={submitReject} disabled={submitting || recipientsLoading} className="btn-danger" style={{ marginTop: 10 }}>
                    {submitting ? 'Submitting…' : 'Confirm Rejection'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h2>Delete Document?</h2>
              <button type="button" onClick={() => setDeleteTarget(null)} className="modal-close-btn" title="Close" disabled={deleting}>×</button>
            </div>
            <div className="modal-body">
              <p>
                Delete <b>{deleteTarget.doc_uuid}</b>?
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 8 }}>
                The pending approval request will be cancelled and the document will be permanently removed from Document Tracking.
                The Doc ID can still be used on the Verify Document page.
              </p>
              <div className="template-form-actions" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="btn-danger"
                >
                  {deleting ? 'Deleting…' : 'Yes, Delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
