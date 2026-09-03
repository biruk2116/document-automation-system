import { useEffect, useState } from 'react';
import { auditService } from '../../services/workflowService';
import { useToast } from '../../hooks/useToast';
import StatusBadge from './StatusBadge';
import { describeAuditEvent, AUDIT_ACTIONS } from './auditActionMap';

const PAGE_SIZE = 15;

export default function AuditTrailTab({ initialDocQuery = '' }) {
  const { showToast } = useToast();
  const [docSearch, setDocSearch] = useState(initialDocQuery);
  const [activeDocQuery, setActiveDocQuery] = useState(initialDocQuery);
  const [actionFilter, setActionFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = {};
      if (activeDocQuery) filters.doc_uuid = activeDocQuery;
      if (actionFilter) filters.action = actionFilter;
      if (from) filters.from = from;
      if (to) filters.to = to;
      const res = await auditService.getAuditTrail(filters);
      setLogs(res.data);
      setPage(1);
    } catch (err) {
      setError(err.message || 'Failed to load the audit trail.');
      showToast(err.message || 'Failed to load the audit trail.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeDocQuery, actionFilter, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (e) => {
    e.preventDefault();
    setActiveDocQuery(docSearch.trim());
  };

  const clearDocSearch = () => {
    setDocSearch('');
    setActiveDocQuery('');
  };

  const isTimelineView = Boolean(activeDocQuery);
  const timelineLogs = isTimelineView ? [...logs].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) : [];

  const totalPages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
  const pagedLogs = logs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <form className="ar-toolbar" onSubmit={handleSearch}>
        <div className="ar-field ar-field-search">
          <label htmlFor="ar-doc-search">Document ID</label>
          <input
            id="ar-doc-search"
            type="text"
            placeholder="e.g. DOC-20260815-00042 — search for its full timeline"
            value={docSearch}
            onChange={(e) => setDocSearch(e.target.value)}
          />
        </div>
        <div className="ar-field">
          <label htmlFor="ar-action-filter">Action</label>
          <select id="ar-action-filter" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{a || 'All actions'}</option>)}
          </select>
        </div>
        <div className="ar-field">
          <label htmlFor="ar-from">From</label>
          <input id="ar-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="ar-field">
          <label htmlFor="ar-to">To</label>
          <input id="ar-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="ar-toolbar-actions">
          {isTimelineView && (
            <button type="button" className="ar-btn ar-btn-secondary" onClick={clearDocSearch}>
              Clear Search
            </button>
          )}
          <button type="submit" className="ar-btn ar-btn-primary">Search</button>
        </div>
      </form>

      <div className="ar-panel">
        <div className="ar-panel-header">
          <div>
            <h3 className="ar-panel-title">
              {isTimelineView ? `Timeline · ${activeDocQuery}` : 'Full Audit Trail'}
            </h3>
            <p className="ar-panel-subtitle">
              {isTimelineView
                ? 'Created → Previewed → Sent for Approval → Approved/Rejected → Downloaded → Delivered → Verified'
                : 'Every recorded action across the system, most recent first'}
            </p>
          </div>
        </div>

        {loading ? (
          <>
            {[0, 1, 2, 3].map((i) => <div key={i} className="ar-skeleton-row" />)}
          </>
        ) : error ? (
          <div className="ar-state">
            <p className="ar-state-title ar-state-error">Couldn't load the audit trail</p>
            <p className="ar-state-desc">{error}</p>
            <button type="button" className="ar-btn ar-btn-primary" style={{ marginTop: 12 }} onClick={load}>Retry</button>
          </div>
        ) : logs.length === 0 ? (
          <div className="ar-state">
            <p className="ar-state-title">
              {isTimelineView ? 'No activity found for that Document ID' : 'No audit activity yet'}
            </p>
            <p className="ar-state-desc">
              {isTimelineView ? 'Double-check the Document ID and try again.' : 'Activity will appear here as documents move through the workflow.'}
            </p>
          </div>
        ) : isTimelineView ? (
          <div className="ar-timeline">
            {timelineLogs.map((log, idx) => {
              const info = describeAuditEvent(log);
              return (
                <div className="ar-timeline-item" key={log.id}>
                  <div className="ar-timeline-rail">
                    <div className={`ar-timeline-dot ar-timeline-dot-${info.tone}`} />
                    {idx < timelineLogs.length - 1 && <div className="ar-timeline-line" />}
                  </div>
                  <div className="ar-timeline-content">
                    <div className="ar-timeline-top">
                      <span className="ar-timeline-action">{info.stage}</span>
                      <StatusBadge status={info.tone === 'green' ? 'signed' : info.tone === 'red' ? 'rejected' : info.tone === 'amber' ? 'pending' : 'delivered'} label={log.action} />
                    </div>
                    <div className="ar-timeline-meta">
                      <b>{log.user_name || 'System'}</b>{log.user_role ? ` (${log.user_role.replace('_', ' ')})` : ''} · {new Date(log.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <div className="ar-table-wrap">
              <table className="ar-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>User</th>
                    <th>Role</th>
                    <th>Action</th>
                    <th>Document ID</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedLogs.map((log) => {
                    const info = describeAuditEvent(log);
                    return (
                      <tr key={log.id}>
                        <td className="ar-cell-muted">{new Date(log.timestamp).toLocaleString()}</td>
                        <td>{log.user_name || '—'}</td>
                        <td className="ar-cell-muted" style={{ textTransform: 'capitalize' }}>{(log.user_role || '—').replace('_', ' ')}</td>
                        <td>{log.action}</td>
                        <td className="ar-mono">{log.doc_uuid || '—'}</td>
                        <td><StatusBadge status={info.tone === 'green' ? 'signed' : info.tone === 'red' ? 'rejected' : info.tone === 'amber' ? 'pending' : 'delivered'} label={info.stage} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="ar-pagination">
              <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, logs.length)} of {logs.length}</span>
              <div className="ar-pagination-controls">
                <button type="button" className="ar-btn ar-btn-secondary ar-btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <button type="button" className="ar-btn ar-btn-secondary ar-btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
