import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../services/authService';
import brandLogo from '../assets/brand-logo.png';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  // Password criteria checks
  const hasLen = newPw.length >= 8;
  const hasUpper = /[A-Z]/.test(newPw);
  const hasLower = /[a-z]/.test(newPw);
  const hasNumber = /[0-9]/.test(newPw);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPw);

  const criteriaCount = [hasLen, hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;
  const isAllCriteriaMet = hasLen && hasUpper && hasLower && hasNumber && hasSpecial;

  // Strength level: Weak (1-2), Medium (3-4), Strong (5)
  const strengthLevel = newPw.length === 0
    ? null
    : isAllCriteriaMet
      ? 'strong'
      : criteriaCount >= 3
        ? 'medium'
        : 'weak';

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('This reset link is missing its token. Please use the link from your email.');
      return;
    }

    if (!isAllCriteriaMet) {
      setError('Password must be Strong: at least 8 characters including uppercase, lowercase, a number, and a special character.');
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

  return (
    <div className="h-screen max-h-screen w-screen overflow-hidden flex flex-col justify-center items-center p-4 bg-white dark:bg-[#0A0F1D] text-slate-900 dark:text-white transition-colors duration-200 select-none">
      <div className="w-full max-w-[420px] flex flex-col items-center text-center">
        {/* Brand Logo */}
        <img
          src={brandLogo}
          alt="Document Automation System"
          className="w-16 h-16 sm:w-20 sm:h-20 object-contain mb-3 select-none"
        />

        {/* Brand Title: Full Horizontal */}
        <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap mb-6 select-none">
          Document Automation System
        </h1>

        {done ? (
          /* ── Success State ── */
          <div className="w-full bg-slate-50 dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-2xl p-7 shadow-sm">
            <div className="w-12 h-12 rounded-full bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800/50 flex items-center justify-center mx-auto mb-3 text-green-600 dark:text-green-400">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Password Updated
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-5 leading-relaxed">
              Your password has been changed successfully. You can now sign in with your new credentials.
            </p>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-[#1D72D8] hover:bg-[#155AB6] text-white transition-colors"
            >
              Sign In
            </button>
          </div>
        ) : (
          /* ── Reset Form (Bold "Reset Password" heading removed as requested) ── */
          <div className="w-full text-left">
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-5 text-center">
              Please choose a new password for your account
            </p>

            {/* Missing token banner */}
            {!token && (
              <div className="mb-4 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-700 dark:text-amber-400">
                No token found. Please use the link from your email or{' '}
                <Link to="/forgot-password" className="font-semibold underline">request a new one</Link>.
              </div>
            )}

            {error && (
              <div className="mb-4 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-2 text-xs text-red-600 dark:text-red-400 font-medium" role="alert">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {/* New Password */}
              <div>
                <label htmlFor="rp-new" className="block text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  New Password
                </label>
                <div className="relative flex items-center">
                  <input
                    id="rp-new"
                    type={showNewPw ? 'text' : 'password'}
                    value={newPw}
                    onChange={(e) => { setNewPw(e.target.value); setError(null); }}
                    placeholder="New Password"
                    autoComplete="new-password"
                    autoFocus
                    required
                    disabled={!token || submitting}
                    className="w-full px-3.5 pr-10 py-2.5 bg-white dark:bg-[#0B1320] border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw(!showNewPw)}
                    className="absolute right-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none transition-colors p-1"
                    title={showNewPw ? 'Hide password' : 'Show password'}
                  >
                    {showNewPw ? (
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

                {/* Password Strength Indicator */}
                {newPw.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {/* Visual 3-level bar */}
                    <div className="flex gap-1.5">
                      <div className={`h-1 flex-1 rounded-full transition-all ${
                        strengthLevel === 'weak' ? 'bg-red-500' : strengthLevel === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'
                      }`} />
                      <div className={`h-1 flex-1 rounded-full transition-all ${
                        strengthLevel === 'medium' ? 'bg-amber-500' : strengthLevel === 'strong' ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-800'
                      }`} />
                      <div className={`h-1 flex-1 rounded-full transition-all ${
                        strengthLevel === 'strong' ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-800'
                      }`} />
                    </div>

                    {/* Status label */}
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500 dark:text-slate-400">
                        {strengthLevel === 'strong' ? 'Strong Password' : 'Password Strength:'}
                      </span>
                      <span className={`font-bold capitalize ${
                        strengthLevel === 'strong' ? 'text-emerald-600 dark:text-emerald-400' : strengthLevel === 'medium' ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'
                      }`}>
                        {strengthLevel}
                      </span>
                    </div>

                    {/* Criteria checklist */}
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] pt-1">
                      <span className={hasUpper ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}>
                        {hasUpper ? '✓' : '○'} Uppercase letter
                      </span>
                      <span className={hasLower ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}>
                        {hasLower ? '✓' : '○'} Lowercase letter
                      </span>
                      <span className={hasNumber ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}>
                        {hasNumber ? '✓' : '○'} Number
                      </span>
                      <span className={hasSpecial ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}>
                        {hasSpecial ? '✓' : '○'} Special character
                      </span>
                      <span className={`col-span-2 ${hasLen ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                        {hasLen ? '✓' : '○'} At least 8 characters
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm New Password */}
              <div>
                <label htmlFor="rp-confirm" className="block text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Confirm New Password
                </label>
                <div className="relative flex items-center">
                  <input
                    id="rp-confirm"
                    type={showConfirmPw ? 'text' : 'password'}
                    value={confirmPw}
                    onChange={(e) => { setConfirmPw(e.target.value); setError(null); }}
                    placeholder="Confirm New Password"
                    autoComplete="new-password"
                    required
                    disabled={!token || submitting}
                    className="w-full px-3.5 pr-10 py-2.5 bg-white dark:bg-[#0B1320] border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPw(!showConfirmPw)}
                    className="absolute right-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none transition-colors p-1"
                    title={showConfirmPw ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPw ? (
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
                {confirmPw.length > 0 && (
                  <p className={`text-[11px] text-right mt-1 font-medium ${newPw === confirmPw ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                    {newPw === confirmPw ? '✓ Passwords match' : '✗ Passwords do not match'}
                  </p>
                )}
              </div>

              {/* Solid Blue Update Password Button (disabled unless Strong & matching) */}
              <button
                type="submit"
                disabled={submitting || !token || !isAllCriteriaMet || newPw !== confirmPw}
                aria-busy={submitting}
                className="w-full py-3 px-4 rounded-lg bg-[#1D72D8] hover:bg-[#155AB6] active:bg-[#104386] text-white font-semibold text-sm shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
              >
                {submitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Updating Password…</span>
                  </>
                ) : (
                  'Update Password'
                )}
              </button>
            </form>

            {/* Centered Cancel link */}
            <div className="mt-4 text-center">
              <Link
                to="/login"
                className="text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Cancel
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
