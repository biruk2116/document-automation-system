import { useEffect, useState } from 'react';
import { settingsService } from '../services/workflowService';
import { useToast } from '../hooks/useToast';

export default function DatabaseConnectionsPage() {
  const { showToast } = useToast();
  const [current, setCurrent] = useState(null);
  const [form, setForm] = useState({ host: '', port: 3306, user: '', password: '', database: '' });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    settingsService.getDbConnection()
      .then((res) => {
        setCurrent(res.data);
        setForm((f) => ({ ...f, host: res.data.host, port: res.data.port, user: res.data.user, database: res.data.database }));
      })
      .catch((err) => showToast(err.message || 'Failed to load connection info.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await settingsService.testDbConnection(form);
      setTestResult({ ok: true, message: res.message });
    } catch (err) {
      setTestResult({ ok: false, message: err.message || 'Connection test failed.' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await settingsService.updateDbConnection(form);
      showToast(res.message || 'Saved.', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save connection.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!current) return <div className="settings-page">Loading connection info…</div>;

  return (
    <div className="settings-page">
      <h1>Database Connections</h1>

      <div className="db-current-info">
        <p><b>Current:</b> {current.user}@{current.host}:{current.port}/{current.database}</p>
      </div>

      <form className="template-form" onSubmit={handleSave} style={{ maxWidth: 480 }}>
        <div className="form-field">
          <label htmlFor="db-host">Host</label>
          <input id="db-host" value={form.host} onChange={handleChange('host')} required />
        </div>
        <div className="form-field">
          <label htmlFor="db-port">Port</label>
          <input id="db-port" type="number" value={form.port} onChange={handleChange('port')} required />
        </div>
        <div className="form-field">
          <label htmlFor="db-user">User</label>
          <input id="db-user" value={form.user} onChange={handleChange('user')} required />
        </div>
        <div className="form-field">
          <label htmlFor="db-password">Password</label>
          <input id="db-password" type="password" value={form.password} onChange={handleChange('password')} placeholder="(leave blank to keep current)" />
        </div>
        <div className="form-field">
          <label htmlFor="db-name">Database Name</label>
          <input id="db-name" value={form.database} onChange={handleChange('database')} required />
        </div>

        {testResult && (
          <p className={testResult.ok ? 'verify-status' : 'verify-status verify-error'}>{testResult.message}</p>
        )}

        <div className="template-form-actions">
          <button type="button" onClick={handleTest} disabled={testing} className="btn-secondary">
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save (requires restart)'}
          </button>
        </div>
      </form>
    </div>
  );
}
