import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import logo from '../assets/logo.svg';
import { autoLoginForWorkflowTracking } from '../services/publicService';
import { setAuthToken } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const API_BASE = import.meta.env?.VITE_API_URL || '/api';

/**
 * WorkflowTrackingPage — the destination of the "View Submitted Document" link
 * that the system emails to the Generator when a User completes the workflow
 * (acknowledgement / signature / response).
 *
 * FLOW (matches the product requirement exactly):
 *   1. Generator clicks the email link → browser opens /workflow-track/:token.
 *   2. On mount:
 *      a) Fetch /workflow-track/:token to validate the token and get the doc id.
 *      b) If the Generator is already signed in → navigate directly.
 *      c) If not signed in → call /workflow-track/:token/auto-login to exchange
 *         the token for a short-lived JWT, store it exactly like a normal login,
 *         hydrate AuthContext via refreshUser(), then navigate.
 *   3. Navigate to /workflow-result?doc=<internalDocId>.
 *      WorkflowResultPage renders inside the authenticated Layout shell with the
 *      full system theme — sidebar, navbar, CSS variables — showing the submitted
 *      document PDF, complete recipient information, acknowledgement status,
 *      signature, and response on a dedicated full page.
 *
 * What the Generator sees:
 *   • A brief branded loading screen while authentication happens (~0.5–1s).
 *   • Then the full WorkflowResultPage — dedicated full-page view with the
 *     submitted document PDF, recipient name/email, acknowledgement, signature,
 *     user response, and complete workflow timeline. No login prompt, no extra
 *     button to click.
 *   • If the token is expired, already used, or invalid: a clear security message
 *     with a "Sign in" fallback.
 *
 * Security:
 *   • The tracking token (SHA-256 stored, 256-bit entropy, 7-day expiry) is the
 *     credential — it was emailed ONLY to the Generator's registered address.
 *   • The JWT issued by auto-login is 15-minute, purpose-scoped.
 *   • Token is never exposed in the URL of the final authenticated page.
 *
 * Route: /workflow-track/:token  (public, outside Layout)
 * Backend:
 *   GET  /api/public/workflow-track/:token            → validate + doc id
 *   POST /api/public/workflow-track/:token/auto-login → JWT exchange
 */
export default function WorkflowTrackingPage() {
  const { token }  = useParams();
  const navigate   = useNavigate();
  const { user, isLoading: authLoading, refreshUser } = useAuth();

  // phase: 'loading' | 'authing' | 'error'
  // We never reach a 'success' phase — on success we navigate away immediately.
  const [phase, setPhase]       = useState('loading');
  const [errorMsg, setErrorMsg] = useState(null);
  const [docInfo, setDocInfo]   = useState(null); // { docId, generatorName }

  // Guard: prevent re-running the flow on React StrictMode double-invoke or
  // if authLoading fires more than once. Once we've started the redirect or
  // set an error, we must not re-enter the async chain.
  const hasRun = useRef(false);

  useEffect(() => {
    // Wait for AuthContext to finish restoring the session from storage.
    // Without this, user is null on first render even if a valid session exists.
    if (authLoading) return;

    // Single-run guard — prevents double-invoke in React StrictMode.
    if (hasRun.current) return;
    hasRun.current = true;

    if (!token) {
      setPhase('error');
      setErrorMsg('This tracking link is invalid — no token was provided.');
      return;
    }

    let cancelled = false;

    // ── Step 1: validate the token server-side ──────────────────────────────
    // This call is public (no auth required). It confirms the token is valid and
    // returns the document id so we can deep-link to the correct document.
    fetch(`${API_BASE}/workflow-track/${encodeURIComponent(token)}`)
      .then(async r => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.message || 'This tracking link is invalid or has expired.');
        return j.data;
      })
      .then(async data => {
        if (cancelled) return;

        setDocInfo({
          docId:         data?.document?.docId || null,
          generatorName: data?.generatorName   || null,
          internalDocId: data?.document?.id    || null,
        });

        const internalDocId = data?.document?.id;
        const target = internalDocId
          ? `/workflow-result?doc=${encodeURIComponent(internalDocId)}`
          : '/document-tracking';

        // ── Step 2: authenticate ─────────────────────────────────────────────
        if (user) {
          // Session already exists — navigate directly, no token exchange needed.
          navigate(target, { replace: true });
          return;
        }

        // No active session — exchange the tracking token for an 8-hour JWT.
        // The tracking token was emailed ONLY to the Generator's registered address
        // so possession of it proves identity at the same trust level as the
        // existing rejection-review and approver-review auto-login patterns.
        setPhase('authing');
        try {
          const loginRes = await autoLoginForWorkflowTracking(token);
          if (cancelled) return;

          const { token: sessionToken } = loginRes.data;

          // Store the JWT the same way a normal (rememberMe=false) login does.
          setAuthToken(sessionToken);
          sessionStorage.setItem('doc_automation_token', sessionToken);

          // Hydrate AuthContext by calling /auth/me with the new token.
          // After this resolves, user is non-null and ProtectedRoute will pass.
          await refreshUser();
          if (cancelled) return;

          navigate(target, { replace: true });
        } catch (authErr) {
          if (cancelled) return;
          setErrorMsg(authErr.message || 'Could not sign in automatically using this link. Please sign in manually.');
          setPhase('error');
        }
      })
      .catch(err => {
        if (!cancelled) {
          setErrorMsg(err.message || 'This tracking link is invalid or has expired.');
          setPhase('error');
        }
      });

    return () => { cancelled = true; };
  // authLoading is the primary trigger — re-run once it becomes false.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, authLoading]);

  /* ── Branded loading screen ────────────────────────────────────────────── */
  if (phase === 'loading' || phase === 'authing') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--bg-base)',
        color: 'var(--text-primary)',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}>
        <style>{`@keyframes wtp-spin{to{transform:rotate(360deg)}}`}</style>

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <img src={logo} alt="" style={{ width: 36, height: 36 }} />
          <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            Document Automation
          </span>
        </div>

        {/* Spinner */}
        <div style={{
          width: 40, height: 40,
          border: '3px solid var(--border)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'wtp-spin 0.75s linear infinite',
          marginBottom: 20,
        }} aria-hidden="true" />

        {/* Status text */}
        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
          {phase === 'authing' ? 'Signing you in…' : 'Opening submitted document…'}
        </p>
        {docInfo?.docId && (
          <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Document {docInfo.docId}
            {docInfo.generatorName ? ` · ${docInfo.generatorName}` : ''}
          </p>
        )}

        <noscript>
          <p style={{ marginTop: 16, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            JavaScript must be enabled to open this secure link.
          </p>
        </noscript>
      </div>
    );
  }

  /* ── Error screen ──────────────────────────────────────────────────────── */
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      minHeight: '100vh',
      background: 'var(--bg-base)',
      color: 'var(--text-primary)',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* Minimal header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src={logo} alt="" style={{ width: 26, height: 26 }} />
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
            Document Automation
          </span>
        </div>
        <Link to="/login" style={{
          fontSize: 13, padding: '5px 13px',
          border: '1px solid var(--border-strong)',
          borderRadius: 6, color: 'var(--text-secondary)',
          textDecoration: 'none',
          background: 'var(--bg-surface)',
        }}>
          Sign in
        </Link>
      </div>

      {/* Error card */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'flex-start',
        justifyContent: 'center', padding: '60px 16px',
      }}>
        <div style={{
          maxWidth: 480, width: '100%',
          background: 'var(--bg-surface)',
          border: '1px solid var(--error-border)',
          borderRadius: 12,
          padding: '28px 32px',
          boxShadow: 'var(--shadow-md)',
        }}>
          {/* Lock icon */}
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'var(--error-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="var(--error-text)" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>

          <h2 style={{ margin: '0 0 8px', fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            Secure Link Unavailable
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: '0.88rem', color: 'var(--error-text)', fontWeight: 500 }}>
            {errorMsg}
          </p>
          <p style={{ margin: '0 0 20px', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            This link may have expired (links are valid for 7 days), already been opened, or
            belong to a different account. Please sign in to view your documents directly.
          </p>

          <Link
            to="/login"
            style={{
              display: 'inline-block',
              padding: '10px 22px',
              background: 'var(--brand)',
              color: 'var(--text-inverse)',
              borderRadius: 8,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '0.88rem',
            }}
          >
            Sign in to Document Tracking
          </Link>
        </div>
      </div>
    </div>
  );
}
