import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import TemplateForm from '../components/templates/TemplateForm';
import { templateService } from '../services/templateService';
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
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [initialData, setInitialData] = useState(null);
  const [loading, setLoading] = useState(mode === 'edit');
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [nameError, setNameError] = useState(null);

  useEffect(() => {
    if (mode !== 'edit') return;
    setLoading(true);
    templateService.getById(id)
      .then((res) => setInitialData(res.data))
      .catch((err) => setLoadError(err.message || 'Failed to load template.'))
      .finally(() => setLoading(false));
  }, [mode, id]);

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    setNameError(null);
    try {
      if (mode === 'edit') {
        const res = await templateService.update(id, payload);
        showToast(res.message || `Updated — now v${res.data.version}.`, 'success');
      } else {
        const res = await templateService.create(payload);
        showToast(res.message || 'Template created.', 'success');
      }
      navigate('/templates');
    } catch (err) {
      // BR-003: duplicate template name — keep the user on the form with the
      // name field flagged, rather than just a toast they might miss.
      if (err.status === 409) {
        setNameError(err.message);
      }
      showToast(err.message || 'Failed to save template.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Rendered first in every branch below (loading / error / the real form) so there's
  // always a way back to the template list — a stuck loading or error state used to
  // leave the user with no way out except the browser's own back button.
  const backBar = (
    <div className="template-create-page-topbar">
      <button type="button" className="template-view-back-btn" onClick={() => navigate('/templates')}>
        <BackArrowIcon /> Back to Templates
      </button>
    </div>
  );

  if (mode === 'edit' && loading) {
    return (
      <div className="template-create-page">
        {backBar}
        Loading template…
      </div>
    );
  }
  if (mode === 'edit' && loadError) {
    return (
      <div className="template-create-page">
        {backBar}
        <p className="modal-error">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="template-create-page">
      {backBar}
      <h1>{mode === 'edit' ? `Edit Template — ${initialData?.name}` : 'Create Template'}</h1>
      <TemplateForm
        mode={mode}
        initialData={initialData}
        onSubmit={handleSubmit}
        submitting={submitting}
        nameError={nameError}
        onNameChange={() => setNameError(null)}
      />
    </div>
  );
}
