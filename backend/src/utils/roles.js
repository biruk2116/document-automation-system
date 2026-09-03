// Matches SRS Section 5 — User Roles & Permissions (RBAC Matrix)
const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  SYSTEM_ADMIN: 'system_admin',
  GENERATOR: 'generator',   // Document Generator (HR/Finance)
  APPROVER: 'approver',     // Director
  RECIPIENT: 'recipient',   // read-only
});

// Convenience groups used across route guards
const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN];
const CAN_MANAGE_TEMPLATES = [ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN];
const CAN_MANAGE_SETTINGS = [ROLES.SUPER_ADMIN]; // DB connections/system settings: super admin only
const CAN_GENERATE_PDF = [ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN, ROLES.GENERATOR, ROLES.APPROVER];
const CAN_SIGN = [ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN, ROLES.APPROVER];
const CAN_VIEW_AUDIT_LOGS = [ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN];

module.exports = {
  ROLES,
  ADMIN_ROLES,
  CAN_MANAGE_TEMPLATES,
  CAN_MANAGE_SETTINGS,
  CAN_GENERATE_PDF,
  CAN_SIGN,
  CAN_VIEW_AUDIT_LOGS,
};
