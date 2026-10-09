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

  const isDraft = result?.status === 'draft' || result?.isDraft === true;
  const verified = !isDraft && result?.verified === true;
  const notFound = result?.verified === false && result?.reason === 'not_found';
  const unapproved = !isDraft && result?.isAuthentic === true && result?.isApproved === false;
  const tampered = !isDraft && result?.verified === false && result?.reason !== 'not_found' && !unapproved;

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
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0f2856] dark:text-[#F1F5F9] whitespace-nowrap mb-5">
          Document Automation System
        </h1>

        <div className="w-full bg-white dark:bg-[#151E2B] border border-slate-200 dark:border-[#223044] rounded-lg p-6 sm:p-7 shadow-none text-left">
          {!result ? (
            /* ── Verification Form ── */
            <div className="w-full">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white tracking-tight mb-1 text-center">
                Document Verification
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-5 text-center">
                Please enter your Document ID to verify authenticity
              </p>

              {error && (
                <div className="mb-4 p-2.5 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400 text-left font-medium" role="alert">
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
                  className="w-full h-[38px] px-3 bg-white dark:bg-[#1A2536] border border-slate-300 dark:border-[#223044] rounded-md text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#0856C3] dark:focus:border-[#2563EB] focus:ring-1 focus:ring-[#0856C3] transition-all uppercase tracking-wider placeholder:normal-case"
                />

                <button
                  type="submit"
                  disabled={loading || !docId.trim()}
                  aria-busy={loading}
                  className="w-full h-[36px] px-4 rounded-md bg-[#0856C3] hover:bg-[#06449E] active:bg-[#053782] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white font-semibold text-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                  className="text-xs font-medium text-[#0856C3] dark:text-[#60A5FA] hover:text-[#06449E] dark:hover:text-[#93C5FD] hover:underline transition-colors"
                >
                  Back to Sign In
                </Link>
              </div>
            </div>
          ) : (
            /* ── Verification Result ── */
            <div className="w-full text-left">
              <div className={`p-4 rounded-md border mb-4 ${
                verified
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
                  : isDraft
                    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-100'
                    : 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800 text-red-900 dark:text-red-100'
              }`}>
                <div className="flex items-center gap-2.5 mb-2">
                  {verified ? (
                    <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold">✓</span>
                  ) : isDraft ? (
                    <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold">!</span>
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold">✕</span>
                  )}
                  <span className="font-semibold text-sm">
                    {verified && 'Document Verified Authentic'}
                    {isDraft && 'Document is Draft — Not Verified'}
                    {notFound && 'Document Not Found'}
                    {unapproved && 'Document Pending Approval'}
                    {tampered && 'Verification Failed (Tampered)'}
                  </span>
                </div>
                <p className="text-xs opacity-90 leading-relaxed mb-3">
                  {verified && 'This document was verified against the cryptographic ledger and has not been altered.'}
                  {isDraft && 'This document is currently in Draft status. It has not completed approval or digital signing, so it cannot be verified as authentic.'}
                  {notFound && 'No matching record exists. Check the document ID and try again.'}
                  {unapproved && 'This document was generated but has not completed the required approval workflow.'}
                  {tampered && 'The digital fingerprint does not match the issued ledger. This document may have been altered.'}
                </p>
                <div className="text-[11px] grid grid-cols-2 gap-1.5 pt-2 border-t border-current/10">
                  <div><strong>ID:</strong> {result.docId || result.metadata?.documentId || docId}</div>
                  <div><strong>Status:</strong> <span className={`font-semibold uppercase ${isDraft ? 'text-amber-700 dark:text-amber-400' : verified ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>{result.status ? (result.status.charAt(0).toUpperCase() + result.status.slice(1)) : (isDraft ? 'Draft' : 'Active')}</span></div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={reset}
                  className="flex-1 h-[34px] px-4 rounded-md bg-[#0856C3] hover:bg-[#06449E] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white font-medium text-xs transition-colors"
                >
                  Verify Another
                </button>
                <Link
                  to="/login"
                  className="h-[34px] px-4 rounded-md border border-slate-300 dark:border-[#223044] text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1A2536] transition-colors inline-flex items-center justify-center"
                >
                  Sign In
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
