import { useEffect, useState } from 'react';
import { dataSourceService, externalDbService } from '../../services/templateService';
import { useToast } from '../../hooks/useToast';

/**
 * Read-only view of an admin-mapped data source table (e.g. "employees"), shown to
 * Generator and Approver — not just Admin — so both roles can see exactly the data
 * the template is bound to instead of guessing record IDs blind.
 *
 * - Generator (onSelectRecord provided): clicking a row fills in that record's ID
 *   wherever the caller wants it (e.g. the "Record ID" field on the generate form).
 * - Approver (onSelectRecord omitted): purely a reference table, to cross-check the
 *   source data behind a document that's pending their signature.
 */
export default function MappedDataTable({ table, connectionId, onSelectRecord, selectedRecordId }) {
  const { showToast } = useToast();
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setColumns([]);
    setRows([]);
    setSearch('');
    if (!table) return;

    let cancelled = false;
    setLoading(true);
    // Same internal-vs-external branch as TemplateForm.jsx / TemplateViewPage.jsx: a
    // table that lives on a saved external connection must go through externalDbService,
    // never the internal-only dataSourceService, or this throws "table not found".
    const fetchRecords = connectionId
      ? externalDbService.getRecords(connectionId, table)
      : dataSourceService.getRecords(table);

    fetchRecords
      .then((res) => {
        if (cancelled) return;
        setColumns(res.columns || []);
        setRows(res.data || []);
      })
      .catch((err) => {
        if (!cancelled) showToast(err.message || `Failed to load "${table}" data.`, 'error');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, connectionId]);

  if (!table) return null;

  const filteredRows = search.trim()
    ? rows.filter((r) => JSON.stringify(r.values).toLowerCase().includes(search.trim().toLowerCase()))
    : rows;

  return (
    <div className="mapped-data-panel">
      <div className="mapped-data-header">
        <h3>Mapped Data — {table} <span className="mapped-data-count">({rows.length} record{rows.length === 1 ? '' : 's'})</span></h3>
        <button type="button" className="btn-secondary" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {!collapsed && (
        <>
          <p className="mapped-data-hint">
            This is the "{table}" data your admin mapped to this template.
            {onSelectRecord ? ' Click a row to use its record ID.' : ' Shown here for reference while you review.'}
          </p>

          {loading ? (
            <div className="template-list-empty">Loading {table} data…</div>
          ) : rows.length === 0 ? (
            <div className="template-list-empty">No records found in "{table}".</div>
          ) : (
            <>
              <input
                type="text"
                className="mapped-data-search"
                placeholder={`Search ${table}…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="mapped-data-table-wrap">
                <table className="template-list-table mapped-data-table">
                  <thead>
                    <tr>
                      {onSelectRecord && <th></th>}
                      {columns.map((c) => <th key={c}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r) => {
                      const isSelected = selectedRecordId !== undefined && String(selectedRecordId) === String(r.recordId);
                      return (
                        <tr
                          key={r.recordId}
                          className={onSelectRecord ? 'mapped-data-row-clickable' : undefined}
                          onClick={onSelectRecord ? () => onSelectRecord(r.recordId) : undefined}
                          style={isSelected ? { background: '#DBEAFE' } : undefined}
                        >
                          {onSelectRecord && (
                            <td>
                              <button type="button" className="btn-secondary" onClick={(e) => { e.stopPropagation(); onSelectRecord(r.recordId); }}>
                                {isSelected ? 'Selected' : 'Use'}
                              </button>
                            </td>
                          )}
                          {columns.map((c) => (
                            <td key={c}>{formatCell(r.values[c])}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function formatCell(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
