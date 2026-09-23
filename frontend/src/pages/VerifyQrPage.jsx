import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { verifyByQrId } from '../services/publicService';
import brandLogo from '../assets/brand-logo.png';

const STATUS_COPY = {
  VALID: { title: 'Document is Valid', tone: 'ok' },
  REVOKED: { title: 'Document has been Revoked', tone: 'fail' },
  INVALID: { title: 'Invalid Verification Code', tone: 'fail' },
};

export default function VerifyQrPage() {
  const { verificationId } = useParams();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    verifyByQrId(verificationId)
      .then((res) => { if (!cancelled) setResult(res.data); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Verification failed.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [verificationId]);

  const copy = result ? (STATUS_COPY[result.status] || STATUS_COPY.INVALID) : null;

  return (
    <div className="min-h-screen flex flex-col justify-between bg-white dark:bg-[#0A0F1D] text-slate-900 dark:text-slate-100 transition-colors duration-200">
      {/* Top bar with brand */}
      <header className="w-full max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={brandLogo} alt="Document Automation System" className="w-8 h-8 object-contain" />
          <span className="font-bold text-sm tracking-tight text-[#0F2856] dark:text-white whitespace-nowrap">
            Document Automation System
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            Sign In
          </Link>
        </div>
      </header>

      {/* Centered Card */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 transition-all">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-blue-600 dark:text-blue-500 tracking-tight mb-2">
              QR Verification
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Scanned from document QR security code
            </p>
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <span className="w-6 h-6 border-2 border-blue-600/30 border-t-blue-600 rounded-full animate-spin" />
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Verifying code…</p>
            </div>
          )}

          {error && (
            <div className="mb-5 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-2 text-xs text-red-600 dark:text-red-400 font-medium" role="alert">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {result && copy && (
            <div className={`p-4 rounded-xl border ${
              copy.tone === 'ok'
                ? 'bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900/40 text-green-800 dark:text-green-300'
                : 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40 text-red-800 dark:text-red-300'
            }`}>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {copy.tone === 'ok' ? (
                    <svg className="w-5 h-5 text-green-600 dark:text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  )}
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                    {copy.title}
                  </h2>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-800/60 text-xs space-y-1.5 font-mono">
                {result.docId && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-sans">Doc ID:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{result.docId}</span>
                  </div>
                )}
                {result.templateName && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-sans">Template:</span>
                    <span className="text-slate-900 dark:text-white font-sans">{result.templateName}</span>
                  </div>
                )}
                {result.generatedAt && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-sans">Generated:</span>
                    <span className="text-slate-900 dark:text-white font-sans">{new Date(result.generatedAt).toLocaleDateString()}</span>
                  </div>
                )}
                {result.status === 'REVOKED' && result.revokedAt && (
                  <div className="flex justify-between text-red-600 dark:text-red-400">
                    <span className="font-sans">Revoked:</span>
                    <span className="font-sans">{new Date(result.revokedAt).toLocaleDateString()}</span>
                  </div>
                )}
                {result.status === 'INVALID' && (
                  <p className="text-xs text-red-600 dark:text-red-400 font-sans mt-2">
                    This verification code doesn't match any document in our records.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-4 text-center text-xs text-slate-400 dark:text-slate-600">
        &copy; {new Date().getFullYear()} Document Automation. All rights reserved.
      </footer>
    </div>
  );
}
