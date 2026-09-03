import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import SecureOneTimeDocumentViewer from '../components/common/SecureOneTimeDocumentViewer';
import RejectRecipientsPicker from '../components/common/RejectRecipientsPicker';
import {
  reviewVerifyOtpViaToken,
  reviewApproveViaToken,
  reviewRejectViaToken,
  reviewResendOtpViaToken,
  reviewGetRejectRecipientsViaToken,
} from '../services/publicService';

const BASE_URL = import.meta.env?.VITE_API_URL || 'http://localhost:5000/api';

/**
 * Best-effort read of the JWT's own payload, purely to pull the signature request id
 * out for the post-login deep link kept as a fallback below — NOT a security check.
 * The token's actual validity, expiry, and single-use enforcement all happen
 * server-side (GET /api/signatures/review/:token, POST .../verify-otp, .../approve,
 * .../reject — all public routes); decoding it here without verifying the signature
 * is fine because nothing sensitive depends on it.
 */
function readSigReqIdFromToken(token) {
  try {
    const payloadPart = token.split('.')[1];
    const decoded = JSON.parse(atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded.sigReqId ?? null;
  } catch {
    return null;
  }
}

/**
 * FR-022 / MAIN REQUIREMENT: destination of the secure, one-time link sent to an
 * Approver by email/in-app notification. No login is required to land here, but the
 * OTP sent in that same email MUST be entered and verified before the PDF is ever
 * shown — this page never fetches the document until that succeeds. After the OTP
 * gate, the whole review -> approve/reject flow finishes right here, no sign-in
 * needed at any point.
 *
 * The backend enforces the link's single-use + expiry for viewing (GET
 * /api/signatures/review/:token, gated by POST .../verify-otp) and independently
 * enforces that approve/reject can only ever succeed once per request (status flips
 * away from "pending" the moment either happens). So even if this link never expired
 * by time, or the tab gets reopened many times, nothing past the first successful
 * view or the first decision is ever obtainable again: a second open gets "This
 * secure link has expired or has already been used.", and a second approve/reject
 * attempt is rejected the same way. On top of that, the PDF also disappears from
 * this page the moment the Approver leaves the tab — and coming BACK to the tab
 * forces a real reload that re-confirms with the server the link is spent, landing
 * on a clear "Failed — timed out" state rather than anything resurrected from memory
 * (see SecureOneTimeDocumentViewer, which also handles the auto-refresh/timeout
 * check while the page sits open).
 */
export default function ReviewDocumentPage() {
  const { token } = useParams();
  const reviewFileUrl = `${BASE_URL}/signatures/review/${encodeURIComponent(token)}`;

  const sigReqId = useMemo(() => readSigReqIdFromToken(token), [token]);
  const loginTarget = sigReqId ? `/approvals?open=${encodeURIComponent(sigReqId)}` : '/approvals';

  // Gate: the document is never fetched/rendered until this is true.
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [gateFeedback, setGateFeedback] = useState(null); // { type, message }

  const [mode, setMode] = useState(null); // null | 'approve' | 'reject'
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', message }
  const [outcome, setOutcome] = useState(null); // null | 'approved' | 'rejected' — once set, decision UI is done

  // Who a rejection can be sent to — fetched lazily the moment reject mode opens.
  const [recipients, setRecipients] = useState([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState([]);

  const handleResendOtp = async () => {
    setSendingOtp(true);
    setGateFeedback(null);
    setFeedback(null);
    try {
      const res = await reviewResendOtpViaToken(token);
      const msg = res.message || 'A new OTP was sent.';
      if (!otpVerified) setGateFeedback({ type: 'success', message: msg });
      else setFeedback({ type: 'success', message: msg });
    } catch (err) {
      const msg = err.message || 'Failed to resend OTP.';
      if (!otpVerified) setGateFeedback({ type: 'error', message: msg });
      else setFeedback({ type: 'error', message: msg });
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode.trim()) {
      setGateFeedback({ type: 'error', message: 'Enter the OTP code sent to your email.' });
      return;
    }
    setVerifyingOtp(true);
    setGateFeedback(null);
    try {
      await reviewVerifyOtpViaToken(token, otpCode.trim());
      setOtpVerified(true); // unlocks the document below
    } catch (err) {
      setGateFeedback({ type: 'error', message: err.message || 'OTP verification failed.' });
    } finally {
      setVerifyingOtp(false);
    }
  };

  const submitApprove = async () => {
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await reviewApproveViaToken(token);
      setFeedback({ type: 'success', message: res.message || 'Document approved and signed.' });
      setOutcome('approved');
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Approval failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const submitReject = async () => {
    if (!rejectReason.trim()) {
      setFeedback({ type: 'error', message: 'A rejection reason is required.' });
      return;
    }
    if (selectedRecipientIds.length === 0) {
      setFeedback({ type: 'error', message: 'Select at least one person to send the rejection to.' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await reviewRejectViaToken(token, rejectReason.trim(), selectedRecipientIds);
      setFeedback({ type: 'success', message: res.message || 'Document rejected.' });
      setOutcome('rejected');
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Rejection failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const openRejectMode = () => {
    setMode('reject');
    setFeedback(null);
    setRecipientsLoading(true);
    reviewGetRejectRecipientsViaToken(token)
      .then((res) => {
        const data = res.data || [];
        setRecipients(data);
        setSelectedRecipientIds(data.map((c) => c.id)); // pre-select everyone eligible
      })
      .catch((err) => setFeedback({ type: 'error', message: err.message || 'Failed to load recipients.' }))
      .finally(() => setRecipientsLoading(false));
  };

  return (
    <div className="public-page-shell" style={{ flexDirection: 'column' }}>
      {/* Minimal top bar */}
      <div className="public-page-header">
        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          One-time secure document — viewable once, disappears if you leave this tab
        </span>
        <Link to="/login" state={{ from: { pathname: loginTarget } }} className="public-page-header-action" style={{ fontSize: 13 }}>
          Trouble with this page? Sign in instead
        </Link>
      </div>

      <div style={{ flex: 1, padding: 12 }}>
        {!otpVerified ? (
          // --- OTP gate: nothing about the document itself is fetched or shown yet ---
          <div className="verify-card" style={{ maxWidth: 480, margin: '40px auto 0' }}>
            <h2 style={{ marginTop: 0 }}>Enter Your OTP</h2>
            <p style={{ fontSize: '0.9rem', color: '#475569' }}>
              For your security, enter the one-time code sent to your email to unlock this document.
              The PDF will not be shown until this is verified.
            </p>
            <div className="form-field">
              <label htmlFor="gate-otp-input">6-digit OTP (expires in 5 minutes)</label>
              <div className="verify-input-row">
                <input
                  id="gate-otp-input"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  maxLength={6}
                  placeholder="123456"
                  disabled={verifyingOtp}
                  autoFocus
                />
                <button type="button" onClick={handleResendOtp} disabled={sendingOtp || verifyingOtp} className="btn-secondary">
                  {sendingOtp ? 'Sending…' : 'Resend OTP'}
                </button>
              </div>
              <div className="template-form-actions" style={{ marginTop: 10 }}>
                <button type="button" onClick={handleVerifyOtp} disabled={verifyingOtp || sendingOtp} className="btn-primary">
                  {verifyingOtp ? 'Verifying…' : 'Unlock Document'}
                </button>
              </div>
            </div>
            {gateFeedback && (
              <p className={gateFeedback.type === 'error' ? 'login-error' : 'verify-status'} style={{ marginTop: 10 }}>
                {gateFeedback.message}
              </p>
            )}
          </div>
        ) : (
          <>
            <SecureOneTimeDocumentViewer fetchUrl={reviewFileUrl} title="Document for review" heightVh={70} />

            {outcome ? (
              <div
                className="verify-card"
                style={{ maxWidth: 600, margin: '16px auto 0', textAlign: 'center' }}
              >
                <p style={{ fontWeight: 600, margin: 0 }}>
                  {outcome === 'approved' ? 'Document approved and digitally signed.' : 'Document rejected.'}
                </p>
                <p style={{ color: '#475569', fontSize: '0.85rem', marginTop: 8 }}>
                  This link is now spent. You can close this tab.
                </p>
              </div>
            ) : (
              <div className="verify-card" style={{ maxWidth: 600, margin: '16px auto 0' }}>
                <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: '#475569' }}>
                  After reviewing the document above, approve it or reject it with a reason — right here, no sign-in needed.
                </p>

                {!mode && (
                  <div className="template-form-actions">
                    <button type="button" onClick={() => { setMode('approve'); setFeedback(null); }} className="btn-primary">
                      Approve
                    </button>
                    <button type="button" onClick={openRejectMode} className="btn-danger">
                      Reject
                    </button>
                  </div>
                )}

                {mode === 'approve' && (
                  <div className="form-field">
                    <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: '#475569' }}>
                      Your identity was already confirmed by the OTP you entered to open this document.
                    </p>
                    <div className="template-form-actions">
                      <button type="button" onClick={submitApprove} disabled={submitting} className="btn-primary">
                        {submitting ? 'Signing…' : 'Confirm & Sign'}
                      </button>
                      <button type="button" onClick={() => { setMode(null); setFeedback(null); }} disabled={submitting} className="btn-secondary">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {mode === 'reject' && (
                  <div className="form-field">
                    <label htmlFor="reject-reason">Reason for rejection (required)</label>
                    <textarea
                      id="reject-reason"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={3}
                      disabled={submitting}
                    />
                    <RejectRecipientsPicker
                      candidates={recipients}
                      loading={recipientsLoading}
                      selectedIds={selectedRecipientIds}
                      onChange={setSelectedRecipientIds}
                    />
                    <div className="template-form-actions" style={{ marginTop: 10 }}>
                      <button type="button" onClick={submitReject} disabled={submitting || recipientsLoading} className="btn-danger">
                        {submitting ? 'Submitting…' : 'Confirm Rejection'}
                      </button>
                      <button type="button" onClick={() => { setMode(null); setFeedback(null); }} disabled={submitting} className="btn-secondary">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {feedback && (
                  <p className={feedback.type === 'error' ? 'login-error' : 'verify-status'} style={{ marginTop: 10 }}>
                    {feedback.message}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
