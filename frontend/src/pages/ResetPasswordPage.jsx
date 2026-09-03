import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../services/authService';
import logo from '../assets/logo.svg';

function EyeIcon({ off }) {
  return off ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

export default function ResetPasswordPage() {
  const [searchParams]              = useSearchParams();
  const navigate                    = useNavigate();
  const token                       = searchParams.get('token') || '';

  const [newPw,      setNewPw]      = useState('');
  const [confirmPw,  setConfirmPw]  = useState('');
  const [showNew,    setShowNew]    = useState(false);
  const [showConf,   setShowConf]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState(null);
  const [done,       setDone]       = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('This reset link is missing its token — please use the link from your email.');
      return;
    }
    if (newPw.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPw !== confirmPw) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(token, newPw);
      setDone(true);
    } catch (err) {
      setError(err.message || 'Failed to reset password. The link may have expired.');
    } finally {
      setSubmitting(false);
    }
  }

  const isWelcome = !done && token; // distinguish "set password" (new user) vs generic reset

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* ── page shell — 100vh, no scroll, same as Login / ForgotPassword ── */
        .rp {
          display: flex;
          height: 100vh;
          overflow: hidden;
          font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif;
          background: #0F2747;
        }

        /* ══════════════════ LEFT HERO 55% ══════════════════ */
        .rp-hero {
          flex: 0 0 55%;
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 28px 40px 24px;
          overflow: hidden;
          background: linear-gradient(148deg, #0A1E38 0%, #0F2747 50%, #0C2040 100%);
        }

        /* orb animations */
        .rp-hero::before {
          content: '';
          position: absolute;
          width: 520px; height: 520px; border-radius: 50%;
          background: radial-gradient(circle, rgba(21,154,156,0.16) 0%, transparent 70%);
          top: -110px; left: -70px;
          animation: rp-orb 14s ease-in-out infinite alternate;
          pointer-events: none;
        }
        .rp-hero::after {
          content: '';
          position: absolute;
          width: 380px; height: 380px; border-radius: 50%;
          background: radial-gradient(circle, rgba(79,140,201,0.13) 0%, transparent 70%);
          bottom: -90px; right: -50px;
          animation: rp-orb 18s ease-in-out infinite alternate-reverse;
          pointer-events: none;
        }
        @keyframes rp-orb {
          from { transform: translate(0,0) scale(1); }
          to   { transform: translate(28px,18px) scale(1.07); }
        }
        @media (prefers-reduced-motion: reduce) {
          .rp-hero::before, .rp-hero::after { animation: none; }
        }

        /* grid overlay */
        .rp-grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px);
          background-size: 40px 40px;
          pointer-events: none;
        }

        .rp-hi {
          position: relative; z-index: 1;
          display: flex; flex-direction: column; height: 100%;
        }

        /* brand row */
        .rp-brand {
          display: flex; align-items: center; gap: 11px;
          flex-shrink: 0; margin-bottom: 0;
        }
        .rp-brand-logo {
          width: 36px; height: 36px; border-radius: 9px;
          overflow: hidden; flex-shrink: 0;
          box-shadow: 0 2px 10px rgba(0,0,0,0.35);
        }
        .rp-brand-logo img { width: 100%; height: 100%; object-fit: cover; }
        .rp-brand-name {
          font-size: 0.88rem; font-weight: 800;
          letter-spacing: 0.1em; text-transform: uppercase; color: #fff;
        }
        .rp-brand-sub {
          font-size: 0.58rem; font-weight: 600;
          letter-spacing: 0.18em; text-transform: uppercase;
          color: #27B8BA; margin-top: 2px;
        }

        /* centre block */
        .rp-centre {
          flex: 1; display: flex; flex-direction: column;
          justify-content: center; padding: 12px 0 8px; min-height: 0;
        }

        .rp-hero-label {
          font-size: 0.7rem; font-weight: 700; letter-spacing: 0.16em;
          text-transform: uppercase; color: #27B8BA; margin-bottom: 14px;
        }
        .rp-headline {
          font-size: clamp(1.45rem, 2.4vw, 2.1rem);
          font-weight: 800; letter-spacing: -0.03em;
          color: #fff; line-height: 1.15; margin-bottom: 10px;
        }
        .rp-headline span {
          background: linear-gradient(90deg, #27B8BA, #6EE7E5);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .rp-desc {
          font-size: 0.82rem; color: rgba(232,238,247,0.58);
          line-height: 1.6; max-width: 340px; margin-bottom: 32px;
        }

        /* security requirements list */
        .rp-reqs {
          display: flex; flex-direction: column; gap: 11px;
        }
        .rp-req {
          display: flex; align-items: flex-start; gap: 11px;
        }
        .rp-req-icon {
          width: 22px; height: 22px; border-radius: 50%;
          background: rgba(39,184,186,0.15);
          border: 1px solid rgba(39,184,186,0.35);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; margin-top: 1px;
        }
        .rp-req-text {
          font-size: 0.79rem; color: rgba(232,238,247,0.58); line-height: 1.5;
        }
        .rp-req-text strong { color: rgba(232,238,247,0.86); font-weight: 600; }

        /* footer pills */
        .rp-pills { display: flex; flex-wrap: wrap; gap: 7px; flex-shrink: 0; }
        .rp-pill {
          padding: 3px 11px; border-radius: 20px;
          font-size: 0.63rem; font-weight: 500;
          color: rgba(232,238,247,0.45);
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.07);
        }

        /* ══════════════════ RIGHT PANEL 45% ══════════════════ */
        .rp-right {
          flex: 1; display: flex; align-items: center;
          justify-content: center; padding: 20px 28px;
          background: #F4F6FA; overflow: hidden;
        }
        @media (prefers-color-scheme: dark) { .rp-right { background: #07111F; } }

        /* card */
        .rp-card {
          width: 100%; max-width: 380px;
          background: #fff; border-radius: 18px;
          padding: 28px 28px 24px;
          box-shadow:
            0 0 0 1px rgba(0,0,0,0.06),
            0 4px 12px rgba(0,0,0,0.07),
            0 18px 44px rgba(0,0,0,0.10);
          animation: rp-card-in .45s cubic-bezier(0.22,1,0.36,1) both;
        }
        @keyframes rp-card-in {
          from { opacity:0; transform: translateY(14px) scale(0.98); }
          to   { opacity:1; transform: translateY(0) scale(1); }
        }
        @media (prefers-color-scheme: dark) {
          .rp-card {
            background: #111C2E;
            box-shadow: 0 0 0 1px rgba(255,255,255,0.06),
                        0 4px 12px rgba(0,0,0,0.4),
                        0 18px 44px rgba(0,0,0,0.55);
          }
        }

        /* card logo */
        .rp-clogo {
          display: flex; flex-direction: column;
          align-items: center; gap: 7px; margin-bottom: 18px;
        }
        .rp-clogo-icon {
          width: 44px; height: 44px; border-radius: 12px;
          overflow: hidden; box-shadow: 0 3px 12px rgba(15,39,71,0.22);
        }
        .rp-clogo-icon img { width: 100%; height: 100%; object-fit: cover; }
        .rp-clogo-name {
          font-size: 0.75rem; font-weight: 800;
          letter-spacing: 0.1em; text-transform: uppercase; color: #0F2747;
        }
        @media (prefers-color-scheme: dark) { .rp-clogo-name { color: #E8EEF7; } }
        .rp-clogo-tag {
          font-size: 0.58rem; font-weight: 700; letter-spacing: 0.14em;
          text-transform: uppercase; color: #159A9C;
          background: rgba(21,154,156,0.09); padding: 2px 9px;
          border-radius: 20px; margin-top: -3px;
        }

        /* heading */
        .rp-card h1 {
          font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif;
          font-size: 1.35rem; font-weight: 800; letter-spacing: -0.025em;
          color: #0F2747; margin-bottom: 2px; line-height: 1.2;
        }
        @media (prefers-color-scheme: dark) { .rp-card h1 { color: #F0F6FF; } }
        .rp-sub {
          font-size: 0.8rem; color: #64748B;
          margin-bottom: 18px; line-height: 1.45;
        }
        @media (prefers-color-scheme: dark) { .rp-sub { color: #9BAAC0; } }

        /* error */
        .rp-err {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 9px 11px; background: #FEF2F2;
          border: 1px solid #FECACA; border-radius: 8px;
          font-size: 0.78rem; color: #DC2626; margin-bottom: 12px;
          animation: rp-shake .3s ease;
        }
        @keyframes rp-shake {
          0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)}
        }
        @media (prefers-color-scheme: dark) {
          .rp-err { background:rgba(220,38,38,.12); border-color:rgba(248,113,113,.3); color:#F87171; }
        }

        /* no-token warning */
        .rp-warn {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 10px 12px;
          background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px;
          font-size: 0.78rem; color: #B45309; margin-bottom: 14px;
        }
        @media (prefers-color-scheme: dark) {
          .rp-warn { background:rgba(251,191,36,.10); border-color:rgba(251,191,36,.3); color:#FBBF24; }
        }

        /* field */
        .rp-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 11px; }
        .rp-lbl { font-size: 0.73rem; font-weight: 600; color: #374151; letter-spacing: 0.01em; }
        @media (prefers-color-scheme: dark) { .rp-lbl { color: #9BAAC0; } }

        .rp-wrap { position: relative; }
        .rp-inp {
          width: 100%; padding: 9px 40px 9px 12px;
          border: 1.5px solid #E2E8F0; border-radius: 8px;
          font-size: 0.88rem; font-family: inherit; color: #172033;
          background: #F8FAFC; outline: none;
          transition: border-color .18s, box-shadow .18s, background .18s;
        }
        .rp-inp:focus {
          border-color: #159A9C; background: #fff;
          box-shadow: 0 0 0 3px rgba(21,154,156,0.14);
        }
        .rp-inp::placeholder { color: #9CA3AF; }
        .rp-inp:disabled { opacity: 0.55; cursor: not-allowed; }
        @media (prefers-color-scheme: dark) {
          .rp-inp { background: #17243A; border-color: #26364D; color: #E8EEF7; }
          .rp-inp:focus { border-color: #27B8BA; background: #1A2E4A; box-shadow: 0 0 0 3px rgba(39,184,186,.14); }
          .rp-inp::placeholder { color: #3D546E; }
        }

        .rp-eye {
          position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer; color: #9CA3AF;
          display: flex; align-items: center; padding: 4px;
          border-radius: 5px; transition: color .15s; line-height: 0;
        }
        .rp-eye:hover { color: #159A9C; }
        @media (prefers-color-scheme: dark) {
          .rp-eye { color: #3D546E; } .rp-eye:hover { color: #27B8BA; }
        }

        /* strength bar */
        .rp-strength {
          display: flex; gap: 4px; margin-top: 5px;
        }
        .rp-strength-bar {
          flex: 1; height: 3px; border-radius: 2px;
          background: #E2E8F0; transition: background .25s;
        }
        @media (prefers-color-scheme: dark) { .rp-strength-bar { background: #26364D; } }
        .rp-strength-bar.weak   { background: #F87171; }
        .rp-strength-bar.fair   { background: #FBBF24; }
        .rp-strength-bar.good   { background: #34D399; }
        .rp-strength-bar.strong { background: #10B981; }
        .rp-strength-label {
          font-size: 0.67rem; color: #9CA3AF; margin-top: 3px;
          text-align: right;
        }
        @media (prefers-color-scheme: dark) { .rp-strength-label { color: #3D546E; } }

        /* submit */
        .rp-btn {
          width: 100%; padding: 10px;
          background: linear-gradient(135deg, #159A9C 0%, #0E7E80 100%);
          color: #fff; border: none; border-radius: 9px;
          font-size: 0.8rem; font-weight: 700; font-family: inherit;
          letter-spacing: 0.08em; text-transform: uppercase;
          cursor: pointer; transition: opacity .2s, transform .15s, box-shadow .2s;
          box-shadow: 0 4px 14px rgba(21,154,156,0.36);
          margin-top: 4px;
        }
        .rp-btn:hover:not(:disabled) { opacity:.9; transform:translateY(-1px); box-shadow:0 6px 18px rgba(21,154,156,.46); }
        .rp-btn:active:not(:disabled) { transform: translateY(0); }
        .rp-btn:disabled { opacity: .55; cursor: not-allowed; transform: none; }
        .rp-spin {
          display: inline-block; width: 12px; height: 12px;
          border: 2px solid rgba(255,255,255,.3); border-top-color: #fff;
          border-radius: 50%; animation: rp-spin .6s linear infinite;
          vertical-align: middle; margin-right: 6px;
        }
        @keyframes rp-spin { to { transform: rotate(360deg); } }

        /* success */
        .rp-success {
          display: flex; flex-direction: column; gap: 14px;
          animation: rp-card-in .4s cubic-bezier(0.22,1,0.36,1) both;
        }
        .rp-success-icon {
          width: 52px; height: 52px; border-radius: 50%;
          background: rgba(21,154,156,0.10);
          border: 1.5px solid rgba(21,154,156,0.3);
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 2px;
        }
        .rp-success h1 {
          text-align: center; font-size: 1.3rem; font-weight: 800;
          color: #0F2747; line-height: 1.2;
        }
        @media (prefers-color-scheme: dark) { .rp-success h1 { color: #F0F6FF; } }
        .rp-success-msg {
          font-size: 0.82rem; color: #64748B;
          text-align: center; line-height: 1.6;
        }
        @media (prefers-color-scheme: dark) { .rp-success-msg { color: #9BAAC0; } }
        .rp-success-notice {
          padding: 10px 13px;
          background: rgba(21,154,156,0.07);
          border: 1px solid rgba(21,154,156,0.2);
          border-radius: 9px;
          font-size: 0.77rem; color: #0E7E80; line-height: 1.5; text-align: center;
        }
        @media (prefers-color-scheme: dark) {
          .rp-success-notice { background:rgba(39,184,186,.10); border-color:rgba(39,184,186,.25); color:#27B8BA; }
        }

        /* divider */
        .rp-div {
          height: 1px;
          background: linear-gradient(90deg, transparent, #E2E8F0 30%, #E2E8F0 70%, transparent);
          margin: 16px 0 13px;
        }
        @media (prefers-color-scheme: dark) {
          .rp-div { background: linear-gradient(90deg, transparent, #26364D 30%, #26364D 70%, transparent); }
        }

        /* back link */
        .rp-back {
          font-size: 0.78rem; font-weight: 600; color: #159A9C;
          text-decoration: none; display: inline-flex;
          align-items: center; gap: 5px; transition: color .15s;
        }
        .rp-back:hover { color: #0E7E80; text-decoration: underline; }
        @media (prefers-color-scheme: dark) {
          .rp-back { color: #27B8BA; } .rp-back:hover { color: #6EE7E5; }
        }

        /* ══ RESPONSIVE ══ */
        @media (max-width: 900px) {
          .rp { flex-direction: column; height: auto; overflow: visible; }
          .rp-hero { flex: none; padding: 20px 24px 18px; }
          .rp-reqs { display: none; }
          .rp-desc { margin-bottom: 10px; }
          .rp-pills { display: none; }
          .rp-right { flex: none; padding: 24px 20px 40px; }
          .rp-card { max-width: 440px; }
        }
        @media (max-width: 540px) {
          .rp-hero { padding: 16px 16px 14px; }
          .rp-headline { font-size: 1.25rem; }
          .rp-right { padding: 14px 12px 36px; }
          .rp-card { padding: 22px 18px 18px; border-radius: 14px; }
          .rp-card h1 { font-size: 1.2rem; }
        }
      `}</style>

      <div className="rp">

        {/* ══ LEFT HERO ══ */}
        <aside className="rp-hero" aria-hidden="true">
          <div className="rp-grid"/>
          <div className="rp-hi">

            {/* brand */}
            <div className="rp-brand">
              <div className="rp-brand-logo"><img src={logo} alt=""/></div>
              <div>
                <div className="rp-brand-name">Document Automation</div>
                <div className="rp-brand-sub">Enterprise Platform</div>
              </div>
            </div>

            {/* centre */}
            <div className="rp-centre">
              <div className="rp-hero-label">Account Security</div>
              <h2 className="rp-headline">
                Protect Your<br/><span>Account</span>
              </h2>
              <p className="rp-desc">
                Choose a strong, unique password to keep your document
                automation workspace secure.
              </p>

              <div className="rp-reqs">
                {[
                  { title: '8+ characters',      body: 'Use at least 8 characters — longer is stronger.' },
                  { title: 'Mix it up',           body: 'Combine uppercase, lowercase, numbers, and symbols.' },
                  { title: 'Keep it unique',      body: "Don't reuse a password you've used on other sites." },
                  { title: 'One-time link',       body: 'This reset link expires after use and cannot be reused.' },
                ].map(r => (
                  <div key={r.title} className="rp-req">
                    <div className="rp-req-icon">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                        stroke="#27B8BA" strokeWidth="3" strokeLinecap="round"
                        strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                    <div className="rp-req-text">
                      <strong>{r.title}</strong> — {r.body}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* pills */}
            <div className="rp-pills">
              {['End-to-end encrypted','One-time token','Audit logged','Expires on use'].map(t => (
                <span key={t} className="rp-pill">{t}</span>
              ))}
            </div>

          </div>
        </aside>

        {/* ══ RIGHT PANEL ══ */}
        <main className="rp-right">
          <div className="rp-card">

            {/* logo */}
            <div className="rp-clogo">
              <div className="rp-clogo-icon"><img src={logo} alt="Document Automation"/></div>
              <div className="rp-clogo-name">Document Automation</div>
              <span className="rp-clogo-tag">Secure Portal</span>
            </div>

            {done ? (
              /* ── Success ── */
              <div className="rp-success">
                <div className="rp-success-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                    stroke="#159A9C" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                </div>
                <h1>Password set!</h1>
                <p className="rp-success-msg">
                  Your password has been saved securely.<br/>
                  You can now sign in with your new password.
                </p>
                <div className="rp-success-notice">
                  This reset link has been invalidated and cannot be used again.
                </div>
                <button
                  type="button"
                  className="rp-btn"
                  onClick={() => navigate('/login', { replace: true })}
                >
                  Go to Sign In
                </button>
              </div>
            ) : (
              /* ── Form ── */
              <>
                <h1>{token ? 'Set your password' : 'Reset your password'}</h1>
                <p className="rp-sub">
                  {token
                    ? 'Choose a strong password for your account.'
                    : 'Enter a new password below.'}
                </p>

                {/* No token warning */}
                {!token && (
                  <div className="rp-warn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                      strokeLinejoin="round" style={{flexShrink:0,marginTop:1}} aria-hidden="true">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    No token found. Please use the link from your email or{' '}
                    <Link to="/forgot-password" style={{color:'inherit',fontWeight:600}}>request a new one</Link>.
                  </div>
                )}

                {error && (
                  <div className="rp-err" role="alert">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                      strokeLinejoin="round" style={{flexShrink:0,marginTop:1}} aria-hidden="true">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="12"/>
                      <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} noValidate>

                  {/* New password */}
                  <div className="rp-field">
                    <label htmlFor="rp-new" className="rp-lbl">New Password</label>
                    <div className="rp-wrap">
                      <input
                        id="rp-new"
                        type={showNew ? 'text' : 'password'}
                        className="rp-inp"
                        value={newPw}
                        onChange={e => { setNewPw(e.target.value); setError(null); }}
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                        autoFocus
                        disabled={!token || submitting}
                        required
                      />
                      <button type="button" className="rp-eye"
                        onClick={() => setShowNew(v => !v)}
                        aria-label={showNew ? 'Hide password' : 'Show password'}>
                        <EyeIcon off={showNew}/>
                      </button>
                    </div>
                    {/* strength indicator */}
                    {newPw.length > 0 && (() => {
                      let strength = 0;
                      if (newPw.length >= 8)  strength++;
                      if (/[A-Z]/.test(newPw)) strength++;
                      if (/[0-9]/.test(newPw)) strength++;
                      if (/[^A-Za-z0-9]/.test(newPw)) strength++;
                      const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
                      const cls    = ['', 'weak', 'fair', 'good', 'strong'];
                      return (
                        <>
                          <div className="rp-strength">
                            {[1,2,3,4].map(i => (
                              <div key={i} className={`rp-strength-bar${i <= strength ? ' ' + cls[strength] : ''}`}/>
                            ))}
                          </div>
                          <div className="rp-strength-label">{labels[strength]}</div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Confirm password */}
                  <div className="rp-field">
                    <label htmlFor="rp-conf" className="rp-lbl">Confirm Password</label>
                    <div className="rp-wrap">
                      <input
                        id="rp-conf"
                        type={showConf ? 'text' : 'password'}
                        className="rp-inp"
                        value={confirmPw}
                        onChange={e => { setConfirmPw(e.target.value); setError(null); }}
                        placeholder="Repeat your new password"
                        autoComplete="new-password"
                        disabled={!token || submitting}
                        required
                      />
                      <button type="button" className="rp-eye"
                        onClick={() => setShowConf(v => !v)}
                        aria-label={showConf ? 'Hide password' : 'Show password'}>
                        <EyeIcon off={showConf}/>
                      </button>
                    </div>
                    {/* match indicator */}
                    {confirmPw.length > 0 && (
                      <div style={{
                        fontSize:'0.67rem', marginTop:3, textAlign:'right',
                        color: newPw === confirmPw ? '#10B981' : '#F87171'
                      }}>
                        {newPw === confirmPw ? '✓ Passwords match' : '✗ Passwords do not match'}
                      </div>
                    )}
                  </div>

                  <button type="submit" className="rp-btn"
                    disabled={submitting || !token} aria-busy={submitting}>
                    {submitting
                      ? <><span className="rp-spin" aria-hidden="true"/>Saving…</>
                      : 'SET PASSWORD'}
                  </button>

                </form>

                <div className="rp-div" aria-hidden="true"/>
                <Link to="/login" className="rp-back">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                  Back to Sign In
                </Link>
              </>
            )}

          </div>
        </main>

      </div>
    </>
  );
}
