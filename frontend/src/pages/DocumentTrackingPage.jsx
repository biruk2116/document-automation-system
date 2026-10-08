import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { documentService } from '../services/templateService';
import { deliveryService, signatureService, auditService } from '../services/workflowService';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import ApproverSelectModal from '../components/common/ApproverSelectModal';
import SecureDeliveryModal from '../components/common/SecureDeliveryModal';
import { ROLES } from '../utils/roles';
import './DocumentTracking.css';

const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN];

// ── Pure SVG Icons (No Emojis) ────────────────────────────────────────────────
function IconTotalDocs({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function IconClock({ size = 14, color = '#D97706' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconCheck({ size = 14, color = '#10B981' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconDeliveredMail({ size = 16, color = '#2563EB' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function IconTrash({ size = 15, color = '#8B1D2C' }) {
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
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="doc-track-spinner" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function IconExternalLink({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function IconDownload({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'signed', label: 'Approved' },
  { value: 'pending', label: 'Pending Approval' },
  { value: 'draft', label: 'Draft' },
  { value: 'rejected', label: 'Rejected' },
];

const DATE_FILTER_OPTIONS = [
  { value: '', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

function effectiveStatus(doc) {
  if (doc.status === 'draft' && doc.signature_status === 'rejected') return 'rejected';
  return doc.status;
}

function withinDateFilter(doc, dateFilter) {
  if (!dateFilter) return true;
  const generated = new Date(doc.generated_at).getTime();
  const now = Date.now();
  const days = dateFilter === 'today' ? 1 : dateFilter === '7d' ? 7 : 30;
  const cutoff = dateFilter === 'today'
    ? new Date().setHours(0, 0, 0, 0)
    : now - days * 24 * 60 * 60 * 1000;
  return generated >= cutoff;
}

export default function DocumentTrackingPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const highlightDocId = searchParams.get('doc');
  const pendingAction = searchParams.get('action');

  const [myDocs, setMyDocs] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [search, setSearch] = useState('');
  const [templateFilter, setTemplateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  const [approverModalDoc, setApproverModalDoc] = useState(null);
  const [secureDeliveryModalDoc, setSecureDeliveryModalDoc] = useState(null);
  const [ownershipRejectionBanner, setOwnershipRejectionBanner] = useState(null);
  const [viewerModalDoc, setViewerModalDoc] = useState(null);

  const handleOpenViewer = async (doc) => {
    if (viewerModalDoc?.url) {
      URL.revokeObjectURL(viewerModalDoc.url);
    }
    setViewerModalDoc({
      id: doc.id,
      doc,
      url: null,
      loading: true,
      error: null,
    });
    try {
      const url = await documentService.viewUrl(doc.id);
      setViewerModalDoc({
        id: doc.id,
        doc,
        url,
        loading: false,
        error: null,
      });
    } catch (err) {
      setViewerModalDoc({
        id: doc.id,
        doc,
        url: null,
        loading: false,
        error: err.message || 'Failed to open the document.',
      });
    }
  };

  const handleCloseViewer = () => {
    if (viewerModalDoc?.url) {
      URL.revokeObjectURL(viewerModalDoc.url);
    }
    setViewerModalDoc(null);
  };

  useEffect(() => {
    if (!viewerModalDoc) return;
    const onKey = (e) => {
      if (e.key === 'Escape') handleCloseViewer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerModalDoc]);

  const loadMyDocs = () => {
    if (!user) return;
    setLoadingDocs(true);
    auditService.searchDocuments({ generated_by: user.id })
      .then((res) => setMyDocs(res.data || []))
      .catch((err) => showToast(err.message || 'Failed to load your documents.', 'error'))
      .finally(() => setLoadingDocs(false));
  };

  useEffect(() => { loadMyDocs(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const isAdminUser = ADMIN_ROLES.includes(user?.role);

  useEffect(() => {
    if (loadingDocs || !highlightDocId || myDocs.some((d) => String(d.id) === String(highlightDocId))) return;
    if (isAdminUser) {
      auditService.searchDocuments({ id: highlightDocId })
        .then((res) => {
          const match = (res.data || [])[0];
          if (match) {
            setMyDocs((prev) => (prev.some((d) => d.id === match.id) ? prev : [match, ...prev]));
          } else {
            showToast("That document doesn't exist or was deleted.", 'error');
            setSearchParams({}, { replace: true });
          }
        })
        .catch(() => {
          showToast("That document doesn't exist or was deleted.", 'error');
          setSearchParams({}, { replace: true });
        });
      return;
    }
    showToast("That document isn't in your list (wrong account, or it doesn't exist).", 'error');
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingDocs, highlightDocId, myDocs, isAdminUser]);

  const handleAssignApprover = async (approverId) => {
    try {
      const res = await signatureService.initiate(approverModalDoc.id, approverId);
      showToast(res.message || 'Signature request sent.', 'success');
      setApproverModalDoc(null);
      loadMyDocs();
    } catch (err) {
      showToast(err.message || 'Failed to send signature request.', 'error');
    }
  };

  const handleSecureDeliverySent = (message) => {
    showToast(message || 'Secure delivery sent.', 'success');
    loadMyDocs();
  };

  const handleEditResubmit = (doc, ownershipBanner = null) => {
    navigate('/documents', {
      state: {
        resubmitDoc: {
          id: doc.id,
          doc_uuid: doc.doc_uuid,
          template_id: doc.template_id,
          template_name: doc.template_name,
          record_identifier: doc.record_identifier,
          approver_id: doc.approver_id || null,
          approver_name: doc.approver_name || null,
          rejection_reason: ownershipBanner?.reason || doc.rejection_reason || null,
        },
      },
    });
  };

  useEffect(() => {
    if (!pendingAction || !highlightDocId) return;
    if (pendingAction !== 'edit_resubmit' && pendingAction !== 'view_rejection' && pendingAction !== 'view_workflow' && pendingAction !== 'view') return;
    if (loadingDocs) return;
    const target = myDocs.find((d) => String(d.id) === String(highlightDocId));
    if (!target) return;

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('action');
      return next;
    }, { replace: true });

    if (pendingAction === 'view') {
      handleOpenViewer(target);
      return;
    }

    if (pendingAction === 'view_workflow') {
      navigate(`/workflow-result?doc=${encodeURIComponent(highlightDocId)}`);
      return;
    }

    deliveryService.listDeliveries(target.id)
      .then((res) => {
        const rows = res.data || [];
        const latest = rows.find((r) => r.ownership_status === 'REJECTED');
        if (latest) {
          const banner = {
            docId: String(target.id),
            reason: latest.rejection_reason || '(no reason given)',
            recipientName: latest.recipient_name || latest.recipient_email || 'the recipient',
          };
          setOwnershipRejectionBanner(banner);
          if (pendingAction === 'edit_resubmit') {
            handleEditResubmit(target, banner);
          }
        } else {
          const wasApproverRejected = target.status === 'draft' && target.signature_status === 'rejected';
          if (wasApproverRejected || target.rejection_reason) {
            const banner = {
              docId: String(target.id),
              reason: target.rejection_reason || '(no reason given)',
              recipientName: target.approver_name ? `Approver (${target.approver_name})` : 'Approver',
              isApprover: true,
            };
            setOwnershipRejectionBanner(banner);
          }
          if (pendingAction === 'edit_resubmit' && wasApproverRejected) {
            handleEditResubmit(target, null);
          }
        }
      })
      .catch(() => {
        const wasApproverRejected = target.status === 'draft' && target.signature_status === 'rejected';
        if (wasApproverRejected || target.rejection_reason) {
          const banner = {
            docId: String(target.id),
            reason: target.rejection_reason || '(no reason given)',
            recipientName: target.approver_name ? `Approver (${target.approver_name})` : 'Approver',
            isApprover: true,
          };
          setOwnershipRejectionBanner(banner);
        }
        if (pendingAction === 'edit_resubmit' && wasApproverRejected) {
          handleEditResubmit(target, null);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction, loadingDocs, highlightDocId, myDocs]);

  const activeDocs = useMemo(() => myDocs.filter((doc) => !doc.deleted_at), [myDocs]);

  const templateNames = useMemo(
    () => Array.from(new Set(activeDocs.map((d) => d.template_name || 'Untitled Template'))).sort((a, b) => a.localeCompare(b)),
    [activeDocs]
  );

  const totals = useMemo(() => {
    const t = { total: activeDocs.length, pending: 0, approved: 0, delivered: 0 };
    for (const doc of activeDocs) {
      const status = effectiveStatus(doc);
      if (status === 'pending') t.pending += 1;
      else if (status === 'signed') t.approved += 1;
      else if (status === 'delivered') t.delivered += 1;
    }
    return t;
  }, [activeDocs]);

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeDocs.filter((doc) => {
      if (templateFilter && (doc.template_name || 'Untitled Template') !== templateFilter) return false;
      if (statusFilter && effectiveStatus(doc) !== statusFilter) return false;
      if (!withinDateFilter(doc, dateFilter)) return false;
      if (q) {
        const haystack = `${doc.doc_uuid} ${doc.record_identifier} ${doc.template_name}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [activeDocs, search, templateFilter, statusFilter, dateFilter]);

  const visibleDocCount = filteredDocs.length;
  const hasActiveFilters = Boolean(search.trim() || templateFilter || statusFilter || dateFilter);

  const clearFilters = () => {
    setSearch('');
    setTemplateFilter('');
    setStatusFilter('');
    setDateFilter('');
  };

  return (
    <div className="doc-track-page-container">
      <div className="doc-track">
        {/* Fixed Top Section: Header, KPI Stat Cards, and Filters (Pinned, will not scroll) */}
        <div className="doc-track-top-section">
          {/* Page Header */}
          <div className="doc-track-header">
            <h1>Document Tracking</h1>
            <p className="doc-track-subtitle">Track generated documents, approval, and delivery.</p>
          </div>

          {/* 4 KPI Stat Cards */}
          <div className="doc-track-kpi-row">
            {/* Total Documents */}
            <div className="doc-kpi-card">
              <div className="doc-kpi-content">
                <span className="doc-kpi-value">{totals.total}</span>
                <span className="doc-kpi-label">Total Documents</span>
              </div>
              <div className="doc-kpi-icon-wrap" style={{ background: '#F1F5F9' }}>
                <IconTotalDocs />
              </div>
            </div>

            {/* Pending Approval */}
            <div className="doc-kpi-card">
              <div className="doc-kpi-content">
                <span className="doc-kpi-value doc-kpi-value-amber">{totals.pending}</span>
                <span className="doc-kpi-label">Pending Approval</span>
              </div>
              <div className="doc-kpi-icon-wrap" style={{ background: '#FEF3C7' }}>
                <IconClock color="#D97706" />
              </div>
            </div>

            {/* Approved Docs */}
            <div className="doc-kpi-card">
              <div className="doc-kpi-content">
                <span className="doc-kpi-value doc-kpi-value-green">{totals.approved}</span>
                <span className="doc-kpi-label">Approved Docs</span>
              </div>
              <div className="doc-kpi-icon-wrap" style={{ background: '#D1FAE5' }}>
                <IconCheck color="#10B981" />
              </div>
            </div>

            {/* Successfully Delivered */}
            <div className="doc-kpi-card">
              <div className="doc-kpi-content">
                <span className="doc-kpi-value doc-kpi-value-blue">{totals.delivered}</span>
                <span className="doc-kpi-label">Successfully Delivered</span>
              </div>
              <div className="doc-kpi-icon-wrap" style={{ background: '#DBEAFE' }}>
                <IconDeliveredMail color="#2563EB" />
              </div>
            </div>
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
                placeholder="Search documents..."
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
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="doc-track-select"
              >
                {STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
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

        {/* Scrollable Content Section */}
        <div className="doc-track-content-scroll">
          {loadingDocs ? (
            <div className="doc-track-loading">
              <IconSpinner />
              <span>Loading documents…</span>
            </div>
          ) : activeDocs.length === 0 ? (
            <div className="doc-track-empty">You haven't generated any documents yet.</div>
          ) : visibleDocCount === 0 ? (
            <div className="doc-track-empty">
              No documents match your search or filters.{' '}
              <button type="button" className="doc-track-link-btn" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          ) : (
            /* 2-Column Document Cards Grid */
            <div className="doc-track-grid">
              {filteredDocs.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  highlighted={String(doc.id) === String(highlightDocId)}
                  isAdmin={isAdminUser}
                  user={user}
                  onNeedsApprover={() => setApproverModalDoc({ id: doc.id, doc_uuid: doc.doc_uuid })}
                  onSecureDeliver={() => setSecureDeliveryModalDoc(doc)}
                  onChanged={loadMyDocs}
                  onEditResubmit={(banner) => handleEditResubmit(doc, banner || null)}
                  ownershipRejectionBanner={
                    ownershipRejectionBanner && ownershipRejectionBanner.docId === String(doc.id)
                      ? ownershipRejectionBanner
                      : null
                  }
                  onView={handleOpenViewer}
                />
              ))}
            </div>
          )}
        </div>

        {viewerModalDoc && (
          <DocumentViewerModal
            viewerState={viewerModalDoc}
            onClose={handleCloseViewer}
            onDownload={(d) => documentService.download(d.id).catch((err) => showToast(err.message || 'Failed to download.', 'error'))}
            onRetry={handleOpenViewer}
          />
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

        {secureDeliveryModalDoc && (
          <SecureDeliveryModal
            doc={secureDeliveryModalDoc}
            onClose={() => setSecureDeliveryModalDoc(null)}
            onSent={handleSecureDeliverySent}
          />
        )}
      </div>
    </div>
  );
}

/** Status pill badge with inline SVG circle dot */
function DocBadge({ status }) {
  let pillClass = 'doc-pill-draft';
  let label = 'Draft';

  if (status === 'delivered') {
    pillClass = 'doc-pill-delivered';
    label = 'Delivered';
  } else if (status === 'signed') {
    pillClass = 'doc-pill-approved';
    label = 'Approved';
  } else if (status === 'pending') {
    pillClass = 'doc-pill-pending';
    label = 'Pending Approval';
  } else if (status === 'rejected') {
    pillClass = 'doc-pill-rejected';
    label = 'Rejected';
  }

  return (
    <span className={`doc-pill-badge ${pillClass}`}>
      <span className="doc-pill-badge-dot" />
      {label}
    </span>
  );
}

function DocumentCard({
  doc,
  highlighted,
  isAdmin,
  user,
  onNeedsApprover,
  onSecureDeliver,
  onChanged,
  onEditResubmit,
  ownershipRejectionBanner,
  onView,
}) {
  const { showToast } = useToast();
  const cardRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [markingDelivered, setMarkingDelivered] = useState(false);
  const [sendingDocument, setSendingDocument] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (highlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlighted]);

  const isDeleted = Boolean(doc.deleted_at);
  const wasRejected = doc.status === 'draft' && doc.signature_status === 'rejected';
  const isSignedOrDelivered = doc.status === 'signed' || doc.status === 'delivered';

  const wasSecureDelivered = doc.status === 'delivered' && doc.delivered_to;
  const wasHandDelivered = doc.status === 'delivered' && !doc.delivered_to;
  const showDeliveryButtons = !isDeleted && isSignedOrDelivered;

  const isOwner = doc.generated_by === user?.id;
  const isAssignedApprover = doc.status === 'pending' && doc.approver_id === user?.id;
  const canDelete = !isDeleted && (isOwner || isAdmin || isAssignedApprover);

  const handleView = () => {
    if (onView) {
      onView(doc);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await documentService.download(doc.id);
    } catch (err) {
      showToast(err.message || 'Failed to download the document.', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const handleMarkDelivered = async () => {
    setMarkingDelivered(true);
    try {
      const res = await deliveryService.markHandDelivered(doc.id);
      showToast(res.message || 'Marked as hand-delivered.', 'success');
      onChanged();
    } catch (err) {
      showToast(err.message || 'Failed to update status.', 'error');
    } finally {
      setMarkingDelivered(false);
    }
  };

  const handleSend = () => {
    setSendingDocument(true);
    onSecureDeliver();
    setTimeout(() => setSendingDocument(false), 800);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await documentService.remove(doc.id);
      showToast(res.message || 'Document deleted.', 'success');
      onChanged();
    } catch (err) {
      showToast(err.message || 'Failed to delete document.', 'error');
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <div
      ref={cardRef}
      className={`doc-card${highlighted ? ' doc-card-highlighted' : ''}${isDeleted ? ' doc-card-deleted' : ''}`}
    >
      {/* Card Header Row */}
      <div className="doc-card-header-row">
        <div className="doc-card-title-group">
          <h3 className="doc-card-template-name">{doc.template_name || 'Document'}</h3>
          <span className="doc-card-code">{doc.doc_uuid}</span>
        </div>
        <DocBadge status={effectiveStatus(doc)} />
      </div>

      {/* Card Body Metadata */}
      <div className="doc-card-body-meta">
        <div className="doc-card-body-meta-row">
          <span className="doc-card-body-label">Record:</span>
          <span className="doc-card-body-value">{doc.record_identifier || '—'}</span>
        </div>

        <div className="doc-card-body-meta-row">
          <span className="doc-card-body-label">Generated:</span>
          <span className="doc-card-body-value">
            {new Date(doc.generated_at).toLocaleString()}
          </span>
        </div>

        {doc.status === 'delivered' && (
          <div className="doc-card-body-meta-row">
            <span className="doc-card-body-label">Delivered Time:</span>
            <span className="doc-card-body-value">
              {doc.delivered_at
                ? new Date(doc.delivered_at).toLocaleString()
                : new Date(doc.generated_at).toLocaleString()}
            </span>
          </div>
        )}

        {doc.status === 'signed' && (
          <div className="doc-card-body-meta-row">
            <span className="doc-card-body-label">Approved Time:</span>
            <span className="doc-card-body-value">
              {doc.approved_at
                ? new Date(doc.approved_at).toLocaleString()
                : new Date(doc.generated_at).toLocaleString()}
            </span>
          </div>
        )}

        {doc.status === 'pending' && (
          <div className="doc-card-body-meta-row">
            <span className="doc-card-body-label">Pending:</span>
            <span className="doc-card-body-value">
              Awaiting {doc.approver_name || 'Approver'}
            </span>
          </div>
        )}

        {wasRejected && (
          <div className="doc-card-body-meta-row" style={{ color: '#DC2626' }}>
            <span className="doc-card-body-label" style={{ color: '#DC2626' }}>Rejected:</span>
            <span className="doc-card-body-value" style={{ color: '#DC2626' }}>
              {doc.rejection_reason || 'Reverted to Draft'}
            </span>
          </div>
        )}

        {ownershipRejectionBanner && (
          <div style={{
            marginTop: 6,
            padding: '8px 12px',
            borderRadius: 8,
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            fontSize: '0.82rem',
            color: '#DC2626',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            <span>
              {ownershipRejectionBanner.isApprover ? 'Approver rejected:' : 'Recipient rejected:'}{' '}
              <b>{ownershipRejectionBanner.reason}</b>
            </span>
          </div>
        )}
      </div>

      {/* Card Action Buttons Bar (Side-by-side with small gap) */}
      <div className="doc-card-actions-bar">
        <button
          type="button"
          onClick={handleView}
          className="btn-doc-view"
          title="View document"
        >
          View
        </button>

        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="btn-doc-download"
        >
          {downloading ? 'Downloading…' : 'Download'}
        </button>

        {doc.status === 'draft' && !wasRejected && (
          <button type="button" onClick={onNeedsApprover} className="btn-doc-action">
            Select Approver
          </button>
        )}

        {wasRejected && (
          <button type="button" onClick={() => onEditResubmit(null)} className="btn-doc-action">
            Edit &amp; Resubmit
          </button>
        )}

        {showDeliveryButtons && (
          <>
            <button
              type="button"
              onClick={handleSend}
              className="btn-doc-send"
              disabled={wasHandDelivered || markingDelivered || sendingDocument}
              title={wasHandDelivered ? 'Document has been marked as hand delivered' : 'Send document'}
            >
              {sendingDocument ? 'Opening…' : 'Send'}
            </button>

            <button
              type="button"
              onClick={handleMarkDelivered}
              disabled={wasSecureDelivered || markingDelivered || sendingDocument}
              className="btn-doc-hand-delivered"
              title={wasSecureDelivered ? 'Document has been sent via secure delivery' : 'Record that a physical copy was handed to recipient'}
            >
              {markingDelivered ? 'Updating…' : 'Hand Delivered'}
            </button>
          </>
        )}

        {ownershipRejectionBanner && isSignedOrDelivered && (
          <button
            type="button"
            onClick={() => onEditResubmit(ownershipRejectionBanner)}
            className="btn-doc-rejection"
          >
            Edit &amp; Resubmit
          </button>
        )}

        {canDelete && (
          <button
            type="button"
            className="btn-doc-trash"
            onClick={() => setConfirmingDelete(true)}
            title="Delete document"
            aria-label="Delete document"
          >
            <IconTrash />
          </button>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {confirmingDelete && (
        <div className="modal-overlay" onClick={() => !deleting && setConfirmingDelete(false)} style={{ zIndex: 1200 }}>
          <div
            className="modal-panel"
            style={{
              maxWidth: 420,
              padding: '22px 24px',
              background: '#FFFFFF',
              borderRadius: 12,
              border: '1px solid #E2E8F0',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ color: '#DC2626', display: 'flex' }}>
                <IconTrash size={22} />
              </span>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#111827' }}>
                Delete Document?
              </h3>
            </div>
            <p style={{ margin: '0 0 18px', fontSize: '0.85rem', color: '#4B5563', lineHeight: 1.5 }}>
              {doc.status === 'pending'
                ? `Delete ${doc.doc_uuid}? The pending approval request will be cancelled immediately and the approver's review link will stop working. This cannot be undone.`
                : `Delete ${doc.doc_uuid}? Its file will be removed and it can no longer be viewed, downloaded, or delivered. This cannot be undone.`}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="btn-doc-gray"
                style={{ padding: '6px 14px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  background: '#DC2626',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentViewerModal({ viewerState, onClose, onDownload, onRetry }) {
  if (!viewerState) return null;
  const { doc, url, loading, error } = viewerState;

  return (
    <div className="doc-track-viewer-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="doc-track-viewer-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="doc-track-viewer-header">
          <div className="doc-track-viewer-header-info">
            <h3 className="doc-track-viewer-title">{doc.template_name || 'Document Preview'}</h3>
            <span className="doc-track-viewer-code">{doc.doc_uuid}</span>
            <DocBadge status={effectiveStatus(doc)} />
          </div>
          <div className="doc-track-viewer-header-actions">
            {url && (
              <button
                type="button"
                className="doc-track-viewer-action-btn"
                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                title="Open in new browser tab"
              >
                <IconExternalLink size={14} />
                <span>New Tab</span>
              </button>
            )}
            <button
              type="button"
              className="doc-track-viewer-action-btn"
              onClick={() => onDownload(doc)}
              title="Download PDF"
            >
              <IconDownload size={14} />
              <span>Download</span>
            </button>
            <button
              type="button"
              className="doc-track-viewer-close-btn"
              onClick={onClose}
              title="Close viewer"
              aria-label="Close viewer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="doc-track-viewer-body">
          {loading && (
            <div className="doc-track-viewer-loading-state">
              <IconSpinner size={32} />
              <span>Loading document preview…</span>
            </div>
          )}

          {error && !loading && (
            <div className="doc-track-viewer-error-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p>{error}</p>
              {onRetry && (
                <button
                  type="button"
                  className="doc-track-viewer-action-btn"
                  onClick={() => onRetry(doc)}
                  style={{ marginTop: 8 }}
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {url && !loading && (
            <iframe
              src={url}
              title={doc.template_name || 'Document Preview'}
              className="doc-track-viewer-iframe"
            />
          )}
        </div>
      </div>
    </div>
  );
}
