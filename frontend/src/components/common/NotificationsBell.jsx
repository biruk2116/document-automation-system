import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationService } from '../../services/notificationService';
import { signatureService } from '../../services/workflowService';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';

const LABELS = {
  awaiting_your_signature: 'Awaiting your signature',
  your_document_approved: 'Your document was approved',
  your_document_rejected: 'Your document was rejected',
  ownership_rejected_notify: 'Recipient rejected your document',
  delivery_confirmed_notify: 'Recipient confirmed ownership',
};

/** Notification bell rendered as a crisp inline SVG (was previously the 🔔 emoji,
 *  which renders inconsistently across OS/browser emoji sets). currentColor lets
 *  it inherit .notif-bell-btn's color so hover/active states keep working via CSS.
 *  Rounder silhouette with a soft duotone fill — the same "friendly, slightly
 *  filled outline" look as YouTube's bell rather than a thin technical stroke. */
function BellIcon({ ringing }) {
  return (
    <svg
      className={`notif-bell-icon${ringing ? ' notif-bell-icon-ring' : ''}`}
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M12 2.75c-.55 0-1 .45-1 1v.78C7.86 5.16 5.75 7.9 5.75 11.1v3.44c0 .5-.18.98-.51 1.36l-1.13 1.28c-.92 1.04-.18 2.67 1.21 2.67h13.36c1.39 0 2.13-1.63 1.21-2.67l-1.13-1.28a2.05 2.05 0 0 1-.51-1.36V11.1c0-3.2-2.11-5.94-5.25-6.57v-.78c0-.55-.45-1-1-1Z"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M9.15 20c.32 1.1 1.36 1.9 2.6 1.9s2.28-.8 2.6-1.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Admins see rejection notifications for documents they didn't generate too
 * (both Admins + the generator get told a doc was rejected) — the label needs
 * to read differently in that case since it isn't literally "your" document. */
function labelFor(n, currentUserId) {
  if (n.notification_type === 'your_document_rejected' && n.generated_by !== currentUserId) {
    return 'A document was rejected';
  }
  return LABELS[n.notification_type] || n.notification_type;
}

export default function NotificationsBell() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [openingId, setOpeningId] = useState(null);
  const [viewerDoc, setViewerDoc] = useState(null); // { url, title }
  const wrapRef = useRef(null);
  const objectUrlRef = useRef(null);

  // The ring only ever shows notifications that haven't been opened yet — once a
  // document has been clicked it's considered handled and drops out of the list
  // entirely (not just greyed out), so the badge count and the list always agree.
  const unreadNotifications = notifications.filter((n) => !n.is_read);
  const unreadCount = unreadNotifications.length;

  const load = () => {
    notificationService.getAll().then((res) => setNotifications(res.data)).catch(() => {});
  };

  useEffect(() => {
    load();
    // Poll every 15s (was 60s) so a rejection/approval shows up in the ring close to
    // the moment the email goes out, rather than up to a minute later — and refresh
    // immediately whenever the tab regains focus, so switching back to an already-open
    // tab doesn't have to wait out the rest of the interval either.
    const interval = setInterval(load, 15000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Release the blob URL whenever the viewer closes or the component unmounts,
  // so we don't leak memory across repeated opens.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const closeViewer = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setViewerDoc(null);
  };

  /**
   * Approver notifications ("awaiting your signature") still open the embedded
   * PDF viewer here — that mirrors the review-before-OTP step they'd get from the
   * email link. Generator notifications ("your document was approved/rejected")
   * instead deep-link to the persistent My Documents list — the same "get
   * notified, then land on an actionable page" pattern the Approver gets, just
   * pointed at Download/Deliver/Secure-Link/Resubmit instead of Approve/Reject.
   *
   * Ownership-rejected notifications deep-link to Document Tracking with
   * ?doc=<id>&action=edit_resubmit so DocumentTrackingPage can scroll to and
   * highlight the card and surface the Edit & Resubmit button prominently.
   */
  const handleOpenNotification = async (n) => {
    // Optimistically drop it from the ring right away — clicking is the "I've
    // seen this" signal, so the badge count decrements and the item disappears
    // from the dropdown immediately rather than lingering in a "read" state.
    const wasUnread = !n.is_read;
    if (wasUnread) {
      setNotifications((prev) => prev.filter((item) => item !== n));
    }

    const markAsRead = () => {
      if (!wasUnread) return;
      notificationService.markRead(n.notification_type, n.id).catch(() => {
        // Non-fatal: worst case it reappears on the next poll if the server call failed.
      });
    };

    if (n.notification_type !== 'awaiting_your_signature') {
      setOpen(false);
      markAsRead();
      // Ownership-rejected: land on Document Tracking with action=view_rejection
      // so the card shows the rejection banner inline. The Generator can then
      // click "Edit & Resubmit" on the card themselves — we don't auto-navigate
      // away from Document Tracking on a bell click (only the email deep-link
      // uses action=edit_resubmit which auto-fires the navigation).
      if (n.notification_type === 'ownership_rejected_notify') {
        navigate(`/document-tracking?doc=${encodeURIComponent(n.doc_id)}&action=view_rejection`);
      } else {
        // Land on Document Tracking (not My Documents / generation-only page) — this is
        // the page that actually reads ?doc= and scrolls/highlights the matching card.
        navigate(`/document-tracking?doc=${encodeURIComponent(n.doc_id)}`);
      }
      return;
    }

    setOpeningId(n.id);
    try {
      const url = await signatureService.viewPdfUrl(n.signature_request_id);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = url;
      setViewerDoc({ url, title: n.doc_uuid || LABELS[n.notification_type] || 'Document' });
      setOpen(false);
      markAsRead();
    } catch (err) {
      showToast(err.message || 'Failed to open the document.', 'error');
      // Restore it to the ring since opening actually failed.
      if (wasUnread) setNotifications((prev) => [...prev, n]);
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-bell-btn"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
      >
        <BellIcon ringing={unreadCount > 0} />
        {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          {unreadNotifications.length === 0 ? (
            <div className="notif-empty">No new notifications.</div>
          ) : (
            unreadNotifications.map((n) => (
              <button
                type="button"
                key={`${n.notification_type}-${n.id}`}
                className="notif-item"
                onClick={() => handleOpenNotification(n)}
                disabled={openingId === n.id}
                style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }}
                title={n.notification_type === 'ownership_rejected_notify' ? 'Click to review and edit & resubmit' : 'Click to view the document'}
              >
                <div>
                  <span className="notif-dot" aria-hidden="true" />
                  <b>{labelFor(n, user?.id)}</b>
                </div>
                <div>{n.doc_uuid}</div>
                {n.notification_type === 'ownership_rejected_notify' && n.action_details && (() => {
                  try {
                    const details = typeof n.action_details === 'string' ? JSON.parse(n.action_details) : n.action_details;
                    return details?.reason ? (
                      <div style={{ color: '#EF4444', fontSize: '0.78rem', marginTop: 2 }}>
                        Reason: {details.reason.length > 60 ? `${details.reason.slice(0, 60)}\u2026` : details.reason}
                      </div>
                    ) : null;
                  } catch { return null; }
                })()}
                {n.notification_type === 'ownership_rejected_notify' && (
                  <div style={{ color: '#6366F1', fontSize: '0.78rem', marginTop: 2, fontWeight: 500 }}>
                    → Edit &amp; Resubmit
                  </div>
                )}
                <div style={{ color: '#94A3B8', fontSize: '0.78rem', marginTop: 2 }}>
                  {openingId === n.id ? 'Opening…' : new Date(n.timestamp).toLocaleString()}
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {viewerDoc && (
        <div className="modal-overlay" onClick={closeViewer}>
          <div className="modal-panel modal-panel-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{viewerDoc.title}</h2>
              <button type="button" className="modal-close-btn" onClick={closeViewer} title="Close">×</button>
            </div>
            <div className="modal-body" style={{ padding: 0 }}>
              <iframe
                src={viewerDoc.url}
                title={viewerDoc.title}
                className="notif-doc-frame"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
