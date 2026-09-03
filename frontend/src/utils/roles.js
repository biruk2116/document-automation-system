// Must mirror backend/src/utils/roles.js exactly
export const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  SYSTEM_ADMIN: 'system_admin',
  GENERATOR: 'generator',
  APPROVER: 'approver',
  RECIPIENT: 'recipient',
});

export const CAN_MANAGE_TEMPLATES = [ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN];
export const CAN_MANAGE_SETTINGS = [ROLES.SUPER_ADMIN];
export const CAN_GENERATE_PDF = [ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN, ROLES.GENERATOR, ROLES.APPROVER];
export const CAN_SIGN = [ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN, ROLES.APPROVER];
export const CAN_VIEW_AUDIT_LOGS = [ROLES.SUPER_ADMIN, ROLES.SYSTEM_ADMIN];

export function hasRole(userRole, allowedRoles) {
  return Array.isArray(allowedRoles) && allowedRoles.includes(userRole);
}
