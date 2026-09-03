import { useState } from 'react';
import { deliveryService } from '../../services/workflowService';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Inline SVG icons ──────────────────────────────────────────────────────────
function LockIcon({ size = 18, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function PaperclipIcon({ size = 18, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function CheckIcon({ size = 16, color = '#16A34A' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function WarningIcon({ size = 16, color = '#DC2626' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function MailIcon({ size = 16, color = '#475569' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

const METHODS = [
  {
    id: 'secure_link_otp',
    label: 'Secure Link via Email',
    Icon: LockIcon,
    desc: 'Recipient receives a one-time secure link + OTP. They must verify identity, view the document, click OWN, then download.',
  },
  {
    id: 'email_attachment',
    label: 'PDF Attachment via Email',
    Icon: PaperclipIcon,
    desc: 'The signed PDF is emailed directly as an attachment. No OTP or ownership step.',
  },
];

/**
 * Send Document modal.
 *
 * Requirement — email / ID cross-check:
 *   The Generator enters the recipient email. The system shows the Record ID that
 *   was used to generate this document (read-only — it is fixed). Before sending,
 *   the backend fetches that record from the data source table and verifies the
 *   email column matches what was entered. If they don't match the backend blocks
 *   delivery and returns:
 *     "The user's email and ID do not match. Please enter the correct email for
 *      the assigned user."
 *   This message is shown verbatim here so the Generator knows exactly what to fix.
 */
export default function SecureDeliveryModal({ doc, onClose, onSent }) {
  const [method, setMethod] = useState('secure_link_otp');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [sentResult, setSentResult] = useState(null);

  const trimmedEmail = email.trim();
  const emailLooksValid = EMAIL_REGEX.test(trimmedEmail);
  const selectedMethod = METHODS.find((m) => m.id === method);
  const fileName = doc.metadata?.fileName || `${doc.doc_uuid}.pdf`;
  // The record ID used to generate this document — shown read-only so the Generator
  // knows which record's email must be entered.
  const recordId = doc.record_identifier || '—';

  const handleMethodChange = (id) => {
    setMethod(id);
    setServerError(null);
    setConfirming(false);
  };

  const handleSendClick = () => {
    setServerError(null);
    if (!trimmedEmail) {
      setServerError('Enter the recipient email address.');
      return;
    }
    if (!emailLooksValid) {
      setServerError('Enter a valid email address (e.g. name@example.com).');
      return;
    }
    setConfirming(true);
  };

  const handleConfirmedSend = async () => {
    setSending(true);
    setServerError(null);
    try {
      const res = await deliveryService.secureDeliver(doc.id, trimmedEmail, method);
      setSentResult({ message: res.message || 'Document sent.', recipientEmail: trimmedEmail, method });
      onSent(res.message || 'Document sent.');
    } catch (err) {
      // Backend cross-check error is shown verbatim — it already contains the
      // human-readable explanation (e.g. "email and ID do not match").
      setServerError(err.message || 'Failed to send the document.');
      setConfirming(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Send Document</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} title="Close">×</button>
        </div>

        <div className="modal-body">
          {/* Document identity */}
          <div className="send-doc-field">
            <label>Document</label>
            <div className="send-doc-doc-id">{doc.doc_uuid}</div>
            <div className="send-doc-doc-template">{doc.template_name}</div>
          </div>

          {sentResult ? (
            /* ── Success screen ── */
            <>
              <div className="send-doc-verify send-doc-verify-ok" style={{ marginTop: 16, flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckIcon size={16} color="#16A34A" />
                  <b>Sent to {sentResult.recipientEmail}</b>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckIcon size={16} color="#16A34A" />
                  Email verified against record <b>{recordId}</b>
                </div>
                {sentResult.method === 'secure_link_otp' ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckIcon size={16} color="#16A34A" />
                      Secure link + OTP emailed (recipient must click OWN before downloading)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckIcon size={16} color="#16A34A" />
                      Plain PDF copy attached separately
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckIcon size={16} color="#16A34A" />
                    PDF attached — {fileName}
                  </div>
                )}
                <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: '#475569' }}>
                  This document has been sent to the assigned recipient. It can only be sent once per delivery.
                </p>
              </div>
              <div className="template-form-actions" style={{ marginTop: 20 }}>
                <button type="button" onClick={onClose} className="btn-primary">Done</button>
              </div>
            </>
          ) : (
            <>
              {/* ── Step 1: send method ── */}
              <div className="send-doc-field" style={{ marginTop: 16 }}>
                <label>Send method</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                  {METHODS.map((m) => {
                    const selected = method === m.id;
                    const { Icon } = m;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleMethodChange(m.id)}
                        disabled={sending}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                          border: selected ? '2px solid #6366F1' : '1.5px solid #E2E8F0',
                          background: selected ? '#EEF2FF' : '#fff',
                          textAlign: 'left', width: '100%',
                        }}
                      >
                        <span style={{ flexShrink: 0, marginTop: 2, color: selected ? '#4338CA' : '#64748B' }}>
                          <Icon size={18} color={selected ? '#4338CA' : '#64748B'} />
                        </span>
                        <span>
                          <span style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', color: selected ? '#4338CA' : '#1E293B' }}>
                            {m.label}{selected && (
                              <span style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle' }}>
                                <CheckIcon size={14} color="#6366F1" />
                              </span>
                            )}
                          </span>
                          <span style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginTop: 2 }}>{m.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Step 2: Record ID (read-only) + recipient email ── */}
              <div className="form-field" style={{ marginTop: 16 }}>
                <label>
                  Assigned Record ID
                  <span style={{ marginLeft: 6, fontWeight: 400, fontSize: '0.78rem', color: '#64748B' }}>
                    (the record used to generate this document)
                  </span>
                </label>
                <input
                  type="text"
                  value={recordId}
                  readOnly
                  disabled
                  style={{ background: '#F8FAFC', color: '#475569', cursor: 'not-allowed' }}
                />
              </div>

              <div className="form-field" style={{ marginTop: 12 }}>
                <label htmlFor="secure-delivery-email">
                  Recipient email
                  <span style={{ marginLeft: 6, fontWeight: 400, fontSize: '0.78rem', color: '#64748B' }}>
                    (must match the email on record <b>{recordId}</b>)
                  </span>
                </label>
                <input
                  id="secure-delivery-email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setServerError(null); setConfirming(false); }}
                  placeholder="recipient@example.com"
                  disabled={sending || confirming}
                  autoComplete="off"
                />
              </div>

              {/* ── Preview of what will be sent ── */}
              {trimmedEmail && emailLooksValid && !confirming && (
                <div className="send-doc-field" style={{ marginTop: 14 }}>
                  <label>What gets sent</label>
                  <div className="send-doc-radio-desc" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MailIcon size={14} /> To: <b>{trimmedEmail}</b>
                  </div>
                  {method === 'secure_link_otp' ? (
                    <>
                      <div className="send-doc-radio-desc" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <LockIcon size={14} color="#6366F1" /> Secure link + OTP → OWN → Download
                      </div>
                      <div className="send-doc-radio-desc" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <PaperclipIcon size={14} /> Plain PDF copy: {fileName}
                      </div>
                    </>
                  ) : (
                    <div className="send-doc-radio-desc" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <PaperclipIcon size={14} /> PDF attached directly: {fileName}
                    </div>
                  )}
                </div>
              )}

              {/* ── Cross-check / validation error ── */}
              {serverError && (
                <div style={{
                  marginTop: 12, padding: '10px 14px', borderRadius: 7,
                  background: '#FEF2F2', border: '1px solid #FECACA',
                  fontSize: '0.88rem', color: '#DC2626',
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                }}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}><WarningIcon size={16} /></span>
                  <span>{serverError}</span>
                </div>
              )}

              {/* ── Confirmation ── */}
              {confirming && !serverError && (
                <div className="send-doc-verify" style={{ marginTop: 14 }}>
                  <div>
                    Send <b>{selectedMethod?.label}</b> to <b>{trimmedEmail}</b>?
                    <div className="template-form-actions" style={{ marginTop: 10 }}>
                      <button type="button" onClick={handleConfirmedSend} disabled={sending} className="btn-primary">
                        {sending ? 'Sending…' : 'Yes, Send'}
                      </button>
                      <button type="button" onClick={() => setConfirming(false)} disabled={sending} className="btn-secondary">
                        Back
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="template-form-actions" style={{ marginTop: 20 }}>
                <button type="button" onClick={onClose} disabled={sending} className="btn-secondary">Cancel</button>
                {!confirming && (
                  <button
                    type="button"
                    onClick={handleSendClick}
                    disabled={sending || !trimmedEmail}
                    className="btn-primary"
                  >
                    Send Document
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
