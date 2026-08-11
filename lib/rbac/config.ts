import {
  BarChart3,
  BookOpen,
  Calculator,
  ClipboardList,
  FileCheck,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { PermissionCode, RbacMenuItem, RbacModule, RbacPermission } from './types'

export const MODULES: RbacModule[] = [
  { code: 'dashboard', name: 'Dashboard', description: 'NJSS executive and operational overview', base_path: '/dashboard', icon: 'LayoutDashboard', sort_order: 10, is_active: true },
  { code: 'budget', name: 'Budget', description: 'Budget preparation, ledgers, submissions, releases and consolidation', base_path: '/dashboard/budget', icon: 'Wallet', sort_order: 20, is_active: true },
  { code: 'finance', name: 'Finance', description: 'FF3, FF4, commitments and payment workflows', base_path: '/dashboard/ff3', icon: 'FileText', sort_order: 30, is_active: true },
  { code: 'reports', name: 'Reports', description: 'Management, finance and audit reporting', base_path: '/dashboard/reports', icon: 'BarChart3', sort_order: 40, is_active: true },
  { code: 'administration', name: 'Administration', description: 'Users, roles, module registration, menu access, data scope and audit', base_path: '/dashboard/users', icon: 'ShieldCheck', sort_order: 90, is_active: true },
  { code: 'system', name: 'System Configuration', description: 'Master data, registry and organization settings', base_path: '/dashboard/master', icon: 'Settings', sort_order: 100, is_active: true },
]

export const MENU_ITEMS: RbacMenuItem[] = [
  { code: 'dashboard.home', module_code: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard', sort_order: 10, required_permissions: ['dashboard.view'], is_active: true },
  { code: 'budget.control', module_code: 'budget', label: 'Budget', href: '/dashboard/budget', icon: 'Wallet', sort_order: 20, required_permissions: ['budget.view', 'budget.module.view'], is_active: true },
  { code: 'budget.template', module_code: 'budget', label: 'Budget Preparation', href: '/dashboard/budget-template', icon: 'Calculator', sort_order: 30, required_permissions: ['budget.template', 'budget.template.submit', 'budget.template.review', 'budget.template.approve'], is_active: true },
  { code: 'budget.plans', module_code: 'budget', label: 'Budget Submissions', href: '/dashboard/plans', icon: 'BookOpen', sort_order: 40, required_permissions: ['plans.create', 'plans.submit', 'plans.review', 'plans.approve', 'plans.authorize', 'plans.confirm', 'budget.view'], is_active: true },
  { code: 'budget.commitments', module_code: 'budget', label: 'Commitments', href: '/dashboard/commitments', icon: 'FileCheck', sort_order: 50, required_permissions: ['budget.view', 'ff4.verify', 'ff4.process'], is_active: true },
  { code: 'finance.ff3', module_code: 'finance', label: 'FF3 Requisitions', href: '/dashboard/ff3', icon: 'FileText', sort_order: 60, required_permissions: ['ff3.view', 'ff3.create', 'ff3.endorse', 'ff3.approve', 'ff3.reject'], is_active: true },
  { code: 'finance.ff3.new', module_code: 'finance', label: 'New FF3', href: '/dashboard/ff3/new', icon: 'FileText', sort_order: 61, required_permissions: ['ff3.create'], is_active: true },
  { code: 'finance.ff4', module_code: 'finance', label: 'FF4 Expenses', href: '/dashboard/ff4', icon: 'FileText', sort_order: 70, required_permissions: ['ff4.view', 'ff4.create', 'ff4.verify', 'ff4.process'], is_active: true },
  { code: 'finance.ff4.new', module_code: 'finance', label: 'New FF4', href: '/dashboard/ff4/new', icon: 'FileText', sort_order: 71, required_permissions: ['ff4.create'], is_active: true },
  { code: 'reports.library', module_code: 'reports', label: 'Relevant Reports', href: '/dashboard/reports', icon: 'BarChart3', sort_order: 80, required_permissions: ['reports.view', 'reports.export'], is_active: true },
  { code: 'administration.users', module_code: 'administration', label: 'Users', href: '/dashboard/users', icon: 'Users', sort_order: 90, required_permissions: ['users.manage'], is_active: true },
  { code: 'administration.audit', module_code: 'administration', label: 'Access Audit', href: '/dashboard/audit-log', icon: 'ClipboardList', sort_order: 95, required_permissions: ['audit.view'], is_active: true },
  { code: 'system.master', module_code: 'system', label: 'Master Data', href: '/dashboard/master', icon: 'FolderOpen', sort_order: 100, required_permissions: ['masterdata.manage', 'registry.manage'], is_active: true },
  { code: 'system.settings', module_code: 'system', label: 'System Settings', href: '/dashboard/settings', icon: 'Settings', sort_order: 110, required_permissions: ['settings.manage'], is_active: true },
  { code: 'system.help', module_code: 'system', label: 'User Guide', href: '/dashboard/help', icon: 'BookOpen', sort_order: 120, required_permissions: ['dashboard.view'], is_active: true },
]

const FINANCE_PERMISSIONS = [
  ['ff3.view', 'View FF3 requisitions'],
  ['ff3.create', 'Create FF3 requisitions'],
  ['ff3.edit', 'Edit FF3 drafts'],
  ['ff3.delete', 'Delete FF3 drafts'],
  ['ff3.submit', 'Submit FF3 requisitions'],
  ['ff3.endorse', 'Endorse FF3 requisitions'],
  ['ff3.approve', 'Approve FF3 requisitions'],
  ['ff3.reject', 'Reject FF3 requisitions'],
  ['ff3.print', 'Print FF3 requisitions'],
  ['ff3.export', 'Export FF3 requisitions'],
  ['ff4.view', 'View FF4 payment requests'],
  ['ff4.create', 'Create FF4 payment requests'],
  ['ff4.edit', 'Edit FF4 drafts'],
  ['ff4.delete', 'Delete FF4 drafts'],
  ['ff4.submit', 'Submit FF4 payment requests'],
  ['ff4.verify', 'Verify FF4 payment requests'],
  ['ff4.approve', 'Approve FF4 payment requests'],
  ['ff4.process', 'Process FF4 payments'],
  ['ff4.reject', 'Reject FF4 payment requests'],
  ['ff4.print', 'Print FF4 payment requests'],
  ['ff4.export', 'Export FF4 payment requests'],
]

const BUDGET_PERMISSIONS = [
  ['budget.module.view', 'Access Budget module'],
  ['budget.module.submit', 'Submit Budget module records'],
  ['budget.module.review', 'Review Budget module records'],
  ['budget.module.approve', 'Approve Budget module records'],
  ['budget.module.admin', 'Administer Budget module'],
  ['budget.view', 'View budget control'],
  ['budget.confirm', 'Confirm budget'],
  ['budget.release', 'Release budget'],
  ['budget.template', 'View budget template'],
  ['budget.template.submit', 'Submit budget template'],
  ['budget.template.review', 'Review budget template'],
  ['budget.template.approve', 'Approve budget template'],
  ['budget.export', 'Export budget reports'],
  ['plans.create', 'Create annual plans'],
  ['plans.submit', 'Submit annual plans'],
  ['plans.review', 'Review annual plans'],
  ['plans.approve', 'Approve annual plans'],
  ['plans.authorize', 'Authorize annual plans'],
  ['plans.confirm', 'Confirm plans to budget'],
  ['consolidation.run', 'Run budget consolidation'],
]

const ADMIN_PERMISSIONS = [
  ['users.manage', 'Manage users'],
  ['roles.manage', 'Manage roles'],
  ['permissions.manage', 'Manage permission matrix'],
  ['modules.manage', 'Manage modules and menus'],
  ['data_scope.manage', 'Manage data scope rules'],
  ['audit.view', 'View audit logs'],
  ['audit.export', 'Export audit logs'],
]

export const PERMISSION_CATALOG: RbacPermission[] = [
  { code: 'all', module_code: 'administration', action: 'manage', label: 'Full system access', is_active: true },
  { code: 'dashboard.view', module_code: 'dashboard', action: 'view', label: 'View dashboard', is_active: true },
  ...BUDGET_PERMISSIONS.map(([code, label]) => ({ code, label, module_code: 'budget', action: actionFromCode(code), is_active: true }) as RbacPermission),
  ...FINANCE_PERMISSIONS.map(([code, label]) => ({ code, label, module_code: 'finance', action: actionFromCode(code), is_active: true }) as RbacPermission),
  { code: 'reports.view', module_code: 'reports', action: 'view', label: 'View reports', is_active: true },
  { code: 'reports.export', module_code: 'reports', action: 'export', label: 'Export reports', is_active: true },
  { code: 'masterdata.manage', module_code: 'system', action: 'manage', label: 'Manage master data', is_active: true },
  { code: 'registry.manage', module_code: 'system', action: 'manage', label: 'Manage registries', is_active: true },
  { code: 'settings.manage', module_code: 'system', action: 'manage', label: 'Manage system settings', is_active: true },
  ...ADMIN_PERMISSIONS.map(([code, label]) => ({ code, label, module_code: 'administration', action: actionFromCode(code), is_active: true }) as RbacPermission),
]

export const ICONS: Record<string, LucideIcon> = {
  BarChart3,
  BookOpen,
  Calculator,
  ClipboardList,
  FileCheck,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
}

export const ROUTE_PERMISSIONS: Array<{ pattern: RegExp; permissions: PermissionCode[] }> = [
  { pattern: /^\/dashboard$/, permissions: ['dashboard.view'] },
  { pattern: /^\/dashboard\/budget($|\/)/, permissions: ['budget.view', 'budget.module.view'] },
  { pattern: /^\/dashboard\/budget-template($|\/)/, permissions: ['budget.template', 'budget.template.submit', 'budget.template.review', 'budget.template.approve'] },
  { pattern: /^\/dashboard\/plans($|\/)/, permissions: ['plans.create', 'plans.submit', 'plans.review', 'plans.approve', 'plans.authorize', 'plans.confirm', 'budget.view'] },
  { pattern: /^\/dashboard\/commitments($|\/)/, permissions: ['budget.view', 'ff4.verify', 'ff4.process'] },
  { pattern: /^\/dashboard\/ff3\/new$/, permissions: ['ff3.create'] },
  { pattern: /^\/dashboard\/ff3($|\/)/, permissions: ['ff3.view', 'ff3.create', 'ff3.endorse', 'ff3.approve', 'ff3.reject'] },
  { pattern: /^\/dashboard\/ff4\/new$/, permissions: ['ff4.create'] },
  { pattern: /^\/dashboard\/ff4($|\/)/, permissions: ['ff4.view', 'ff4.create', 'ff4.verify', 'ff4.approve', 'ff4.process'] },
  { pattern: /^\/dashboard\/reports($|\/)/, permissions: ['reports.view'] },
  { pattern: /^\/dashboard\/audit-log($|\/)/, permissions: ['audit.view'] },
  { pattern: /^\/dashboard\/users($|\/)/, permissions: ['users.manage'] },
  { pattern: /^\/dashboard\/master($|\/)/, permissions: ['masterdata.manage', 'registry.manage'] },
  { pattern: /^\/dashboard\/settings($|\/)/, permissions: ['settings.manage'] },
  { pattern: /^\/dashboard\/help($|\/)/, permissions: ['dashboard.view'] },
]

function actionFromCode(code: string): RbacPermission['action'] {
  const suffix = code.split('.').pop() || 'view'
  if (['view', 'create', 'edit', 'delete', 'submit', 'verify', 'approve', 'reject', 'print', 'export', 'manage'].includes(suffix)) {
    return suffix as RbacPermission['action']
  }
  if (suffix === 'admin') return 'manage'
  if (suffix === 'process' || suffix === 'confirm' || suffix === 'release' || suffix === 'authorize' || suffix === 'endorse' || suffix === 'review') return 'approve'
  return 'access'
}
