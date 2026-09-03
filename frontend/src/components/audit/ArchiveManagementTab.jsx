import { useEffect, useState } from 'react';
import { auditService } from '../../services/workflowService';
import { useToast } from '../../hooks/useToast';
import StatusBadge from './StatusBadge';
import ConfirmDialog from './ConfirmDialog';

export default function ArchiveManagementTab() {
  const { showToast } = useToast();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await auditService.getArchiveOverview();
      setOverview(res.data);
    } catch (err) {
      setError(err.message || 'Failed to load archive overview.');
      showToast(err.message || 'Failed to load archive overview.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunArchive = async () => {
    setRunning(true);
    try {
      const res = await auditService.runArchiveNow();
      showToast(res.message, 'success');
      setConfirmOpen(false);
      await load();
    } catch (err) {
      showToast(err.message || 'Archive run failed.', 'error');
    } finally {
      setRunning(false);
    }
  };

  const documents = overview?.documents || [];
  const filtered = filter ? documents.filter((d) => d.retention_state === filter) : documents;
  const overdueCount = overview?.summary.overdue || 0;

  return (
    <>
      <div className="ar-summary-grid" style={{ marginBottom: 20 }}>
        <div className="ar-summary-tile">
          <div className="ar-summary-tile-label">Retention Policy</div>
          <div className="ar-summary-tile-value">{overview ? `${overview.retentionYears} yr` : '—'}</div>
        </div>
        <div className="ar-summary-tile" style={{ background: '#DBEAFE', borderColor: '#BFDBFE' }}>
          <div className="ar-summary-tile-label">Approaching Retention</div>
          <div className="ar-summary-tile-value" style={{ color: '#1D4ED8' }}>{overview?.summary.approaching ?? '—'}</div>
        </div>
        <div className="ar-summary-tile" style={{ background: '#F1F5F9', borderColor: '#0F172A', borderWidth: 2 }}>
          <div className="ar-summary-tile-label">Overdue for Archive</div>
          <div className="ar-summary-tile-value" style={{ color: '#0F172A', fontWeight: 800 }}>{overview?.summary.overdue ?? '—'}</div>
        </div>
        <div className="ar-summary-tile">
          <div className="ar-summary-tile-label">Already Archived</div>
          <div className="ar-summary-tile-value">{overview?.summary.archived ?? '—'}</div>
        </div>
      </div>

      <div className="ar-panel">
        <div className="ar-panel-header">
          <div>
            <h3 className="ar-panel-title">Archive Management</h3>
            <p className="ar-panel-subtitle">
              Documents older than the retention period move to file-system cold storage automatically
              (daily) — their searchable metadata and index always stay in the database.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: '0.85rem', fontFamily: 'inherit' }}>
              <option value="">All retention states</option>
              <option value="approaching">Approaching Retention</option>
              <option value="overdue">Overdue for Archive</option>
              <option value="archived">Archived</option>
            </select>
            <button
              type="button"
              className="ar-btn ar-btn-primary"
              onClick={() => setConfirmOpen(true)}
              disabled={loading || overdueCount === 0}
            >
              Run Archive Now
            </button>
          </div>
        </div>

        {loading ? (
          <>{[0, 1, 2].map((i) => <div key={i} className="ar-skeleton-row" />)}</>
        ) : error ? (
          <div className="ar-state">
            <p className="ar-state-title ar-state-error">Couldn't load archive data</p>
            <p className="ar-state-desc">{error}</p>
            <button type="button" className="ar-btn ar-btn-primary" style={{ marginTop: 12 }} onClick={load}>Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="ar-state">
            <p className="ar-state-title">Nothing to show here</p>
            <p className="ar-state-desc">
              {filter ? 'No documents currently match this retention state.' : 'No documents are approaching or over the retention window yet.'}
            </p>
          </div>
        ) : (
          <div className="ar-table-wrap">
            <table className="ar-table">
              <thead>
                <tr>
                  <th>Document ID</th>
                  <th>Template</th>
                  <th>Status</th>
                  <th>Retention</th>
                  <th>
                    <span className="ar-tooltip" data-tip="Days since the document was generated">Age</span>
                  </th>
                  <th>Generated</th>
                  <th>Archive Date</th>
                  <th>Storage Location</th>
                  <th>DB Index</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id}>
                    <td className="ar-mono">{d.doc_uuid}</td>
                    <td>{d.template_name}</td>
                    <td><StatusBadge status={d.status} /></td>
                    <td><StatusBadge status={d.retention_state} /></td>
                    <td className="ar-cell-muted">{d.age_days}d</td>
                    <td className="ar-cell-muted">{new Date(d.generated_at).toLocaleDateString()}</td>
                    <td className="ar-cell-muted">{d.archived_at ? new Date(d.archived_at).toLocaleDateString() : '—'}</td>
                    <td className="ar-cell-muted">{d.storage_location}</td>
                    <td><StatusBadge status="indexed" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmOpen && (
        <ConfirmDialog
          title="Run archive sweep now?"
          description={
            <>
              This will move every document over the {overview?.retentionYears}-year retention window
              ({overdueCount} document{overdueCount === 1 ? '' : 's'}) to file-system cold storage.
              Their records, metadata, and search index stay in the database and remain fully searchable — only
              the underlying file relocates. This action runs immediately and cannot be undone.
            </>
          }
          confirmLabel={running ? 'Archiving…' : `Archive ${overdueCount} document${overdueCount === 1 ? '' : 's'}`}
          busy={running}
          onConfirm={handleRunArchive}
          onCancel={() => !running && setConfirmOpen(false)}
        />
      )}
    </>
  );
}
