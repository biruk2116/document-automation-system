import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import logo from '../assets/logo.svg';
import { getPublicRejectionReview, autoLoginForRejectionReview } from '../services/publicService';
import { setAuthToken } from '../services/api';
import { useAuth } from '../hooks/useAuth';

// ── Inline SVG icons ──────────────────────────────────────────────────────────
function WarningIcon({ size = 20, color = '#DC2626' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function BlockIcon({ size = 28, color = '#DC2626' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}
function EditIcon({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Public rejection-review page — NO LOGIN REQUIRED to view OR to act.
 *
 * The Generator receives an email when a recipient rejects ownership. The email
 * contains a link to this page: /rejection-review/:token
 *
 * What this page does:
 *   1. Loads via the public GET /rejection-review/:token endpoint (no auth).
 *   2. Displays: rejection alert, document info, rejection reason, next-steps card.
 *   3. "Edit & Resubmit" button:
 *      a) If already logged in → navigates directly to /documents with resubmitDoc.
 *      b) If NOT logged in → calls POST /rejection-review/:token/auto-login which
 *         returns a short-lived JWT for the Generator; this is stored exactly like a
 *         normal login token (setAuthToken + sessionStorage + AuthContext user), then
 *         navigates directly to /documents. NO LOGIN PAGE IS SHOWN.
 *
 * Security: the review token was emailed only to the Generator's registered address
 * so possessing it proves identity at the same level as the existing approver-review
 * and generator-notify-view patterns. The issued JWT expires in 15 minutes.
 */
export default function RejectionReviewPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [acting, setActing] = useState(false);
  const [actError, setActError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getPublicRejectionReview(token)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err.message || 'This review link is invalid or has expired.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const handleEditResubmit = async () => {
    if (!data) return;
    setActError(null);
    setActing(true);
    try {
      if (!user) {
        // Not logged in — use the auto-login endpoint to get a short-lived session.
        const loginRes = await autoLoginForRejectionReview(token);
        const { token: sessionToken, user: sessionUser } = loginRes.data;

        // Store exactly the same way as normal login (authService.login).
        setAuthToken(sessionToken);
        sessionStorage.setItem('doc_automation_token', sessionToken);

        // Patch AuthContext user so the rest of the app sees an authenticated session.
        // We call refreshUser() to let AuthContext do a full /auth/me fetch using the
        // new token — this is more robust than patching state directly.
        await refreshUser();
      }

      // Navigate to My Documents in Edit & Resubmit mode.
      navigate('/documents', {
        replace: true,
        state: { resubmitDoc: data.resubmitDoc },
      });
    } catch (err) {
      setActError(err.message || 'Failed to proceed. Please sign in manually.');
      setActing(false);
    }
  };

  return (
    <div className="verify-page public-page-shell" style={{ flexDirection: 'column', alignItems: 'stretch', padding: 0 }}>
      {/* Branded header */}
      <div className="public-page-header">
        <div className="login-brand" style={{ marginBottom: 0 }}>
          <img src={logo} alt="" className="login-brand-mark" style={{ width: 28, height: 28 }} />
          <div className="login-brand-name">Doc Automation</div>
        </div>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Document rejection review</span>
        {user ? (
          <Link to="/document-tracking" className="public-page-header-action" style={{ fontSize: 13 }}>
            Document Tracking
          </Link>
        ) : (
          <Link to="/login" className="public-page-header-action" style={{ fontSize: 13 }}>
            Sign in
          </Link>
        )}
      </div>

      <div style={{ flex: 1, padding: '32px 16px 48px', display: 'flex', justifyContent: 'center' }}>
        {loading ? (
          <p className="verify-status" style={{ marginTop: 40 }}>Loading…</p>
        ) : error ? (
          /* ── Error state ── */
          <div className="verify-card" style={{ maxWidth: 520, width: '100%' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
              padding: '10px 14px', borderRadius: 8,
              background: '#FEF2F2', border: '1px solid #FECACA',
            }}>
              <WarningIcon size={20} />
              <p className="login-error" style={{ margin: 0, fontWeight: 600 }}>{error}</p>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 8 }}>
              This link may have already been used or expired. Sign in and check Document Tracking.
            </p>
            <div className="template-form-actions" style={{ marginTop: 16 }}>
              <Link to="/login" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
                Sign in
              </Link>
            </div>
          </div>
        ) : data && (
          /* ── Main content ── */
          <div style={{ maxWidth: 600, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Rejection alert banner */}
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 14,
              padding: '18px 20px', borderRadius: 10,
              background: '#FEF2F2', border: '1.5px solid #FECACA',
            }}>
              <span style={{ flexShrink: 0, marginTop: 2 }}><BlockIcon size={28} /></span>
              <div>
                <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '1rem', color: '#DC2626' }}>
                  Document rejected by recipient
                </p>
                <p style={{ margin: 0, fontSize: '0.88rem', color: '#7F1D1D' }}>
                  <b>{data.recipientName}</b> indicated that document <b>{data.docUuid}</b>{' '}
                  is not intended for them. The download link has been permanently blocked.
                </p>
              </div>
            </div>

            {/* Document info */}
            <div className="verify-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
              <div style={{ flex: '1 1 180px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '0.78rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Document
                </h3>
                <p style={{ margin: 0, fontWeight: 600, fontSize: '0.95rem' }}>{data.docUuid}</p>
                <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: '#475569' }}>{data.templateName}</p>
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '0.78rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Rejected by
                </h3>
                <p style={{ margin: 0, fontWeight: 600, fontSize: '0.95rem' }}>{data.recipientName}</p>
                {data.rejectedAt && (
                  <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: '#475569' }}>
                    {new Date(data.rejectedAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {/* Rejection reason */}
            <div className="verify-card">
              <h3 style={{ margin: '0 0 8px', fontSize: '0.78rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Rejection reason
              </h3>
              <p style={{
                margin: 0, padding: '12px 16px', borderRadius: 7,
                background: '#FFF7ED', border: '1px solid #FED7AA',
                color: '#92400E', fontSize: '0.95rem', lineHeight: 1.6,
                fontStyle: data.rejectionReason === '(no reason given)' ? 'italic' : 'normal',
              }}>
                {data.rejectionReason}
              </p>
            </div>

            {/* Action card */}
            <div className="verify-card">
              <h3 style={{ margin: '0 0 6px', fontSize: '0.95rem', fontWeight: 600 }}>
                What to do next
              </h3>
              <p style={{ margin: '0 0 16px', fontSize: '0.88rem', color: '#475569', lineHeight: 1.6 }}>
                Review the reason above, correct the document or recipient information,
                then click <b>Edit &amp; Resubmit</b> to fix and send the document directly
                to the recipient — no approver step required.
              </p>

              {actError && (
                <div style={{
                  margin: '0 0 14px', padding: '10px 14px', borderRadius: 7,
                  background: '#FEF2F2', border: '1px solid #FECACA',
                  fontSize: '0.85rem', color: '#DC2626',
                }}>
                  {actError}{' '}
                  <Link to="/login" style={{ color: '#DC2626', fontWeight: 600 }}>Sign in manually →</Link>
                </div>
              )}

              <div className="template-form-actions">
                <button
                  type="button"
                  onClick={handleEditResubmit}
                  disabled={acting}
                  className="btn-primary"
                  style={{ fontSize: '0.95rem', padding: '10px 24px', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  {acting ? 'Opening editor…' : 'Edit & Resubmit'}
                </button>
                {user && (
                  <Link
                    to={`/document-tracking?doc=${encodeURIComponent(data.resubmitDoc?.id || '')}&action=view_rejection`}
                    className="btn-secondary"
                    style={{ textDecoration: 'none', display: 'inline-block', fontSize: '0.9rem' }}
                  >
                    View in Document Tracking
                  </Link>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
