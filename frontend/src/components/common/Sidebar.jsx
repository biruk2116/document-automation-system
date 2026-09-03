import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ROLES, CAN_GENERATE_PDF } from '../../utils/roles';
import SidebarUserMenu from './SidebarUserMenu';
import logo from '../../assets/logo.svg';
import {
  IconTemplates,
  IconMyDocuments,
  IconDocumentTracking,
  IconApprovals,
  IconUsers,
  IconSettings,
  IconDatabase,
  IconExternalData,
  IconAudit,
} from './SidebarIcons';

export default function Sidebar({ open, onClose }) {
  const { user } = useAuth();
  if (!user) return null;

  const isSuperAdmin = user.role === ROLES.SUPER_ADMIN;
  const isSystemAdmin = user.role === ROLES.SYSTEM_ADMIN;
  const isAdmin = isSuperAdmin || isSystemAdmin;

  // On narrow screens the sidebar behaves like an overlay drawer, so picking a link
  // should also close it; on desktop it stays open across navigation as normal.
  const handleNavClick = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 900) onClose?.();
  };

  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : 'sidebar-closed'}`}>
      <div className="sidebar-brand">
        <span className="sidebar-brand-text">
          <img src={logo} alt="" className="sidebar-brand-logo" />
          Doc Automation
        </span>
        <button type="button" className="sidebar-close-btn" onClick={onClose} title="Close sidebar" aria-label="Close sidebar">
          ×
        </button>
      </div>
      <nav className="sidebar-nav sidebar-nav-scroll" onClick={handleNavClick}>
        {/* Both admin roles manage templates (RBAC matrix row: Create/Edit/Delete Document Templates) */}
        {isAdmin && (
          <NavLink to="/templates" className="sidebar-link">
            <IconTemplates /> <span>Templates</span>
          </NavLink>
        )}

        {/*
          "My Documents" — visible to the 4 roles that can generate PDFs
          (super_admin, system_admin, generator, approver — see CAN_GENERATE_PDF).
          This is the single page for generating a document and viewing/managing
          documents that role has generated (route: /documents, MyDocumentsPage).
        */}
        {CAN_GENERATE_PDF.includes(user.role) && (
          <NavLink to="/documents" className="sidebar-link">
            <IconMyDocuments /> <span>My Documents</span>
          </NavLink>
        )}

        {/*
          "Document Tracking" — same roles as My Documents, but this is the
          Doc ID / Template / Record / Status / Generated / Actions table
          (View/Download, Generate Secure Link, recipient email + Deliver),
          reachable from its own sidebar entry on every page instead of being
          buried inside My Documents.
        */}
        {CAN_GENERATE_PDF.includes(user.role) && (
          <NavLink to="/document-tracking" className="sidebar-link">
            <IconDocumentTracking /> <span>Document Tracking</span>
          </NavLink>
        )}

        {(user.role === ROLES.APPROVER || isAdmin) && (
          <NavLink to="/approvals" className="sidebar-link">
            <IconApprovals /> <span>Pending Approvals</span>
          </NavLink>
        )}

        {/* Super admin only: Manage System Settings & DB Connections & Users (RBAC matrix row 1) */}
        {isSuperAdmin && (
          <>
            <div className="sidebar-section-label">Administration</div>
            <NavLink to="/users" className="sidebar-link">
              <IconUsers /> <span>User Management</span>
            </NavLink>
            <NavLink to="/settings" end className="sidebar-link">
              <IconSettings /> <span>System Settings</span>
            </NavLink>
            <NavLink to="/settings/database" className="sidebar-link">
              <IconDatabase /> <span>Database Connections</span>
            </NavLink>
            <NavLink to="/settings/external-databases" className="sidebar-link">
              <IconExternalData /> <span>External Data Sources</span>
            </NavLink>
          </>
        )}

        {/* Audit & Reports (Module 7, FR-036–FR-040): super admin + system admin */}
        {isAdmin && (
          <NavLink to="/audit-logs" className="sidebar-link">
            <IconAudit /> <span>Audit &amp; Reports</span>
          </NavLink>
        )}
      </nav>

      <SidebarUserMenu />
    </aside>
  );
}
