import { useEffect, useMemo, useState } from 'react';
import { userService } from '../services/userService';
import { useToast } from '../hooks/useToast';
import ConfirmModal from '../components/common/ConfirmModal';

const ROLE_OPTIONS = [
  { value: 'system_admin', label: 'System Admin' },
  { value: 'generator',    label: 'Document Generator' },
  { value: 'approver',     label: 'Approver' },
];

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  system_admin: 'System Admin',
  generator: 'Document Generator',
  approver: 'Approver',
  recipient: 'Recipient',
};

const emptyForm = { email: '', full_name: '', role: 'generator', phone: '' };

/** Same "never a blank circle" initials fallback used by the sidebar's own avatar. */
function initialsFor(fullName) {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function UserRowAvatar({ user }) {
  if (user.avatar_url) {
    return <img src={user.avatar_url} alt="" className="user-row-avatar-img" />;
  }
  return (
    <div className="user-row-avatar-fallback" aria-hidden="true">
      {initialsFor(user.full_name)}
    </div>
  );
}

export default function UserManagementPage() {
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null); // user awaiting delete confirmation
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await userService.getAll();
      setUsers(res.data);
    } catch (err) {
      showToast(err.message || 'Failed to load users.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await userService.create(form);
      showToast(res.message || 'User created.', 'success');
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      showToast(err.message || 'Failed to create user.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (user) => {
    setBusyId(user.id);
    try {
      const res = await userService.updateStatus(user.id, !user.is_active);
      showToast(res.message || 'Updated.', 'success');
      load();
    } catch (err) {
      showToast(err.message || 'Failed to update status.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (user) => setPendingDelete(user);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const user = pendingDelete;
    setBusyId(user.id);
    try {
      const res = await userService.remove(user.id);
      showToast(res.message || 'User deleted.', 'success');
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      showToast(err.message || 'Failed to delete user.', 'error');
    } finally {
      setBusyId(null);
      setPendingDelete(null);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [users, search]);

  const activeCount = users.filter((u) => u.is_active).length;

  return (
    <div className="user-management-page">
      <div className="page-header user-management-header">
        <div>
          <h1>User Management</h1>
          <p className="user-management-subtitle">
            {loading ? 'Loading accounts…' : `${users.length} account${users.length === 1 ? '' : 's'} · ${activeCount} active`}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : '+ Create User'}
        </button>
      </div>

      {showForm && (
        <form className="template-form" onSubmit={handleCreate} style={{ maxWidth: 480, marginBottom: 24 }}>
          <div className="form-field">
            <label htmlFor="new-email">Email</label>
            <input id="new-email" type="email" value={form.email} onChange={handleChange('email')} required />
          </div>
          <div className="form-field">
            <label htmlFor="new-name">Full Name</label>
            <input id="new-name" value={form.full_name} onChange={handleChange('full_name')} required />
          </div>
          <div className="form-field">
            <label htmlFor="new-role">Role</label>
            <select id="new-role" value={form.role} onChange={handleChange('role')}>
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="new-phone">Phone (optional)</label>
            <input id="new-phone" value={form.phone} onChange={handleChange('phone')} />
          </div>
          <p style={{ margin: '0 0 12px', fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
            A welcome email with a <strong>set-password link</strong> will be sent automatically to the address above.
            No password needs to be entered here.
          </p>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Creating…' : 'Create Account & Send Welcome Email'}
          </button>
        </form>
      )}

      <div className="user-management-card">
        <div className="user-management-toolbar">
          <div className="user-management-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
              <path d="M21 21L16.5 16.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search users"
            />
          </div>
        </div>

        {loading ? (
          <div className="template-list-loading">Loading users…</div>
        ) : filteredUsers.length === 0 ? (
          <div className="template-list-empty">
            {search ? 'No users match your search.' : 'No users yet — create the first account above.'}
          </div>
        ) : (
          <table className="template-list-table user-management-table">
            <thead>
              <tr><th>User</th><th>Role</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="user-row-identity">
                      <UserRowAvatar user={u} />
                      <div className="user-row-identity-text">
                        <div className="user-row-name">{u.full_name}</div>
                        <div className="user-row-email">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`role-pill role-pill-${u.role}`}>{ROLE_LABELS[u.role] || u.role.replace('_', ' ')}</span>
                  </td>
                  <td>
                    <span className={`status-badge ${u.is_active ? 'status-active' : 'status-archived'}`}>
                      {u.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="template-actions">
                    {u.role !== 'super_admin' && (
                      <div style={{
                        display: 'flex',
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: 6,
                        alignItems: 'center',
                      }}>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(u)}
                          disabled={busyId === u.id}
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(u)}
                          disabled={busyId === u.id}
                          className="btn-danger"
                          title="Permanently delete this user"
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {busyId === u.id ? 'Working…' : 'Delete'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pendingDelete && (
        <ConfirmModal
          title="Delete user?"
          message={<>Delete <strong>{pendingDelete.full_name}</strong> ({pendingDelete.email})?</>}
          confirmLabel="Delete"
          busy={busyId === pendingDelete.id}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
