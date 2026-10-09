import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../services/authService';
import brandLogo from '../assets/brand-logo.png';

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }
    if (!EMAIL_REGEX.test(cleanEmail)) {
      setError('Please enter a valid email address (e.g. name@company.com).');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(cleanEmail);
      setSent(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-screen flex flex-col justify-center items-center p-4 sm:p-6 bg-white dark:bg-[#0B1118] text-slate-900 dark:text-[#F1F5F9] transition-colors duration-200">
      <div className="w-full max-w-[420px] flex flex-col items-center text-center">
        {/* Brand Logo */}
        <img
          src={brandLogo}
          alt="Document Automation System"
          className="w-16 h-16 sm:w-20 sm:h-20 object-contain mb-3 select-none"
        />

        {/* Brand Title: Full Horizontal */}
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0f2856] dark:text-[#F1F5F9] whitespace-nowrap mb-6 select-none">
          Document Automation System
        </h1>

        {sent ? (
          /* ── Success State ── */
          <div className="w-full bg-white dark:bg-[#151E2B] border border-slate-200 dark:border-[#223044] rounded-lg p-7 shadow-none">
            <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 flex items-center justify-center mx-auto mb-4 text-emerald-600 dark:text-emerald-400">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
              Check Your Email
            </h2>
            <p
              className="text-[15px] sm:text-base text-slate-700 dark:text-slate-300 mb-6 leading-relaxed"
              style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
            >
              If <strong className="text-slate-900 dark:text-white font-semibold">{email.trim()}</strong> is registered, a password reset link has been sent. The link expires in 60 minutes.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center justify-center w-full h-[38px] px-4 text-sm font-semibold rounded-md bg-[#0856C3] hover:bg-[#06449E] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white transition-colors"
            >
              Back to Login
            </Link>
          </div>
        ) : (
          /* ── Form State ── */
          <div className="w-full bg-white dark:bg-[#151E2B] border border-slate-200 dark:border-[#223044] rounded-lg p-6 sm:p-7 shadow-none">
            {error && (
              <div
                className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-2.5 text-[13px] sm:text-sm text-red-600 dark:text-red-400 text-left font-medium"
                role="alert"
                style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
              >
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div>
                <input
                  id="fp-email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  placeholder="Email Address (e.g. name@company.com)"
                  autoComplete="email"
                  autoFocus
                  required
                  disabled={submitting}
                  className="w-full h-[42px] px-3.5 bg-white dark:bg-[#1A2536] border border-slate-300 dark:border-[#223044] rounded-md text-[15px] text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 placeholder:text-[14px] focus:outline-none focus:border-[#0856C3] dark:focus:border-[#2563EB] focus:ring-1 focus:ring-[#0856C3] transition-all text-left"
                  style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
                />
              </div>

              <button
                type="submit"
                disabled={submitting || !email.trim()}
                aria-busy={submitting}
                className="w-full h-[40px] px-4 rounded-md bg-[#0856C3] hover:bg-[#06449E] active:bg-[#053782] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white font-semibold tracking-wide text-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Submitting…</span>
                  </>
                ) : (
                  'Submit'
                )}
              </button>
            </form>

            <div className="mt-5 text-center">
              <Link
                to="/login"
                className="text-sm font-semibold text-[#0856C3] dark:text-[#60A5FA] hover:text-[#06449E] dark:hover:text-[#93C5FD] hover:underline transition-colors"
              >
                Back to Login
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
