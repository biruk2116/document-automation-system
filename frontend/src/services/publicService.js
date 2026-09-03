// Use relative /api so Vite's dev proxy forwards to localhost:5000.
// In production, VITE_API_URL must be set to the deployed backend base URL.
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

/** FR-033: verify by pasting a Doc ID (no file). */
export async function verifyByDocId(docId) {
  const res = await fetch(`${BASE_URL}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc_id: docId }),
  });
  return res.json();
}

/** FR-033: verify by uploading the PDF itself (multipart, not JSON). */
export async function verifyByFile(file) {
  const formData = new FormData();
  formData.append('pdf', file);

  const res = await fetch(`${BASE_URL}/verify`, {
    method: 'POST',
    body: formData, // browser sets the multipart boundary header automatically
  });
  return res.json();
}

// --- Generator's one-time notify-view page action bar (no login required) ---

/**
 * Read-only lookup of the outcome behind a notify-view link — 'signed' or
 * 'rejected' (with the reason), so the page can show the right actions instead of
 * a generic "Send" bar that would 409 on a rejected (draft) document. Never
 * consumes the one-time PDF view — safe to call on every load.
 */
export async function getNotifyTokenMeta(token) {
  const res = await fetch(`${BASE_URL}/documents/notify-view/${encodeURIComponent(token)}/meta`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to load document status.');
  return data;
}

/**
 * Fetches the PDF for the "Download the Document" button as a blob and hands back an
 * object URL + filename, instead of a raw backend URL. Kept as a fetch (like every
 * other document-open path in the app — see documentService.viewUrl / signatureService
 * .viewPdfUrl) specifically so a failure (expired/invalid token, missing file, server
 * error) surfaces as an in-app toast, never as the browser navigating away to show the
 * backend's bare JSON error response.
 */
export async function downloadDocumentViaNotifyToken(token) {
  const res = await fetch(`${BASE_URL}/documents/notify-view/${encodeURIComponent(token)}/download`);
  if (!res.ok) {
    let message = 'Failed to download the document.';
    try {
      const payload = await res.json();
      message = payload.message || message;
    } catch {
      // response wasn't JSON (shouldn't happen on this endpoint's error path, but don't crash on it)
    }
    throw new Error(message);
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const filename = match ? match[1] : 'document.pdf';
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), filename };
}

/** "Prepare a place to send the one-time secure link" — validated recipient email required. */
export async function sendSecureLinkViaNotifyToken(token, email) {
  const res = await fetch(`${BASE_URL}/documents/notify-view/${encodeURIComponent(token)}/secure-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to send the secure link.');
  return data;
}

/** "Directly send the document with email" — PDF attached, validated recipient email required. */
export async function sendDocumentViaNotifyToken(token, email) {
  const res = await fetch(`${BASE_URL}/documents/notify-view/${encodeURIComponent(token)}/deliver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to send the document.');
  return data;
}

// --- Approver's one-time review-link action bar (no login required) ---

/** MAIN REQUIREMENT: verify the OTP sent by email BEFORE the document is revealed. */
export async function reviewVerifyOtpViaToken(token, otpCode) {
  const res = await fetch(`${BASE_URL}/signatures/review/${encodeURIComponent(token)}/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ otp_code: otpCode }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || 'OTP verification failed.');
    err.code = data.code;
    throw err;
  }
  return data;
}

/**
 * Confirm & sign directly from the one-time review link. No OTP is sent here — the
 * Approver already verified it (via reviewVerifyOtpViaToken) before the document was
 * ever shown, so this only needs the token itself.
 */
export async function reviewApproveViaToken(token) {
  const res = await fetch(`${BASE_URL}/signatures/review/${encodeURIComponent(token)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Approval failed.');
  return data;
}

/**
 * Who a rejection can be sent to, before the Approver submits it: the document's
 * generator plus up to 2 Admins — or just the one Admin if they generated it
 * themselves. Backs the recipient checklist shown once "Reject" is chosen.
 */
export async function reviewGetRejectRecipientsViaToken(token) {
  const res = await fetch(`${BASE_URL}/signatures/review/${encodeURIComponent(token)}/reject-recipients`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to load recipients.');
  return data;
}

/** Reject directly from the one-time review link — reason + at least one recipient required. */
export async function reviewRejectViaToken(token, reason, recipientIds) {
  const res = await fetch(`${BASE_URL}/signatures/review/${encodeURIComponent(token)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, recipientIds }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Rejection failed.');
  return data;
}

/** Resend the OTP without signing in, if the original code was lost or expired. */
export async function reviewResendOtpViaToken(token) {
  const res = await fetch(`${BASE_URL}/signatures/review/${encodeURIComponent(token)}/resend-otp`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to resend OTP.');
  return data;
}

// --- Secure Document Delivery & Ownership Verification module (public, recipient-facing) ---

/** Landing hit when the recipient opens the emailed secure-delivery link. */
export async function getSecureDeliveryLanding(token) {
  const res = await fetch(`${BASE_URL}/secure-delivery/${encodeURIComponent(token)}`);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || 'This link is invalid.');
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Requirement 3: verify the token + OTP + recipient identity before anything is shown. */
export async function verifySecureDeliveryOtp(token, otpCode) {
  const res = await fetch(`${BASE_URL}/secure-delivery/${encodeURIComponent(token)}/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ otp_code: otpCode }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || 'OTP verification failed.');
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Only usable before the link has ever been successfully verified. */
export async function resendSecureDeliveryOtp(token) {
  const res = await fetch(`${BASE_URL}/secure-delivery/${encodeURIComponent(token)}/resend-otp`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to resend OTP.');
  return data;
}

/**
 * Requirement 3: recipient/user information + document information, fetched once
 * the OTP has been verified, to render on the secure delivery page alongside the
 * preview and the ownership/download controls.
 */
export async function getSecureDeliveryDetails(token) {
  const res = await fetch(`${BASE_URL}/secure-delivery/${encodeURIComponent(token)}/details`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to load delivery details.');
  return data;
}

/**
 * Requirements 5/6/7: submit the ownership Yes/No answer. The backend independently
 * re-validates a "Yes" against document.recipient_id — this call only ever carries
 * the recipient's answer, never decides ownership itself.
 */
export async function submitSecureDeliveryOwnership(token, confirmed, reason) {
  const res = await fetch(`${BASE_URL}/secure-delivery/${encodeURIComponent(token)}/ownership`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed, ...(reason ? { reason } : {}) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to record your response.');
  return data;
}

/** Final, single-use download — only reachable once ownership_status is CONFIRMED. */
export async function downloadSecureDelivery(token) {
  const res = await fetch(`${BASE_URL}/secure-delivery/${encodeURIComponent(token)}/download`);
  if (!res.ok) {
    let message = 'Failed to download the document.';
    try {
      const payload = await res.json();
      message = payload.message || message;
    } catch {
      // non-JSON error body
    }
    throw new Error(message);
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const filename = match ? match[1] : 'document.pdf';
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), filename };
}

// --- Requirement 10: public QR verification page ---

/** Reports exactly one of VALID / REVOKED / INVALID for a scanned QR's verification id. */
export async function verifyByQrId(verificationId) {
  const res = await fetch(`${BASE_URL}/verify-qr/${encodeURIComponent(verificationId)}`);
  return res.json();
}

// --- Rejection Review (public, no login required) ---

/**
 * Fetches rejection details via the one-time per-delivery review token included
 * in the Generator's rejection notification email. Returns:
 *   { rejectionReason, rejectedAt, recipientName, docUuid, templateName, resubmitDoc }
 * No authentication required — the token itself is the credential.
 */
export async function getPublicRejectionReview(token) {
  const res = await fetch(`${BASE_URL}/rejection-review/${encodeURIComponent(token)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'This review link is invalid or has expired.');
  return data;
}

/**
 * Issues a short-lived JWT for the document generator using only the rejection-review
 * token as the credential (same trust level as the existing notify-view / approver-
 * review patterns). Returns { token, user } on success.
 * Called by RejectionReviewPage when the Generator clicks "Edit & Resubmit" and is
 * not already signed in — avoids showing a login form for something they already
 * proved identity for via the emailed link.
 */
export async function autoLoginForRejectionReview(token) {
  const res = await fetch(`${BASE_URL}/rejection-review/${encodeURIComponent(token)}/auto-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Auto-login failed.');
  return data; // { success, data: { token, user } }
}

/**
 * OWN button — tells the backend the recipient confirms this document is theirs.
 * Sets owned=1, ownership_status=CONFIRMED, fires dual notification to the Generator.
 * Requires the delivery token (same credential used for all other delivery steps).
 */
export async function ownDelivery(deliveryId, token) {
  const res = await fetch(
    `${BASE_URL}/secure-delivery/deliveries/${encodeURIComponent(deliveryId)}/own`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to confirm ownership.');
  return data;
}

/**
 * Issues a short-lived JWT for the document generator using only the
 * workflow-tracking token as the credential — same trust level as the existing
 * rejection-review auto-login pattern. Returns { token, user } on success.
 * Called by WorkflowTrackingPage when the Generator clicks "Open in Dashboard"
 * and is not already signed in.
 */
export async function autoLoginForWorkflowTracking(token) {
  const res = await fetch(`${BASE_URL}/workflow-track/${encodeURIComponent(token)}/auto-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Auto-login failed.');
  return data; // { success, data: { token, user } }
}
