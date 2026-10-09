import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { deliveryService } from '../services/workflowService';
import { documentService } from '../services/templateService';
import { useAuth } from '../hooks/useAuth';
import './WorkflowResult.css';

/**
 * WorkflowResultPage
 *
 * Dedicated full-page view opened when the Generator arrives via the
 * "View Submitted Document" email link. Renders inside the authenticated
 * Layout shell (sidebar + navbar + full system theme) — no public page,
 * no slide-in drawer, no hidden panel.
 *
 * The Generator sees the submitted document and every detail the User
 * submitted in one focused, readable page:
 *   • Recipient full name, email, delivery timestamp
 *   • Acknowledgement status + timestamp
 *   • User response / message
 *   • Submitted signature (typed name + drawn/uploaded image)
 *   • Full-size PDF of the submitted document
 *
 * Route: /workflow-result?doc=<internalDocId>
 *   (navigated to by WorkflowTrackingPage after auto-login)
 */
export default function WorkflowResultPage() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const { user }       = useAuth();

  const docId = searchParams.get('doc'); // internal numeric doc id

  const [delivery,   setDelivery]   = useState(null);
  const [docMeta,    setDocMeta]    = useState(null); // doc_uuid, template_name etc.
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);

  const [pdfUrl,     setPdfUrl]     = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError,   setPdfError]   = useState(null);
  const pdfBlobRef = useRef(null);

  // ── Load delivery + document metadata ───────────────────────────────────
  useEffect(() => {
    if (!docId) {
      setError('No document specified.');
      setLoading(false);
      return;
    }
    let cancelled = false;

    Promise.all([
      deliveryService.listDeliveries(docId),
      documentService.viewUrl(docId).catch(() => null), // non-fatal
    ])
      .then(([deliveryRes, blobUrl]) => {
        if (cancelled) return;

        const rows = deliveryRes.data || [];
        // Find the most recent delivery with workflow activity
        const best =
          rows.find(r => r.workflow_completed_at || r.workflow_user_signed_at || r.workflow_acknowledged_at) ||
          rows[0] ||
          null;
        setDelivery(best);

        if (blobUrl) {
          setPdfUrl(blobUrl);
          pdfBlobRef.current = blobUrl;
        }
      })
      .catch(err => {
        if (!cancelled) setError(err.message || 'Failed to load the submission.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (pdfBlobRef.current) { URL.revokeObjectURL(pdfBlobRef.current); pdfBlobRef.current = null; }
    };
  }, [docId]);

  // ── Load PDF separately if it wasn't already resolved above ─────────────
  useEffect(() => {
    if (pdfUrl || pdfLoading || !docId) return;
    let cancelled = false;
    setPdfLoading(true);
    documentService.viewUrl(docId)
      .then(url => {
        if (cancelled) { URL.revokeObjectURL(url); return; }
        if (pdfBlobRef.current) URL.revokeObjectURL(pdfBlobRef.current);
        pdfBlobRef.current = url;
        setPdfUrl(url);
      })
      .catch(err => { if (!cancelled) setPdfError(err.message || 'Could not load the document.'); })
      .finally(() => { if (!cancelled) setPdfLoading(false); });
    return () => {
      cancelled = true;
      if (pdfBlobRef.current) { URL.revokeObjectURL(pdfBlobRef.current); pdfBlobRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const fmt = (iso) => iso ? new Date(iso).toLocaleString() : '—';

  const wf  = delivery || {};
  const sig = (() => {
    try { return wf.workflow_signature_data ? JSON.parse(wf.workflow_signature_data) : null; }
    catch { return null; }
  })();

  // ── Error / loading states ───────────────────────────────────────────────
  if (loading) {
    return (
      <div className="wfr-loading">
        <div className="wfr-spinner" aria-label="Loading…" />
        <p>Loading submitted document…</p>
      </div>
    );
  }

  if (error || !delivery) {
    return (
      <div className="wfr-error-page">
        <div className="wfr-error-card">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
            stroke="var(--error-text)" strokeWidth="1.5" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h2>Could not load submission</h2>
          <p>{error || 'No workflow submission found for this document.'}</p>
          <button type="button" className="wfr-btn-primary" onClick={() => navigate('/document-tracking')}>
            Back to Document Tracking
          </button>
        </div>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <div className="wfr-page">
      <style>{`@keyframes wfr-spin{to{transform:rotate(360deg)}}`}</style>

      {/* Page header */}
      <div className="wfr-page-header">
        <div className="wfr-page-header-left">
          {/* Back */}
          <button
            type="button"
            className="wfr-back-btn"
            onClick={() => navigate(`/document-tracking?doc=${encodeURIComponent(docId)}`)}
            aria-label="Back to Document Tracking"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Document Tracking
          </button>

          <div className="wfr-page-title-block">
            <span className="wfr-page-badge">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="var(--success-text)" strokeWidth="2.5" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              Workflow Completed
            </span>
            <h1 className="wfr-page-title">Final Document</h1>
          </div>
        </div>
      </div>

      {/* Content: display only the final document, highly visible */}
      <div className="wfr-content wfr-content--doc-only">
        {/* Document PDF */}
        <div className="wfr-pdf-col">
          <section className="wfr-card wfr-pdf-card">
            <div className="wfr-pdf-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="var(--brand)" strokeWidth="2" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span className="wfr-pdf-title">Submitted Document</span>
              {pdfUrl && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await documentService.download(docId);
                    } catch (err) {
                      console.error('Download error:', err);
                    }
                  }}
                  className="wfr-pdf-download-btn"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Download
                </button>
              )}
            </div>
            <div className="wfr-pdf-body">
              {(pdfLoading || loading) && (
                <div className="wfr-pdf-placeholder">
                  <div className="wfr-spinner" aria-label="Loading PDF…"/>
                  <p>Loading document…</p>
                </div>
              )}
              {pdfError && (
                <div className="wfr-pdf-placeholder">
                  <p style={{ color: 'var(--error-text)' }}>{pdfError}</p>
                </div>
              )}
              {pdfUrl && !pdfLoading && (
                <object
                  data={pdfUrl}
                  type="application/pdf"
                  className="wfr-pdf-embed"
                  aria-label="Submitted document PDF"
                >
                  <div className="wfr-pdf-placeholder">
                    <p>Your browser cannot display PDFs inline.</p>
                    <a href={pdfUrl} download className="wfr-btn-primary" style={{ marginTop: 12, display: 'inline-block' }}>
                      Download PDF
                    </a>
                  </div>
                </object>
              )}
            </div>
          </section>
        </div>

      </div>
    </div>
  );
}
