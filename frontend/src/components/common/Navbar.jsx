import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import NotificationsBell from './NotificationsBell';
import ThemeToggle from './ThemeToggle';

export default function Navbar({ onToggleSidebar, sidebarOpen }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="navbar">
      {/* Hamburger — opens the sidebar. Only shown when the sidebar is closed
          so it never conflicts with the sidebar's own × close button. */}
      {!sidebarOpen && (
        <button
          type="button"
          className="hamburger-btn"
          onClick={onToggleSidebar}
          title="Open sidebar"
          aria-label="Open sidebar"
          aria-expanded={false}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="3" y1="6"  x2="21" y2="6"  />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      )}
      {/* Spacer that fills when hamburger is visible — keeps right side aligned */}
      {sidebarOpen && <div className="hamburger-btn" style={{ visibility: 'hidden', pointerEvents: 'none' }} aria-hidden="true" />}

      <div className="navbar-spacer" />

      <div className="navbar-user">
        {/* Global dark / light mode toggle */}
        <ThemeToggle />

        {/* Notifications */}
        <NotificationsBell />

        {/* Logout icon button at the last corner beside notification icon (no text) */}
        <button
          type="button"
          onClick={handleLogout}
          className="navbar-logout-btn"
          title="Logout"
          aria-label="Logout"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1.5" />
            <polyline points="17 8 21 12 17 16" />
            <line x1="8" y1="12" x2="21" y2="12" />
          </svg>
        </button>
      </div>
    </header>
  );
}
