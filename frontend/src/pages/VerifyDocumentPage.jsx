import { useState } from 'react';
import { Link } from 'react-router-dom';
import { verifyByDocId } from '../services/publicService';
import logo from '../assets/logo.svg';

export default function VerifyDocumentPage() {
  const [docId,   setDocId]   = useState('');
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

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
  const tampered = result?.verified === false && result?.reason !== 'not_found';

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* ─────────────────────────────────────
           PAGE — fixed 100vh, no scroll ever
        ───────────────────────────────────────*/
        .vp {
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif;
          background: linear-gradient(155deg, #07111F 0%, #0F2747 60%, #091829 100%);
          position: relative;
        }

        /* background grid */
        .vp::before {
          content:'';
          position:fixed; inset:0;
          background-image:
            linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),
            linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px);
          background-size:42px 42px;
          pointer-events:none; z-index:0;
        }
        /* glow */
        .vp::after {
          content:'';
          position:fixed; width:600px; height:600px; border-radius:50%;
          background:radial-gradient(circle,rgba(21,154,156,0.13) 0%,transparent 65%);
          top:-160px; left:50%; transform:translateX(-50%);
          pointer-events:none; z-index:0;
          animation:vglow 11s ease-in-out infinite alternate;
        }
        @keyframes vglow {
          from{transform:translateX(-50%) scale(1);}
          to  {transform:translateX(-50%) scale(1.12);}
        }
        @media (prefers-reduced-motion:reduce){ .vp::after{animation:none;} }

        /* ── top bar ── */
        .vp-bar {
          position:relative; z-index:2;
          width:100%; max-width:520px;
          display:flex; align-items:center; justify-content:space-between;
          padding:0 0 14px;
          flex-shrink:0;
        }
        .vp-bar-brand { display:flex; align-items:center; gap:9px; }
        .vp-bar-logo {
          width:30px; height:30px; border-radius:8px; overflow:hidden;
          flex-shrink:0; box-shadow:0 2px 8px rgba(0,0,0,0.4);
        }
        .vp-bar-logo img { width:100%; height:100%; object-fit:cover; }
        .vp-bar-name {
          font-size:0.75rem; font-weight:800; letter-spacing:0.1em;
          text-transform:uppercase; color:#fff;
        }
        .vp-bar-back {
          font-size:0.72rem; font-weight:600; color:rgba(232,238,247,0.5);
          text-decoration:none; display:inline-flex; align-items:center; gap:4px;
          transition:color .15s;
        }
        .vp-bar-back:hover { color:#27B8BA; }

        /* ── shield ── */
        .vp-shield-wrap {
          position:relative; z-index:2;
          display:flex; justify-content:center; margin-bottom:12px; flex-shrink:0;
        }
        .vp-shield { position:relative; width:60px; height:60px; }
        .vp-ring {
          position:absolute; inset:0; border-radius:50%;
          border:2px solid rgba(21,154,156,0.35);
          animation:ring-pulse 2.8s ease-in-out infinite;
        }
        .vp-ring:nth-child(2){inset:-9px;border-color:rgba(21,154,156,0.18);animation-delay:.7s;}
        .vp-ring:nth-child(3){inset:-18px;border-color:rgba(21,154,156,0.08);animation-delay:1.4s;}
        @keyframes ring-pulse{
          0%,100%{opacity:1;transform:scale(1);}
          50%{opacity:0.35;transform:scale(1.06);}
        }
        @media (prefers-reduced-motion:reduce){ .vp-ring{animation:none;} }
        .vp-shield-icon {
          position:absolute; inset:0;
          background:linear-gradient(135deg,#0E7E80,#159A9C);
          border-radius:50%;
          display:flex; align-items:center; justify-content:center;
          box-shadow:0 4px 18px rgba(21,154,156,0.4);
        }

        /* ── hero text ── */
        .vp-hero {
          position:relative; z-index:2;
          text-align:center; margin-bottom:18px; flex-shrink:0;
        }
        .vp-hero-badge {
          font-size:0.62rem; font-weight:700; letter-spacing:0.18em;
          text-transform:uppercase; color:#27B8BA;
          background:rgba(39,184,186,0.10);
          padding:3px 12px; border-radius:20px;
          display:inline-block; margin-bottom:10px;
        }
        .vp-hero h1 {
          font-family:'Plus Jakarta Sans','Inter',system-ui,sans-serif;
          font-size:clamp(1.4rem,3vw,1.85rem);
          font-weight:800; letter-spacing:-0.03em;
          color:#fff; line-height:1.15; margin-bottom:7px;
        }
        .vp-hero-desc {
          font-size:0.8rem; color:rgba(232,238,247,0.52);
          line-height:1.55; max-width:360px; margin:0 auto;
        }

        /* ── main card ── */
        .vp-card {
          position:relative; z-index:2;
          width:calc(100% - 32px); max-width:480px;
          background:rgba(255,255,255,0.97);
          border-radius:18px; overflow:hidden;
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.07),
            0 8px 24px rgba(0,0,0,0.28),
            0 28px 64px rgba(0,0,0,0.38);
          animation:card-in .5s cubic-bezier(0.22,1,0.36,1) both;
          flex-shrink:0;
        }
        @keyframes card-in {
          from{opacity:0;transform:translateY(16px) scale(0.98);}
          to  {opacity:1;transform:translateY(0) scale(1);}
        }
        .dark .vp-card { background: var(--bg-raised); box-shadow: var(--shadow-overlay); }

        /* card body */
        .vp-body { padding:22px 24px 20px; }

        /* scan bar */
        .vp-scan {
          position:relative; height:2px;
          background:rgba(21,154,156,0.10);
          border-radius:2px; margin-bottom:16px; overflow:hidden;
        }
        .vp-scan-bar {
          position:absolute; left:0; top:0; height:100%; width:38%;
          background:linear-gradient(90deg,transparent,#159A9C,transparent);
          animation:scan-mv 1.1s ease-in-out infinite;
        }
        @keyframes scan-mv{ 0%{left:-38%;} 100%{left:138%;} }
        @media (prefers-reduced-motion:reduce){ .vp-scan{display:none;} }

        /* error */
        .vp-err {
          display:flex; align-items:flex-start; gap:7px;
          padding:9px 11px; background:#FEF2F2;
          border:1px solid #FECACA; border-radius:8px;
          font-size:0.78rem; color:#DC2626; margin-bottom:13px;
          animation:shake .3s ease;
        }
        @keyframes shake {
          0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)}
        }
        @media (prefers-color-scheme:dark) {
          .vp-err{background:rgba(220,38,38,.12);border-color:rgba(248,113,113,.3);color:#F87171;}
        }
        .dark .vp-err { background: var(--error-bg); border-color: var(--error-border); color: var(--error-text); }

        /* field */
        .vp-field { display:flex; flex-direction:column; gap:5px; margin-bottom:14px; }
        .vp-lbl { font-size:0.75rem; font-weight:600; color:var(--text-primary); letter-spacing:0.01em; }
        .dark .vp-lbl { color: var(--text-secondary); }
        .vp-hint { font-size:0.7rem; color:var(--text-muted); }
        .dark .vp-hint { color: var(--text-muted); }

        .vp-inp {
          width:100%; padding:10px 13px;
          border:1.5px solid var(--border-strong); border-radius:9px;
          font-size:0.9rem; font-family:inherit; color:var(--text-primary);
          background:var(--bg-subtle); outline:none;
          transition:border-color .18s,box-shadow .18s,background .18s;
          text-transform:uppercase; letter-spacing:0.04em;
        }
        .vp-inp:focus {
          border-color:var(--accent); background:var(--bg-surface);
          box-shadow:0 0 0 3px rgba(21,154,156,0.14);
        }
        .vp-inp::placeholder{color:var(--text-muted);text-transform:none;letter-spacing:normal;}
        .dark .vp-inp { background: var(--bg-raised); border-color: var(--border); color: var(--text-primary); }
        .dark .vp-inp:focus { border-color: var(--accent); background: var(--bg-raised); box-shadow: 0 0 0 3px rgba(34,184,181,0.14); }
        .dark .vp-inp::placeholder { color: var(--text-muted); }

        /* button */
        .vp-btn {
          width:100%; padding:11px;
          background:linear-gradient(135deg,#159A9C 0%,#0E7E80 100%);
          color:#fff; border:none; border-radius:9px;
          font-size:0.8rem; font-weight:700; font-family:inherit;
          letter-spacing:0.08em; text-transform:uppercase;
          cursor:pointer; transition:opacity .2s,transform .15s,box-shadow .2s;
          box-shadow:0 4px 14px rgba(21,154,156,.36);
          display:flex; align-items:center; justify-content:center; gap:7px;
        }
        .vp-btn:hover:not(:disabled){opacity:.9;transform:translateY(-1px);box-shadow:0 5px 18px rgba(21,154,156,.46);}
        .vp-btn:active:not(:disabled){transform:translateY(0);}
        .vp-btn:disabled{opacity:.55;cursor:not-allowed;transform:none;}
        .vp-spin {
          width:13px; height:13px;
          border:2px solid rgba(255,255,255,.3); border-top-color:#fff;
          border-radius:50%; animation:spin .65s linear infinite; flex-shrink:0;
        }
        @keyframes spin{to{transform:rotate(360deg)}}

        /* ── result ── */
        .vp-result {
          margin-top:16px; border-radius:11px; overflow:hidden;
          animation:card-in .38s cubic-bezier(0.22,1,0.36,1) both;
        }
        .vp-rhead {
          padding:13px 15px;
          display:flex; align-items:center; gap:11px;
        }
        .vp-rhead.ok   {background:#F0FDF4;}
        .vp-rhead.fail {background:#FEF2F2;}
        .dark .vp-rhead.ok { background: var(--success-bg); } .dark .vp-rhead.fail { background: var(--error-bg); }
        .vp-rico {
          width:36px; height:36px; border-radius:50%;
          display:flex; align-items:center; justify-content:center; flex-shrink:0;
        }
        .ok   .vp-rico{background:rgba(22,163,74,0.15);}
        .fail .vp-rico{background:rgba(220,38,38,0.15);}
        .vp-rtitle{font-size:0.9rem;font-weight:700;line-height:1.2;}
        .ok   .vp-rtitle{color:#15803D;}
        .fail .vp-rtitle{color:#B91C1C;}
        .dark .ok .vp-rtitle { color: var(--success-text); } .dark .fail .vp-rtitle { color: var(--error-text); }
        .vp-rsub{font-size:0.73rem;margin-top:2px;}
        .ok   .vp-rsub{color:#16A34A;}
        .fail .vp-rsub{color:#DC2626;}
        .dark .ok .vp-rsub { color: var(--success-text); } .dark .fail .vp-rsub { color: var(--error-text); }

        .vp-rbody {
          padding:12px 15px;
          border-top:1px solid var(--border);
          background:var(--bg-surface);
          display:flex; flex-direction:column; gap:7px;
        }
        .dark .vp-rbody { background: var(--bg-raised); border-top-color: var(--border); }
        .vp-rrow{display:flex;gap:8px;font-size:0.79rem;line-height:1.4;}
        .vp-rkey{font-weight:600;color:var(--text-secondary);min-width:110px;flex-shrink:0;}
        .dark .vp-rkey { color: var(--text-secondary); }
        .vp-rval{color:var(--text-primary);font-family:'SFMono-Regular',Consolas,monospace;font-size:0.78rem;}
        .dark .vp-rval { color: var(--text-primary); }
        .vp-rval.cap{text-transform:capitalize;font-family:inherit;font-size:0.79rem;}
        .vp-rwarn {
          padding:9px 12px; border-radius:7px;
          font-size:0.76rem; line-height:1.5; font-style:italic;
          background:#FEF2F2; color:#B91C1C;
        }
        .dark .vp-rwarn { background: var(--error-bg); color: var(--error-text); }

        /* ── footer ── */
        .vp-foot {
          position:relative; z-index:2; margin-top:14px; flex-shrink:0;
          text-align:center; font-size:0.7rem; color:rgba(232,238,247,0.28);
        }
        .vp-foot a{color:rgba(39,184,186,0.65);text-decoration:none;font-weight:600;}
        .vp-foot a:hover{color:#27B8BA;text-decoration:underline;}

        /* inner scroll only on very short screens so card doesn't clip */
        @media (max-height:620px) {
          .vp { overflow-y:auto; height:auto; min-height:100vh; justify-content:flex-start; padding:24px 0 32px; }
        }
        @media (max-width:520px){
          .vp-body{padding:18px 16px 16px;}
          .vp-hero h1{font-size:1.3rem;}
        }
        @media (max-width:380px){
          .vp-body{padding:14px 12px 12px;}
          .vp-rkey{min-width:90px;}
        }
      `}</style>

      <div className="vp">

        {/* top bar */}
        <div className="vp-bar">
          <div className="vp-bar-brand">
            <div className="vp-bar-logo"><img src={logo} alt="Document Automation"/></div>
            <span className="vp-bar-name">Document Automation</span>
          </div>
          <Link to="/login" className="vp-bar-back">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Sign In
          </Link>
        </div>

        {/* animated shield */}
        <div className="vp-shield-wrap">
          <div className="vp-shield">
            <div className="vp-ring"/>
            <div className="vp-ring"/>
            <div className="vp-ring"/>
            <div className="vp-shield-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <polyline points="9 12 11 14 15 10"/>
              </svg>
            </div>
          </div>
        </div>

        {/* hero */}
        <div className="vp-hero">
          <div className="vp-hero-badge">Public Verification Portal</div>
          <h1>Verify Your Document</h1>
          <p className="vp-hero-desc">
            Confirm the authenticity and integrity of a document — no account required.
          </p>
        </div>

        {/* card */}
        <div className="vp-card" role="main">
          <div className="vp-body">

            {loading && <div className="vp-scan"><div className="vp-scan-bar"/></div>}

            {error && (
              <div className="vp-err" role="alert">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
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
              <div className="vp-field">
                <label htmlFor="vp-id" className="vp-lbl">Document ID</label>
                <p className="vp-hint">Printed on the document — format: DOC-YYYYMMDD-XXXXX</p>
                <input
                  id="vp-id"
                  className="vp-inp"
                  value={docId}
                  onChange={e=>{ setDocId(e.target.value); reset(); }}
                  placeholder="e.g. DOC-20260817-A1B2C"
                  autoFocus
                  disabled={loading}
                />
              </div>

              <button type="submit" className="vp-btn"
                disabled={loading || !docId.trim()} aria-busy={loading}>
                {loading ? (
                  <><div className="vp-spin" aria-hidden="true"/>Verifying…</>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                      strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    VERIFY DOCUMENT
                  </>
                )}
              </button>
            </form>

            {/* ── result ── */}
            {result && (
              <div className={`vp-result ${verified?'ok':'fail'}`}>

                <div className={`vp-rhead ${verified?'ok':'fail'}`}>
                  <div className="vp-rico">
                    {verified ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                        stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                        stroke="#B91C1C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="15" y1="9" x2="9" y2="15"/>
                        <line x1="9" y1="9" x2="15" y2="15"/>
                      </svg>
                    )}
                  </div>
                  <div>
                    <div className="vp-rtitle">
                      {verified
                        ? '✓ Document is Authentic & Untampered'
                        : notFound ? 'Document Not Found'
                        : '⚠ Document is Corrupt or Forged'}
                    </div>
                    <div className="vp-rsub">
                      {verified
                        ? 'Verified against the original record.'
                        : notFound ? 'No document with this ID exists in our records.'
                        : 'Hash mismatch — content may have been modified.'}
                    </div>
                  </div>
                </div>

                {(result.docId || result.status || result.originalSignedAt) && (
                  <div className="vp-rbody">
                    {result.docId && (
                      <div className="vp-rrow">
                        <span className="vp-rkey">Document ID</span>
                        <span className="vp-rval">{result.docId}</span>
                      </div>
                    )}
                    {result.status && (
                      <div className="vp-rrow">
                        <span className="vp-rkey">Status</span>
                        <span className="vp-rval cap">{result.status}</span>
                      </div>
                    )}
                    {result.originalSignedAt && (
                      <div className="vp-rrow">
                        <span className="vp-rkey">Recorded at</span>
                        <span className="vp-rval">{new Date(result.originalSignedAt).toLocaleString()}</span>
                      </div>
                    )}
                    {tampered && (
                      <div className="vp-rwarn">
                        The document may have been modified after generation. Do not rely on its contents.
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}

          </div>
        </div>

        {/* footer */}
        <div className="vp-foot">
          <Link to="/login">Sign in</Link> to access the full Document Automation workspace.
        </div>

      </div>
    </>
  );
}
