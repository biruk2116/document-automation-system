import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import Layout from './components/common/Layout';
import Login from './pages/Login';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import Unauthorized from './pages/Unauthorized';
import VerifyDocumentPage from './pages/VerifyDocumentPage';
import VerifyQrPage from './pages/VerifyQrPage';
import ReviewDocumentPage from './pages/ReviewDocumentPage';
import GeneratorDocumentViewPage from './pages/GeneratorDocumentViewPage';
import SecureDeliveryPage from './pages/SecureDeliveryPage';
import RejectionReviewPage from './pages/RejectionReviewPage';
import WorkflowTrackingPage from './pages/WorkflowTrackingPage';
import WorkflowResultPage from './pages/WorkflowResultPage';
import {
  CAN_MANAGE_TEMPLATES,
  CAN_MANAGE_SETTINGS,
  CAN_VIEW_AUDIT_LOGS,
  CAN_GENERATE_PDF,
  ROLES,
} from './utils/roles';

import TemplateManagementPage from './components/templates/TemplateManagementPage';
import TemplateCreatePage from './pages/TemplateCreatePage';
import TemplateViewPage from './pages/TemplateViewPage';
import MyDocumentsPage from './pages/MyDocumentsPage';
import DocumentTrackingPage from './pages/DocumentTrackingPage';
import ApprovalsPage from './pages/ApprovalsPage';
import SettingsPage from './pages/SettingsPage';
import DatabaseConnectionsPage from './pages/DatabaseConnectionsPage';
import ExternalDatabaseConnectionsPage from './pages/ExternalDatabaseConnectionsPage';
import UserManagementPage from './pages/UserManagementPage';
import AuditLogsPage from './pages/AuditLogsPage';

import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
      <AuthProvider>
        <Routes>
          {/* Public routes — no login required */}
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/unauthorized" element={<Unauthorized />} />
          <Route path="/verify" element={<VerifyDocumentPage />} />
          <Route path="/verify-qr/:verificationId" element={<VerifyQrPage />} />
          <Route path="/review/:token" element={<ReviewDocumentPage />} />
          <Route path="/document-view/:token" element={<GeneratorDocumentViewPage />} />
          <Route path="/deliver/:token" element={<SecureDeliveryPage />} />
          {/* Public rejection-review page — no login required */}
          <Route path="/rejection-review/:token" element={<RejectionReviewPage />} />
          {/* Generator workflow tracking — no login required, auto-logins then redirects */}
          <Route path="/workflow-track/:token" element={<WorkflowTrackingPage />} />

          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/templates" replace />} />

            {/* Workflow result — full-page submission view for the Generator */}
            <Route
              path="/workflow-result"
              element={
                <ProtectedRoute allowedRoles={CAN_GENERATE_PDF}>
                  <WorkflowResultPage />
                </ProtectedRoute>
              }
            />

            {/* Template Management — super_admin + system_admin only */}
            <Route
              path="/templates"
              element={
                <ProtectedRoute allowedRoles={CAN_MANAGE_TEMPLATES}>
                  <TemplateManagementPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/templates/create"
              element={
                <ProtectedRoute allowedRoles={CAN_MANAGE_TEMPLATES}>
                  <TemplateCreatePage mode="create" />
                </ProtectedRoute>
              }
            />
            {/* Full-page template view — opened from each card's "View" button. */}
            <Route
              path="/templates/view/:id"
              element={
                <ProtectedRoute allowedRoles={CAN_MANAGE_TEMPLATES}>
                  <TemplateViewPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/templates/edit/:id"
              element={
                <ProtectedRoute allowedRoles={CAN_MANAGE_TEMPLATES}>
                  <TemplateCreatePage mode="edit" />
                </ProtectedRoute>
              }
            />

            {/* Document generation — restricted to the 4 roles allowed to generate PDFs:
                super_admin, system_admin, generator, approver. */}
            <Route
              path="/documents"
              element={
                <ProtectedRoute allowedRoles={CAN_GENERATE_PDF}>
                  <MyDocumentsPage />
                </ProtectedRoute>
              }
            />

            {/* Document Tracking — same 4 roles as generation; the Doc ID/Template/
                Record/Status/Generated/Actions table with View, Generate Secure Link,
                recipient email + Deliver, split out of My Documents. */}
            <Route
              path="/document-tracking"
              element={
                <ProtectedRoute allowedRoles={CAN_GENERATE_PDF}>
                  <DocumentTrackingPage />
                </ProtectedRoute>
              }
            />

            {/* Approver only */}
            <Route
              path="/approvals"
              element={
                <ProtectedRoute allowedRoles={[ROLES.APPROVER, ...CAN_MANAGE_TEMPLATES]}>
                  <ApprovalsPage />
                </ProtectedRoute>
              }
            />

            {/* Super admin only */}
            <Route
              path="/settings"
              element={
                <ProtectedRoute allowedRoles={CAN_MANAGE_SETTINGS}>
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings/database"
              element={
                <ProtectedRoute allowedRoles={CAN_MANAGE_SETTINGS}>
                  <DatabaseConnectionsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings/external-databases"
              element={
                <ProtectedRoute allowedRoles={CAN_MANAGE_SETTINGS}>
                  <ExternalDatabaseConnectionsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/users"
              element={
                <ProtectedRoute allowedRoles={CAN_MANAGE_SETTINGS}>
                  <UserManagementPage />
                </ProtectedRoute>
              }
            />

            {/* Admin roles only */}
            <Route
              path="/audit-logs"
              element={
                <ProtectedRoute allowedRoles={CAN_VIEW_AUDIT_LOGS}>
                  <AuditLogsPage />
                </ProtectedRoute>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/templates" replace />} />
        </Routes>
      </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
