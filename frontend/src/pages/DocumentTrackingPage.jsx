import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { documentService } from '../services/templateService';
import { deliveryService, signatureService, auditService } from '../services/workflowService';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import ApproverSelectModal from '../components/common/ApproverSelectModal';
import SecureDeliveryModal from '../components/common/SecureDeliveryModal';
import { ROLES } from '../utils/roles';
import './DocumentTracking.css';

const API_BASE = import.meta.env?.VITE_API_URL || '/api';
const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN];

const STATUS_BADGE = {
  draft: { tone: 'slate', label: 'Draft' },
  pending: { tone: 'amber', label: 'Pending Approval' },
  signed: { tone: 'green', label: 'Approved' },
  delivered: { tone: 'blue', label: 'Delivered' },
  rejected: { tone: 'red', label: 'Rejected' },
};

// Same status vocabulary DocBadge already renders, plus the order groups are shown in —
// pending work first, then drafts/rejections still needing attention, then the two
// "done" states last.
const STATUS_GROUP_ORDER = ['pending', 'draft', 'rejected', 'signed', 'delivered'];

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending Approval' },
  { value: 'signed', label: 'Approved' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'draft', label: 'Draft' },
  { value: 'rejected', label: 'Rejected' },
];

const DATE_FILTER_OPTIONS = [
  { value: '', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

/** A document that was reverted after rejection is still status="draft" underneath —
 * this is the same effective-status logic DocumentCard itself uses for its badge/
 * actions, reused here purely to decide which status GROUP a card is sorted into.
 */
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

/**
 * Tracking / delivery view for everything the current user has generated:
 * Doc ID, Template, Record, Status, Generated, and per-document Actions
 * (View/Download, Send, Generate Secure Link, Select/Resubmit Approver, Delete —
 * and, for admins, Mark Hand Delivered).
 *
 * Split out of MyDocumentsPage so that page is generation-only; this page is
 * reachable from its own sidebar entry on every page, and is where the notification
 * bell now deep-links every non-approver notification (?doc=<id> highlights that
 * specific document below).
 *
 * Layout: a totals bar, then a search box + Template/Status/Date filters, then
 * documents grouped first by their template (mirroring the card-grid look of
 * Template Management), then by status within each template — each status group
 * rendered as its own responsive card grid, each template group collapsible.
 */
export default function DocumentTrackingPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Deep link from a notification (in-app bell / one-time email link):
  // ?doc=<id> highlights that specific document in the list below.
  // ?action=edit_resubmit (set by ownership_rejected_notify bell notification)
  // auto-triggers Edit & Resubmit once the matching document is loaded.
  const highlightDocId = searchParams.get('doc');

  // ?action=edit_resubmit  → email link: auto-fire Edit & Resubmit
  // ?action=view_rejection → bell notification: show rejection banner, let Generator click manually
  const pendingAction = searchParams.get('action');

  const [myDocs, setMyDocs] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [search, setSearch] = useState('');
  const [templateFilter, setTemplateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [collapsedTemplates, setCollapsedTemplates] = useState(() => new Set());

  // Approver-assignment modal is keyed to whichever document currently needs it —
  // a freshly generated one, or a rejected one being resubmitted.
  const [approverModalDoc, setApproverModalDoc] = useState(null); // { id, doc_uuid }

  // Secure Document Delivery (link + OTP + ownership confirmation) modal — the only
  // way to send a document to a recipient. The old direct-email-attachment and
  // no-OTP "secure link" paths have been removed; see deliveryController.js.
  const [secureDeliveryModalDoc, setSecureDeliveryModalDoc] = useState(null);

  // When arriving via ?action=edit_resubmit (ownership-rejected bell notification),
  // fetch and surface the latest ownership rejection reason on the highlighted card.
  const [ownershipRejectionBanner, setOwnershipRejectionBanner] = useState(null); // { docId, reason, recipientName }

  // Workflow result panel — no longer used; Generator navigates to /workflow-result directly.
  // Keeping the state stub so ?action=view_workflow in URLs from old emails
  // gracefully does nothing rather than crashing.
  const [workflowPanelDoc, setWorkflowPanelDoc] = useState(null); // eslint-disable-line no-unused-vars

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
    // Admins land here from a rejection notification even for documents someone ELSE
    // generated (rejections notify both System Admins + the generator) — this page
    // normally only lists the current user's own documents, so fetch that one
    // specific document by id and merge it in rather than reporting it "not found".
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

  // Note: this does NOT close the modal — SecureDeliveryModal shows its own
  // "sent" confirmation screen (email / PDF attached / secure link checklist)
  // first, and only closes itself once the Generator clicks "Done". This just
  // refreshes the doc list underneath so its status flips to "Delivered".
  const handleSecureDeliverySent = (message) => {
    showToast(message || 'Secure delivery sent.', 'success');
    loadMyDocs();
  };

  // "Edit & Resubmit": sends the Generator (or an Admin, for a document they didn't
  // generate) to My Documents in a dedicated resubmit mode — pick/confirm the entry
  // (in case the RECORD/ID was the problem), write a short note on what was fixed
  // (covers the TEMPLATE-was-the-problem case too, since an admin who already fixed
  // the template just leaves the ID as-is and explains the fix here), and submit —
  // it regenerates and sends straight back to the same approver, no re-selecting one.
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
          // For approver-rejected docs: the approver's rejection reason.
          // For recipient-rejected (delivered) docs: the ownership rejection reason
          // from the delivery log, passed via ownershipBanner.
          rejection_reason: ownershipBanner?.reason || doc.rejection_reason || null,
        },
      },
    });
  };

  // When the Generator arrives via an ownership_rejected_notify bell notification
  // (?doc=<id>&action=edit_resubmit), auto-trigger Edit & Resubmit once the
  // highlighted document has loaded — saves them having to find the card and click
  // the button manually. Clears the action param after firing so a page refresh
  // doesn't re-trigger the navigation.
  useEffect(() => {
    if (!pendingAction || !highlightDocId) return;
    if (pendingAction !== 'edit_resubmit' && pendingAction !== 'view_rejection' && pendingAction !== 'view_workflow') return;
    if (loadingDocs) return;
    const target = myDocs.find((d) => String(d.id) === String(highlightDocId));
    if (!target) return; // not loaded yet — will retry when myDocs changes

    // Clear the action param first to prevent re-triggering on re-render.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('action');
      return next;
    }, { replace: true });

    // ── view_workflow: navigate to the full-page workflow result view ────────
    if (pendingAction === 'view_workflow') {
      // Navigate to the dedicated WorkflowResultPage with the doc id
      navigate(`/workflow-result?doc=${encodeURIComponent(highlightDocId)}`);
      return;
    }

    // For edit_resubmit and view_rejection: fetch delivery log to surface the
    // ownership rejection reason on the highlighted card.
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
          // edit_resubmit (from email link): auto-navigate once banner is known.
          if (pendingAction === 'edit_resubmit') {
            const wasRejected = target.status === 'draft' && target.signature_status === 'rejected';
            const wasDeliveredRejected = target.status === 'delivered';
            if (wasRejected || wasDeliveredRejected) {
              handleEditResubmit(target, banner);
            }
          }
        } else if (pendingAction === 'edit_resubmit') {
          // No rejected delivery — still navigate for draft-rejected docs.
          const wasRejected = target.status === 'draft' && target.signature_status === 'rejected';
          if (wasRejected) {
            handleEditResubmit(target, null);
          }
        }
      })
      .catch(() => {
        // Non-critical — if delivery log fetch fails, still navigate for draft-rejected.
        if (pendingAction === 'edit_resubmit') {
          const wasRejected = target.status === 'draft' && target.signature_status === 'rejected';
          if (wasRejected) handleEditResubmit(target, null);
        }
      });
    // view_rejection (from bell): banner will be set above once the fetch completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction, loadingDocs, highlightDocId, myDocs]);

  // A deleted document (Delete button -> deleted_at set) has no file left to view/
  // download/deliver — it stays in the DB (and remains verifiable by Doc ID on the
  // Verify Document page), but it no longer belongs in this tracking grid.
  const activeDocs = useMemo(() => myDocs.filter((doc) => !doc.deleted_at), [myDocs]);

  const templateNames = useMemo(
    () => Array.from(new Set(activeDocs.map((d) => d.template_name || 'Untitled Template'))).sort((a, b) => a.localeCompare(b)),
    [activeDocs]
  );

  // Totals bar reflects every active document, independent of the search/filter
  // controls below, so it always reads as the account-wide picture.
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

  // Groups documents by template name, and within each template by status — the API
  // already returns docs ordered newest-first, and that relative order is preserved
  // inside each group. Template groups are sorted alphabetically for a stable layout
  // across reloads instead of jumping around with generation order.
  const templateGroups = useMemo(() => {
    const byTemplate = new Map();
    for (const doc of filteredDocs) {
      const key = doc.template_name || 'Untitled Template';
      if (!byTemplate.has(key)) byTemplate.set(key, []);
      byTemplate.get(key).push(doc);
    }
    return Array.from(byTemplate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([templateName, docs]) => {
        const byStatus = new Map();
        for (const doc of docs) {
          const key = effectiveStatus(doc);
          if (!byStatus.has(key)) byStatus.set(key, []);
          byStatus.get(key).push(doc);
        }
        const statusGroups = STATUS_GROUP_ORDER
          .filter((status) => byStatus.has(status))
          .map((status) => ({ status, docs: byStatus.get(status) }));
        // Defensive: any status outside the known set still shows up, just last.
        for (const [status, docs] of byStatus) {
          if (!STATUS_GROUP_ORDER.includes(status)) statusGroups.push({ status, docs });
        }
        return { templateName, count: docs.length, statusGroups };
      });
  }, [filteredDocs]);

  const visibleDocCount = filteredDocs.length;
  const hasActiveFilters = Boolean(search.trim() || templateFilter || statusFilter || dateFilter);

  const toggleTemplateCollapsed = (templateName) => {
    setCollapsedTemplates((prev) => {
      const next = new Set(prev);
      if (next.has(templateName)) next.delete(templateName); else next.add(templateName);
      return next;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setTemplateFilter('');
    setStatusFilter('');
    setDateFilter('');
  };

  return (
    <div className="doc-track">
      <div className="doc-track-header">
        <h1>Document Tracking</h1>
      </div>
      <p className="doc-track-subtitle">Track generated documents, approval, and delivery.</p>
      {!loadingDocs && activeDocs.length > 0 && (
        <div className="doc-track-stats">
          <div className="doc-track-stat">
            <span className="doc-track-stat-value">{totals.total}</span>
            <span className="doc-track-stat-label">Total</span>
          </div>
          <div className="doc-track-stat doc-track-stat-amber">
            <span className="doc-track-stat-value">{totals.pending}</span>
            <span className="doc-track-stat-label">Pending</span>
          </div>
          <div className="doc-track-stat doc-track-stat-green">
            <span className="doc-track-stat-value">{totals.approved}</span>
            <span className="doc-track-stat-label">Approved</span>
          </div>
          <div className="doc-track-stat doc-track-stat-blue">
            <span className="doc-track-stat-value">{totals.delivered}</span>
            <span className="doc-track-stat-label">Delivered</span>
          </div>
        </div>
      )}
      {!loadingDocs && activeDocs.length > 0 && (
        <div className="doc-track-toolbar">
          <div className="doc-track-search">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search documents…"
            />
          </div>
          <select value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)}>
            <option value="">All templates</option>
            {templateNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
            {DATE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {hasActiveFilters && (
            <button type="button" className="doc-btn doc-btn-secondary" onClick={clearFilters}>Clear</button>
          )}
        </div>
      )}
      {loadingDocs ? (
        <p className="doc-track-loading">Loading your documents…</p>
      ) : activeDocs.length === 0 ? (
        <div className="doc-track-empty">You haven't generated any documents yet.</div>
      ) : visibleDocCount === 0 ? (
        <div className="doc-track-empty">No documents match your search/filters. <button type="button" className="doc-track-link-btn" onClick={clearFilters}>Clear filters</button></div>
      ) : (
        <div className="doc-track-groups">
          {templateGroups.map((group) => {
            const collapsed = collapsedTemplates.has(group.templateName);
            return (
              <section className="doc-track-template-group" key={group.templateName}>
                <button
                  type="button"
                  className="doc-track-template-header"
                  onClick={() => toggleTemplateCollapsed(group.templateName)}
                  aria-expanded={!collapsed}
                >
                  <span className={`doc-track-caret${collapsed ? ' doc-track-caret-collapsed' : ''}`}>▼</span>
                  <h2>{group.templateName}</h2>
                  <span className="doc-track-count">{group.count} document{group.count === 1 ? '' : 's'}</span>
                </button>
                {!collapsed && group.statusGroups.map(({ status, docs }) => {
                  const entry = STATUS_BADGE[status] || { tone: 'slate', label: status };
                  return (
                    <div className="doc-track-status-group" key={status}>
                      <div className={`doc-track-status-header doc-track-status-header-${entry.tone}`}>
                        <span className="doc-badge-dot" />
                        {entry.label}
                        <span className="doc-track-status-count">{docs.length}</span>
                      </div>
                      <div className="doc-track-grid">
                        {docs.map((doc) => (
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
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
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
  );
}

/** Small status pill matching the badge look used elsewhere in the app. */
function DocBadge({ status }) {
  const entry = STATUS_BADGE[status] || { tone: 'slate', label: status };
  return (
    <span className={`doc-badge doc-badge-${entry.tone}`}>
      <span className="doc-badge-dot" />
      {entry.label}
    </span>
  );
}

/**
 * One document's card, with the status-appropriate actions:
 *  - View / Download are always available (two separate actions — View opens the
 *    PDF in a new tab, Download saves it to disk).
 *  - draft, never sent: "Select Approver"
 *  - draft, reverted after a rejection: shows the reason + "Resubmit"
 *  - pending: awaiting approver — admins can delete it (cancels the in-flight request)
 *  - signed / delivered: "Send" opens the Secure Delivery modal. "Hand Delivered"
 *    records a physical handover — available to the document owner and admins.
 *  - Delete lives inline for pending/draft, and behind "⋮" for other statuses.
 */
function DocumentCard({ doc, highlighted, isAdmin, user, onNeedsApprover, onSecureDeliver, onChanged, onEditResubmit, ownershipRejectionBanner }) {
  const { showToast } = useToast();
  const cardRef = useRef(null);
  const menuRef = useRef(null);
  const [viewingDoc, setViewingDoc] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [markingDelivered, setMarkingDelivered] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (highlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlighted]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isDeleted = Boolean(doc.deleted_at);
  const wasRejected = doc.status === 'draft' && doc.signature_status === 'rejected';
  const isSignedOrDelivered = doc.status === 'signed' || doc.status === 'delivered';

  // Hand Delivered — available to the document's own generator and admins,
  // for signed or delivered documents.
  const canMarkHandDelivered = !isDeleted && isSignedOrDelivered;

  // Delete rules:
  // - Pending: GENERATOR (owner), assigned APPROVER, or ADMIN can delete
  // - Other statuses: GENERATOR (owner) or ADMIN can delete
  const isOwner = doc.generated_by === user?.id;
  const isAssignedApprover = doc.status === 'pending' && doc.approver_id === user?.id;
  const canDelete = !isDeleted && (isOwner || isAdmin || isAssignedApprover);

  // The "⋮" menu holds Delete only (Hand Delivered is now a primary action button).
  const hasSecondaryActions = canDelete;

  const handleView = async () => {
    setViewingDoc(true);
    try {
      const url = await documentService.viewUrl(doc.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      showToast(err.message || 'Failed to open the document.', 'error');
    } finally {
      setViewingDoc(false);
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
      setMenuOpen(false);
      onChanged();
    } catch (err) {
      showToast(err.message || 'Failed to update status.', 'error');
    } finally {
      setMarkingDelivered(false);
    }
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

  // "Edit & Resubmit": handed off to the parent, which navigates to My Documents in
  // resubmit mode for this exact document — see DocumentTrackingPage.handleEditResubmit.
  return (
    <div
      ref={cardRef}
      className={`doc-card${highlighted ? ' doc-card-highlighted' : ''}${isDeleted ? ' doc-card-deleted' : ''}`}
    >
      <div className="doc-card-top">
        <div className="doc-card-id-block">
          <span className="doc-card-template">{doc.template_name}</span>
          <span className="doc-card-id">{doc.doc_uuid}</span>
          <div className="doc-card-meta">
            <span><b>Record:</b> {doc.record_identifier}</span>
            <span><b>Generated:</b> {new Date(doc.generated_at).toLocaleString()}</span>
          </div>
        </div>
        <div>
          {isDeleted ? <span className="doc-badge doc-badge-red"><span className="doc-badge-dot" />Deleted</span> : <DocBadge status={doc.status} />}
          {doc.status === 'pending' && doc.approver_name && !isDeleted && (
            <div className="doc-card-subline doc-card-subline-amber">Awaiting {doc.approver_name}</div>
          )}
          {doc.status === 'signed' && doc.approver_name && !isDeleted && (
            <div className="doc-card-subline doc-card-subline-green">Approved by {doc.approver_name}</div>
          )}
          {doc.status === 'delivered' && doc.delivered_to && !isDeleted && (
            <div className="doc-card-subline doc-card-subline-blue">
              Sent to {doc.delivered_to}
              {doc.delivered_at && <> · Delivered {new Date(doc.delivered_at).toLocaleString()}</>}
            </div>
          )}
          {wasRejected && !isDeleted && (
            <div className="doc-card-subline doc-card-subline-red">
              Rejected{doc.rejection_reason ? `: ${doc.rejection_reason}` : ''}
            </div>
          )}
          {/* Ownership rejection banner — shown when Generator arrives from the bell
              notification (?action=edit_resubmit) for a delivered doc whose recipient
              rejected ownership. Different from the approver rejection above. */}
          {ownershipRejectionBanner && !wasRejected && !isDeleted && (
            <div style={{
              marginTop: 4, padding: '4px 10px', borderRadius: 6,
              background: '#FEF2F2', border: '1px solid #FECACA',
              fontSize: '0.8rem', color: '#DC2626',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              Recipient rejected: <i>{ownershipRejectionBanner.reason}</i>
            </div>
          )}
        </div>
      </div>
      {isDeleted ? (
        <div className="doc-card-deleted-note">
          This document was deleted — its file is no longer available to view, download, or deliver. It can still be checked for authenticity on the <b>Verify Document</b> page using its Doc ID (<span className="doc-card-id">{doc.doc_uuid}</span>).
        </div>
      ) : (
        <>
          <div className="doc-card-actions">
            <button type="button" onClick={handleView} disabled={viewingDoc} className="doc-btn doc-btn-secondary">
              {viewingDoc ? 'Opening…' : 'View'}
            </button>
            <button type="button" onClick={handleDownload} disabled={downloading} className="doc-btn doc-btn-secondary">
              {downloading ? 'Downloading…' : 'Download'}
            </button>
            {doc.status === 'draft' && !wasRejected && (
              <button type="button" onClick={onNeedsApprover} className="doc-btn doc-btn-primary">Select Approver</button>
            )}
            {wasRejected && (
              <button type="button" onClick={() => onEditResubmit(null)} className="doc-btn doc-btn-primary">
                Edit &amp; Resubmit
              </button>
            )}
            {isSignedOrDelivered && (
              <button type="button" onClick={onSecureDeliver} className="doc-btn doc-btn-primary">Send</button>
            )}
            {/* Hand Delivered — primary action for signed/delivered docs */}
            {canMarkHandDelivered && (
              <button
                type="button"
                onClick={handleMarkDelivered}
                disabled={markingDelivered}
                className="doc-btn doc-btn-secondary"
                title="Record that a physical copy was handed to the recipient"
              >
                {markingDelivered ? 'Updating…' : 'Hand Delivered'}
              </button>
            )}
            {/* Delete — visible directly for pending (admin) and draft docs */}
            {canDelete && (doc.status === 'pending' || doc.status === 'draft') && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="doc-btn doc-btn-danger"
              >
                Delete
              </button>
            )}
            {/* When arriving from an ownership-rejection bell notification, surface
                Edit & Resubmit prominently even for a delivered doc — the rejection
                means the recipient never owned it, so it needs to be resent. */}
            {ownershipRejectionBanner && isSignedOrDelivered && (
              <button type="button" onClick={() => onEditResubmit(ownershipRejectionBanner)} className="doc-btn doc-btn-primary" style={{ background: '#DC2626', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit &amp; Resubmit
              </button>
            )}
            {/* ⋮ menu — Delete for signed/delivered/rejected (not shown inline) */}
            {hasSecondaryActions && doc.status !== 'pending' && doc.status !== 'draft' && (
              <div className="doc-card-menu" ref={menuRef}>
                <button
                  type="button"
                  className="doc-btn doc-btn-secondary doc-card-menu-trigger"
                  onClick={() => setMenuOpen((o) => !o)}
                  title="More actions"
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                >
                  ⋮
                </button>
                {menuOpen && (
                  <div className="doc-card-menu-dropdown">
                    <button
                      type="button"
                      className="doc-card-menu-item doc-card-menu-item-danger"
                      onClick={() => { setMenuOpen(false); setConfirmingDelete(true); }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          {confirmingDelete && (
            <div className="doc-confirm-banner doc-confirm-banner-danger" style={{ marginTop: 10 }}>
              <p>
                {doc.status === 'pending'
                  ? 'Delete this document? The pending approval request will be cancelled immediately and the approver\'s review link will stop working. This cannot be undone.'
                  : 'Delete this document? Its file will be removed and it can no longer be viewed, downloaded, or delivered — but it will still be verifiable by Doc ID on the Verify Document page. This can\'t be undone.'}
              </p>
              <div className="doc-confirm-banner-actions">
                <button type="button" onClick={handleDelete} disabled={deleting} className="doc-btn doc-btn-danger doc-btn-sm">
                  {deleting ? 'Deleting…' : 'Yes, Delete'}
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting} className="doc-btn doc-btn-secondary doc-btn-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
