import { useEffect, useRef, useState } from 'react';
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
const IconX      = () => <Ic d="M6 6l12 12M18 6L6 18"/>;
const IconCamera = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', pointerEvents: 'none' }}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
);

const IconEye = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconEyeOff = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <line x1="2" y1="2" x2="22" y2="22" />
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
  const { user, updateUser } = useAuth();
  const { showToast }        = useToast();

  // 'closed' | 'menu' | 'profile'
  const [view, setView] = useState('closed');

  // Photo
  const [file,     setFile]     = useState(null);
  const [preview,  setPreview]  = useState(null);
  const [savingPh, setSavingPh] = useState(false);
  const [removePh, setRemovePh] = useState(false);

  // Password
  const [pw,      setPw]      = useState(emptyPw);
  const [showPw,  setShowPw]  = useState({ current: false, next: false, confirm: false });
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
    setPw(emptyPw);
    setPwErr(null);
    setShowPw({ current: false, next: false, confirm: false });
  };
  const formatRole = (r) => {
    if (!r) return '';
    const cleaned = r.replace(/_/g, ' ').toLowerCase();
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  };

  const openProfile   = () => { setView('profile'); resetPhoto(); resetPw(); };
  const closeAll      = () => { setView('closed'); resetPhoto(); resetPw(); };
  const toggleProfile = () => {
    if (view === 'profile') closeAll();
    else openProfile();
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

      {/* ── Trigger: clicking opens My Profile directly ──────────────────── */}
      <button
        type="button"
        className="sidebar-user-trigger"
        onClick={toggleProfile}
        aria-expanded={view === 'profile'}
        title="My profile"
      >
        <Avatar user={user} size={28} />
        <span className="sidebar-user-trigger-text">
          <span
            className="sidebar-user-trigger-name"
            style={{
              fontSize: '14px',
              fontWeight: 600,
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            }}
          >
            {user.full_name}
          </span>
          <span
            className="sidebar-user-trigger-role"
            style={{
              fontSize: '12px',
              fontWeight: 400,
              textTransform: 'none',
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            }}
          >
            {formatRole(user.role)}
          </span>
        </span>
        <svg
          className={`sidebar-user-chevron${view === 'profile' ? ' sidebar-user-chevron-open' : ''}`}
          width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"
        >
          <path d="M6 15L12 9L18 15" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* ── My Profile panel — opens directly, covers sidebar height with Plus Jakarta Sans font ──────── */}
      {view === 'profile' && (
        <div
          className="sidebar-profile-panel"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: 'var(--sidebar-width)',
            height: '100vh',
            background: 'var(--bg-surface)',
            borderRight: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 1300, // covers sidebar cleanly
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          }}
        >

          {/* Panel header with Close button at top */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px 10px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <span style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-primary)', fontFamily: 'inherit' }}>
              My profile
            </span>
            <button
              type="button"
              onClick={closeAll}
              aria-label="Close profile"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: 4,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-subtle)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
            >
              <IconX size={16} />
            </button>
          </div>

          {/* ── Avatar section ── */}
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 8, padding: '12px 14px 10px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
              onChange={onFileChange} style={{ display: 'none' }} />

            {/* Circular avatar with camera upload button overlay */}
            <div style={{ position: 'relative', width: 62, height: 62 }}>
              <div
                onClick={pickFile}
                title="Click to change profile photo"
                style={{
                  width: 62, height: 62, borderRadius: '50%', overflow: 'hidden',
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
                    fontSize: '1.35rem', fontWeight: 700,
                    color: 'var(--brand)',
                    fontFamily: 'inherit',
                  }}>
                    {initialsFor(user.full_name)}
                  </div>
                )}
              </div>

              {/* Small camera icon button over profile image */}
              <button
                type="button"
                onClick={pickFile}
                className="user-avatar-upload-btn"
                title="Upload or change profile photo"
                aria-label="Upload or change profile photo"
              >
                {savingPh ? (
                  <span className="user-avatar-spinner" style={{ width: 10, height: 10 }} />
                ) : (
                  <IconCamera size={12} />
                )}
              </button>
            </div>

            {/* Profile information */}
            <div style={{ textAlign: 'center', width: '100%' }}>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)', fontFamily: 'inherit' }}>
                {user.full_name}
              </div>
              <div style={{ marginTop: 2 }}>
                <span style={{
                  fontSize: '0.8rem', fontWeight: 600, textTransform: 'none',
                  padding: '2px 8px', borderRadius: 4,
                  background: 'var(--brand-light)', color: 'var(--brand-text)',
                  display: 'inline-block',
                  fontFamily: 'inherit',
                }}>
                  {formatRole(user.role)}
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 3, fontFamily: 'inherit' }}>
                {user.email}
              </div>
            </div>

            {/* Save / Discard buttons when a new file is staged */}
            {file && (
              <div style={{ display: 'flex', gap: 6, width: '100%', marginTop: 2 }}>
                <button type="button"
                  onClick={resetPhoto}
                  disabled={savingPh}
                  style={{ ...btnBase, flex: 1, padding: '5px 0', fontSize: '0.82rem', background: 'var(--bg-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border)', fontFamily: 'inherit' }}>
                  Discard
                </button>
                <button type="button"
                  onClick={savePhoto}
                  disabled={savingPh}
                  style={{ ...btnBase, flex: 1, padding: '5px 0', fontSize: '0.82rem', background: 'var(--brand, #0856C3)', color: '#fff', opacity: savingPh ? 0.6 : 1, fontFamily: 'inherit' }}>
                  {savingPh ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}

            {/* Remove existing photo */}
            {user.avatar_url && !file && (
              <button type="button" onClick={removePhoto} disabled={removePh}
                style={{ background: 'none', border: 'none', fontSize: '0.78rem', color: 'var(--error-text)', cursor: 'pointer', padding: 0, fontWeight: 500, fontFamily: 'inherit' }}>
                {removePh ? 'Removing…' : 'Remove photo'}
              </button>
            )}
          </div>

          {/* ── Update password section ── */}
          <form onSubmit={submitPw} style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{
              fontWeight: 700,
              fontSize: '0.95rem',
              color: 'var(--text-secondary)',
              textTransform: 'none',
              marginBottom: 8,
              fontFamily: 'inherit',
            }}>
              Update password
            </div>

            {pwErr && (
              <div style={{
                background: 'var(--error-bg)', border: '1px solid var(--error-border)',
                color: 'var(--error-text)', borderRadius: 6,
                padding: '6px 8px', fontSize: '0.78rem', marginBottom: 8,
                fontFamily: 'inherit',
              }}>
                {pwErr}
              </div>
            )}

            {[
              { id: 'cur',  label: 'Current password', val: pw.current, field: 'current', ac: 'current-password' },
              { id: 'new',  label: 'New password',     val: pw.next,    field: 'next',    ac: 'new-password' },
              { id: 'con',  label: 'Confirm password', val: pw.confirm, field: 'confirm', ac: 'new-password' },
            ].map(({ id, label, val, field, ac }) => (
              <div key={id} style={{ marginBottom: 7 }}>
                <label htmlFor={`spw-${id}`} style={{
                  display: 'block', fontSize: '0.88rem', fontWeight: 600,
                  color: 'var(--text-secondary)', marginBottom: 2,
                  fontFamily: 'inherit', textTransform: 'none',
                }}>
                  {label}
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    id={`spw-${id}`}
                    type={showPw[field] ? 'text' : 'password'}
                    required
                    autoComplete={ac}
                    value={val}
                    onChange={(e) => setPw((p) => ({ ...p, [field]: e.target.value }))}
                    disabled={pwBusy}
                    style={{
                      ...inputStyle,
                      padding: '5px 28px 5px 8px',
                      fontSize: '0.92rem',
                      borderRadius: 6,
                      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                    }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--brand, #0856C3)')}
                    onBlur={(e)  => (e.target.style.borderColor = 'var(--border-strong)')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((prev) => ({ ...prev, [field]: !prev[field] }))}
                    title={showPw[field] ? 'Hide password' : 'Show password'}
                    aria-label={showPw[field] ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
                    tabIndex={-1}
                    style={{
                      position: 'absolute',
                      right: 6,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 2,
                      borderRadius: 4,
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                  >
                    {showPw[field] ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                  </button>
                </div>
                {/* Dynamic 3-state password strength indicator */}
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
                    <div style={{ marginTop: 3 }}>
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'inherit' }}>
                          Strength:
                        </span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: barColor, fontFamily: 'inherit' }}>
                          {strengthText}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))}

            {/* Cancel + Update buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button"
                onClick={closeAll}
                disabled={pwBusy}
                style={{
                  ...btnBase,
                  flex: 1,
                  padding: '7px 0',
                  fontSize: '0.92rem',
                  fontWeight: 600,
                  background: 'var(--bg-subtle)',
                  color: 'var(--text-primary)',
                  border: '1.5px solid var(--border)',
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button type="submit" disabled={pwBusy}
                style={{
                  ...btnBase,
                  flex: 1,
                  padding: '7px 0',
                  fontSize: '0.92rem',
                  fontWeight: 600,
                  background: 'var(--brand, #0856C3)',
                  color: '#fff',
                  opacity: pwBusy ? 0.6 : 1,
                  fontFamily: 'inherit',
                }}
              >
                {pwBusy ? 'Saving…' : 'Update'}
              </button>
            </div>
          </form>

        </div>
      )}
    </div>
  );
}
