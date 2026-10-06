import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { documentService } from '../../services/templateService';
import { useToast } from '../../hooks/useToast';

function AlertCircleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function EditDocIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function ViewPdfIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function RejectedDocumentsList({ onCountChange }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState(null);

  const loadRejected = async () => {
    setLoading(true);
    try {
      const res = await documentService.listRejected();
      const list = res.data || [];
      setDocuments(list);
      onCountChange?.(list.length);
    } catch (err) {
      showToast(err.message || 'Failed to load rejected documents.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRejected();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleViewPdf = async (id) => {
    setOpeningId(id);
    try {
      const url = await documentService.viewUrl(id);
      window.open(url, '_blank');
    } catch (err) {
      showToast(err.message || 'Failed to open document PDF.', 'error');
    } finally {
      setOpeningId(null);
    }
  };

  if (loading) {
    return <div className="template-list-loading">Loading rejected documents…</div>;
  }

  if (documents.length === 0) {
    return (
      <div className="template-list-empty" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem', color: 'var(--text-primary)' }}>
          No Rejected Documents
        </h3>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          There are currently no documents rejected by approvers or recipients awaiting correction.
        </p>
      </div>
    );
  }

  return (
    <div className="rejected-documents-container">
      <div style={{
        padding: '12px 16px',
        marginBottom: 16,
        background: 'rgba(239, 68, 68, 0.06)',
        border: '1px solid rgba(239, 68, 68, 0.25)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <div style={{ color: '#DC2626' }}><AlertCircleIcon /></div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
          <strong>{documents.length} document{documents.length === 1 ? '' : 's'} require correction.</strong>{' '}
          Click <strong>&quot;Correct Document&quot;</strong> to open the document in the full Template Editor, fix the Header/Body/Footer, and resubmit for approval.
        </div>
      </div>

      <div className="template-card-grid">
        {documents.map((doc) => (
          <div className="template-card" key={doc.id} style={{ borderLeft: '4px solid #DC2626' }}>
            <div className="template-card-top">
              <div className="template-card-icon" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#DC2626' }}>
                <AlertCircleIcon />
              </div>
              <div className="template-card-title-wrap">
                <h3 className="template-card-name" title={doc.template_name || doc.doc_uuid}>
                  {doc.template_name || 'Document'}
                </h3>
                <span className="template-card-category" style={{ color: '#DC2626', fontWeight: 600 }}>
                  DOC ID: {doc.doc_uuid}
                </span>
              </div>
            </div>

            <div className="template-card-meta">
              <span className="template-card-meta-item">
                <strong>Record ID</strong> {doc.record_identifier || 'N/A'}
              </span>
              <span className="template-card-meta-item">
                <strong>Generator</strong> {doc.generator_name || 'N/A'}
              </span>
              <span className="template-card-meta-item">
                <strong>Rejected</strong> {doc.rejected_at ? new Date(doc.rejected_at).toLocaleDateString() : 'Recently'}
              </span>
            </div>

            {/* Rejection comment callout */}
            <div style={{
              margin: '10px 0',
              padding: '10px 12px',
              background: 'var(--bg-subtle, #f8fafc)',
              border: '1px solid var(--border, #e2e8f0)',
              borderRadius: 6,
              fontSize: '0.8rem',
            }}>
              <div style={{ fontWeight: 600, color: '#DC2626', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>Rejection Reason:</span>
                {doc.approver_name && (
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                    (by {doc.approver_name})
                  </span>
                )}
              </div>
              <div style={{ color: 'var(--text-primary)', fontStyle: 'italic', lineHeight: 1.4 }}>
                &ldquo;{doc.rejection_reason || 'No specific comment provided'}&rdquo;
              </div>
            </div>

            <div className="template-card-actions" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => navigate(`/templates/correct/${doc.id}`)}
                title="Open in full template editor to correct and resubmit"
              >
                <EditDocIcon /> Correct Document
              </button>
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={() => handleViewPdf(doc.id)}
                disabled={openingId === doc.id}
                title="View rejected PDF"
              >
                <ViewPdfIcon /> {openingId === doc.id ? 'Opening…' : 'View PDF'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
