import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SecureOneTimeDocumentViewer from '../components/common/SecureOneTimeDocumentViewer';
import {
  downloadDocumentViaNotifyToken,
  getNotifyTokenMeta,
} from '../services/publicService';
import { useToast } from '../hooks/useToast';

const BASE_URL = import.meta.env?.VITE_API_URL || 'http://localhost:5000/api';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Inline SVG icon helpers (no emoji) ───────────────────────────────────────
function LockIcon({ size = 18, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function PaperclipIcon({ size = 18, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function CheckIcon({ size = 18, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function WarningIcon({ size = 16, color = '#DC2626' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

const DELIVERY_METHODS = [
  {
    id: 'secure_link_otp',
    label: 'Secure Link via Email',
    Icon: LockIcon,
    desc: 'Recipient gets a one-time secure link + OTP — must click OWN before downloading.',
  },
  {
    id: 'email_attachment',
    label: 'PDF Attachment via Email',
    Icon: PaperclipIcon,
    desc: 'The signed PDF is emailed directly as an attachment.',
  },
];

function readDocIdFromToken(token) {
  try {
    const payloadPart = token.split('.')[1];
    const decoded = JSON.parse(atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded.docId ?? null;
  } catch {
    return null;
  }
}

/**
 * Public delivery form — no Authorization header needed.
 *
 * Calls POST /documents/notify-view/:notifyToken/deliver-validated which:
 *   - uses the notify-view JWT as the credential (no login required)
 *   - runs the SAME email/record cross-check as the in-system SecureDeliveryModal
 *   - writes to document_deliveries (same table, same flow)
 *   - returns the exact backend error verbatim, e.g.:
 *     "The user's email and ID do not match. Please enter the correct email
 *      for the assigned user."
 */
function DeliverySendForm({ notifyToken, recordIdentifier }) {
  const [method, setMethod] = useState('secure_link_otp');
  const [email, setEmail] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const trimmedEmail = email.trim();
  const emailLooksValid = EMAIL_REGEX.test(trimmedEmail);
  const selectedMethod = DELIVERY_METHODS.find((m) => m.id === method);

  const handleSendClick = () => {
    setError(null);
    if (!trimmedEmail) { setError('Enter the recipient email address.'); return; }
    if (!emailLooksValid) { setError('Enter a valid email address.'); return; }
    setConfirming(true);
  };

  const handleConfirmedSend = async () => {
    setSending(true);
    setError(null);
    try {
      // PUBLIC endpoint — notify JWT is the credential, no Authorization header.
      const res = await fetch(
        `${BASE_URL}/documents/notify-view/${encodeURIComponent(notifyToken)}/deliver-validated`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmedEmail, delivery_method: method }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to send.');
      setSuccess(data.message || 'Sent successfully.');
      setConfirming(false);
      setEmail('');
    } catch (err) {
      setError(err.message || 'Failed to send.');
      setConfirming(false);
    } finally {
      setSending(false);
    }
  };

  if (success) {
    return (
      <div className="send-doc-verify send-doc-verify-ok" style={{ marginTop: 16, flexDirection: 'column', gap: 6 }}>
        <div><b>{success}</b></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CheckIcon size={16} color="#16A34A" />
          <span>Email verified against record <b>{recordIdentifier}</b></span>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: '#475569' }}>
          This document has been sent to the assigned recipient. It can only be sent once per delivery.
        </p>
      </div>
    );
  }

  return (
    <div className="form-field" style={{ marginTop: 20 }}>
      <label style={{ fontWeight: 600, fontSize: '0.95rem' }}>Send this document</label>

      {/* Method choice */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        {DELIVERY_METHODS.map((m) => {
          const selected = method === m.id;
          const { Icon } = m;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => { setMethod(m.id); setError(null); setConfirming(false); }}
              disabled={sending}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                border: selected ? '2px solid #6366F1' : '1.5px solid #E2E8F0',
                background: selected ? '#EEF2FF' : '#fff',
                textAlign: 'left', width: '100%',
              }}
            >
              <span style={{ flexShrink: 0, marginTop: 2, color: selected ? '#4338CA' : '#64748B' }}>
                <Icon size={18} color={selected ? '#4338CA' : '#64748B'} />
              </span>
              <span>
                <span style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', color: selected ? '#4338CA' : '#1E293B' }}>
                  {m.label}{selected && (
                    <span style={{ marginLeft: 6, color: '#6366F1', display: 'inline-flex', verticalAlign: 'middle' }}>
                      <CheckIcon size={14} color="#6366F1" />
                    </span>
                  )}
                </span>
                <span style={{ display: 'block', fontSize: '0.78rem', color: '#475569', marginTop: 1 }}>{m.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Record ID (read-only) + email */}
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <label style={{ fontSize: '0.82rem', color: '#64748B' }}>
            Record ID — the email you enter must match this record
          </label>
          <input
            type="text"
            value={recordIdentifier || '—'}
            readOnly
            disabled
            style={{ background: '#F8FAFC', color: '#475569', cursor: 'not-allowed', marginTop: 4 }}
          />
        </div>
        <div>
          <label htmlFor="notify-view-email" style={{ fontSize: '0.82rem', color: '#64748B' }}>
            Recipient email (must match record <b>{recordIdentifier}</b>)
          </label>
          <div className="verify-input-row" style={{ marginTop: 4 }}>
            <input
              id="notify-view-email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); setConfirming(false); }}
              placeholder="recipient@example.com"
              disabled={sending || confirming}
            />
            {!confirming && (
              <button type="button" onClick={handleSendClick} disabled={sending || !trimmedEmail} className="btn-primary">
                Send Document
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cross-check / validation error — shown verbatim from backend */}
      {error && (
        <div style={{
          marginTop: 10, padding: '10px 14px', borderRadius: 7,
          background: '#FEF2F2', border: '1px solid #FECACA',
          fontSize: '0.88rem', color: '#DC2626',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}><WarningIcon size={16} /></span>
          <span>{error}</span>
        </div>
      )}

      {/* Confirmation */}
      {confirming && !error && (
        <div className="approver-required-banner" style={{ display: 'block', marginTop: 10 }}>
          <p style={{ margin: '0 0 8px' }}>
            Send via <b>{selectedMethod?.label}</b> to <b>{trimmedEmail}</b>?
          </p>
          <div className="template-form-actions">
            <button type="button" onClick={handleConfirmedSend} disabled={sending} className="btn-primary">
              {sending ? 'Sending…' : 'Yes, Send'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={sending} className="btn-secondary">
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Destination of the secure, one-time link sent to the Generator in the docSigned /
 * docRejected notification emails (see signatureController.buildDocNotifyUrl +
 * documentController.viewDocumentByNotifyToken) — the Generator gets the same
 * no-login, one-time "review in browser" experience the Approver gets, once the
 * outcome (signed or rejected) is known.
 *
 * The same link is used for BOTH outcomes, so on load this first calls
 * getNotifyTokenMeta to find out which one it actually is (never burns the
 * one-time PDF view — see that endpoint's docblock) and renders accordingly:
 *   - Rejected: the reason, front and center, plus an "Edit & Resubmit" button —
 *     the exact same action Document Tracking offers for a rejected document,
 *     just reachable straight from the email without hunting for it after login.
 *   - Signed: the delivery actions — download, or send on to someone else via
 *     either a Directly-Emailed PDF attachment or a Secure one-time link, picked
 *     with a radio choice rather than two separate always-visible forms.
 * Either way, the PDF itself is viewable in-app via SecureOneTimeDocumentViewer —
 * "the exact document, opened in the system" — before any of those actions.
 */
export default function GeneratorDocumentViewPage() {
  const { token } = useParams();
  const { showToast } = useToast();
  const fileUrl = `${BASE_URL}/documents/notify-view/${encodeURIComponent(token)}`;
  const [downloading, setDownloading] = useState(false);
  const [meta, setMeta] = useState(null); // { outcome, doc_uuid, rejection_reason, ... }
  const [metaError, setMetaError] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const docId = useMemo(() => readDocIdFromToken(token), [token]);

  useEffect(() => {
    let cancelled = false;
    setLoadingMeta(true);
    getNotifyTokenMeta(token)
      .then((res) => { if (!cancelled) setMeta(res.data); })
      .catch((err) => { if (!cancelled) setMetaError(err.message || 'Failed to load document status.'); })
      .finally(() => { if (!cancelled) setLoadingMeta(false); });
    return () => { cancelled = true; };
  }, [token]);

  const isRejected = meta?.outcome === 'rejected';
  const isSigned = meta?.outcome === 'signed';

  // Plain sign-in target (used whenever we don't have enough context yet, e.g. the
  // meta lookup is still loading or failed) — falls back to Document Tracking with
  // the doc pre-highlighted, same as before.
  const plainLoginTarget = docId ? `/document-tracking?doc=${encodeURIComponent(docId)}` : '/document-tracking';

  // "Edit & Resubmit" straight from the email: carries the same resubmitDoc shape
  // DocumentTrackingPage.handleEditResubmit builds, so after signing in the person
  // lands directly in My Documents' resubmit form instead of a plain document list.
  // See Login.jsx, which now forwards this state through to the redirect target.
  const editResubmitState = isRejected
    ? {
        from: {
          pathname: '/documents',
          state: {
            resubmitDoc: {
              id: meta.id,
              doc_uuid: meta.doc_uuid,
              template_id: meta.template_id,
              template_name: meta.template_name,
              record_identifier: meta.record_identifier,
              approver_id: meta.approver_id,
              approver_name: meta.approver_name,
              rejection_reason: meta.rejection_reason,
            },
          },
        },
      }
    : { from: { pathname: plainLoginTarget } };

  /**
   * Fetches the PDF as a blob and triggers a real save-as download in-app — never a
   * plain <a href> straight to the backend, which would leave the tab showing the
   * server's raw JSON error the moment the link is expired/invalid instead of a
   * proper in-app message.
   */
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const { url, filename } = await downloadDocumentViaNotifyToken(token);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message || 'Failed to download the document.', 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="verify-page">
      <div className="verify-card" style={{ maxWidth: 900 }}>
        <h1>{isRejected ? 'Document Rejected' : isSigned ? 'Document Approved & Signed' : 'Document Update'}</h1>
        <p className="verify-subtitle">
          This is your one-time secure link to review this document in the system — it
          can only be opened once, and the PDF will disappear from this page if you
          switch away from this tab. Use the options below afterward.
        </p>

        {isRejected && (
          <div className="approver-required-banner" style={{ display: 'block', marginBottom: 16 }}>
            <p style={{ margin: 0 }}>
              <b>{meta.doc_uuid}</b> was rejected{meta.approver_name ? ` by ${meta.approver_name}` : ''} and
              reverted to Draft.
            </p>
            {meta.rejection_reason && (
              <p style={{ margin: '8px 0 0' }}>
                <b>Reason:</b> {meta.rejection_reason}
              </p>
            )}
          </div>
        )}

        {metaError && !isRejected && !isSigned && (
          <p className="login-error" style={{ marginBottom: 12 }}>{metaError}</p>
        )}

        <SecureOneTimeDocumentViewer fetchUrl={fileUrl} title="Document update" />

        <div className="template-form-actions" style={{ marginTop: 16, flexWrap: 'wrap', gap: 10 }}>
          <button type="button" onClick={handleDownload} disabled={downloading} className="btn-secondary">
            {downloading ? 'Downloading…' : 'Download the Document'}
          </button>
          {isRejected && (
            <Link to="/login" state={editResubmitState} className="btn-primary">
              Edit &amp; Resubmit
            </Link>
          )}
        </div>

        {/* Send/deliver on to someone else only ever makes sense for a signed
            document — the backend itself refuses these on a rejected (draft) one,
            so they're only shown once we've confirmed that's actually the outcome. */}
        {isSigned && (
          <DeliverySendForm
            notifyToken={token}
            recordIdentifier={meta?.record_identifier}
          />
        )}

        {!loadingMeta && !isRejected && (
          <div className="template-form-actions" style={{ marginTop: 20 }}>
            <Link to="/login" state={editResubmitState} className="btn-primary">
              Sign in to Doc Automation
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
