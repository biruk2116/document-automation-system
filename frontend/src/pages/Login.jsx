import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ROLES } from '../utils/roles';
import brandLogo from '../assets/brand-logo.png';

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function defaultRouteForRole(role) {
  switch (role) {
    case ROLES.SUPER_ADMIN:
    case ROLES.SYSTEM_ADMIN: return '/templates';
    case ROLES.APPROVER:     return '/approvals';
    default:                 return '/documents';
  }
}

const loginStyles = `
  :root { color-scheme: light dark; }
  .login-page {
    width: 100vw; height: 100vh; display: flex; overflow: hidden;
    background: #ffffff; color: #0f172a; user-select: none;
  }
  .login-left {
    width: 50%; height: 100%; display: flex; flex-direction: column;
    justify-content: center; align-items: center;
    background: #ffffff;
    border-right: 1px solid #e8edf5; flex-shrink: 0; overflow: hidden;
  }
  .login-left-inner { display: flex; flex-direction: column; align-items: center; gap: 28px; padding: 40px; }
  .login-left-title {
    font-size: 2rem; font-weight: 800; color: #0f2856; line-height: 1.25;
    letter-spacing: -0.01em; text-align: center;
    font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; margin: 0;
  }
  .login-right {
    width: 50%; height: 100%; display: flex; flex-direction: column;
    justify-content: center; align-items: center; padding: 40px 56px;
    background: #ffffff; overflow: hidden; flex-shrink: 0;
  }
  .login-card {
    width: 100%; max-width: 410px; background: #ffffff; border-radius: 24px;
    border: 1px solid #e8edf5; padding: 36px; box-shadow: 0 20px 60px rgba(0,0,0,0.06);
  }
  .login-avatar {
    width: 80px; height: 80px; border-radius: 50%; background: #eff6ff;
    border: 1px solid #dbeafe; display: flex; align-items: center;
    justify-content: center; margin: 0 auto 16px; box-shadow: 0 2px 8px rgba(37,99,235,0.08);
  }
  .login-avatar svg { color: #2563eb; width: 40px; height: 40px; }
  .login-heading {
    text-align: center; font-size: 1.1rem; font-weight: 700; letter-spacing: 0.1em;
    color: #374151; text-transform: uppercase; margin: 0 0 24px;
  }
  .login-form-space { display: flex; flex-direction: column; gap: 16px; }
  .login-input-wrap { position: relative; display: flex; align-items: center; }
  .login-input-icon {
    position: absolute; left: 16px; color: #2563eb;
    pointer-events: none; display: flex; align-items: center;
  }
  .login-input {
    width: 100%; padding: 12px 16px 12px 48px; background: #F1F4F9;
    border: 1.5px solid rgba(203,213,225,0.8); border-radius: 9999px;
    font-size: 0.875rem; color: #1e293b; outline: none;
    transition: border-color 0.15s, box-shadow 0.15s; box-sizing: border-box;
  }
  .login-input::-ms-reveal,
  .login-input::-ms-clear,
  input::-ms-reveal,
  input::-ms-clear {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
  .login-input::placeholder { color: #94a3b8; }
  .login-input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }
  .login-input-pr { padding-right: 44px; }
  .login-eye {
    position: absolute; right: 16px; background: none; border: none;
    cursor: pointer; color: #94a3b8; padding: 4px;
    display: flex; align-items: center; transition: color 0.15s;
  }
  .login-eye:hover { color: #475569; }
  .login-forgot { display: flex; justify-content: flex-end; padding-top: 4px; }
  .login-forgot a {
    font-size: 0.75rem; font-weight: 500; color: #2563eb;
    text-decoration: none; transition: color 0.15s;
  }
  .login-forgot a:hover { color: #1d4ed8; text-decoration: underline; }
  .login-btn {
    width: 100%; padding: 12px 24px; margin-top: 8px; border-radius: 9999px;
    background: #2563eb; color: #ffffff; font-weight: 700; font-size: 0.875rem;
    letter-spacing: 0.08em; border: none; cursor: pointer;
    box-shadow: 0 4px 14px rgba(37,99,235,0.35);
    transition: background 0.15s, box-shadow 0.15s, opacity 0.15s;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .login-btn:hover:not(:disabled) { background: #1d4ed8; box-shadow: 0 6px 20px rgba(37,99,235,0.45); }
  .login-btn:active:not(:disabled) { background: #1e40af; }
  .login-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .login-spinner {
    width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #ffffff; border-radius: 50%; flex-shrink: 0;
    animation: lspin 0.7s linear infinite;
  }
  @keyframes lspin { to { transform: rotate(360deg); } }
  .login-verify { margin-top: 24px; text-align: center; }
  .login-verify a {
    font-size: 0.75rem; font-weight: 600; color: #2563eb;
    text-decoration: underline; transition: color 0.15s;
  }
  .login-verify a:hover { color: #1d4ed8; }
  .login-error {
    margin-bottom: 16px; padding: 12px; border-radius: 12px;
    background: #fef2f2; border: 1px solid #fecaca;
    display: flex; align-items: flex-start; gap: 10px;
    font-size: 0.75rem; color: #dc2626; font-weight: 500;
  }
  .login-error svg { flex-shrink: 0; margin-top: 1px; }

  /* DARK MODE — pure black panels, clean black right side, blue button */
  @media (prefers-color-scheme: dark) {
    .login-page   { background: #000000; color: #ffffff; }
    .login-left   { background: #000000; border-right: 1px solid #1a1a1a; }
    .login-left-title { color: #ffffff; }
    .login-right  { background: #000000; }
    .login-card   { background: #000000; border-color: #222222; box-shadow: 0 20px 60px rgba(0,0,0,0.8); }
    .login-avatar { background: rgba(37,99,235,0.15); border-color: rgba(37,99,235,0.3); }
    .login-avatar svg { color: #60a5fa; }
    .login-heading { color: #ffffff; }
    .login-input  { background: #111111; border-color: #262626; color: #ffffff; }
    .login-input::placeholder { color: #666666; }
    .login-input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.25); }
    .login-input-icon { color: #60a5fa; }
    .login-eye    { color: #666666; }
    .login-eye:hover { color: #ffffff; }
    .login-forgot a { color: #60a5fa; }
    .login-forgot a:hover { color: #93c5fd; }
    .login-btn { background: #2563eb; color: #ffffff; box-shadow: 0 4px 14px rgba(37,99,235,0.4); }
    .login-btn:hover:not(:disabled) { background: #1d4ed8; box-shadow: 0 6px 20px rgba(37,99,235,0.5); }
    .login-btn:active:not(:disabled) { background: #1e40af; }
    .login-spinner { border-color: rgba(255,255,255,0.3); border-top-color: #ffffff; }
    .login-verify a { color: #60a5fa; }
    .login-verify a:hover { color: #93c5fd; }
    .login-error { background: #200000; border-color: #500000; color: #ff7777; }
  }

  /* Class-based dark mode */
  .dark .login-page   { background: #000000; color: #ffffff; }
  .dark .login-left   { background: #000000; border-right: 1px solid #1a1a1a; }
  .dark .login-left-title { color: #ffffff; }
  .dark .login-right  { background: #000000; }
  .dark .login-card   { background: #000000; border-color: #222222; box-shadow: 0 20px 60px rgba(0,0,0,0.8); }
  .dark .login-avatar { background: rgba(37,99,235,0.15); border-color: rgba(37,99,235,0.3); }
  .dark .login-avatar svg { color: #60a5fa; }
  .dark .login-heading { color: #ffffff; }
  .dark .login-input  { background: #111111; border-color: #262626; color: #ffffff; }
  .dark .login-input::placeholder { color: #666666; }
  .dark .login-input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.25); }
  .dark .login-input-icon { color: #60a5fa; }
  .dark .login-eye    { color: #666666; }
  .dark .login-eye:hover { color: #ffffff; }
  .dark .login-forgot a { color: #60a5fa; }
  .dark .login-forgot a:hover { color: #93c5fd; }
  .dark .login-btn { background: #2563eb; color: #ffffff; box-shadow: 0 4px 14px rgba(37,99,235,0.4); }
  .dark .login-btn:hover:not(:disabled) { background: #1d4ed8; box-shadow: 0 6px 20px rgba(37,99,235,0.5); }
  .dark .login-btn:active:not(:disabled) { background: #1e40af; }
  .dark .login-spinner { border-color: rgba(255,255,255,0.3); border-top-color: #ffffff; }
  .dark .login-verify a { color: #60a5fa; }
  .dark .login-verify a:hover { color: #93c5fd; }
  .dark .login-error { background: #200000; border-color: #500000; color: #ff7777; }

  @media (max-width: 1023px) {
    .login-page  { flex-direction: column; height: auto; min-height: 100vh; overflow: auto; }
    .login-left  { display: none; }
    .login-right { width: 100%; height: auto; min-height: 100vh; padding: 40px 24px; }
  }
`;

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) { setError('Please enter your work email.'); return; }
    if (!EMAIL_REGEX.test(cleanEmail)) {
      setError('Please enter a valid email address (e.g. name@company.com).');
      return;
    }
    if (!password) { setError('Please enter your password.'); return; }
    setError(null);
    setSubmitting(true);
    try {
      const u = await login(cleanEmail, password);
      const to = location.state?.from?.pathname || defaultRouteForRole(u.role);
      navigate(to, { replace: true, state: location.state?.from?.state });
    } catch (err) {
      setError(err.message || 'Invalid email or password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <style>{loginStyles}</style>
      <div className="login-page">

        {/* LEFT — Brand Panel */}
        <aside className="login-left">
          <div className="login-left-inner">
            <img
              src={brandLogo}
              alt="Document Automation System"
              style={{ width: '270px', height: '270px', objectFit: 'contain' }}
            />
            <h1 className="login-left-title">
              Document Automation<br />System
            </h1>
          </div>
        </aside>

        {/* RIGHT — Login */}
        <main className="login-right">
          <div className="login-card">

            {/* Avatar */}
            <div className="login-avatar">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
              </svg>
            </div>

            {/* Heading */}
            <h2 className="login-heading">User Login</h2>

            {/* Error */}
            {error && (
              <div className="login-error" role="alert">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} noValidate className="login-form-space">

              {/* Email */}
              <div className="login-input-wrap">
                <span className="login-input-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                  </svg>
                </span>
                <input
                  id="login-username"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  placeholder="Username"
                  autoComplete="username"
                  autoFocus
                  required
                  disabled={submitting}
                  className="login-input"
                />
              </div>

              {/* Password */}
              <div className="login-input-wrap">
                <span className="login-input-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                  </svg>
                </span>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                  disabled={submitting}
                  className="login-input login-input-pr"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="login-eye"
                  title={showPassword ? 'Hide password' : 'Show password'}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <line x1="2" y1="2" x2="22" y2="22" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Forgot Password */}
              <div className="login-forgot">
                <Link to="/forgot-password">Forgot Password?</Link>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting || !email.trim() || !password}
                aria-busy={submitting}
                className="login-btn"
              >
                {submitting ? (
                  <>
                    <span className="login-spinner" />
                    <span>LOGGING IN...</span>
                  </>
                ) : 'LOGIN'}
              </button>
            </form>

            {/* Verify */}
            <div className="login-verify">
              <Link to="/verify">Verify Document</Link>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
