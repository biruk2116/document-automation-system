import { api, getAuthToken } from './api';

// Use relative /api so the Vite dev proxy forwards to localhost:5000.
// Hardcoded http://localhost:5000 bypasses the proxy and causes CORS errors.
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const signatureService = {
  initiate: (docId, approverId) => api.post('/signatures', { doc_id: docId, approver_id: approverId }),
  listPending: () => api.get('/signatures/pending'),
  resendOtp: (id) => api.post(`/signatures/${id}/resend-otp`),
  approve: (id, otpCode) => api.post(`/signatures/${id}/approve`, { otp_code: otpCode }),
  /**
   * Who a rejection can be sent to: the document's generator plus up to 2 Admins,
   * or just the one Admin if they generated it themselves — shown as a checklist
   * before the Approver confirms the rejection.
   */
  getRejectRecipients: (id) => api.get(`/signatures/${id}/reject-recipients`),
  reject: (id, reason, recipientIds) => api.post(`/signatures/${id}/reject`, { reason, recipientIds }),
  /**
   * Streams the pending document's PDF for in-browser viewing (before OTP entry).
   * Binary + auth-header, so it can't be a plain <a href> link — fetch as a blob and
   * hand the caller an object URL to open in a new tab, matching uploadLogo's pattern.
   */
  viewPdfUrl: async (id) => {
    const res = await fetch(`${BASE_URL}/signatures/${id}/view`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) {
      let message = 'Failed to load document for viewing.';
      try {
        const payload = await res.json();
        message = payload.message || message;
      } catch {
        // response wasn't JSON (e.g. the PDF stream itself on success path never hits this)
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
};

export const deliveryService = {
  // NOTE — SECURITY FIX: the old `deliver` (direct email attachment, no verification)
  // and `secureLink` (no-OTP download link) methods have been removed. Every
  // recipient delivery now goes exclusively through `secureDeliver` below —
  // one-time link + OTP + ownership confirmation. See deliveryController.js.
  markHandDelivered: (docId) => api.patch(`/documents/${docId}/hand-delivered`),

  // --- Secure Document Delivery & Ownership Verification module ---
  /**
   * Initiates a delivery with the chosen send method.
   *   delivery_method = 'secure_link_otp'    → one-time link + OTP + ownership flow.
   *   delivery_method = 'email_attachment'   → PDF emailed directly, no OTP step.
   * The backend independently validates the recipient email against the document's
   * own mapped data source table regardless of the chosen method (requirement 11).
   */
  secureDeliver: (docId, email, delivery_method = 'secure_link_otp') =>
    api.post(`/documents/${docId}/secure-delivery`, { email, delivery_method }),
  /**
   * After edit & resubmit (documentController.resubmitDocument regenerates and
   * re-signs), call this to automatically send a new secure-link+OTP delivery to
   * the same recipient that was on record at the time of the rejection.
   * Returns { deliveryId, recipientEmail, linkEmailSent, plainCopyEmailSent }.
   */
  resubmitDelivery: (docId) => api.post(`/documents/${docId}/resubmit-delivery`),
  /** Full delivery timeline/audit log for one document — sent/opened/OTP-verified/ownership/downloaded. */
  listDeliveries: (docId) => api.get(`/documents/${docId}/deliveries`),
  /**
   * Requirement 7: system-wide (or, with a docId, per-document) ownership report —
   * total delivered, confirmed, rejected, confirmation rate, and rejection reasons.
   */
  getOwnershipReport: (docId) => api.get(`/documents/deliveries/report${docId ? `?docId=${docId}` : ''}`),
  /** Admin-only: revokes a document — its QR verification page will report REVOKED. */
  revoke: (docId, reason) => api.patch(`/documents/${docId}/revoke`, reason ? { reason } : undefined),
};

export const auditService = {
  getAuditTrail: (filters = {}) => {
    const params = new URLSearchParams(filters).toString();
    return api.get(`/audit-logs${params ? `?${params}` : ''}`);
  },
  /**
   * Downloads the full-information audit trail CSV (same filters as getAuditTrail,
   * every underlying column — not just what the on-screen table shows) and triggers
   * a save-as, without hardcoding the Authorization header into a plain <a href>.
   */
  exportCsv: async (filters = {}) => {
    const params = new URLSearchParams(filters).toString();
    const res = await fetch(`${BASE_URL}/audit-logs/export${params ? `?${params}` : ''}`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) {
      let message = 'Failed to export the audit trail.';
      try {
        const payload = await res.json();
        message = payload.message || message;
      } catch {
        // response wasn't JSON (the CSV stream itself on the success path never hits this)
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_trail_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  getDashboardKpis: () => api.get('/dashboard/kpis'),
  getDashboardTrends: () => api.get('/dashboard/trends'),
  searchDocuments: (filters = {}) => {
    const params = new URLSearchParams(filters).toString();
    return api.get(`/documents/search${params ? `?${params}` : ''}`);
  },
  getReportFilterOptions: () => api.get('/reports/filter-options'),
  getMonthlyReportPreview: (month) => api.get(`/reports/monthly/preview?month=${encodeURIComponent(month)}`),
  getArchiveOverview: () => api.get('/archive/overview'),
  runArchiveNow: () => api.post('/archive/run'),
  /**
   * The monthly report endpoint returns raw CSV (Content-Disposition: attachment),
   * not JSON, so it can't go through the shared `api` client's res.json() parsing —
   * fetched directly as a blob and handed off as a real file download, same pattern
   * as signatureService.viewPdfUrl.
   */
  downloadMonthlyReportCsv: async (month) => {
    const res = await fetch(`${BASE_URL}/reports/monthly?month=${encodeURIComponent(month)}`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) {
      let message = 'Failed to generate report.';
      try {
        const payload = await res.json();
        message = payload.message || message;
      } catch {
        // non-JSON error body
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `department_report_${month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export const settingsService = {
  get: () => api.get('/settings'),
  update: (payload) => api.put('/settings', payload),
  getDbConnection: () => api.get('/settings/database'),
  testDbConnection: (payload) => api.post('/settings/database/test', payload),
  updateDbConnection: (payload) => api.put('/settings/database', payload),
};
