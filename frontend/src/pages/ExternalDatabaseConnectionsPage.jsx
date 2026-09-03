import { useEffect, useState } from 'react';
import { externalDbService } from '../services/templateService';
import { useToast } from '../hooks/useToast';

const DB_TYPES = [
  { value: 'mysql', label: 'MySQL (XAMPP)', defaultPort: 3306 },
  { value: 'mongodb', label: 'MongoDB', defaultPort: 27017 },
  { value: 'postgresql', label: 'PostgreSQL', defaultPort: 5432 },
  { value: 'sqlite', label: 'SQLite (file)', defaultPort: null },
];

const EMPTY_FORM = {
  name: '', db_type: 'mysql', host: '', port: 3306,
  username: '', password: '', database: '', file_path: '', ssl: false,
};

/**
 * Commercial-tier feature: connect this system to a CUSTOMER'S OWN external database
 * (MongoDB / PostgreSQL / SQLite) so their templates' data source map can be built from
 * their own tables — completely separate from, and never able to touch, this app's own
 * "doc_automation" database (see backend/src/utils/externalDbClients.js's
 * assertNoConflictWithInternalDb, which the backend re-checks on every test/save/browse
 * call regardless of what this form sends).
 *
 * Flow: pick a database type -> fill in credentials -> Test Connection (nothing is
 * saved yet) -> Save, which re-tests server-side and only persists if that succeeds.
 * The password is never sent back down once saved (see externalDbService.list()).
 */
export default function ExternalDatabaseConnectionsPage() {
  const { showToast } = useToast();
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);

  const isSqlite = form.db_type === 'sqlite';

  const loadConnections = () => {
    setLoading(true);
    externalDbService.list()
      .then((res) => setConnections(res.data || []))
      .catch((err) => showToast(err.message || 'Failed to load connections.', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadConnections(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTypeChange = (e) => {
    const dbType = e.target.value;
    const meta = DB_TYPES.find((t) => t.value === dbType);
    setForm((f) => ({
      ...f,
      db_type: dbType,
      port: meta?.defaultPort || '',
    }));
    setTestResult(null);
  };

  const handleChange = (field) => (e) => {
    const value = field === 'ssl' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
    setTestResult(null);
  };

  const buildPayload = () => ({
    name: form.name.trim(),
    db_type: form.db_type,
    host: isSqlite ? undefined : form.host.trim(),
    port: isSqlite ? undefined : (form.port ? Number(form.port) : undefined),
    username: isSqlite ? undefined : form.username.trim(),
    password: isSqlite ? undefined : form.password,
    database: isSqlite ? undefined : form.database.trim(),
    file_path: isSqlite ? form.file_path.trim() : undefined,
    ssl: isSqlite ? false : form.ssl,
  });

  const validateLocally = () => {
    if (!form.name.trim()) return 'Give this connection a name.';
    if (isSqlite) {
      if (!form.file_path.trim()) return 'A file path is required for SQLite.';
    } else {
      if (!form.host.trim()) return 'Host is required.';
      if (!form.database.trim()) return 'Database name is required.';
      if ((form.db_type === 'postgresql' || form.db_type === 'mysql') && !form.username.trim()) {
        return `Username is required for ${form.db_type === 'mysql' ? 'MySQL' : 'PostgreSQL'}.`;
      }
    }
    return null;
  };

  const handleTest = async () => {
    const localError = validateLocally();
    if (localError) { setTestResult({ ok: false, message: localError }); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await externalDbService.test(buildPayload());
      setTestResult({ ok: true, message: res.message });
    } catch (err) {
      setTestResult({ ok: false, message: err.message || 'Connection test failed.' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const localError = validateLocally();
    if (localError) { setTestResult({ ok: false, message: localError }); return; }
    setSaving(true);
    try {
      const res = await externalDbService.create(buildPayload());
      showToast(res.message || 'Connection saved.', 'success');
      setForm(EMPTY_FORM);
      setTestResult(null);
      loadConnections();
    } catch (err) {
      setTestResult({ ok: false, message: err.message || 'Failed to save connection.' });
      showToast(err.message || 'Failed to save connection.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      const res = await externalDbService.remove(id);
      showToast(res.message || 'Connection deleted.', 'success');
      setConnections((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      showToast(err.message || 'Failed to delete connection.', 'error');
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  };

  return (
    <div className="settings-page">
      <h1>External Database Connections</h1>
      <p className="ext-db-subtitle">
        Connect to an external database on any host — your own server, a friend's PC, a cloud instance,
        or any remote machine — so its tables can be used as a data source when building templates.
        Enter the remote host IP or domain name, port, and credentials. This connection is completely
        separate from and can never point at this system's own internal database.
      </p>

      <form className="template-form" onSubmit={handleSave} style={{ maxWidth: 560 }}>
        <div className="template-form-meta" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="form-field">
            <label htmlFor="ext-name">Connection Name</label>
            <input id="ext-name" value={form.name} onChange={handleChange('name')} placeholder="e.g. Customer HR Database" required />
          </div>
          <div className="form-field">
            <label htmlFor="ext-type">Database Type</label>
            <select id="ext-type" value={form.db_type} onChange={handleTypeChange}>
              {DB_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {isSqlite ? (
            <div className="form-field form-field-wide">
              <label htmlFor="ext-filepath">SQLite File Path</label>
              <input
                id="ext-filepath"
                value={form.file_path}
                onChange={handleChange('file_path')}
                placeholder="/absolute/path/to/database.sqlite"
                required
              />
            </div>
          ) : (
            <>
              <div className="form-field">
                <label htmlFor="ext-host">Host (IP or domain)</label>
                <input id="ext-host" value={form.host} onChange={handleChange('host')} placeholder="e.g. 192.168.1.50 or db.example.com" required />
              </div>
              <div className="form-field">
                <label htmlFor="ext-port">Port</label>
                <input id="ext-port" type="number" value={form.port} onChange={handleChange('port')} required />
              </div>
              <div className="form-field">
                <label htmlFor="ext-user">Username</label>
                <input id="ext-user" value={form.username} onChange={handleChange('username')} />
              </div>
              <div className="form-field">
                <label htmlFor="ext-pass">Password</label>
                <input id="ext-pass" type="password" value={form.password} onChange={handleChange('password')} />
              </div>
              <div className="form-field">
                <label htmlFor="ext-database">Database Name</label>
                <input
                  id="ext-database"
                  value={form.database}
                  onChange={handleChange('database')}
                  placeholder={form.db_type === 'mysql' ? 'e.g. students' : undefined}
                  required
                />
              </div>
              <div className="form-field ext-db-ssl-field">
                <label htmlFor="ext-ssl">
                  <input id="ext-ssl" type="checkbox" checked={form.ssl} onChange={handleChange('ssl')} /> Use SSL
                </label>
              </div>
            </>
          )}
        </div>

        {testResult && (
          <p className={testResult.ok ? 'verify-status' : 'verify-status verify-error'}>{testResult.message}</p>
        )}

        <div className="template-form-actions">
          <button type="button" onClick={handleTest} disabled={testing || saving} className="btn-secondary">
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button type="submit" disabled={saving || testing} className="btn-primary">
            {saving ? 'Saving…' : 'Save Connection'}
          </button>
        </div>
      </form>

      <h2 className="ext-db-list-heading">Saved Connections</h2>
      {loading ? (
        <div className="template-list-loading">Loading connections…</div>
      ) : connections.length === 0 ? (
        <div className="template-list-empty"><p>No external connections yet.</p></div>
      ) : (
        <table className="template-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Target</th>
              <th>Status</th>
              <th>Last Tested</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {connections.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td style={{ textTransform: 'capitalize' }}>{c.db_type}</td>
                <td>
                  {c.db_type === 'sqlite'
                    ? c.file_path
                    : `${c.username ? `${c.username}@` : ''}${c.host}:${c.port}/${c.database}`}
                </td>
                <td><span className={`status-badge status-${c.status === 'connected' ? 'active' : 'archived'}`}>{c.status}</span></td>
                <td>{c.last_tested_at ? new Date(c.last_tested_at).toLocaleString() : '—'}</td>
                <td className="template-table-actions">
                  {confirmingDeleteId === c.id ? (
                    <div className="delete-confirm">
                      <button type="button" className="btn-danger" disabled={deletingId === c.id} onClick={() => handleDelete(c.id)}>
                        {deletingId === c.id ? 'Deleting…' : 'Confirm'}
                      </button>
                      <button type="button" onClick={() => setConfirmingDeleteId(null)} disabled={deletingId === c.id}>Cancel</button>
                    </div>
                  ) : (
                    <button type="button" className="btn-danger-text" onClick={() => setConfirmingDeleteId(c.id)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
