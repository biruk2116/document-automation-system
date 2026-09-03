import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { templateService, dataSourceService, externalDbService, documentService } from '../services/templateService';
import { useToast } from '../hooks/useToast';
import TemplateViewer from '../components/templates/TemplateViewer';
import ConfirmModal from '../components/common/ConfirmModal';

function BackArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 3 4 9l7 6" />
      <path d="M4.5 9h10" />
    </svg>
  );
}

/**
 * Full-page template view — opened from the "View" button on each template card.
 * Replaces the old modal so the document is genuinely easy to read (a real A4-sized
 * preview with room to breathe), with a clear top-left way back to the card grid.
 */
export default function TemplateViewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [structuralData, setStructuralData] = useState(null);
  const [sampleData, setSampleData] = useState(null);
  const [viewMode, setViewMode] = useState('structure'); // 'structure' | 'sample'
  const [loading, setLoading] = useState(true);
  const [loadingSample, setLoadingSample] = useState(false);
  const [error, setError] = useState(null);
  const [sampleError, setSampleError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    templateService.getById(id)
      .then((res) => { if (!cancelled) setStructuralData(res.data); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load template.'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [id]);

  const handlePreviewWithSampleData = async () => {
    if (!structuralData?.data_source_table) return;
    setLoadingSample(true);
    setSampleError(null);
    try {
      // A template's data source is either this app's internal table, or a table on a
      // saved external connection (MongoDB/PostgreSQL/MySQL/SQLite) — see
      // TemplateForm.jsx's same branch for getFields. Previously this always called the
      // internal-only endpoint, so any externally-mapped template (e.g. "students" on an
      // external connection) failed here with "table not found" before preview ever ran,
      // even though documentService.preview itself already routes correctly.
      const recordsRes = structuralData.data_source_connection_id
        ? await externalDbService.getRecords(structuralData.data_source_connection_id, structuralData.data_source_table)
        : await dataSourceService.getRecords(structuralData.data_source_table);
      const firstRecord = recordsRes.data?.[0];
      if (!firstRecord) {
        setSampleError('No records found in this data source to preview with.');
        return;
      }
      const previewRes = await documentService.preview({ template_id: id, record_id: firstRecord.recordId });
      setSampleData(previewRes.data);
      setViewMode('sample');
    } catch (err) {
      setSampleError(err.message || 'Failed to generate sample preview.');
    } finally {
      setLoadingSample(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!structuralData) return;
    const nextStatus = structuralData.status === 'active' ? 'archived' : 'active';
    setBusy(true);
    try {
      await templateService.updateStatus(id, nextStatus);
      setStructuralData((prev) => ({ ...prev, status: nextStatus }));
      showToast(`Template marked as ${nextStatus}.`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update status.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = () => {
    if (!structuralData) return;
    setConfirmingDelete(true);
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await templateService.remove(id);
      showToast('Template deleted successfully.', 'success');
      navigate('/templates');
    } catch (err) {
      showToast(err.message || 'Failed to delete template.', 'error');
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <div className="template-view-page">
      <div className="template-view-page-topbar">
        <button type="button" className="template-view-back-btn" onClick={() => navigate('/templates')}>
          <BackArrowIcon /> Back to Templates
        </button>

        {structuralData && (
          <div className="template-view-actions">
            <Link to={`/templates/edit/${id}`} className="tpl-action-btn tpl-action-edit">Edit</Link>
            <button
              type="button"
              className={`tpl-action-btn ${structuralData.status === 'active' ? 'tpl-action-archive' : 'tpl-action-activate'}`}
              onClick={handleToggleStatus}
              disabled={busy}
            >
              {structuralData.status === 'active' ? 'Archive' : 'Activate'}
            </button>
            <button type="button" className="tpl-action-btn tpl-action-delete" onClick={handleDelete} disabled={busy}>
              Delete
            </button>
          </div>
        )}
      </div>

      {loading && <div className="template-list-loading">Loading template…</div>}
      {error && <p className="modal-error">{error}</p>}

      {!loading && !error && structuralData && (
        <>
          <div className="template-view-heading">
            <h1>{structuralData.name}</h1>
            <div className="template-view-heading-meta">
              <span className="template-card-category">{structuralData.category}</span>
              <span>Version {structuralData.version}</span>
              <span className={`status-badge status-${structuralData.status}`}>{structuralData.status}</span>
              <span>Updated {new Date(structuralData.updated_at).toLocaleString()}</span>
            </div>
          </div>

          <div className="template-view-body">
            <div className="template-view-toggle">
              <button
                type="button"
                className={viewMode === 'structure' ? 'bulk-tab-active' : ''}
                onClick={() => setViewMode('structure')}
              >
                Structure
              </button>
              {structuralData.data_source_table && (
                <button
                  type="button"
                  className={viewMode === 'sample' ? 'bulk-tab-active' : ''}
                  onClick={sampleData ? () => setViewMode('sample') : handlePreviewWithSampleData}
                  disabled={loadingSample}
                >
                  {loadingSample ? 'Loading sample…' : 'Preview with Sample Data'}
                </button>
              )}
            </div>

            {sampleError && <p className="modal-error">{sampleError}</p>}

            <TemplateViewer data={viewMode === 'sample' && sampleData ? sampleData : structuralData} />
          </div>
        </>
      )}

      {confirmingDelete && (
        <ConfirmModal
          title="Delete template?"
          itemName={structuralData?.name}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
