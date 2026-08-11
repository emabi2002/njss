// CRMS Role-Based Access Control fallback permissions.
// The database tables are the source of truth; this file is only used when the
// app is offline or when RBAC catalog lookups fail.

export type Permission = string

export const ROLES = [
  'System Administrator',
  'Registrar',
  'Administrator',
  'Finance Manager',
  'Department Head',
  'Section Manager',
  'Section Head',
  'Approver',
  'Requisition Officer',
  'Auditor',
  'Executive Management',
  'Executive Viewer',
  'Budget Officer',
  'Budget Manager',
  'HR Officer',
  'HR Manager',
  'Payroll Officer',
  'Payroll Manager',
  'Procurement Officer',
  'Asset Officer',
  'Finance Officer',
  'Divisional Manager',
] as const

export type RoleName = (typeof ROLES)[number]

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  'System Administrator': ['all'],
  Registrar: ['dashboard.view', 'plans.review', 'plans.authorize', 'budget.view', 'budget.module.view', 'budget.template', 'budget.template.review', 'budget.template.approve', 'reports.view', 'reports.export', 'audit.view'],
  Administrator: ['dashboard.view', 'masterdata.manage', 'registry.manage', 'settings.manage', 'plans.confirm', 'budget.view', 'budget.module.view', 'budget.confirm', 'budget.release', 'budget.template', 'budget.template.review', 'budget.template.approve', 'consolidation.run', 'users.manage', 'roles.manage', 'permissions.manage', 'modules.manage', 'data_scope.manage', 'reports.view'],
  'Finance Manager': ['dashboard.view', 'ff3.view', 'ff3.approve', 'ff3.reject', 'ff4.view', 'ff4.verify', 'ff4.approve', 'ff4.process', 'budget.view', 'budget.release', 'budget.template', 'budget.template.review', 'budget.template.approve', 'reports.view', 'reports.export'],
  'Department Head': ['dashboard.view', 'plans.review', 'budget.view', 'budget.template', 'budget.template.review', 'ff3.view', 'ff3.endorse', 'ff3.reject', 'reports.view'],
  'Section Manager': ['dashboard.view', 'plans.create', 'plans.submit', 'budget.view', 'budget.module.view', 'budget.template', 'budget.template.submit', 'ff3.view', 'ff3.create', 'ff3.edit', 'ff3.submit', 'ff4.view', 'ff4.create', 'ff4.submit'],
  'Section Head': ['dashboard.view', 'plans.create', 'plans.submit', 'budget.template', 'budget.template.submit', 'ff3.view', 'ff3.create', 'ff3.submit', 'ff3.endorse'],
  Approver: ['dashboard.view', 'ff3.view', 'ff3.approve'],
  'Requisition Officer': ['dashboard.view', 'ff3.view', 'ff3.create', 'ff3.edit', 'ff3.submit', 'ff4.view', 'ff4.create', 'ff4.submit'],
  Auditor: ['dashboard.view', 'audit.view', 'audit.export', 'reports.view', 'reports.export'],
  'Executive Management': ['dashboard.view', 'reports.view', 'reports.export'],
  'Executive Viewer': ['dashboard.view', 'reports.view'],
  'Budget Officer': ['dashboard.view', 'budget.module.view', 'budget.view', 'budget.template', 'budget.template.submit', 'plans.create', 'plans.submit', 'reports.view'],
  'Budget Manager': ['dashboard.view', 'budget.module.view', 'budget.module.review', 'budget.view', 'budget.template', 'budget.template.review', 'budget.template.approve', 'budget.release', 'consolidation.run', 'reports.view', 'reports.export'],
  'Finance Officer': ['dashboard.view', 'ff4.view', 'ff4.create', 'ff4.submit', 'budget.view', 'reports.view'],
  'Divisional Manager': ['dashboard.view', 'budget.module.view', 'budget.view', 'budget.template.review', 'plans.review', 'reports.view'],
}

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  'System Administrator': 'Full system access',
  Registrar: 'Authorize annual plans & consolidated department budget',
  Administrator: 'Manage master data, codes, templates & access control',
  'Finance Manager': 'Approve FF3, verify, approve & process FF4 payments',
  'Department Head': 'Review section plans; endorse or reject requisitions',
  'Section Manager': 'Prepare annual plans & requisitions for their section',
  'Section Head': 'Prepare plans & endorse requisitions',
  Approver: 'Final approver for requisitions',
  'Requisition Officer': 'Create FF3 & FF4 drafts',
  Auditor: 'Read-only audit logs & reports',
  'Executive Management': 'Dashboard & reports only',
  'Executive Viewer': 'Dashboard & management reports only',
  'Budget Officer': 'Prepare and submit budget records',
  'Budget Manager': 'Review and approve budget records',
  'Finance Officer': 'Prepare finance payment records',
  'Divisional Manager': 'Review divisional budget records',
}

export function permissionsForRoles(roles: Array<string | undefined | null>): Permission[] {
  const merged = roles.flatMap((role) => (role ? ROLE_PERMISSIONS[role] || [] : []))
  return Array.from(new Set(merged))
}

export function hasPermission(role: string | undefined | null, perm: Permission): boolean {
  return hasAnyRolePermission(role ? [role] : [], perm)
}

export function hasAnyRolePermission(roles: Array<string | undefined | null>, perm: Permission): boolean {
  const perms = permissionsForRoles(roles)
  return perms.includes('all') || perms.includes(perm)
}

export function hasAnyPermission(role: string | undefined | null, perms: Permission[]): boolean {
  return hasAnyPermissionForRoles(role ? [role] : [], perms)
}

export function hasAnyPermissionForRoles(roles: Array<string | undefined | null>, perms: Permission[]): boolean {
  const merged = permissionsForRoles(roles)
  return merged.includes('all') || perms.some((p) => merged.includes(p))
}
