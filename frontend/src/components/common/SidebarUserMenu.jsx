import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { userService } from '../../services/userService';

// API base — used to resolve relative avatar/logo paths stored in the DB.
// In development the Vite proxy forwards /api/* → localhost:5000, but static
// assets under /uploads/* are NOT proxied. We need the explicit backend origin
// so the browser can reach them directly.
const API_ORIGIN = (() => {
  const viteUrl = import.meta.env?.VITE_API_URL || '';
  if (viteUrl) {
    // VITE_API_URL is typically "http://host:port/api" — strip the path
    try { return new URL(viteUrl).origin; } catch { /* fall through */ }
  }
  // Default: same host as the page but port 5000 (Express default)
  return `${window.location.protocol}//${window.location.hostname}:5000`;
})();

/**
 * Resolves an avatar_url stored in the database to a browser-loadable URL.
 * - Relative paths like /uploads/avatars/abc.jpg → prefixed with API_ORIGIN
 * - Already-absolute URLs (http/https) → returned unchanged (legacy rows)
 * - Blob object URLs (preview) → returned unchanged
 * - null / undefined → returned as-is (Avatar shows initials fallback)
 */
function resolveAvatarUrl(url) {
  if (!url) return url;
  if (url.startsWith('blob:') || url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  // Relative path — prepend the backend origin
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function initialsFor(n) {
  if (!n) return '?';
  const p = n.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

function Avatar({ user, previewUrl, size = 34 }) {
  const s = { width: size, height: size, fontSize: size * 0.38, flexShrink: 0 };
  // previewUrl is a blob: URL (already absolute); avatar_url may be relative → resolve it
  const src = previewUrl || resolveAvatarUrl(user?.avatar_url);
  return src
    ? <img src={src} alt="" className="user-avatar-img" style={s} />
    : <div className="user-avatar-fallback" style={s} aria-hidden="true">{initialsFor(user?.full_name)}</div>;
}

// ── SVG icons (inline, currentColor) ─────────────────────────────────────────
const Ic = ({ d, d2, circle, cx, cy, r, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {d  && <path d={d}  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>}
    {d2 && <path d={d2} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>}
    {circle && <circle cx={cx} cy={cy} r={r} stroke="currentColor" strokeWidth="1.8"/>}
  </svg>
);

const IconPerson = () => <Ic d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" d2="M4 20c.5-3.5 3.6-6 8-6s7.5 2.5 8 6"/>;
const IconPower  = () => <Ic d="M12 4v7" d2="M6.5 7C4.9 8.6 4 10.7 4 13a8 8 0 0 0 16 0c0-2.3-.9-4.4-2.5-6"/>;
const IconX      = () => <Ic d="M6 6l12 12M18 6L6 18"/>;
const IconCamera = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 8.5C4 7.4 4.9 6.5 6 6.5H8l1.2-1.7c.4-.5 1-.8 1.6-.8h2.4c.6 0 1.2.3 1.6.8L16 6.5h2c1.1 0 2 .9 2 2V17c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V8.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
    <circle cx="12" cy="12.5" r="3.4" stroke="currentColor" strokeWidth="1.7"/>
  </svg>
);

const emptyPw = { current: '', next: '', confirm: '' };

// ── Shared input style ────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%', padding: '8px 11px',
  border: '1.5px solid var(--border-strong)', borderRadius: 8,
  fontSize: '0.86rem', fontFamily: 'inherit',
  background: 'var(--bg-subtle)', color: 'var(--text-primary)',
  boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s',
};

// ── Thin button base ──────────────────────────────────────────────────────────
const btnBase = {
  border: 'none', borderRadius: 7, fontFamily: 'inherit',
  fontWeight: 600, cursor: 'pointer', fontSize: '0.82rem',
  padding: '8px 0', transition: 'opacity 0.15s',
};

// =============================================================================
export default function SidebarUserMenu() {
  const { user, logout, updateUser } = useAuth();
  const { showToast }                = useToast();
  const navigate                     = useNavigate();

  // 'closed' | 'menu' | 'profile'
  const [view, setView] = useState('closed');

  // Photo
  const [file,     setFile]     = useState(null);
  const [preview,  setPreview]  = useState(null);
  const [savingPh, setSavingPh] = useState(false);
  const [removePh, setRemovePh] = useState(false);

  // Password
  const [pw,      setPw]      = useState(emptyPw);
  const [pwBusy,  setPwBusy]  = useState(false);
  const [pwErr,   setPwErr]   = useState(null);

  const wrapRef = useRef(null);
  const fileRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const h = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setView('closed');
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Revoke blob URL on unmount
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (!user) return null;

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const resetPhoto = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null); setPreview(null);
  };
  const resetPw = () => {
    setPw(emptyPw); setPwErr(null);
  };
  const openProfile = () => { setView('profile'); resetPhoto(); resetPw(); };
  const closeAll    = () => { setView('closed'); resetPhoto(); resetPw(); };

  const handleLogout = async () => {
    closeAll();
    await logout();
    navigate('/login', { replace: true });
  };

  const pickFile = () => fileRef.current?.click();

  const onFileChange = (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(f); setPreview(URL.createObjectURL(f));
  };

  const savePhoto = async () => {
    if (!file || savingPh) return;
    setSavingPh(true);
    try {
      const res = await userService.uploadAvatar(file);
      updateUser({ avatar_url: res.data.avatar_url });
      showToast('Profile photo updated.', 'success');
      resetPhoto();
    } catch (err) {
      showToast(err.message || 'Upload failed.', 'error');
    } finally { setSavingPh(false); }
  };

  const removePhoto = async () => {
    if (!user.avatar_url || removePh) return;
    setRemovePh(true);
    try {
      await userService.removeAvatar();
      updateUser({ avatar_url: null });
      showToast('Photo removed.', 'success');
    } catch (err) {
      showToast(err.message || 'Failed.', 'error');
    } finally { setRemovePh(false); }
  };

  const submitPw = async (e) => {
    e.preventDefault(); setPwErr(null);
    const hasLen = pw.next.length >= 8;
    const hasUpper = /[A-Z]/.test(pw.next);
    const hasLower = /[a-z]/.test(pw.next);
    const hasNumber = /[0-9]/.test(pw.next);
    const hasSpecial = /[^A-Za-z0-9]/.test(pw.next);

    if (!hasLen || !hasUpper || !hasLower || !hasNumber || !hasSpecial) {
      return setPwErr('Password is not strong. It must contain at least 8 characters including uppercase, lowercase, a number, and a special character.');
    }
    if (pw.next !== pw.confirm) return setPwErr('Passwords do not match.');
    setPwBusy(true);
    try {
      await userService.changeOwnPassword(pw.current, pw.next);
      showToast('Password updated.', 'success');
      resetPw();
    } catch (err) {
      setPwErr(err.message || 'Failed to update password.');
    } finally { setPwBusy(false); }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="sidebar-user-menu" ref={wrapRef} style={{ position: 'relative', zIndex: 100 }}>

      {/* ── Trigger ─────────────────────────────────────────────────────── */}
      <button
        type="button"
        className="sidebar-user-trigger"
        onClick={() => setView((v) => v === 'closed' ? 'menu' : 'closed')}
        aria-expanded={view !== 'closed'}
        title="Account"
      >
        <Avatar user={user} size={28} />
        <span className="sidebar-user-trigger-text">
          <span className="sidebar-user-trigger-name" style={{ fontSize: '0.8rem' }}>{user.full_name}</span>
          <span className="sidebar-user-trigger-role" style={{ fontSize: '0.68rem' }}>{user.role.replace(/_/g, ' ')}</span>
        </span>
        <svg
          className={`sidebar-user-chevron${view !== 'closed' ? ' sidebar-user-chevron-open' : ''}`}
          width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"
        >
          <path d="M6 15L12 9L18 15" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* ── Compact dropdown — sits securely above the trigger inside the sidebar ── */}
      {view === 'menu' && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: '8px',
          overflow: 'hidden', zIndex: 1000,
        }} role="menu">

          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', borderBottom: '1px solid var(--border)',
          }}>
            <Avatar user={user} size={30} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.full_name}
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'capitalize', marginTop: 1 }}>
                {user.role.replace(/_/g, ' ')}
              </div>
            </div>
          </div>

          {/* My Profile */}
          <button type="button" role="menuitem"
            className="sidebar-user-dropdown-item"
            style={{ width: '100%', padding: '7px 10px', fontSize: '0.78rem' }}
            onClick={openProfile}
          >
            <span className="sidebar-user-dropdown-item-icon"><IconPerson size={14} /></span>
            My Profile
          </button>

          {/* Logout */}
          <button type="button" role="menuitem"
            className="sidebar-user-dropdown-item sidebar-user-dropdown-item-danger"
            style={{ width: '100%', padding: '7px 10px', fontSize: '0.78rem' }}
            onClick={handleLogout}
          >
            <span className="sidebar-user-dropdown-item-icon"><IconPower size={14} /></span>
            Logout
          </button>
        </div>
      )}

      {/* ── My Profile panel — covers full sidebar height, same width ──────── */}
      {view === 'profile' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: 'var(--sidebar-width)',
          height: '100vh',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 1300, // above sidebar (1200) so it covers it
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}>

          {/* Panel header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 16px 12px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>My Profile</span>
            <button type="button" onClick={closeAll} aria-label="Close profile"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6, display: 'flex' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-subtle)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
            >
              <IconX size={15} />
            </button>
          </div>

          {/* ── Avatar section — compact & professional (Requirement 7) ── */}
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 10, padding: '16px',
            borderBottom: '1px solid var(--border)',
          }}>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
              onChange={onFileChange} style={{ display: 'none' }} />

            {/* Compact circular avatar with camera upload button overlay */}
            <div style={{ position: 'relative', width: 68, height: 68 }}>
              <div
                onClick={pickFile}
                title="Click to change profile photo"
                style={{
                  width: 68, height: 68, borderRadius: '50%', overflow: 'hidden',
                  cursor: 'pointer', background: 'var(--bg-subtle)',
                  border: '1.5px solid var(--border-strong)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {(preview || user?.avatar_url) ? (
                  <img
                    src={preview || resolveAvatarUrl(user.avatar_url)}
                    alt="Profile"
                    style={{
                      width: '100%', height: '100%',
                      objectFit: 'cover', display: 'block',
                    }}
                  />
                ) : (
                  <div style={{
                    fontSize: '1.2rem', fontWeight: 600,
                    color: 'var(--brand)',
                  }}>
                    {initialsFor(user.full_name)}
                  </div>
                )}
              </div>

              {/* Small camera icon button over profile image */}
              <button
                type="button"
                onClick={pickFile}
                title="Upload or change profile photo"
                aria-label="Upload or change profile photo"
                style={{
                  position: 'absolute', bottom: -2, right: -2,
                  width: 24, height: 24, borderRadius: '50%',
                  background: '#2563EB', color: '#FFFFFF',
                  border: '2px solid var(--bg-surface)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', padding: 0,
                  transition: 'background 0.15s',
                }}
              >
                {savingPh ? (
                  <span className="user-avatar-spinner" style={{ width: 10, height: 10 }} />
                ) : (
                  <IconCamera />
                )}
              </button>
            </div>

            {/* Profile information: compact, small labels, readable values */}
            <div style={{ textAlign: 'center', width: '100%' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                {user.full_name}
              </div>
              <div style={{ marginTop: 3 }}>
                <span style={{
                  fontSize: '0.68rem', fontWeight: 600, textTransform: 'capitalize',
                  padding: '2px 8px', borderRadius: 4,
                  background: 'var(--brand-light)', color: 'var(--brand-text)',
                  display: 'inline-block',
                }}>
                  {user.role.replace(/_/g, ' ')}
                </span>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {user.email}
              </div>
            </div>

            {/* Save / Discard buttons when a new file is staged */}
            {file && (
              <div style={{ display: 'flex', gap: 6, width: '100%', marginTop: 2 }}>
                <button type="button"
                  onClick={resetPhoto}
                  disabled={savingPh}
                  style={{ ...btnBase, flex: 1, padding: '5px 0', fontSize: '0.75rem', background: 'var(--bg-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                  Discard
                </button>
                <button type="button"
                  onClick={savePhoto}
                  disabled={savingPh}
                  style={{ ...btnBase, flex: 1, padding: '5px 0', fontSize: '0.75rem', background: '#2563EB', color: '#fff', opacity: savingPh ? 0.6 : 1 }}>
                  {savingPh ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}

            {/* Remove existing photo */}
            {user.avatar_url && !file && (
              <button type="button" onClick={removePhoto} disabled={removePh}
                style={{ background: 'none', border: 'none', fontSize: '0.7rem', color: 'var(--error-text)', cursor: 'pointer', padding: 0, fontWeight: 500 }}>
                {removePh ? 'Removing…' : 'Remove photo'}
              </button>
            )}
          </div>

          {/* ── Update Password section — compact modern UI (Requirement 8) ── */}
          <form onSubmit={submitPw} style={{ padding: '14px 16px', flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '0.76rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              Update Password
            </div>

            {pwErr && (
              <div style={{
                background: 'var(--error-bg)', border: '1px solid var(--error-border)',
                color: 'var(--error-text)', borderRadius: 6,
                padding: '6px 8px', fontSize: '0.75rem', marginBottom: 8,
              }}>
                {pwErr}
              </div>
            )}

            {[
              { id: 'cur',  label: 'Current Password', val: pw.current, field: 'current', ac: 'current-password' },
              { id: 'new',  label: 'New Password',     val: pw.next,    field: 'next',    ac: 'new-password' },
              { id: 'con',  label: 'Confirm Password', val: pw.confirm, field: 'confirm', ac: 'new-password' },
            ].map(({ id, label, val, field, ac }) => (
              <div key={id} style={{ marginBottom: 8 }}>
                <label htmlFor={`spw-${id}`} style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 3 }}>
                  {label}
                </label>
                <input
                  id={`spw-${id}`}
                  type="password"
                  required
                  autoComplete={ac}
                  value={val}
                  onChange={(e) => setPw((p) => ({ ...p, [field]: e.target.value }))}
                  disabled={pwBusy}
                  style={{
                    ...inputStyle,
                    padding: '6px 9px',
                    fontSize: '0.8rem',
                    borderRadius: 6,
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#2563EB')}
                  onBlur={(e)  => (e.target.style.borderColor = 'var(--border-strong)')}
                />
                {/* Dynamic 3-state password strength indicator (Weak, Medium, Strong) */}
                {field === 'next' && pw.next.length > 0 && (() => {
                  let score = 0;
                  if (pw.next.length >= 8) score++;
                  if (/[A-Z]/.test(pw.next)) score++;
                  if (/[a-z]/.test(pw.next)) score++;
                  if (/[0-9]/.test(pw.next)) score++;
                  if (/[^A-Za-z0-9]/.test(pw.next)) score++;

                  const isStrong = score === 5;
                  const isMedium = score >= 3 && !isStrong;
                  const strengthText = isStrong ? 'Strong' : isMedium ? 'Medium' : 'Weak';
                  const activeBars = isStrong ? 3 : isMedium ? 2 : 1;
                  const barColor = isStrong ? '#10B981' : isMedium ? '#F59E0B' : '#EF4444';

                  return (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ display: 'flex', gap: 3, height: 3 }}>
                        {[1, 2, 3].map(i => (
                          <div
                            key={i}
                            style={{
                              flex: 1,
                              height: '100%',
                              borderRadius: 2,
                              background: i <= activeBars ? barColor : 'var(--border)',
                              transition: 'background 0.2s',
                            }}
                          />
                        ))}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                          Strength:
                        </span>
                        <span style={{ fontSize: '0.68rem', fontWeight: 600, color: barColor }}>
                          {strengthText}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))}

            {/* Cancel + Update buttons */}
            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              <button type="button"
                onClick={closeAll}
                disabled={pwBusy}
                style={{ ...btnBase, flex: 1, padding: '6px 0', fontSize: '0.78rem', background: 'var(--bg-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <button type="submit" disabled={pwBusy}
                style={{ ...btnBase, flex: 1, padding: '6px 0', fontSize: '0.78rem', background: '#2563EB', color: '#fff', opacity: pwBusy ? 0.6 : 1 }}>
                {pwBusy ? 'Saving…' : 'Update'}
              </button>
            </div>
          </form>

        </div>
      )}
    </div>
  );
}
