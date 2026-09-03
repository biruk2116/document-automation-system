import { api, getAuthToken } from './api';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const templateService = {
  getAll: (filters = {}) => {
    const params = new URLSearchParams(filters).toString();
    return api.get(`/templates${params ? `?${params}` : ''}`);
  },
  getById: (id) => api.get(`/templates/${id}`),
  create: (payload) => api.post('/templates', payload),
  update: (id, payload) => api.put(`/templates/${id}`, payload),
  remove: (id) => api.delete(`/templates/${id}`),
  updateStatus: (id, status) => api.patch(`/templates/${id}/status`, { status }),
  /** FR-008: logo upload is multipart, not JSON — bypasses the JSON-only api client. */
  uploadLogo: async (file) => {
    const formData = new FormData();
    formData.append('logo', file);
    const res = await fetch(`${BASE_URL}/templates/upload-logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAuthToken()}` },
      body: formData,
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.message || 'Logo upload failed.');
    return payload;
  },
};

export const dataSourceService = {
  getAll: () => api.get('/data-sources'),
  getFields: (table) => api.get(`/data-sources/${table}/fields`),
  getRecords: (table) => api.get(`/data-sources/${table}/records`),
};

/**
 * Commercial-tier external database connections (MongoDB / PostgreSQL / SQLite) — lets
 * a template's data source map pull tables/fields from a customer's own database
 * instead of only this system's internal "employees" table. Credentials are tested and
 * only saved if the test succeeds; the backend never sends a saved password back down
 * (see externalDbController.js's toPublicShape), so `list()` results never include one.
 */
export const externalDbService = {
  list: () => api.get('/external-db'),
  test: (payload) => api.post('/external-db/test', payload),
  create: (payload) => api.post('/external-db', payload),
  remove: (id) => api.delete(`/external-db/${id}`),
  getTables: (connectionId) => api.get(`/external-db/${connectionId}/tables`),
  getFields: (connectionId, table) => api.get(`/external-db/${connectionId}/tables/${table}/fields`),
  // Counterpart of dataSourceService.getRecords, for a table that lives on a saved
  // external connection rather than this app's internal DB — backs GET
  // /api/external-db/:id/tables/:table/records (listExternalRecords), which returns
  // the exact same { columns, idColumn, data } shape as the internal endpoint.
  getRecords: (connectionId, table) => api.get(`/external-db/${connectionId}/tables/${table}/records`),
};

export const documentService = {
  preview: (payload) => api.post('/documents/preview', payload),
  generate: (payload) => api.post('/documents/generate', payload),
  validateBulk: (payload) => api.post('/documents/validate-bulk', payload),
  generateBulk: (payload) => api.post('/documents/generate/bulk', payload),
  getBulkStatus: (jobId) => api.get(`/documents/bulk-status/${jobId}`),
  /**
   * Streams a generated document's PDF (by numeric doc id) as a blob and hands back
   * an object URL — used both to open it inline in a new tab (View) and to trigger a
   * save-as download, without hardcoding the Authorization header into a plain <a href>.
   */
  viewUrl: async (id) => {
    const res = await fetch(`${BASE_URL}/documents/${id}/download`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) {
      let message = 'Failed to load the document.';
      try {
        const payload = await res.json();
        message = payload.message || message;
      } catch {
        // response wasn't JSON (e.g. the PDF stream itself on the success path)
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
  /**
   * Same endpoint as viewUrl, but triggers a real save-as download (via a temporary
   * anchor with `download` set) instead of opening the PDF in a new tab — used by
   * Document Tracking's separate [ Download ] button. Still a fetch-as-blob, never a
   * plain <a href> straight to the backend, so an error surfaces as an in-app toast
   * rather than the tab navigating away to raw JSON.
   */
  download: async (id) => {
    const res = await fetch(`${BASE_URL}/documents/${id}/download`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) {
      let message = 'Failed to download the document.';
      try {
        const payload = await res.json();
        message = payload.message || message;
      } catch {
        // response wasn't JSON
      }
      throw new Error(message);
    }
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = /filename="?([^"]+)"?/i.exec(disposition);
    const filename = match ? match[1] : `document-${id}.pdf`;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
  /**
   * Soft-deletes a generated document (Document Tracking's Delete button). The file is
   * removed on the backend but the record stays verifiable by Doc ID afterwards — see
   * documentController.deleteDocument.
   */
  remove: (id) => api.delete(`/documents/${id}`),
  /**
   * "Edit & Resubmit" for a rejected document — regenerates a corrected PDF from the
   * same template (picking up any just-fixed content automatically) and sends it
   * straight to the same approver in one call, no re-selecting an approver.
   * `payload` is optional: { record_identifier, note } — pass a different record_identifier
   * when the entry/ID itself was the problem, and/or a short note on what was fixed
   * (shown to the approver). See documentController.resubmitDocument.
   */
  resubmit: (id, payload) => api.post(`/documents/${id}/resubmit`, payload || undefined),
};
