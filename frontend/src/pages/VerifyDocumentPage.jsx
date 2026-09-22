import { useState } from 'react';
import { Link } from 'react-router-dom';
import { verifyByDocId } from '../services/publicService';
import brandLogo from '../assets/brand-logo.png';

export default function VerifyDocumentPage() {
  const [docId, setDocId] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function reset() { setResult(null); setError(null); }

  async function handleSubmit(e) {
    e.preventDefault();
    const id = docId.trim().toUpperCase();
    if (!id) { setError('Please enter a Document ID.'); return; }
    reset();
    setLoading(true);
    try {
      const res = await verifyByDocId(id);
      if (!res.data) throw new Error(res.message || 'Verification failed.');
      setResult(res.data);
    } catch (err) {
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const verified = result?.verified === true;
  const notFound = result?.verified === false && result?.reason === 'not_found';
  const unapproved = result?.isAuthentic === true && result?.isApproved === false;
  const tampered = result?.verified === false && result?.reason !== 'not_found' && !unapproved;

  return (
    <div className="h-screen max-h-screen w-screen overflow-hidden flex flex-col justify-center items-center p-4 bg-white dark:bg-[#0A0F1D] text-slate-900 dark:text-white transition-colors duration-200 select-none">
      <div className="w-full max-w-[440px] flex flex-col items-center text-center">
        {/* Brand Logo */}
        <img
          src={brandLogo}
          alt="Document Automation System"
          className="w-16 h-16 sm:w-20 sm:h-20 object-contain mb-3 select-none"
        />

        {/* Brand Title: Full Horizontal */}
        <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap mb-5">
          Document Automation System
        </h1>

        {/* Divider line matching reference mockup */}
        <div className="w-full border-t border-slate-200 dark:border-slate-800/80 mb-5" />

        {!result ? (
          /* ── Verification Form ── */
          <div className="w-full">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight mb-2">
              Verification
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-6">
              Please insert your Document ID to continue
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
              <input
                id="vp-doc-id"
                type="text"
                value={docId}
                onChange={(e) => { setDocId(e.target.value); setError(null); }}
                placeholder="Enter Document ID"
                autoComplete="off"
                autoFocus
                required
                disabled={loading}
                className="w-full px-4 py-3 bg-white dark:bg-[#0B1320] border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-all uppercase tracking-wider placeholder:normal-case"
              />

              <button
                type="submit"
                disabled={loading || !docId.trim()}
                aria-busy={loading}
                className="w-full py-3 px-4 rounded-lg bg-[#1D72D8] hover:bg-[#155AB6] active:bg-[#104386] text-white font-semibold text-sm shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Verifying…</span>
                  </>
                ) : (
                  'Verify Document'
                )}
              </button>
            </form>

            <div className="mt-5 text-center">
              <Link
                to="/login"
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline transition-colors"
              >
                Back to Sign In
              </Link>
            </div>
          </div>
        ) : (
          /* ── Verification Result (Clean & Compact to avoid scrolling) ── */
          <div className="w-full text-left">
            <div className={`p-4 rounded-xl border mb-4 ${
              verified
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
                : 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800 text-red-900 dark:text-red-100'
            }`}>
              <div className="flex items-center gap-2.5 mb-2">
                {verified ? (
                  <span className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold">✓</span>
                ) : (
                  <span className="w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold">✕</span>
                )}
                <span className="font-bold text-sm">
                  {verified && 'Document Verified Authentic'}
                  {notFound && 'Document Not Found'}
                  {unapproved && 'Document Pending Approval'}
                  {tampered && 'Verification Failed (Tampered)'}
                </span>
              </div>
              <p className="text-xs opacity-90 leading-relaxed mb-3">
                {verified && 'This document was verified against the cryptographic ledger and has not been altered.'}
                {notFound && 'No matching record exists. Check the document ID and try again.'}
                {unapproved && 'This document was generated but has not completed the required approval workflow.'}
                {tampered && 'The digital fingerprint does not match the issued ledger. This document may have been altered.'}
              </p>
              {result.metadata && (
                <div className="text-[11px] grid grid-cols-2 gap-1.5 pt-2 border-t border-current/10">
                  <div><strong>ID:</strong> {result.metadata.documentId || docId}</div>
                  <div><strong>Status:</strong> {result.metadata.status || 'Active'}</div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={reset}
                className="flex-1 py-2.5 px-4 rounded-lg bg-[#1D72D8] hover:bg-[#155AB6] text-white font-semibold text-xs transition-colors"
              >
                Verify Another
              </button>
              <Link
                to="/login"
                className="py-2.5 px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-center"
              >
                Sign In
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
