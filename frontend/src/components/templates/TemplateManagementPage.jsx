import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import TemplateList from './TemplateList';
import RejectedDocumentsList from './RejectedDocumentsList';
import { documentService } from '../../services/templateService';

export default function TemplateManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') === 'rejected' ? 'rejected' : 'templates';
  const [rejectedCount, setRejectedCount] = useState(0);

  // Check rejected documents count on mount to badge the tab immediately
  useEffect(() => {
    documentService.listRejected()
      .then((res) => {
        setRejectedCount((res.data || []).length);
      })
      .catch(() => {});
  }, []);

  const handleTabChange = (tab) => {
    if (tab === 'rejected') {
      setSearchParams({ tab: 'rejected' });
    } else {
      setSearchParams({});
    }
  };

  return (
    <div className="template-management-page">
      <div className="page-header" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ margin: '0 0 6px' }}>Template Management</h1>
          <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
            Manage master document templates and correct documents rejected during the approval workflow.
          </p>
        </div>
        {currentTab === 'templates' && (
          <Link to="/templates/create" className="btn-primary">
            + Create Template
          </Link>
        )}
      </div>

      {/* Tabs navigation */}
      <div style={{
        display: 'flex',
        gap: 8,
        borderBottom: 'none',
        marginBottom: 20,
        paddingBottom: 2,
      }}>
        <button
          type="button"
          onClick={() => handleTabChange('templates')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            fontSize: '0.88rem',
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            borderBottom: currentTab === 'templates' ? '2.5px solid var(--brand, #0856C3)' : '2.5px solid transparent',
            color: currentTab === 'templates' ? 'var(--brand, #0856C3)' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <span>All Templates</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('rejected')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            fontSize: '0.88rem',
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            borderBottom: currentTab === 'rejected' ? '2.5px solid #DC2626' : '2.5px solid transparent',
            color: currentTab === 'rejected' ? '#DC2626' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <span>Rejected Documents</span>
          {rejectedCount > 0 && (
            <span style={{
              background: '#DC2626',
              color: '#FFFFFF',
              fontSize: '0.72rem',
              fontWeight: 700,
              padding: '1px 7px',
              borderRadius: 10,
              lineHeight: 1.4,
            }}>
              {rejectedCount}
            </span>
          )}
        </button>
      </div>

      {/* Content depending on active tab */}
      {currentTab === 'templates' ? (
        <TemplateList />
      ) : (
        <RejectedDocumentsList onCountChange={(count) => setRejectedCount(count)} />
      )}
    </div>
  );
}
