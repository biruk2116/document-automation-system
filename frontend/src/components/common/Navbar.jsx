import { useEffect, useState } from 'react';
import NotificationsBell from './NotificationsBell';

// ── Dark mode helpers ─────────────────────────────────────────────────────────
// Reads the saved preference from localStorage, falling back to the OS setting.
function getInitialDark() {
  try {
    const saved = localStorage.getItem('doc-automation-theme');
    if (saved === 'dark')  return true;
    if (saved === 'light') return false;
  } catch { /* localStorage blocked */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function applyDark(dark) {
  if (dark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  try {
    localStorage.setItem('doc-automation-theme', dark ? 'dark' : 'light');
  } catch { /* ignore */ }
}
// ─────────────────────────────────────────────────────────────────────────────

// Moon icon (dark mode)
function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

// Sun icon (light mode)
function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1"  x2="12" y2="3"  />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22"  y1="4.22"  x2="5.64"  y2="5.64"  />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1"  y1="12" x2="3"  y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36" />
      <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"  />
    </svg>
  );
}

export default function Navbar({ onToggleSidebar }) {
  const [dark, setDark] = useState(getInitialDark);
  // Apply on first render and whenever dark changes
  useEffect(() => { applyDark(dark); }, [dark]);

  // Also listen for OS-level preference changes (user switches OS theme while the
  // app is open and hasn't manually overridden it yet).
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const handler = (e) => {
      // Only follow OS changes if the user hasn't manually set a preference.
      try {
        if (!localStorage.getItem('doc-automation-theme')) setDark(e.matches);
      } catch { setDark(e.matches); }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggleDark = () => setDark((d) => !d);

  return (
    <header className="navbar">
      {/* Hamburger — toggles sidebar at ALL screen sizes */}
      <button
        type="button"
        className="hamburger-btn"
        onClick={onToggleSidebar}
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="3" y1="6"  x2="21" y2="6"  />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <div className="navbar-spacer" />

      <div className="navbar-user">
        {/* Dark / light mode toggle */}
        <button
          type="button"
          className="dark-mode-toggle"
          onClick={toggleDark}
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={dark}
        >
          {dark ? <SunIcon /> : <MoonIcon />}
          <span className="dark-mode-toggle-label">
            {dark ? 'Light' : 'Dark'}
          </span>
        </button>

        <NotificationsBell />
      </div>
    </header>
  );
}
