import { useEffect, useState } from 'react';
import { settingsService } from '../services/workflowService';
import { useToast } from '../hooks/useToast';

export default function SettingsPage() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settingsService.get()
      .then((res) => setSettings(res.data))
      .catch((err) => showToast(err.message || 'Failed to load settings.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await settingsService.update(settings);
      setSettings(res.data);
      showToast('Settings saved.', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="settings-page">Loading settings…</div>;

  return (
    <div className="settings-page">
      <h1>System Settings</h1>
      <form className="template-form" onSubmit={handleSave} style={{ maxWidth: 480 }}>
        <div className="form-field">
          <label htmlFor="escalation-hours">Escalation reminder threshold (hours)</label>
          <input
            id="escalation-hours"
            type="number"
            min={1}
            value={settings.escalationHours}
            onChange={(e) => setSettings({ ...settings, escalationHours: e.target.value })}
          />
        </div>

        <div className="form-field">
          <label htmlFor="archive-years">Auto-archive documents older than (years)</label>
          <input
            id="archive-years"
            type="number"
            min={1}
            value={settings.archiveYears}
            onChange={(e) => setSettings({ ...settings, archiveYears: e.target.value })}
          />
        </div>

        <div className="form-field">
          <label htmlFor="minutes-saved">Estimated minutes saved per document (for reports)</label>
          <input
            id="minutes-saved"
            type="number"
            min={1}
            value={settings.minutesSavedPerDoc}
            onChange={(e) => setSettings({ ...settings, minutesSavedPerDoc: e.target.value })}
          />
        </div>

        <p className="settings-note">
          Note: OTP expiry (5 min), max attempts (3), and lockout duration (15 min) are fixed
          business rules (BR-004) and aren't configurable here by design.
        </p>

        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
