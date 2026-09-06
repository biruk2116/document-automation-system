import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import logo from '../assets/logo.svg';
import {
  getSecureDeliveryLanding,
  verifySecureDeliveryOtp,
  resendSecureDeliveryOtp,
  getSecureDeliveryDetails,
  ownDelivery,
  downloadSecureDelivery,
} from '../services/publicService';

const API_BASE = import.meta.env?.VITE_API_URL || '/api';

/* ── Workflow API helpers ───────────────────────────────────────────────── */
async function callWorkflowAcknowledge(token, responseText = null) {
  const body = {};
  if (responseText && String(responseText).trim()) {
    body.response = String(responseText).trim();
  }
  const res = await fetch(`${API_BASE}/secure-delivery/${encodeURIComponent(token)}/acknowledge`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to acknowledge.');
  return data;
}

/**
 * workflowSign — records the signature AND marks workflow complete.
 * This is the "Submit" action: the server generates the tracking token
 * and sends the ONE notification email to the Generator.
 */
async function callWorkflowSign(token, signatureText, signaturePhotoBase64 = null) {
  const res = await fetch(`${API_BASE}/secure-delivery/${encodeURIComponent(token)}/workflow-sign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signature_text: signatureText,
      ...(signaturePhotoBase64 ? { signature_photo: signaturePhotoBase64 } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to submit signature.');
  return data;
}

async function callWorkflowRespond(token, response) {
  const res = await fetch(`${API_BASE}/secure-delivery/${encodeURIComponent(token)}/workflow-respond`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to send response.');
  return data;
}

/* ── Shared UI components ───────────────────────────────────────────────── */
function CheckCircleIcon({ size = 20, color = '#16A34A' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function StepBadge({ n, active, done }) {
  const bg  = done ? '#16A34A' : active ? '#159A9C' : '#E2E8F0';
  const clr = done || active ? '#fff' : '#94A3B8';
  return (
    <div style={{
      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
      background: bg, color: clr,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.75rem', fontWeight: 700, transition: 'background 0.2s',
    }}>
      {done
        ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff"
            strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        : n}
    </div>
  );
}

function Card({ children, style = {} }) {
  return (
    <div className="public-card" style={style}>
      {children}
    </div>
  );
}

function ActionBtn({ onClick, disabled, loading, children, variant = 'primary', style = {} }) {
  const variants = {
    primary:   { background: 'var(--accent)',        color: 'var(--text-inverse)' },
    green:     { background: '#16A34A',               color: '#fff' },
    navy:      { background: 'var(--brand)',          color: 'var(--text-inverse)' },
    secondary: { background: 'var(--bg-surface)',     color: 'var(--text-primary)', border: '1px solid var(--border-strong)' },
    indigo:    { background: '#6366F1',               color: '#fff' },
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled || loading}
      style={{
        padding: '10px 20px', borderRadius: 8, fontWeight: 600, fontSize: '0.88rem',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1, border: 'none', fontFamily: 'inherit',
        display: 'inline-flex', alignItems: 'center', gap: 7,
        transition: 'opacity .15s',
        ...variants[variant],
        ...style,
      }}>
      {loading && (
        <span style={{
          width: 13, height: 13, border: '2px solid rgba(255,255,255,.35)',
          borderTopColor: '#fff', borderRadius: '50%',
          animation: 'sdp-spin .6s linear infinite', display: 'inline-block',
        }} aria-hidden="true"/>
      )}
      {children}
    </button>
  );
}

function FeedbackMsg({ msg, type = 'error' }) {
  if (!msg) return null;
  const classMap = { error: 'public-status-error', success: 'public-status-success', info: 'public-status-info' };
  return (
    <p className={classMap[type] || 'public-status-error'} style={{ margin: '8px 0 0' }}>{msg}</p>
  );
}

/* ── Derive ordered workflow steps from config ──────────────────────────── */
function buildSteps(wf) {
  const cfg   = wf || {};
  const steps = [];
  if (cfg.viewDocument)                            steps.push({ id: 'view',      label: 'View Document' });
  steps.push(                                               { id: 'ownership', label: 'Confirm Ownership' });
  if (cfg.acknowledge)                             steps.push({ id: 'acknowledge',label: 'Acknowledge' });
  if (cfg.userSignature)                           steps.push({ id: 'sign',       label: 'Sign & Submit' });
  if (cfg.requireResponse || cfg.sendResponseToGenerator)
                                                   steps.push({ id: 'respond',    label: 'Send Response' });
  steps.push(                                               { id: 'download',  label: 'Download' });
  return steps;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main component
═══════════════════════════════════════════════════════════════════════════ */
export default function SecureDeliveryPage() {
  const { token } = useParams();

  /* ── Landing ── */
  const [loadingLanding, setLoadingLanding] = useState(true);
  const [landingError,   setLandingError]   = useState(null);
  const [docId,          setDocId]          = useState(null);
  const [deliveryId,     setDeliveryId]     = useState(null);

  /* ── OTP gate ── */
  const [otpVerified,  setOtpVerified]  = useState(false);
  const [otpCode,      setOtpCode]      = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [sendingOtp,   setSendingOtp]   = useState(false);
  const [gateFeedback, setGateFeedback] = useState(null);

  /* ── Post-OTP state ── */
  const [details,           setDetails]           = useState(null);
  const [ownershipStatus,   setOwnershipStatus]   = useState('PENDING');
  const [alreadyDownloaded, setAlreadyDownloaded] = useState(false);

  /* ── Workflow state ── */
  const [wfAcknowledgedAt, setWfAcknowledgedAt] = useState(null);
  const [wfSignedAt,       setWfSignedAt]       = useState(null);  // set after Submit
  const [wfResponse,       setWfResponse]       = useState(null);

  /* ── Sign step: two-phase (type → submit) ── */
  const [signText,      setSignText]      = useState('');
  const [signPhotoFile, setSignPhotoFile] = useState(null);  // File object (Upload tab)
  const [signPhotoUrl,  setSignPhotoUrl]  = useState(null);  // object URL for preview
  const [signTab,       setSignTab]       = useState('draw'); // 'draw' | 'upload'
  const [signPreview,   setSignPreview]   = useState(false);  // true after Apply, before Submit
  const [signing,       setSigning]       = useState(false);
  const [signError,     setSignError]     = useState(null);

  /* ── Canvas drawing (Draw tab) ── */
  const canvasRef      = useRef(null);
  const isDrawing      = useRef(false);
  const lastPos        = useRef({ x: 0, y: 0 });
  const [canvasEmpty,  setCanvasEmpty]    = useState(true);  // true = blank canvas

  /* ── PDF blob ── */
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError,   setPdfError]   = useState(null);
  const blobUrlRef = useRef(null);

  /* ── Per-step UI ── */
  const [owning,          setOwning]          = useState(false);
  const [ownError,        setOwnError]        = useState(null);
  const [acking,          setAcking]          = useState(false);
  const [ackError,        setAckError]        = useState(null);
  const [ackResponseText, setAckResponseText] = useState(''); // optional text sent with acknowledgement
  const [responseText,    setResponseText]    = useState('');
  const [responding,      setResponding]      = useState(false);
  const [respondError,    setRespondError]    = useState(null);
  const [downloading,     setDownloading]     = useState(false);
  const [downloadDone,    setDownloadDone]    = useState(false);
  const [downloadError,   setDownloadError]   = useState(null);

  /* ─────────────────────────────────────────────────────────────────────
     OTP SESSION SECURITY:
     If the user leaves or hides the page (tab switch, close, navigation),
     reset the in-memory otpVerified state.  The delivery token itself is
     already consumed server-side (otp_verified_at / token_used_at stamped)
     so re-opening the link will require a NEW OTP via Resend.
     This prevents a shared device from showing the document to someone
     who opens the browser tab later without re-verifying identity.
  ───────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const handleHide = () => {
      // Only reset if we're in the unlocked state — don't disturb the OTP
      // entry screen itself (user may switch to email to get the code).
      if (otpVerified) {
        setOtpVerified(false);
        setDetails(null);
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
        setPdfBlobUrl(null);
        setPdfError(null);
        setOtpCode('');
        setGateFeedback({ type: 'info', message: 'For your security, please verify your OTP again to continue.' });
      }
    };

    // visibilitychange fires on tab switch / minimize / lock screen
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') handleHide();
    });
    // pagehide fires on navigation away / tab close
    window.addEventListener('pagehide', handleHide);

    return () => {
      document.removeEventListener('visibilitychange', handleHide);
      window.removeEventListener('pagehide', handleHide);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpVerified]);

  /* ── Landing fetch ── */
  useEffect(() => {
    let cancelled = false;
    getSecureDeliveryLanding(token)
      .then(res => {
        if (cancelled) return;
        setDocId(res.data?.docId || null);
        setDeliveryId(res.data?.deliveryId || null);
        // Do NOT restore otpVerified from server — always require OTP on page load
        setOwnershipStatus(res.data?.ownershipStatus || 'PENDING');
        setAlreadyDownloaded(Boolean(res.data?.alreadyDownloaded));
      })
      .catch(err => { if (!cancelled) setLandingError(err.message || 'This link is invalid or has expired.'); })
      .finally(() => { if (!cancelled) setLoadingLanding(false); });
    return () => { cancelled = true; };
  }, [token]);

  /* ── Fetch details + workflow state after OTP verified ── */
  useEffect(() => {
    if (!otpVerified || details) return;
    let cancelled = false;
    getSecureDeliveryDetails(token)
      .then(res => {
        if (cancelled) return;
        setDetails(res.data || null);
        setOwnershipStatus(res.data?.ownershipStatus || 'PENDING');
        setWfAcknowledgedAt(res.data?.workflowAcknowledgedAt || null);
        setWfSignedAt(res.data?.workflowUserSignedAt || null);
        setWfResponse(res.data?.workflowResponse || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [otpVerified, details, token]);

  /* ── Fetch PDF after OTP verified ── */
  useEffect(() => {
    if (!otpVerified || pdfBlobUrl || pdfLoading) return;
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);
    fetch(`${API_BASE}/secure-delivery/${encodeURIComponent(token)}/preview`)
      .then(async res => {
        if (!res.ok) {
          let msg = 'Failed to load the document preview.';
          try { const j = await res.json(); msg = j.message || msg; } catch { /* */ }
          throw new Error(msg);
        }
        return res.blob();
      })
      .then(blob => {
        if (cancelled) return;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setPdfBlobUrl(url);
      })
      .catch(err => { if (!cancelled) setPdfError(err.message || 'Could not load preview.'); })
      .finally(() => { if (!cancelled) setPdfLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpVerified, token]);

  useEffect(() => () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); }, []);

  /* ── OTP handlers ── */
  const handleVerifyOtp = async () => {
    if (!otpCode.trim()) { setGateFeedback({ type: 'error', message: 'Enter the OTP code.' }); return; }
    setVerifyingOtp(true); setGateFeedback(null);
    try { await verifySecureDeliveryOtp(token, otpCode.trim()); setOtpVerified(true); }
    catch (err) { setGateFeedback({ type: 'error', message: err.message || 'OTP verification failed.' }); }
    finally { setVerifyingOtp(false); }
  };
  const handleResendOtp = async () => {
    setSendingOtp(true); setGateFeedback(null);
    try { const r = await resendSecureDeliveryOtp(token); setGateFeedback({ type: 'success', message: r.message || 'New OTP sent.' }); }
    catch (err) { setGateFeedback({ type: 'error', message: err.message || 'Failed to resend.' }); }
    finally { setSendingOtp(false); }
  };

  /* ── Step handlers ── */
  const handleOwn = async () => {
    if (!deliveryId) { setOwnError('Delivery ID unavailable — please reload.'); return; }
    setOwning(true); setOwnError(null);
    try { const r = await ownDelivery(deliveryId, token); setOwnershipStatus(r.data?.ownershipStatus || 'CONFIRMED'); }
    catch (err) { setOwnError(err.message || 'Failed to confirm ownership.'); }
    finally { setOwning(false); }
  };

  const handleAcknowledge = async () => {
    setAcking(true); setAckError(null);
    try {
      const r = await callWorkflowAcknowledge(token, ackResponseText.trim() || null);
      setWfAcknowledgedAt(r.data?.acknowledgedAt || new Date().toISOString());
      // If a response was submitted with acknowledgement, also record it in local state
      // so the UI reflects it immediately (for the Respond step status check).
      if (r.data?.response) setWfResponse(r.data.response);
    }
    catch (err) { setAckError(err.message || 'Failed to acknowledge.'); }
    finally { setAcking(false); }
  };

  /**
   * Two-phase sign flow:
   *  Phase 1 — "Apply Signature": validates input, shows preview (signPreview = true).
   *  Phase 2 — "Submit to Generator": calls workflowSign (sets signed + sends email).
   */
  const handleApplySignature = () => {
    if (!signText.trim()) { setSignError('Please type your full name.'); return; }
    const sf = wf?.signatureField;
    if (sf?.required) {
      // At least one signature image source must be present when required
      const hasDrawing = !canvasEmpty;
      const hasUpload  = !!signPhotoUrl;
      if (!hasDrawing && !hasUpload) {
        setSignError('Please draw or upload your signature image.');
        return;
      }
    }
    setSignError(null);
    setSignPreview(true);
  };

  /** Exports the canvas as a base64 PNG data URL, or null if blank. */
  const getCanvasDataUrl = () => {
    const canvas = canvasRef.current;
    if (!canvas || canvasEmpty) return null;
    return canvas.toDataURL('image/png');
  };

  const handleSubmitSignature = async () => {
    setSigning(true); setSignError(null);
    try {
      let photoBase64 = null;

      if (signTab === 'draw') {
        photoBase64 = getCanvasDataUrl(); // PNG data URL from canvas, or null
      } else if (signPhotoFile) {
        // Upload tab — encode the File as a base64 data URL
        photoBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(signPhotoFile);
        });
      }

      const r = await callWorkflowSign(token, signText.trim(), photoBase64);
      setWfSignedAt(r.data?.signedAt || new Date().toISOString());
      setSignPreview(false);
      if (signPhotoUrl) { URL.revokeObjectURL(signPhotoUrl); setSignPhotoUrl(null); }
    }
    catch (err) { setSignError(err.message || 'Failed to submit signature.'); }
    finally { setSigning(false); }
  };

  const handleRespond = async () => {
    if (!responseText.trim()) { setRespondError('Please enter your response.'); return; }
    setResponding(true); setRespondError(null);
    try { await callWorkflowRespond(token, responseText.trim()); setWfResponse(responseText.trim()); }
    catch (err) { setRespondError(err.message || 'Failed to send response.'); }
    finally { setResponding(false); }
  };

  const handleDownload = async () => {
    setDownloading(true); setDownloadError(null);
    try {
      const { url, filename } = await downloadSecureDelivery(token);
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setDownloadDone(true); setAlreadyDownloaded(true);
    }
    catch (err) { setDownloadError(err.message || 'Failed to download.'); }
    finally { setDownloading(false); }
  };

  /* ── Workflow step logic ── */
  const wf       = details?.workflowConfig || null;
  const steps    = buildSteps(wf);
  const wfEnabled = Boolean(wf?.enabled);

  function isStepDone(stepId) {
    switch (stepId) {
      case 'view':       return true;
      case 'ownership':  return ownershipStatus === 'CONFIRMED';
      case 'acknowledge':return Boolean(wfAcknowledgedAt);
      case 'sign':       return Boolean(wfSignedAt);
      case 'respond':    return Boolean(wfResponse);
      case 'download':   return downloadDone || alreadyDownloaded;
      default:           return false;
    }
  }
  const activeStep = steps.find(s => !isStepDone(s.id))?.id || 'download';

  const sectionStyle = (stepId) => ({
    opacity: (!wfEnabled || isStepDone(stepId) || activeStep === stepId) ? 1 : 0.45,
    pointerEvents: (!wfEnabled || activeStep === stepId || isStepDone(stepId)) ? 'auto' : 'none',
    transition: 'opacity .2s',
  });

  /* ═════════════════════════════════════════════════════════════════════════
     Render
  ═════════════════════════════════════════════════════════════════════════ */
  return (
    <>
      <style>{`
        @keyframes sdp-spin { to { transform: rotate(360deg); } }
        .sig-canvas { cursor: crosshair; touch-action: none; display: block; border-radius: 4px; }
        .sig-tab-btn {
          padding: 6px 16px; font-size: 0.82rem; font-weight: 600; font-family: inherit;
          border: 1.5px solid var(--border-strong); border-radius: 6px; cursor: pointer;
          background: var(--bg-surface); color: var(--text-secondary); transition: all .15s;
        }
        .sig-tab-btn.active {
          background: var(--brand); color: var(--text-inverse); border-color: var(--brand);
        }
        /* Scoped text-colour helpers for inline styles that reference hex directly */
        .sdp-text-primary  { color: var(--text-primary); }
        .sdp-text-secondary{ color: var(--text-secondary); }
        .sdp-text-muted    { color: var(--text-muted); }
        .sdp-surface       { background: var(--bg-surface); border-color: var(--border); }
        .sdp-step-connector{ background: var(--border); }
      `}</style>

      <div className="public-page-shell">

        {/* ── Header ── */}
        <div className="public-page-header">
          <div className="public-page-header-brand">
            <img src={logo} alt="" style={{ width: 28, height: 28 }}/>
            Document Automation
          </div>
          <span className="public-page-header-meta">
            Secure delivery{docId ? ` · ${docId}` : ''}
          </span>
          <Link to="/login" className="public-page-header-action">Sign in</Link>
        </div>

        <div style={{ flex: 1, padding: '28px 16px 56px', maxWidth: 920, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

          {/* Loading */}
          {loadingLanding && <p style={{ textAlign: 'center', marginTop: 60, color: 'var(--text-muted)' }}>Loading…</p>}

          {/* Link error */}
          {!loadingLanding && landingError && (
            <Card style={{ maxWidth: 480, margin: '60px auto 0', borderColor: '#FECACA' }}>
              <p style={{ margin: 0, fontWeight: 700, color: '#DC2626' }}>{landingError}</p>
              <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                This link may be invalid, expired, or already used.
              </p>
            </Card>
          )}

          {/* Already used */}
          {!loadingLanding && !landingError &&
            (alreadyDownloaded || ownershipStatus === 'CONFIRMED') && !otpVerified && (
            <Card style={{ maxWidth: 480, margin: '60px auto 0', borderColor: '#BBF7D0', textAlign: 'center' }}>
              <CheckCircleIcon size={44} color="#16A34A"/>
              <h2 style={{ margin: '12px 0 6px', fontSize: '1.05rem', color: '#15803D' }}>
                This link has already been used
              </h2>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {alreadyDownloaded
                  ? 'The document was already downloaded. Each secure link is single-use.'
                  : 'Ownership was already confirmed on this link. Each secure link is single-use.'}
              </p>
              <p style={{ margin: '12px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Contact the sender if you need the document again.
              </p>
            </Card>
          )}

          {/* OTP gate */}
          {!loadingLanding && !landingError &&
            !(alreadyDownloaded && !otpVerified) && !otpVerified && (
            <Card style={{ maxWidth: 460, margin: '60px auto 0' }}>
              <h2 style={{ margin: '0 0 8px', fontSize: '1.2rem', color: 'var(--text-primary)' }}>Confirm It's You</h2>
              <p style={{ margin: '0 0 22px', fontSize: '0.87rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Enter the one-time code sent to your email. The document stays hidden until verified.
              </p>

              <label htmlFor="otp-input" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                6-digit OTP code
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <input
                  id="otp-input"
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()}
                  maxLength={6}
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  disabled={verifyingOtp}
                  autoFocus
                  style={{
                    flex: 1, padding: '10px 14px', fontSize: '1.3rem', letterSpacing: '0.22em',
                    textAlign: 'center', border: '1.5px solid var(--border-strong)', borderRadius: 8,
                    outline: 'none', fontWeight: 600, fontFamily: 'inherit',
                    background: 'var(--bg-surface)', color: 'var(--text-primary)',
                  }}
                />
                <button type="button" onClick={handleResendOtp}
                  disabled={sendingOtp || verifyingOtp}
                  style={{
                    padding: '10px 14px', border: '1px solid var(--border-strong)', borderRadius: 8,
                    background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: '0.83rem',
                    cursor: sendingOtp || verifyingOtp ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap', fontFamily: 'inherit',
                  }}>
                  {sendingOtp ? 'Sending…' : 'Resend'}
                </button>
              </div>

              {gateFeedback && <FeedbackMsg msg={gateFeedback.message} type={gateFeedback.type}/>}

              <ActionBtn
                onClick={handleVerifyOtp}
                loading={verifyingOtp}
                disabled={verifyingOtp || sendingOtp || otpCode.length < 6}
                variant="indigo"
                style={{ width: '100%', justifyContent: 'center', marginTop: 14, padding: '12px' }}
              >
                Unlock Document
              </ActionBtn>
            </Card>
          )}

          {/* ── Unlocked: workflow portal ── */}
          {!loadingLanding && !landingError && otpVerified && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Progress stepper */}
              {wfEnabled && steps.length > 0 && (
                <Card style={{ padding: '14px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 8 }}>
                    {steps.map((s, i) => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <StepBadge n={i + 1} active={activeStep === s.id} done={isStepDone(s.id)}/>
                          <span style={{
                            fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap',
                            color: isStepDone(s.id) ? 'var(--success-text)' : activeStep === s.id ? 'var(--accent)' : 'var(--text-muted)',
                          }}>{s.label}</span>
                        </div>
                        {i < steps.length - 1 && (
                          <div style={{ width: 20, height: 1, background: 'var(--border)', margin: '0 6px', flexShrink: 0 }}/>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Recipient & document info */}
              {details && (
                <Card style={{ padding: '16px 22px' }}>
                  <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 160px' }}>
                      <p style={{ margin: '0 0 3px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recipient</p>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: '0.93rem', color: 'var(--text-primary)' }}>{details.recipient?.name || '—'}</p>
                      <p style={{ margin: '2px 0 0', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{details.recipient?.email || '—'}</p>
                    </div>
                    <div style={{ flex: '1 1 200px' }}>
                      <p style={{ margin: '0 0 3px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Document</p>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: '0.93rem', color: 'var(--text-primary)' }}>{details.document?.templateName || '—'}</p>
                      <p style={{ margin: '2px 0 0', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                        {details.document?.docId}
                        {details.document?.generatedAt ? ` · ${new Date(details.document.generatedAt).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                    {wf?.userType && (
                      <div style={{ flex: '0 1 auto', alignSelf: 'center' }}>
                        <span style={{
                          padding: '4px 12px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600,
                          background: 'rgba(21,154,156,0.10)', color: 'var(--accent-text)',
                          border: '1px solid rgba(21,154,156,0.25)',
                        }}>{wf.userType}</span>
                      </div>
                    )}
                  </div>
                </Card>
              )}

              {/* ── STEP: View Document ── */}
              {(!wfEnabled || wf?.viewDocument) && (
                <Card style={sectionStyle('view')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    {wfEnabled && <StepBadge n={steps.findIndex(s => s.id === 'view') + 1} active={activeStep === 'view'} done={isStepDone('view')}/>}
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>Document Preview</h3>
                  </div>
                  {pdfLoading && <p style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '0.87rem' }}>Loading document…</p>}
                  {pdfError && <FeedbackMsg msg={pdfError} type="error"/>}
                  {pdfBlobUrl && !pdfLoading && (
                    <object
                      data={pdfBlobUrl}
                      type="application/pdf"
                      style={{
                        display: 'block', width: '100%',
                        height: window.innerWidth < 640 ? '55vh' : '72vh',
                        border: '1px solid var(--border)', borderRadius: 6,
                      }}
                    >
                      <p style={{ padding: 20, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        Your browser cannot display PDFs inline.{' '}
                        <a href={pdfBlobUrl} download style={{ color: 'var(--accent)' }}>Download preview</a>
                      </p>
                    </object>
                  )}
                </Card>
              )}

              {/* ── STEP: Confirm Ownership ── */}
              <Card style={sectionStyle('ownership')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  {wfEnabled && <StepBadge n={steps.findIndex(s => s.id === 'ownership') + 1} active={activeStep === 'ownership'} done={isStepDone('ownership')}/>}
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>Confirm Ownership</h3>
                </div>

                {ownershipStatus === 'REJECTED' ? (
                  <div style={{ padding: '12px 14px', background: '#FEF2F2', borderRadius: 8, border: '1px solid #FECACA' }}>
                    <p style={{ margin: 0, fontWeight: 600, color: '#DC2626', fontSize: '0.88rem' }}>
                      You indicated this document is not yours. Download has been permanently blocked.
                    </p>
                    <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Contact the sender if this was a mistake.</p>
                  </div>
                ) : ownershipStatus === 'CONFIRMED' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#16A34A', fontWeight: 600, fontSize: '0.88rem' }}>
                    <CheckCircleIcon size={18} color="#16A34A"/> Ownership confirmed
                  </div>
                ) : (
                  <>
                    <p style={{ margin: '0 0 14px', fontSize: '0.87rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                      Is this document intended for you? Confirming allows you to proceed.
                    </p>
                    <ActionBtn onClick={handleOwn} loading={owning} disabled={owning} variant="primary">
                      Yes, this is my document
                    </ActionBtn>
                    {ownError && <FeedbackMsg msg={ownError} type="error"/>}
                    <p style={{ margin: '10px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      If this document is not yours, contact the sender — do not confirm.
                    </p>
                  </>
                )}
              </Card>

              {/* ── STEP: Acknowledge ── */}
              {wfEnabled && wf?.acknowledge && (
                <Card style={sectionStyle('acknowledge')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <StepBadge n={steps.findIndex(s => s.id === 'acknowledge') + 1} active={activeStep === 'acknowledge'} done={isStepDone('acknowledge')}/>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>Acknowledge Receipt</h3>
                  </div>
                  {wfAcknowledgedAt ? (
                    /* ── Already acknowledged ── */
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--success-text)', fontWeight: 600, fontSize: '0.88rem', marginBottom: wfResponse ? 8 : 0 }}>
                        <CheckCircleIcon size={18} color="var(--success-text)"/>
                        Acknowledged {new Date(wfAcknowledgedAt).toLocaleString()}
                      </div>
                      {wfResponse && (
                        <blockquote style={{
                          margin: '8px 0 0', padding: '8px 12px',
                          borderLeft: '3px solid var(--accent)',
                          background: 'var(--accent-light)',
                          borderRadius: '0 6px 6px 0',
                          fontSize: '0.84rem', color: 'var(--text-primary)',
                          fontStyle: 'italic',
                        }}>
                          "{wfResponse}"
                        </blockquote>
                      )}
                      <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        The document issuer has been notified.
                      </p>
                    </div>
                  ) : (
                    /* ── Pending acknowledgement ── */
                    <>
                      <p style={{ margin: '0 0 12px', fontSize: '0.87rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        Confirm that you have received and reviewed this document.
                        {wf?.acknowledgeResponseLabel
                          ? ` ${wf.acknowledgeResponseLabel}`
                          : ' You may also add a short response for the document issuer.'}
                      </p>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 5 }}>
                        Response to sender
                        {wf?.acknowledgeResponseRequired
                          ? <span style={{ color: 'var(--error-text)' }}> *</span>
                          : <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> (optional)</span>}
                      </label>
                      <textarea
                        value={ackResponseText}
                        onChange={e => { setAckResponseText(e.target.value); setAckError(null); }}
                        placeholder="Write your message or comment back to the document issuer…"
                        rows={3}
                        disabled={acking || ownershipStatus !== 'CONFIRMED'}
                        style={{
                          width: '100%', padding: '10px 13px', fontSize: '0.88rem',
                          border: '1.5px solid var(--border-strong)', borderRadius: 8,
                          outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                          lineHeight: 1.5, marginBottom: 12, boxSizing: 'border-box',
                          background: ownershipStatus !== 'CONFIRMED' ? 'var(--bg-subtle)' : 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                        }}
                      />
                      <ActionBtn
                        onClick={handleAcknowledge}
                        loading={acking}
                        disabled={
                          acking ||
                          ownershipStatus !== 'CONFIRMED' ||
                          (wf?.acknowledgeResponseRequired && !ackResponseText.trim())
                        }
                        variant="primary"
                      >
                        I Acknowledge Receipt
                      </ActionBtn>
                      {ackError && <FeedbackMsg msg={ackError} type="error"/>}
                    </>
                  )}
                </Card>
              )}

              {/* ── STEP: Sign & Submit ── */}
              {wfEnabled && wf?.userSignature && (
                <Card style={sectionStyle('sign')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <StepBadge n={steps.findIndex(s => s.id === 'sign') + 1} active={activeStep === 'sign'} done={isStepDone('sign')}/>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>Sign &amp; Submit</h3>
                  </div>

                  {wfSignedAt ? (
                    /* ── Already submitted ── */
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#16A34A', fontWeight: 600, fontSize: '0.88rem', marginBottom: 6 }}>
                        <CheckCircleIcon size={18} color="#16A34A"/>
                        Signed and submitted {new Date(wfSignedAt).toLocaleString()}
                      </div>
                      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        The document issuer has been notified and can view your signed submission.
                      </p>
                    </div>

                  ) : signPreview ? (
                    /* ── Phase 2: signature preview + Submit ── */
                    <div>
                      <p style={{ margin: '0 0 10px', fontSize: '0.87rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        Review your signature below, then click <strong>Submit to Generator</strong> to send it.
                        The document issuer will receive a notification to review your submission.
                      </p>
                      {/* Signature preview box */}
                      <div style={{
                        padding: '16px 20px', margin: '0 0 14px',
                        background: 'var(--bg-subtle)', border: '1px solid #CBD5E1', borderRadius: 8,
                        borderBottom: '2px solid var(--brand)',
                      }}>
                        <p style={{ margin: '0 0 4px', fontSize: '0.72rem', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Signature</p>
                        <p style={{ margin: 0, fontSize: '1.2rem', fontFamily: 'cursive, serif', color: 'var(--brand-text)', letterSpacing: '0.04em' }}>
                          {signText}
                        </p>
                        {/* Show drawn or uploaded signature preview */}
                        {signTab === 'draw' && !canvasEmpty && canvasRef.current && (
                          <img
                            src={canvasRef.current.toDataURL('image/png')}
                            alt="Drawn signature"
                            style={{
                              display: 'block', marginTop: 10,
                              maxHeight: 64, maxWidth: 260,
                              objectFit: 'contain',
                              border: '1px solid var(--border)', borderRadius: 4,
                              background: 'var(--bg-surface)', padding: 4,
                            }}
                          />
                        )}
                        {signTab === 'upload' && signPhotoUrl && (
                          <img
                            src={signPhotoUrl}
                            alt="Uploaded signature"
                            style={{
                              display: 'block', marginTop: 10,
                              maxHeight: 64, maxWidth: 260,
                              objectFit: 'contain',
                              border: '1px solid var(--border)', borderRadius: 4,
                              background: 'var(--bg-surface)', padding: 4,
                            }}
                          />
                        )}
                        <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {new Date().toLocaleDateString()}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <ActionBtn onClick={handleSubmitSignature} loading={signing}
                          disabled={signing} variant="navy">
                          {signing ? 'Submitting…' : 'Submit to Generator'}
                        </ActionBtn>
                        <ActionBtn onClick={() => { setSignPreview(false); setSignError(null); }}
                          disabled={signing} variant="secondary">
                          Edit Signature
                        </ActionBtn>
                      </div>
                      {signError && <FeedbackMsg msg={signError} type="error"/>}
                    </div>

                  ) : (
                    /* ── Phase 1: name + draw/upload signature ── */
                    <div>
                      {/* ── Footer signature field preview ── */}
                      {wf.signatureField?.inFooter && (
                        <div style={{
                          marginBottom: 16, padding: '12px 14px',
                          background: 'var(--brand-light)',
                          border: '1.5px dashed var(--brand)', borderRadius: 8,
                        }}>
                          <p style={{ margin: '0 0 8px', fontSize: '0.72rem', fontWeight: 700,
                            color: 'var(--brand-text)', textTransform: 'uppercase', letterSpacing: '0.06em',
                            display: 'flex', alignItems: 'center', gap: 6 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0F2747"
                              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                            </svg>
                            Locked Signature Area (Footer)
                          </p>
                          {/* Visual replica of the footer signature block from the template */}
                          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                              <tbody>
                                <tr>
                                  <td style={{ width: '38%', paddingRight: 8, verticalAlign: 'bottom' }}>
                                    <div style={{ borderBottom: '1.5px solid #94A3B8', paddingBottom: 3, minWidth: 80 }}>&nbsp;</div>
                                    <div style={{ marginTop: 4, fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>Name</div>
                                  </td>
                                  <td style={{ width: '62%', paddingLeft: 8, verticalAlign: 'bottom' }}>
                                    <div style={{ border: '1.5px solid #0F2747', borderRadius: 4, minHeight: 36,
                                      padding: '4px 8px', background: 'var(--bg-subtle)',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                                        [ Your signature will appear here ]
                                      </span>
                                    </div>
                                    <div style={{ marginTop: 4, fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>Signature</div>
                                  </td>
                                </tr>
                                <tr>
                                  <td colSpan={2} style={{ paddingTop: 8, verticalAlign: 'bottom' }}>
                                    <div style={{ borderBottom: '1.5px solid #94A3B8', paddingBottom: 3 }}>&nbsp;</div>
                                    <div style={{ marginTop: 4, fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>Date</div>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                          <p style={{ margin: '6px 0 0', fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                            Your name and signature will be embedded <strong>directly inside this box</strong> in the document.
                            You cannot move or resize it.
                          </p>
                        </div>
                      )}

                      {/* ── Name field (always shown) ── */}
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 5 }}>
                        Full Name <span style={{ color: '#DC2626' }}>*</span>
                      </label>
                      <input
                        type="text"
                        value={signText}
                        onChange={e => { setSignText(e.target.value); setSignError(null); }}
                        placeholder="Type your full name exactly as it should appear"
                        disabled={ownershipStatus !== 'CONFIRMED'}
                        style={{
                          width: '100%', padding: '10px 14px', fontSize: '1rem',
                          border: '1.5px solid var(--border-strong)', borderRadius: 8, outline: 'none',
                          fontFamily: 'cursive, serif', letterSpacing: '0.04em',
                          marginBottom: 16, boxSizing: 'border-box',
                          borderBottom: '2px solid var(--brand)',
                          background: ownershipStatus !== 'CONFIRMED' ? '#F8FAFC' : (signText.trim() ? '#F0FDF4' : '#fff'),
                          color: signText.trim() ? '#15803D' : 'inherit',
                          fontWeight: signText.trim() ? 600 : 400,
                        }}
                      />

                      {/* ── Signature image: Draw / Upload tabs ── */}
                      {(wf.signatureField?.allowPhoto !== false || wf.signatureField?.allowDraw !== false || !wf.signatureField) && (
                        <div>
                          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                            Signature Image
                            {wf.signatureField?.required === false && (
                              <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> (optional)</span>
                            )}
                          </label>

                          {/* Tab switcher */}
                          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                            {(wf.signatureField?.allowDraw !== false) && (
                              <button
                                type="button"
                                className={`sig-tab-btn${signTab === 'draw' ? ' active' : ''}`}
                                onClick={() => { setSignTab('draw'); setSignError(null); }}
                                disabled={ownershipStatus !== 'CONFIRMED'}
                              >
                                ✏ Draw
                              </button>
                            )}
                            {(wf.signatureField?.allowPhoto !== false) && (
                              <button
                                type="button"
                                className={`sig-tab-btn${signTab === 'upload' ? ' active' : ''}`}
                                onClick={() => { setSignTab('upload'); setSignError(null); }}
                                disabled={ownershipStatus !== 'CONFIRMED'}
                              >
                                ↑ Upload
                              </button>
                            )}
                          </div>

                          {/* ── Draw tab ── */}
                          {signTab === 'draw' && (
                            <div>
                              <div style={{
                                position: 'relative',
                                border: '1.5px solid var(--border-strong)', borderRadius: 8,
                                background: ownershipStatus !== 'CONFIRMED' ? '#F8FAFC' : '#fff',
                                overflow: 'hidden',
                              }}>
                                <canvas
                                  ref={canvasRef}
                                  width={540}
                                  height={120}
                                  className="sig-canvas"
                                  style={{
                                    width: '100%', height: 120,
                                    opacity: ownershipStatus !== 'CONFIRMED' ? 0.5 : 1,
                                  }}
                                  onPointerDown={e => {
                                    if (ownershipStatus !== 'CONFIRMED') return;
                                    const canvas = canvasRef.current;
                                    const rect = canvas.getBoundingClientRect();
                                    const scaleX = canvas.width / rect.width;
                                    const scaleY = canvas.height / rect.height;
                                    isDrawing.current = true;
                                    lastPos.current = {
                                      x: (e.clientX - rect.left) * scaleX,
                                      y: (e.clientY - rect.top)  * scaleY,
                                    };
                                    canvas.setPointerCapture(e.pointerId);
                                  }}
                                  onPointerMove={e => {
                                    if (!isDrawing.current || ownershipStatus !== 'CONFIRMED') return;
                                    const canvas = canvasRef.current;
                                    const ctx = canvas.getContext('2d');
                                    const rect = canvas.getBoundingClientRect();
                                    const scaleX = canvas.width / rect.width;
                                    const scaleY = canvas.height / rect.height;
                                    const x = (e.clientX - rect.left) * scaleX;
                                    const y = (e.clientY - rect.top)  * scaleY;
                                    ctx.beginPath();
                                    ctx.moveTo(lastPos.current.x, lastPos.current.y);
                                    ctx.lineTo(x, y);
                                    ctx.strokeStyle = '#0F2747';
                                    ctx.lineWidth = 2.2;
                                    ctx.lineCap = 'round';
                                    ctx.lineJoin = 'round';
                                    ctx.stroke();
                                    lastPos.current = { x, y };
                                    if (canvasEmpty) setCanvasEmpty(false);
                                  }}
                                  onPointerUp={() => { isDrawing.current = false; }}
                                  onPointerLeave={() => { isDrawing.current = false; }}
                                />
                                {canvasEmpty && ownershipStatus === 'CONFIRMED' && (
                                  <div style={{
                                    position: 'absolute', inset: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    pointerEvents: 'none', color: '#CBD5E1',
                                    fontSize: '0.82rem', fontStyle: 'italic',
                                  }}>
                                    Draw your signature here
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                                <button
                                  type="button"
                                  disabled={canvasEmpty || ownershipStatus !== 'CONFIRMED'}
                                  onClick={() => {
                                    const canvas = canvasRef.current;
                                    if (canvas) {
                                      const ctx = canvas.getContext('2d');
                                      ctx.clearRect(0, 0, canvas.width, canvas.height);
                                    }
                                    setCanvasEmpty(true);
                                    setSignError(null);
                                  }}
                                  style={{
                                    background: 'none', border: '1px solid #FECACA', borderRadius: 6,
                                    color: '#DC2626', fontSize: '0.75rem', fontWeight: 600,
                                    padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
                                    opacity: canvasEmpty ? 0.4 : 1,
                                  }}
                                >
                                  Clear
                                </button>
                              </div>
                            </div>
                          )}

                          {/* ── Upload tab ── */}
                          {signTab === 'upload' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                              {signPhotoUrl ? (
                                <>
                                  <img
                                    src={signPhotoUrl}
                                    alt="Signature"
                                    style={{
                                      height: 64, maxWidth: 220, objectFit: 'contain',
                                      border: '1.5px solid var(--border-strong)', borderRadius: 6,
                                      background: 'var(--bg-surface)', padding: 4,
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => { setSignPhotoUrl(null); setSignPhotoFile(null); }}
                                    style={{
                                      background: 'none', border: '1px solid #FECACA', borderRadius: 6,
                                      color: '#DC2626', fontSize: '0.78rem', fontWeight: 600,
                                      padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit',
                                    }}
                                  >
                                    Remove
                                  </button>
                                </>
                              ) : (
                                <label style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 7,
                                  padding: '10px 16px',
                                  background: ownershipStatus !== 'CONFIRMED' ? '#F8FAFC' : '#F0FDFA',
                                  border: '1.5px dashed #159A9C', borderRadius: 8,
                                  cursor: ownershipStatus !== 'CONFIRMED' ? 'not-allowed' : 'pointer',
                                  fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent-text)',
                                }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="17 8 12 3 7 8"/>
                                    <line x1="12" y1="3" x2="12" y2="15"/>
                                  </svg>
                                  Upload Signature Image
                                  <input
                                    type="file"
                                    accept="image/*"
                                    disabled={ownershipStatus !== 'CONFIRMED'}
                                    style={{ display: 'none' }}
                                    onChange={e => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      setSignPhotoFile(file);
                                      setSignPhotoUrl(URL.createObjectURL(file));
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ marginTop: 16 }}>
                        <ActionBtn
                          onClick={handleApplySignature}
                          disabled={!signText.trim() || ownershipStatus !== 'CONFIRMED'}
                          variant="primary"
                        >
                          Apply Signature
                        </ActionBtn>
                      </div>
                      {signError && <FeedbackMsg msg={signError} type="error"/>}
                    </div>
                  )}
                </Card>
              )}

              {/* ── STEP: Send Response ── */}
              {wfEnabled && (wf?.requireResponse || wf?.sendResponseToGenerator) && (
                <Card style={sectionStyle('respond')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <StepBadge n={steps.findIndex(s => s.id === 'respond') + 1} active={activeStep === 'respond'} done={isStepDone('respond')}/>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {wf?.requireResponse ? 'Your Response' : 'Send Response to Issuer'}
                    </h3>
                  </div>
                  {wfResponse ? (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#16A34A', fontWeight: 600, fontSize: '0.88rem', marginBottom: 8 }}>
                        <CheckCircleIcon size={18} color="#16A34A"/> Response recorded
                      </div>
                      <blockquote style={{
                        margin: 0, padding: '10px 14px',
                        borderLeft: '3px solid #159A9C', background: '#F0FDFA',
                        borderRadius: '0 8px 8px 0', fontSize: '0.87rem', color: 'var(--text-primary)', fontStyle: 'italic',
                      }}>
                        "{wfResponse}"
                      </blockquote>
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: '0 0 10px', fontSize: '0.87rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        {wf?.requireResponse
                          ? 'A response is required before you can proceed.'
                          : 'Optionally send a comment or message back to the document issuer.'}
                      </p>
                      <textarea
                        value={responseText}
                        onChange={e => { setResponseText(e.target.value); setRespondError(null); }}
                        placeholder="Write your response or comment here…"
                        rows={4}
                        disabled={responding || ownershipStatus !== 'CONFIRMED'}
                        style={{
                          width: '100%', padding: '10px 13px', fontSize: '0.88rem',
                          border: '1.5px solid var(--border-strong)', borderRadius: 8, outline: 'none',
                          resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5,
                          marginBottom: 10, boxSizing: 'border-box',
                          background: (responding || ownershipStatus !== 'CONFIRMED') ? '#F8FAFC' : (responseText.trim() ? '#FEF3C7' : '#fff'),
                          color: responseText.trim() ? '#92400E' : 'inherit',
                          fontWeight: responseText.trim() ? 600 : 400,
                        }}
                      />
                      <ActionBtn onClick={handleRespond} loading={responding}
                        disabled={responding || !responseText.trim() || ownershipStatus !== 'CONFIRMED'}
                        variant="primary">
                        Send Response
                      </ActionBtn>
                      {respondError && <FeedbackMsg msg={respondError} type="error"/>}
                    </>
                  )}
                </Card>
              )}

              {/* ── STEP: Download ── */}
              <Card style={sectionStyle('download')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  {wfEnabled && <StepBadge n={steps.findIndex(s => s.id === 'download') + 1} active={activeStep === 'download'} done={isStepDone('download')}/>}
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>Download Document</h3>
                </div>

                {ownershipStatus === 'REJECTED' ? (
                  <p style={{ margin: 0, color: '#DC2626', fontSize: '0.87rem', fontWeight: 600 }}>
                    Download is blocked — ownership was rejected.
                  </p>
                ) : downloadDone || alreadyDownloaded ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#16A34A', fontWeight: 600, fontSize: '0.88rem', marginBottom: 6 }}>
                      <CheckCircleIcon size={18} color="#16A34A"/> Download complete
                    </div>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      This secure link has been used and is permanently expired.
                    </p>
                  </div>
                ) : (() => {
                  const precedingDone = steps.filter(s => s.id !== 'download').every(s => isStepDone(s.id));
                  const canDownload   = ownershipStatus === 'CONFIRMED' && precedingDone;
                  return (
                    <>
                      {!canDownload && (
                        <p style={{ margin: '0 0 10px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          Complete the steps above to unlock the download.
                        </p>
                      )}
                      <ActionBtn onClick={handleDownload} loading={downloading}
                        disabled={downloading || !canDownload}
                        variant={canDownload ? 'green' : 'secondary'}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="7 10 12 15 17 10"/>
                          <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        {downloading ? 'Downloading…' : 'Download'}
                      </ActionBtn>
                      {downloadError && <FeedbackMsg msg={downloadError} type="error"/>}
                    </>
                  );
                })()}
              </Card>

            </div>
          )}

        </div>
      </div>
    </>
  );
}
