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
    <div className="min-h-screen w-screen flex flex-col justify-center items-center p-4 sm:p-6 bg-white dark:bg-[#0b1121] text-slate-900 dark:text-white transition-colors duration-200">
      <div className="w-full max-w-[440px] flex flex-col items-center text-center">
        {/* Brand Logo */}
        <img
          src={brandLogo}
          alt="Document Automation System"
          className="w-16 h-16 sm:w-20 sm:h-20 object-contain mb-4 select-none"
        />

        {/* Brand Title: Full Horizontal */}
        <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-[#0F2856] dark:text-white whitespace-nowrap mb-6 sm:mb-8 select-none">
          Document Automation System
        </h1>

        {sent ? (
          /* ── Success State ── */
          <div className="w-full bg-slate-50 dark:bg-[#141b2d] border border-slate-200 dark:border-transparent rounded-2xl p-7 sm:p-8 shadow-sm">
            <div className="w-12 h-12 rounded-full bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800/50 flex items-center justify-center mx-auto mb-4 text-green-600 dark:text-green-400">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Check Your Email
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
              If <strong className="text-slate-900 dark:text-white font-medium">{email.trim()}</strong> is registered, a password reset link has been sent. The link expires in 60 minutes.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center justify-center w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              Back to Login
            </Link>
          </div>
        ) : (
          /* ── Form State (Bold "FORGOT PASSWORD" and icons removed as requested) ── */
          <div className="w-full">
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 sm:mb-7">
              Please enter your email to receive a password reset link.
            </p>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400 text-left font-medium" role="alert">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {/* Clean Email Address input (no @ button and no document icon) */}
              <div>
                <input
                  id="fp-email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  placeholder="Email Address"
                  autoComplete="email"
                  autoFocus
                  required
                  disabled={submitting}
                  className="w-full px-4 py-3 bg-white dark:bg-[#0b1121] border border-slate-300 dark:border-[#1e293b] rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-all text-left"
                />
              </div>

              {/* Solid Blue SUBMIT button */}
              <button
                type="submit"
                disabled={submitting || !email.trim()}
                aria-busy={submitting}
                className="w-full py-3 px-4 rounded-lg bg-[#1D72D8] hover:bg-[#155AB6] active:bg-[#104386] text-white font-bold tracking-wider text-sm shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed uppercase flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>SUBMITTING…</span>
                  </>
                ) : (
                  'SUBMIT'
                )}
              </button>
            </form>

            {/* Back to Login link */}
            <div className="mt-6 text-center">
              <Link
                to="/login"
                className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
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
