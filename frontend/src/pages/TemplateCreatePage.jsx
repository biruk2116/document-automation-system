import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import TemplateForm from '../components/templates/TemplateForm';
import { templateService, documentService } from '../services/templateService';
import { useToast } from '../hooks/useToast';

function BackArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 3 4 9l7 6" />
      <path d="M4.5 9h10" />
    </svg>
  );
}

export default function TemplateCreatePage({ mode = 'create' }) {
  const { id, docId } = useParams();
  const targetId = docId || id;
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [initialData, setInitialData] = useState(null);
  const [rejectionContext, setRejectionContext] = useState(null);
  const [loading, setLoading] = useState(mode === 'edit' || mode === 'correct-rejected');
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [nameError, setNameError] = useState(null);

  useEffect(() => {
    if (mode === 'create') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    if (mode === 'correct-rejected') {
      documentService.getRejectionContext(targetId)
        .then((res) => {
          setInitialData(res.data?.template || null);
          setRejectionContext(res.data?.doc || null);
        })
        .catch((err) => setLoadError(err.message || 'Failed to load rejected document context.'))
        .finally(() => setLoading(false));
    } else if (mode === 'edit') {
      templateService.getById(targetId)
        .then((res) => setInitialData(res.data))
        .catch((err) => setLoadError(err.message || 'Failed to load template.'))
        .finally(() => setLoading(false));
    }
  }, [mode, targetId]);

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    setNameError(null);
    try {
      if (mode === 'correct-rejected') {
        const res = await documentService.correctAndResubmit(targetId, payload);
        showToast(res.message || 'Document corrected and resubmitted for approval successfully.', 'success');
      } else if (mode === 'edit') {
        const res = await templateService.update(targetId, payload);
        showToast(res.message || `Updated — now v${res.data.version}.`, 'success');
      } else {
        const res = await templateService.create(payload);
        showToast(res.message || 'Template created.', 'success');
      }
      navigate('/templates');
    } catch (err) {
      if (err.status === 409) {
        setNameError(err.message);
      }
      showToast(err.message || 'Failed to save document/template.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const backBar = (
    <div className="template-create-page-topbar">
      <button type="button" className="template-view-back-btn" onClick={() => navigate('/templates')}>
        <BackArrowIcon /> Back
      </button>
    </div>
  );

  if ((mode === 'edit' || mode === 'correct-rejected') && loading) {
    return (
      <div className="template-create-page">
        {backBar}
        <div style={{ padding: '24px 0', color: 'var(--text-secondary)' }}>
          {mode === 'correct-rejected' ? 'Loading rejected document context…' : 'Loading template…'}
        </div>
      </div>
    );
  }

  if ((mode === 'edit' || mode === 'correct-rejected') && loadError) {
    return (
      <div className="template-create-page">
        {backBar}
        <p className="modal-error">{loadError}</p>
      </div>
    );
  }

  const pageTitle = mode === 'correct-rejected'
    ? `Correct Rejected Document — ${initialData?.name || 'Document'}`
    : mode === 'edit'
      ? `Edit Template — ${initialData?.name || ''}`
      : 'Create Template';

  return (
    <div className="template-create-page">
      {backBar}
      <h1>{pageTitle}</h1>
      <TemplateForm
        mode={mode}
        initialData={initialData}
        rejectionContext={rejectionContext}
        onSubmit={handleSubmit}
        submitting={submitting}
        nameError={nameError}
        onNameChange={() => setNameError(null)}
      />
    </div>
  );
}
