import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../services/authService';
import logo from '../assets/logo.svg';

export default function ForgotPasswordPage() {
  const [email,      setEmail]      = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState(null);
  const [sent,       setSent]       = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) { setError('Please enter your work email.'); return; }
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* ── same two-panel shell as Login ── */
        .fp {
          display: flex;
          height: 100vh;
          overflow: hidden;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          background: #0F2747;
        }

        /* ══ LEFT HERO — same palette, simplified ══ */
        .fp-hero {
          flex: 0 0 55%;
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 36px 48px;
          overflow: hidden;
          background: linear-gradient(150deg, #0A1E38 0%, #0F2747 45%, #0C2244 100%);
        }
        .fp-hero::before {
          content: '';
          position: absolute;
          width: 500px; height: 500px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(21,154,156,0.15) 0%, transparent 70%);
          top: -80px; left: -60px;
          animation: fp-orb 16s ease-in-out infinite alternate;
          pointer-events: none;
        }
        .fp-hero::after {
          content: '';
          position: absolute;
          width: 360px; height: 360px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(79,140,201,0.12) 0%, transparent 70%);
          bottom: -80px; right: -40px;
          animation: fp-orb 20s ease-in-out infinite alternate-reverse;
          pointer-events: none;
        }
        @keyframes fp-orb {
          from { transform: translate(0,0) scale(1); }
          to   { transform: translate(20px,15px) scale(1.06); }
        }
        @media (prefers-reduced-motion: reduce) {
          .fp-hero::before, .fp-hero::after { animation: none; }
        }
        .fp-grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
          background-size: 44px 44px;
          pointer-events: none;
        }
        .fp-hero-inner {
          position: relative; z-index: 1;
          display: flex; flex-direction: column; height: 100%;
        }

        /* brand */
        .fp-brand {
          display: flex; align-items: center; gap: 12px; margin-bottom: 48px;
        }
        .fp-brand-logo {
          width: 40px; height: 40px; border-radius: 10px; overflow: hidden;
          flex-shrink: 0; box-shadow: 0 2px 10px rgba(0,0,0,0.35);
        }
        .fp-brand-logo img { width: 100%; height: 100%; object-fit: cover; }
        .fp-brand-name {
          font-size: 0.95rem; font-weight: 800; letter-spacing: 0.1em;
          text-transform: uppercase; color: #fff;
        }
        .fp-brand-sub {
          font-size: 0.62rem; font-weight: 600; letter-spacing: 0.18em;
          text-transform: uppercase; color: #27B8BA; margin-top: 3px;
        }

        /* centre content */
        .fp-hero-body {
          flex: 1; display: flex; flex-direction: column; justify-content: center;
        }
        .fp-hero-label {
          font-size: 0.7rem; font-weight: 700; letter-spacing: 0.16em;
          text-transform: uppercase; color: #27B8BA; margin-bottom: 14px;
        }
        .fp-hero-heading {
          font-size: clamp(1.5rem, 2.6vw, 2.1rem);
          font-weight: 800; letter-spacing: -0.03em;
          color: #fff; line-height: 1.2; margin-bottom: 16px;
        }
        .fp-hero-heading span {
          background: linear-gradient(90deg, #27B8BA, #6EE7E5);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .fp-hero-desc {
          font-size: 0.88rem; color: rgba(232,238,247,0.58);
          line-height: 1.65; max-width: 340px; margin-bottom: 36px;
        }

        /* security steps */
        .fp-steps {
          display: flex; flex-direction: column; gap: 12px;
        }
        .fp-step {
          display: flex; align-items: flex-start; gap: 12px;
        }
        .fp-step-num {
          width: 24px; height: 24px; border-radius: 50%;
          background: rgba(39,184,186,0.15);
          border: 1px solid rgba(39,184,186,0.35);
          display: flex; align-items: center; justify-content: center;
          font-size: 0.65rem; font-weight: 800; color: #27B8BA;
          flex-shrink: 0; margin-top: 1px;
        }
        .fp-step-text {
          font-size: 0.8rem; color: rgba(232,238,247,0.6); line-height: 1.5;
        }
        .fp-step-text strong { color: rgba(232,238,247,0.88); font-weight: 600; }

        /* footer pills */
        .fp-pills {
          display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px;
        }
        .fp-pill {
          padding: 4px 12px; border-radius: 20px;
          font-size: 0.68rem; font-weight: 500;
          color: rgba(232,238,247,0.45);
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.07);
        }

        /* ══ RIGHT PANEL ══ */
        .fp-right {
          flex: 1; display: flex; align-items: center;
          justify-content: center; padding: 24px 32px;
          background: #F4F6FA; overflow-y: auto;
        }
        @media (prefers-color-scheme: dark) { .fp-right { background: #07111F; } }

        /* card */
        .fp-card {
          width: 100%; max-width: 380px;
          background: #fff; border-radius: 18px;
          padding: 36px 32px 30px;
          box-shadow:
            0 0 0 1px rgba(0,0,0,0.06),
            0 4px 12px rgba(0,0,0,0.06),
            0 20px 48px rgba(0,0,0,0.10);
          animation: card-in .45s cubic-bezier(0.22,1,0.36,1) both;
        }
        @keyframes card-in {
          from { opacity:0; transform:translateY(16px) scale(0.98); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
        @media (prefers-color-scheme: dark) {
          .fp-card {
            background: #111C2E;
            box-shadow:
              0 0 0 1px rgba(255,255,255,0.06),
              0 4px 12px rgba(0,0,0,0.4),
              0 20px 48px rgba(0,0,0,0.55);
          }
        }

        /* card logo */
        .fp-card-logo {
          display: flex; flex-direction: column;
          align-items: center; gap: 8px; margin-bottom: 24px;
        }
        .fp-card-logo-icon {
          width: 48px; height: 48px; border-radius: 13px;
          overflow: hidden; box-shadow: 0 4px 14px rgba(15,39,71,0.22);
        }
        .fp-card-logo-icon img { width:100%; height:100%; object-fit:cover; }
        .fp-card-logo-name {
          font-size: 0.82rem; font-weight: 800; letter-spacing: 0.1em;
          text-transform: uppercase; color: #0F2747;
        }
        @media (prefers-color-scheme: dark) { .fp-card-logo-name { color:#E8EEF7; } }
        .fp-card-logo-sub {
          font-size: 0.62rem; font-weight: 600; letter-spacing: 0.14em;
          text-transform: uppercase; color: #159A9C;
          background: rgba(21,154,156,0.09); padding: 2px 9px;
          border-radius: 20px; margin-top: -3px;
        }

        /* headings */
        .fp-card h1 {
          font-size: 1.4rem; font-weight: 800; letter-spacing: -0.025em;
          color: #0F2747; margin-bottom: 3px; line-height: 1.2;
        }
        @media (prefers-color-scheme: dark) { .fp-card h1 { color:#F0F6FF; } }
        .fp-card-sub {
          font-size: 0.83rem; color: #64748B;
          margin-bottom: 22px; line-height: 1.5;
        }
        @media (prefers-color-scheme: dark) { .fp-card-sub { color:#9BAAC0; } }

        /* error */
        .fp-err {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 10px 12px; background: #FEF2F2;
          border: 1px solid #FECACA; border-radius: 9px;
          font-size: 0.81rem; color: #DC2626; margin-bottom: 14px;
          animation: shake .3s ease;
        }
        @keyframes shake {
          0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)}
        }
        @media (prefers-color-scheme: dark) {
          .fp-err { background:rgba(220,38,38,.12); border-color:rgba(248,113,113,.3); color:#F87171; }
        }

        /* success */
        .fp-success {
          display: flex; flex-direction: column; gap: 16px;
          animation: card-in .4s cubic-bezier(0.22,1,0.36,1) both;
        }
        .fp-success-icon {
          width: 56px; height: 56px; border-radius: 50%;
          background: rgba(21,154,156,0.10);
          border: 1.5px solid rgba(21,154,156,0.3);
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 4px;
        }
        .fp-success h1 {
          font-size: 1.35rem; font-weight: 800; color: #0F2747;
          text-align: center; line-height: 1.2;
        }
        @media (prefers-color-scheme: dark) { .fp-success h1 { color:#F0F6FF; } }
        .fp-success-msg {
          font-size: 0.83rem; color: #64748B; text-align: center; line-height: 1.6;
        }
        @media (prefers-color-scheme: dark) { .fp-success-msg { color:#9BAAC0; } }
        .fp-success-notice {
          padding: 10px 14px;
          background: rgba(21,154,156,0.07);
          border: 1px solid rgba(21,154,156,0.2);
          border-radius: 9px;
          font-size: 0.78rem; color: #0E7E80; line-height: 1.5;
        }
        @media (prefers-color-scheme: dark) {
          .fp-success-notice { background:rgba(39,184,186,.1); border-color:rgba(39,184,186,.25); color:#27B8BA; }
        }

        /* field */
        .fp-field { display:flex; flex-direction:column; gap:5px; margin-bottom:18px; }
        .fp-lbl { font-size:0.77rem; font-weight:600; color:#374151; letter-spacing:0.01em; }
        @media (prefers-color-scheme: dark) { .fp-lbl { color:#9BAAC0; } }
        .fp-inp {
          width:100%; padding:10px 13px;
          border:1.5px solid #E2E8F0; border-radius:9px;
          font-size:0.9rem; font-family:inherit; color:#172033;
          background:#F8FAFC; outline:none;
          transition:border-color .18s,box-shadow .18s,background .18s;
        }
        .fp-inp:focus {
          border-color:#159A9C; background:#fff;
          box-shadow:0 0 0 3px rgba(21,154,156,0.15);
        }
        .fp-inp::placeholder { color:#9CA3AF; }
        @media (prefers-color-scheme: dark) {
          .fp-inp { background:#17243A; border-color:#26364D; color:#E8EEF7; }
          .fp-inp:focus { border-color:#27B8BA; background:#1A2E4A; box-shadow:0 0 0 3px rgba(39,184,186,.15); }
          .fp-inp::placeholder { color:#3D546E; }
        }

        /* submit */
        .fp-btn {
          width:100%; padding:11px;
          background:linear-gradient(135deg,#159A9C 0%,#0E7E80 100%);
          color:#fff; border:none; border-radius:10px;
          font-size:0.83rem; font-weight:700; font-family:inherit;
          letter-spacing:0.08em; text-transform:uppercase;
          cursor:pointer; transition:opacity .2s,transform .15s,box-shadow .2s;
          box-shadow:0 4px 14px rgba(21,154,156,0.38);
          margin-bottom:14px;
        }
        .fp-btn:hover:not(:disabled) { opacity:.9; transform:translateY(-1px); box-shadow:0 6px 20px rgba(21,154,156,.48); }
        .fp-btn:active:not(:disabled) { transform:translateY(0); }
        .fp-btn:disabled { opacity:.6; cursor:not-allowed; transform:none; }
        .fp-spin {
          display:inline-block; width:13px; height:13px;
          border:2px solid rgba(255,255,255,.3); border-top-color:#fff;
          border-radius:50%; animation:spin .6s linear infinite;
          vertical-align:middle; margin-right:6px;
        }
        @keyframes spin { to{transform:rotate(360deg)} }

        /* back link */
        .fp-back {
          font-size:0.8rem; font-weight:600; color:#159A9C;
          text-decoration:none; display:inline-flex; align-items:center; gap:5px;
          transition:color .15s;
        }
        .fp-back:hover { color:#0E7E80; text-decoration:underline; }
        @media (prefers-color-scheme: dark) {
          .fp-back { color:#27B8BA; }
          .fp-back:hover { color:#6EE7E5; }
        }

        /* ══ RESPONSIVE ══ */
        @media (max-width: 960px) {
          .fp { flex-direction:column; height:auto; overflow:visible; }
          .fp-hero { flex:none; min-height:0; padding:24px 24px 20px; }
          .fp-steps { display:none; }
          .fp-hero-desc { margin-bottom:16px; }
          .fp-right { flex:none; padding:24px 20px 40px; min-height:auto; }
          .fp-card { max-width:440px; }
        }
        @media (max-width: 600px) {
          .fp-hero { padding:18px; }
          .fp-hero-heading { font-size:1.35rem; }
          .fp-pills { display:none; }
          .fp-right { padding:18px 14px 36px; }
          .fp-card { padding:26px 18px 22px; border-radius:14px; }
        }
        @media (max-width: 380px) {
          .fp-card { padding:20px 14px 18px; }
        }
      `}</style>

      <div className="fp">

        {/* ══ LEFT HERO ══ */}
        <aside className="fp-hero" aria-hidden="true">
          <div className="fp-grid"/>
          <div className="fp-hero-inner">

            <div className="fp-brand">
              <div className="fp-brand-logo"><img src={logo} alt=""/></div>
              <div>
                <div className="fp-brand-name">Document Automation</div>
                <div className="fp-brand-sub">Enterprise Platform</div>
              </div>
            </div>

            <div className="fp-hero-body">
              <div className="fp-hero-label">Account Recovery</div>
              <h2 className="fp-hero-heading">
                Secure<br/><span>Password Reset</span>
              </h2>
              <p className="fp-hero-desc">
                We take security seriously. Password resets are delivered over encrypted email
                and expire within 60 minutes.
              </p>

              <div className="fp-steps">
                {[
                  { n:'1', title:'Enter your email', body:'Provide the work email address linked to your account.' },
                  { n:'2', title:'Check your inbox', body:'A time-limited reset link will be sent securely to that address.' },
                  { n:'3', title:'Set a new password', body:'Follow the link to create a new strong password and regain access.' },
                ].map(s => (
                  <div key={s.n} className="fp-step">
                    <div className="fp-step-num">{s.n}</div>
                    <div className="fp-step-text"><strong>{s.title}</strong> — {s.body}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="fp-pills">
              {['Encrypted delivery','60-minute expiry','One-time link','Audit logged'].map(t => (
                <span key={t} className="fp-pill">{t}</span>
              ))}
            </div>

          </div>
        </aside>

        {/* ══ RIGHT PANEL ══ */}
        <main className="fp-right">
          <div className="fp-card">

            <div className="fp-card-logo">
              <div className="fp-card-logo-icon"><img src={logo} alt="Document Automation"/></div>
              <div className="fp-card-logo-name">Document Automation</div>
              <span className="fp-card-logo-sub">Secure Portal</span>
            </div>

            {sent ? (
              /* ── Success state ── */
              <div className="fp-success">
                <div className="fp-success-icon">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                    stroke="#159A9C" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                </div>
                <h1>Check your email</h1>
                <p className="fp-success-msg">
                  If <strong style={{color:'inherit'}}>{email.trim()}</strong> is registered
                  and eligible for self-service reset, a link has been sent.
                  The link expires in <strong style={{color:'inherit'}}>60 minutes</strong> and
                  can only be used once.
                </p>
                <div className="fp-success-notice">
                  Super Admin accounts cannot be reset via this flow. Contact your system administrator directly.
                </div>
                <Link to="/login" className="fp-back" style={{alignSelf:'center'}}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                  Back to Sign In
                </Link>
              </div>
            ) : (
              /* ── Request form ── */
              <>
                <h1>Forgot your password?</h1>
                <p className="fp-card-sub">
                  Enter your work email and we'll help you securely reset your password.
                </p>

                {error && (
                  <div className="fp-err" role="alert">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      style={{flexShrink:0,marginTop:1}} aria-hidden="true">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="12"/>
                      <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} noValidate>
                  <div className="fp-field">
                    <label htmlFor="fp-email" className="fp-lbl">Work Email</label>
                    <input
                      id="fp-email"
                      type="email"
                      className="fp-inp"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setError(null); }}
                      placeholder="you@yourcompany.com"
                      autoComplete="username"
                      autoFocus
                      required
                      disabled={submitting}
                    />
                  </div>

                  <button type="submit" className="fp-btn"
                    disabled={submitting || !email.trim()} aria-busy={submitting}>
                    {submitting
                      ? <><span className="fp-spin" aria-hidden="true"/>Sending…</>
                      : 'SEND RESET LINK'}
                  </button>
                </form>

                <Link to="/login" className="fp-back">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
