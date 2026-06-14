// CRMS Role-Based Access Control
// Mirrors the seeded `roles` / `role_permissions` tables so the UI can gate
// actions without a DB round-trip on every render.

export type Permission =
  | 'all'
  | 'dashboard.view'
  | 'ff3.create'
  | 'ff3.endorse'
  | 'ff3.approve'
  | 'ff3.reject'
  | 'ff4.create'
  | 'ff4.verify'
  | 'ff4.process'
  | 'budget.view'
  | 'budget.confirm'
  | 'budget.release'
  | 'plans.create'
  | 'plans.submit'
  | 'plans.review'
  | 'plans.approve'
  | 'plans.authorize'
  | 'plans.confirm'
  | 'consolidation.run'
  | 'masterdata.manage'
  | 'registry.manage'
  | 'reports.view'
  | 'audit.view'
  | 'users.manage'

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
] as const

export type RoleName = (typeof ROLES)[number]

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  'System Administrator': ['all'],
  Registrar: ['dashboard.view', 'plans.review', 'plans.authorize', 'budget.view', 'reports.view', 'audit.view'],
  Administrator: ['dashboard.view', 'masterdata.manage', 'registry.manage', 'plans.confirm', 'budget.view', 'budget.confirm', 'budget.release', 'consolidation.run', 'users.manage', 'reports.view'],
  'Finance Manager': ['dashboard.view', 'ff3.approve', 'ff4.verify', 'ff4.process', 'budget.view', 'budget.release', 'reports.view'],
  'Department Head': ['dashboard.view', 'plans.review', 'ff3.endorse', 'ff3.reject', 'reports.view'],
  'Section Manager': ['dashboard.view', 'plans.create', 'plans.submit', 'ff3.create', 'ff4.create', 'budget.view'],
  'Section Head': ['dashboard.view', 'plans.create', 'plans.submit', 'ff3.endorse'],
  Approver: ['dashboard.view', 'ff3.approve'],
  'Requisition Officer': ['dashboard.view', 'ff3.create', 'ff4.create'],
  Auditor: ['dashboard.view', 'audit.view', 'reports.view'],
  'Executive Management': ['dashboard.view', 'reports.view'],
  'Executive Viewer': ['dashboard.view', 'reports.view'],
}

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  'System Administrator': 'Full system access',
  Registrar: 'Authorize annual plans & consolidated department budget',
  Administrator: 'Manage master data, codes, templates & confirm budget',
  'Finance Manager': 'Approve FF3, verify & process FF4 payments',
  'Department Head': 'Review section plans; endorse or reject requisitions',
  'Section Manager': 'Prepare annual plans & requisitions for their section',
  'Section Head': 'Prepare plans & endorse requisitions',
  Approver: 'Final approver for requisitions',
  'Requisition Officer': 'Create FF3 & FF4 drafts',
  Auditor: 'Read-only audit logs & reports',
  'Executive Management': 'Dashboard & reports only',
  'Executive Viewer': 'Dashboard & management reports only',
}

export function hasPermission(role: string | undefined | null, perm: Permission): boolean {
  if (!role) return false
  const perms = ROLE_PERMISSIONS[role]
  if (!perms) return false
  return perms.includes('all') || perms.includes(perm)
}

export function hasAnyPermission(role: string | undefined | null, perms: Permission[]): boolean {
  return perms.some((p) => hasPermission(role, p))
}
