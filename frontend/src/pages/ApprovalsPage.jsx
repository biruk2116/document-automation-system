import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { signatureService } from '../services/workflowService';
import { documentService } from '../services/templateService';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ROLES } from '../utils/roles';
import RejectRecipientsPicker from '../components/common/RejectRecipientsPicker';
import './DocumentTracking.css';

// ── Pure SVG Icons (matching Document Tracking) ──────────────────────────────

function IconTrash({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function IconSearch({ size = 14, color = '#9CA3AF' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconChevronDown({ size = 12, color = '#64748B' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconSpinner({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--brand, #0856C3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="doc-track-spinner" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

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
 * Pending Approvals — adopts the exact compact design system, card structure,
 * and button styling (colors and size) of Document Tracking.
 */
export default function ApprovalsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkCardRef = useRef(null);

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

  // Approvers can delete documents they're assigned to review.
  const canDeletePending = true;

  const loadPending = async () => {
    setLoading(true);
    try {
      const res = await signatureService.listPending();
      setPending(res.data || []);
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

  useEffect(() => {
    if (openId && deepLinkCardRef.current) {
      deepLinkCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [openId, pending]);

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

  const hasActiveFilters = Boolean(search.trim() || templateFilter || dateFilter);
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
        setSelectedRecipientIds([]);
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
      showToast(res.message || 'Document approved successfully.', 'success');
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

  if (loading) {
    return (
      <div className="doc-track-page-container">
        <div className="doc-track">
          <div className="doc-track-loading">
            <IconSpinner />
            <span>Loading pending approvals…</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="doc-track-page-container">
      <div className="doc-track">
        {/* Fixed Top Section: Header, KPI Stat Cards & Filters (Matches Document Tracking) */}
        <div className="doc-track-top-section">
          {/* Page Header */}
          <div className="doc-track-header">
            <h1>Pending Approvals</h1>
            <p className="doc-track-subtitle">Documents routed to you for review, OTP-confirmed approval, or rejection.</p>
          </div>



          {/* Search & Filter Toolbar */}
          <div className="doc-track-toolbar">
            <div className="doc-track-search">
              <span className="doc-track-search-icon">
                <IconSearch />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by Doc ID, template, or generator…"
              />
            </div>

            <div className="doc-track-select-wrap">
              <select
                value={templateFilter}
                onChange={(e) => setTemplateFilter(e.target.value)}
                className="doc-track-select"
              >
                <option value="">All templates</option>
                {templateNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <span className="doc-track-select-chevron">
                <IconChevronDown />
              </span>
            </div>

            <div className="doc-track-select-wrap">
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="doc-track-select"
              >
                {DATE_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span className="doc-track-select-chevron">
                <IconChevronDown />
              </span>
            </div>

            {hasActiveFilters && (
              <button type="button" className="doc-track-clear-btn" onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Document Content Area */}
        <div className="doc-track-content-scroll">
          {deepLinkReq && (
            <div style={{
              marginBottom: 14,
              padding: '8px 14px',
              borderRadius: 6,
              background: 'var(--brand-light, #EFF6FF)',
              border: '1px solid var(--border, #E2E8F0)',
              fontSize: '0.8rem',
              color: 'var(--brand, #0856C3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              maxWidth: 696,
            }}>
              <span>
                Action Required: Focused on approval request for <b>{deepLinkReq.doc_uuid}</b> ({deepLinkReq.template_name}).
              </span>
              <button
                type="button"
                onClick={dismissDeepLink}
                className="doc-track-link-btn"
                style={{ fontSize: '0.78rem' }}
              >
                Show all
              </button>
            </div>
          )}

          {pending.length === 0 ? (
            <div className="doc-track-empty">Nothing awaiting your approval right now.</div>
          ) : visibleRequests.length === 0 ? (
            <div className="doc-track-empty">
              No approvals match your search or filters.{' '}
              <button type="button" className="doc-track-link-btn" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          ) : (
            <div className="doc-track-grid">
              {visibleRequests.map((req) => {
                const isHighlighted = openId && String(req.id) === String(openId);
                return (
                  <div
                    key={req.id}
                    ref={isHighlighted ? deepLinkCardRef : null}
                    className={`doc-card${isHighlighted ? ' doc-card-highlighted' : ''}`}
                  >
                    {/* Card Header Row */}
                    <div className="doc-card-header-row">
                      <div className="doc-card-title-group">
                        <h3 className="doc-card-template-name">{req.template_name || 'Document'}</h3>
                        <span className="doc-card-code">{req.doc_uuid}</span>
                      </div>
                      <span className="doc-pill-badge doc-pill-pending">
                        <span className="doc-pill-badge-dot" />
                        Pending Approval
                      </span>
                    </div>

                    {/* Card Body Metadata */}
                    <div className="doc-card-body-meta">
                      <div className="doc-card-body-meta-row">
                        <span className="doc-card-body-label">Record:</span>
                        <span className="doc-card-body-value">{req.record_identifier || '—'}</span>
                      </div>
                      <div className="doc-card-body-meta-row">
                        <span className="doc-card-body-label">Generated by:</span>
                        <span className="doc-card-body-value">{req.generator_name || '—'}</span>
                      </div>
                      <div className="doc-card-body-meta-row">
                        <span className="doc-card-body-label">Requested:</span>
                        <span className="doc-card-body-value">{new Date(req.created_at).toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Card Action Buttons Bar (Matching Document Tracking size & colors) */}
                    <div className="doc-card-actions-bar">
                      <button
                        type="button"
                        onClick={() => handleViewPdf(req)}
                        disabled={viewingPdf}
                        className="btn-doc-view"
                      >
                        {viewingPdf ? 'Opening…' : 'View PDF'}
                      </button>

                      <button
                        type="button"
                        onClick={() => openApprove(req)}
                        className="btn-doc-approve"
                      >
                        Approve
                      </button>

                      <button
                        type="button"
                        onClick={() => openReject(req)}
                        className="btn-doc-reject"
                      >
                        Reject
                      </button>

                      {canDeletePending && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(req)}
                          className="btn-doc-trash"
                          title="Delete document"
                          aria-label="Delete document"
                        >
                          <IconTrash />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Approve / Reject Modal */}
        {activeRequest && (
          <div className="modal-overlay" onClick={closePanel} style={{ zIndex: 1200 }}>
            <div
              className="modal-panel"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: 460,
                padding: '22px 24px',
                background: '#FFFFFF',
                borderRadius: 12,
                border: '1px solid #E2E8F0',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: '#0F172A' }}>
                  {mode === 'approve' ? 'Enter OTP to Approve' : 'Reject Document'}
                </h2>
                <button
                  type="button"
                  onClick={closePanel}
                  className="modal-close-btn"
                  title="Close"
                  style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: '#64748B', lineHeight: 1 }}
                >
                  ×
                </button>
              </div>

              <div className="modal-body" style={{ padding: 0 }}>
                <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: '#475569' }}>
                  Document: <b style={{ color: '#0F172A' }}>{activeRequest.doc_uuid}</b> ({activeRequest.template_name})
                </p>

                {mode === 'approve' && (
                  <div className="form-field">
                    <div style={{ marginBottom: 14 }}>
                      <button
                        type="button"
                        onClick={() => handleViewPdf(activeRequest)}
                        disabled={viewingPdf}
                        className="btn-doc-view"
                        style={{ height: '28px', fontSize: '0.8rem' }}
                      >
                        {viewingPdf ? 'Opening…' : 'View PDF in Browser'}
                      </button>
                    </div>

                    <label htmlFor="otp-input" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#334155', marginBottom: 6 }}>
                      6-digit OTP (sent to your email, expires in 5 minutes)
                    </label>
                    <div className="verify-input-row" style={{ display: 'flex', gap: '8px', marginBottom: 16 }}>
                      <input
                        id="otp-input"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        maxLength={6}
                        placeholder={sendingOtp ? 'Sending OTP…' : '123456'}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          border: '1px solid #CBD5E1',
                          borderRadius: 6,
                          fontSize: '0.95rem',
                          letterSpacing: '2px',
                          textAlign: 'center',
                          fontWeight: 600,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSendOtp(activeRequest.id)}
                        disabled={sendingOtp}
                        className="btn-secondary"
                        style={{ margin: 0, padding: '8px 14px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                      >
                        {sendingOtp ? 'Sending…' : 'Resend OTP'}
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 16 }}>
                      <button
                        type="button"
                        onClick={closePanel}
                        disabled={submitting}
                        className="btn-secondary"
                        style={{ margin: 0 }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={submitApprove}
                        disabled={submitting || sendingOtp}
                        className="btn-success"
                      >
                        {submitting ? 'Verifying…' : 'Confirm Approval'}
                      </button>
                    </div>
                  </div>
                )}

                {mode === 'reject' && (
                  <div className="form-field">
                    <label htmlFor="reject-reason" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#334155', marginBottom: 6 }}>
                      Reason for rejection (required)
                    </label>
                    <textarea
                      id="reject-reason"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={3}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        border: '1px solid #CBD5E1',
                        borderRadius: 6,
                        fontSize: '0.85rem',
                        boxSizing: 'border-box',
                        marginBottom: 12,
                      }}
                    />
                    <RejectRecipientsPicker
                      candidates={recipients}
                      loading={recipientsLoading}
                      selectedIds={selectedRecipientIds}
                      onChange={setSelectedRecipientIds}
                    />
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 16 }}>
                      <button
                        type="button"
                        onClick={closePanel}
                        disabled={submitting}
                        className="btn-secondary"
                        style={{ margin: 0 }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={submitReject}
                        disabled={submitting || recipientsLoading}
                        className="btn-danger"
                      >
                        {submitting ? 'Submitting…' : 'Confirm Rejection'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal (Matches Document Tracking) */}
        {deleteTarget && (
          <div className="modal-overlay" onClick={() => !deleting && setDeleteTarget(null)} style={{ zIndex: 1200 }}>
            <div
              className="modal-panel"
              style={{
                maxWidth: 420,
                padding: '22px 24px',
                background: 'var(--bg-surface, #FFFFFF)',
                borderRadius: 12,
                border: '1px solid var(--border, #E2E8F0)',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.25)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ color: '#DC2626', display: 'flex' }}>
                  <IconTrash size={22} />
                </span>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary, #111827)' }}>
                  Delete Document?
                </h3>
              </div>
              <p style={{ margin: '0 0 18px', fontSize: '0.85rem', color: 'var(--text-secondary, #4B5563)', lineHeight: 1.5 }}>
                Delete <b>{deleteTarget.doc_uuid}</b>? The pending approval request will be cancelled immediately and the document will be permanently removed from Document Tracking. This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={confirmDelete}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
