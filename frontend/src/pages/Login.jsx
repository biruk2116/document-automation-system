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
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-white dark:bg-[#0B1118] text-slate-900 dark:text-[#F1F5F9] transition-colors duration-200 select-none">
      {/* LEFT — Brand Panel with previous logo (no middle dividing border line) */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center p-8 bg-white dark:bg-[#0B1118]">
        <div className="flex flex-col items-center gap-6 max-w-lg text-center">
          <img
            src={brandLogo}
            alt="Document Automation System"
            className="w-64 h-64 sm:w-72 sm:h-72 object-contain"
          />
          <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight text-[#0f2856] dark:text-white leading-tight">
            Document Automation<br />System
          </h1>
        </div>
      </div>

      {/* RIGHT — Login Form (borderless card, clean white light mode) */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-12 bg-white dark:bg-[#0B1118]">
        {/* Mobile Header Logo */}
        <div className="lg:hidden flex flex-col items-center mb-6">
          <img
            src={brandLogo}
            alt="Document Automation System"
            className="w-24 h-24 object-contain mb-3"
          />
          <h1 className="text-xl font-bold text-[#0f2856] dark:text-white text-center">
            Document Automation System
          </h1>
        </div>

        <div className="w-full max-w-[390px] bg-white dark:bg-[#0B1118] p-6 sm:p-8">
          {/* Title: 24px, 700 */}
          <h2 className="text-2xl font-bold text-center text-[#0856C3] dark:text-[#60A5FA] mb-8 tracking-tight">
            Login
          </h2>

          {/* Error notification */}
          {error && (
            <div className="mb-6 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400 font-medium" role="alert">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            {/* Email / Username with underline input: 14px, 400 */}
            <div className="flex items-center border-b-2 border-slate-300 dark:border-slate-700 focus-within:border-[#0856C3] dark:focus-within:border-[#60A5FA] pb-2 transition-colors">
              <span className="text-[#0856C3] dark:text-[#60A5FA] flex-shrink-0 mr-3">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                </svg>
              </span>
              <input
                id="login-username"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                placeholder="enter your email"
                autoComplete="username"
                autoFocus
                required
                disabled={submitting}
                className="w-full bg-transparent text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
              />
            </div>

            {/* Password with underline input: 14px, 400 */}
            <div className="flex items-center border-b-2 border-slate-300 dark:border-slate-700 focus-within:border-[#0856C3] dark:focus-within:border-[#60A5FA] pb-2 transition-colors relative">
              <span className="text-[#0856C3] dark:text-[#60A5FA] flex-shrink-0 mr-3">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                </svg>
              </span>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                placeholder="password"
                autoComplete="current-password"
                required
                disabled={submitting}
                className="w-full bg-transparent text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none pr-8"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none p-1 transition-colors"
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>

            {/* Forgot Password link positioned ABOVE the login button */}
            <div className="flex justify-end pt-1">
              <Link
                to="/forgot-password"
                className="text-[13px] font-semibold text-[#0856C3] dark:text-[#60A5FA] hover:underline transition-colors"
              >
                Forgot Password ?
              </Link>
            </div>

            {/* Submit Button: 14px, 600 */}
            <button
              type="submit"
              disabled={submitting || !email.trim() || !password}
              aria-busy={submitting}
              className="w-full h-[42px] px-6 rounded-full bg-[#0856C3] hover:bg-[#06449E] active:bg-[#053782] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white font-semibold text-sm tracking-wide shadow-md hover:shadow-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Logging In…</span>
                </>
              ) : (
                'Login'
              )}
            </button>
          </form>

          {/* Bottom Auxiliary Links */}
          <div className="mt-8 pt-4 flex items-center justify-center text-xs font-semibold text-[#0856C3] dark:text-[#60A5FA]">
            <Link
              to="/verify"
              className="hover:underline transition-colors text-[13px] font-semibold"
            >
              Verify Document
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
