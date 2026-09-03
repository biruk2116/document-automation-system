import { useEffect, useState } from 'react';
import { auditService } from '../../services/workflowService';
import { documentService } from '../../services/templateService';
import { useToast } from '../../hooks/useToast';
import StatusBadge from './StatusBadge';

const STATUSES = ['', 'draft', 'pending', 'signed', 'rejected', 'delivered'];
const PAGE_SIZE = 10;

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ReportsSearchTab({ onJumpToTimeline }) {
  const { showToast } = useToast();

  const [options, setOptions] = useState({ templates: [], generators: [], approvers: [] });
  const [filters, setFilters] = useState({
    template_name: '', date_from: '', date_to: '', status: '', generated_by: '', approver_id: '',
  });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  const [month, setMonth] = useState(currentMonthValue());
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [exporting, setExporting] = useState(false);

  const runSearch = async (activeFilters) => {
    setLoading(true);
    setError(null);
    try {
      const cleaned = Object.fromEntries(Object.entries(activeFilters).filter(([, v]) => v !== ''));
      const res = await auditService.searchDocuments(cleaned);
      setResults(res.data);
      setPage(1);
    } catch (err) {
      setError(err.message || 'Failed to search documents.');
      showToast(err.message || 'Failed to search documents.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadMonthlyPreview = async (m) => {
    setReportLoading(true);
    setReportError(null);
    try {
      const res = await auditService.getMonthlyReportPreview(m);
      setReport(res.data);
    } catch (err) {
      setReportError(err.message || 'Failed to load the department report.');
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    auditService.getReportFilterOptions()
      .then((res) => setOptions(res.data))
      .catch((err) => showToast(err.message || 'Failed to load filter options.', 'error'));
    runSearch(filters);
    loadMonthlyPreview(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterChange = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  const handleSearch = (e) => {
    e.preventDefault();
    runSearch(filters);
  };

  const handleReset = () => {
    const cleared = { template_name: '', date_from: '', date_to: '', status: '', generated_by: '', approver_id: '' };
    setFilters(cleared);
    runSearch(cleared);
  };

  const handleMonthChange = (value) => {
    setMonth(value);
    loadMonthlyPreview(value);
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      await auditService.downloadMonthlyReportCsv(month);
      showToast(`Exported the ${month} department report.`, 'success');
    } catch (err) {
      showToast(err.message || 'Export failed.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleView = async (docId) => {
    try {
      const url = await documentService.viewUrl(docId);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      showToast(err.message || 'Failed to open the document.', 'error');
    }
  };

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const pagedResults = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <form className="ar-toolbar" onSubmit={handleSearch}>
        <div className="ar-field">
          <label htmlFor="ar-f-template">Template</label>
          <select id="ar-f-template" value={filters.template_name} onChange={(e) => handleFilterChange('template_name', e.target.value)}>
            <option value="">All templates</option>
            {options.templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </div>
        <div className="ar-field">
          <label htmlFor="ar-f-from">Date From</label>
          <input id="ar-f-from" type="date" value={filters.date_from} onChange={(e) => handleFilterChange('date_from', e.target.value)} />
        </div>
        <div className="ar-field">
          <label htmlFor="ar-f-to">Date To</label>
          <input id="ar-f-to" type="date" value={filters.date_to} onChange={(e) => handleFilterChange('date_to', e.target.value)} />
        </div>
        <div className="ar-field">
          <label htmlFor="ar-f-status">Status</label>
          <select id="ar-f-status" value={filters.status} onChange={(e) => handleFilterChange('status', e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All statuses'}</option>)}
          </select>
        </div>
        <div className="ar-field">
          <label htmlFor="ar-f-generator">Generator</label>
          <select id="ar-f-generator" value={filters.generated_by} onChange={(e) => handleFilterChange('generated_by', e.target.value)}>
            <option value="">All generators</option>
            {options.generators.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <div className="ar-field">
          <label htmlFor="ar-f-approver">Approver</label>
          <select id="ar-f-approver" value={filters.approver_id} onChange={(e) => handleFilterChange('approver_id', e.target.value)}>
            <option value="">All approvers</option>
            {options.approvers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <div className="ar-toolbar-actions">
          <button type="button" className="ar-btn ar-btn-secondary" onClick={handleReset}>Reset</button>
          <button type="submit" className="ar-btn ar-btn-primary">Apply Filters</button>
        </div>
      </form>

      <div className="ar-panel">
        <div className="ar-panel-header">
          <div>
            <h3 className="ar-panel-title">Document Search Results</h3>
            <p className="ar-panel-subtitle">{results.length} document(s) matching your filters</p>
          </div>
        </div>

        {loading ? (
          <>{[0, 1, 2, 3].map((i) => <div key={i} className="ar-skeleton-row" />)}</>
        ) : error ? (
          <div className="ar-state">
            <p className="ar-state-title ar-state-error">Couldn't load results</p>
            <p className="ar-state-desc">{error}</p>
            <button type="button" className="ar-btn ar-btn-primary" style={{ marginTop: 12 }} onClick={() => runSearch(filters)}>Retry</button>
          </div>
        ) : results.length === 0 ? (
          <div className="ar-state">
            <p className="ar-state-title">No documents match these filters</p>
            <p className="ar-state-desc">Try widening the date range or clearing a filter.</p>
          </div>
        ) : (
          <>
            <div className="ar-table-wrap">
              <table className="ar-table">
                <thead>
                  <tr>
                    <th>Document ID</th>
                    <th>Template</th>
                    <th>Generator</th>
                    <th>Approver</th>
                    <th>Status</th>
                    <th>Created Date</th>
                    <th>Approval Time</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedResults.map((doc) => (
                    <tr key={doc.id}>
                      <td className="ar-mono">{doc.doc_uuid}</td>
                      <td>{doc.template_name}</td>
                      <td>{doc.generated_by_name}</td>
                      <td className="ar-cell-muted">{doc.approver_name || '—'}</td>
                      <td><StatusBadge status={doc.status} /></td>
                      <td className="ar-cell-muted">{new Date(doc.generated_at).toLocaleDateString()}</td>
                      <td className="ar-cell-muted">
                        {doc.approval_time_minutes != null ? `${doc.approval_time_minutes}m` : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button type="button" className="ar-btn ar-btn-ghost ar-btn-sm" onClick={() => handleView(doc.id)}>View</button>
                          <button type="button" className="ar-btn ar-btn-ghost ar-btn-sm" onClick={() => onJumpToTimeline?.(doc.doc_uuid)}>Timeline</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ar-pagination">
              <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, results.length)} of {results.length}</span>
              <div className="ar-pagination-controls">
                <button type="button" className="ar-btn ar-btn-secondary ar-btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <button type="button" className="ar-btn ar-btn-secondary ar-btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="ar-panel">
        <div className="ar-panel-header">
          <div>
            <h3 className="ar-panel-title">Monthly Department Report</h3>
            <p className="ar-panel-subtitle">Signed documents and estimated time saved, by department</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div className="ar-field" style={{ minWidth: 140 }}>
              <label htmlFor="ar-report-month">Month</label>
              <input id="ar-report-month" type="month" value={month} onChange={(e) => handleMonthChange(e.target.value)} />
            </div>
            <button type="button" className="ar-btn ar-btn-primary" onClick={handleExportCsv} disabled={exporting || reportLoading}>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>

        {reportLoading ? (
          <div className="ar-skeleton-row" style={{ borderRadius: 10 }} />
        ) : reportError ? (
          <div className="ar-state">
            <p className="ar-state-title ar-state-error">Couldn't load the report</p>
            <p className="ar-state-desc">{reportError}</p>
          </div>
        ) : !report || report.departments.length === 0 ? (
          <div className="ar-state">
            <p className="ar-state-title">No documents generated in {month}</p>
            <p className="ar-state-desc">Pick a different month, or export once documents exist for this period.</p>
          </div>
        ) : (
          <>
            <div className="ar-summary-grid" style={{ marginBottom: 16 }}>
              <div className="ar-summary-tile">
                <div className="ar-summary-tile-label">Documents Signed</div>
                <div className="ar-summary-tile-value">{report.totals.documents_signed}</div>
              </div>
              <div className="ar-summary-tile">
                <div className="ar-summary-tile-label">Documents Generated</div>
                <div className="ar-summary-tile-value">{report.totals.documents_generated}</div>
              </div>
              <div className="ar-summary-tile">
                <div className="ar-summary-tile-label">Est. Time Saved</div>
                <div className="ar-summary-tile-value">
                  {report.totals.estimated_minutes_saved >= 60
                    ? `${(report.totals.estimated_minutes_saved / 60).toFixed(1)}h`
                    : `${report.totals.estimated_minutes_saved}m`}
                </div>
              </div>
            </div>
            <div className="ar-table-wrap">
              <table className="ar-table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Documents Generated</th>
                    <th>Documents Signed</th>
                    <th>Est. Time Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {report.departments.map((d) => (
                    <tr key={d.department}>
                      <td>{d.department}</td>
                      <td>{d.documents_generated}</td>
                      <td>{d.documents_signed}</td>
                      <td>{d.estimated_minutes_saved >= 60 ? `${(d.estimated_minutes_saved / 60).toFixed(1)}h` : `${d.estimated_minutes_saved}m`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
