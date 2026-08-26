import type { DataScopeType } from "@/lib/rbac/types"

export type AdminRole = {
  id: string
  name: string
  description: string | null
  data_scope_type: DataScopeType | null
  is_active: boolean
  is_business_role?: boolean
  is_protected?: boolean
  workflow_sequence?: number | null
  deactivated_at?: string | null
  deactivation_reason?: string | null
}

export type AdminUser = {
  id: string
  email: string
  full_name: string | null
  employee_id: string | null
  phone: string | null
  position: string | null
  department_id: string | null
  section_id: string | null
  is_active: boolean
  auth_user_id: string | null
  created_at: string
  /** Columns below only exist once migration 041 has been applied. */
  is_protected?: boolean
  must_change_password?: boolean
  password_set_at?: string | null
  password_changed_at?: string | null
  last_login_at?: string | null
  invited_at?: string | null
  archived_at?: string | null
  archive_reason?: string | null
  department?: { id: string; name: string } | null
  section?: { id: string; name: string } | null
  user_roles?: Array<{ role?: AdminRole | null }>
}

export type Department = { id: string; name: string }
export type Section = { id: string; name: string; department_id: string | null }

export type PermissionRow = {
  code: string
  module_code: string
  menu_code: string | null
  action: string
  label: string
  description: string | null
  is_active: boolean
}

export type RolePermissionRow = { role_id: string; permission: string; is_allowed: boolean }
export type RoleScopeRow = { role_id: string; scope_type: DataScopeType; department_ids?: string[] | null }
export type UserScopeRow = {
  user_id: string
  scope_type: DataScopeType
  department_ids?: string[] | null
  valid_until?: string | null
}
export type UserPermissionRow = {
  id: string
  user_id: string
  permission: string
  effect: "ALLOW" | "DENY"
  valid_from: string | null
  valid_until: string | null
  reason: string | null
  granted_by: string | null
}

export type ModuleRow = {
  id?: string
  code: string
  name: string
  description: string | null
  base_path: string
  icon: string | null
  sort_order: number
  is_active: boolean
}

export type MenuRow = {
  id?: string
  code: string
  module_code: string
  parent_code: string | null
  label: string
  href: string
  icon: string | null
  sort_order: number
  required_permissions: string[] | null
  is_active: boolean
}

export type AccessConfig = {
  roles: AdminRole[]
  permissions: PermissionRow[]
  rolePermissions: RolePermissionRow[]
  modules: ModuleRow[]
  menus: MenuRow[]
  roleScopes: RoleScopeRow[]
  userScopes: UserScopeRow[]
  userPermissions: UserPermissionRow[]
  migrationApplied?: boolean
}

export const DATA_SCOPE_OPTIONS: Array<{ value: DataScopeType; label: string; description: string }> = [
  { value: "OWN_RECORDS", label: "Own Records", description: "Only records the user raised or is assigned to" },
  { value: "SECTION_WIDE", label: "Section-wide", description: "All authorised records within the user's assigned section" },
  { value: "OWN_DIVISION", label: "Own Division", description: "Records within the user's division" },
  { value: "OWN_BRANCH", label: "Own Branch", description: "Records within the user's branch" },
  { value: "OWN_PROVINCE", label: "Own Province", description: "Records within the user's province" },
  { value: "DEPARTMENT_WIDE", label: "Department-wide", description: "All records in the user's department" },
  { value: "SYSTEM_WIDE", label: "System-wide", description: "All records across NJSS" },
]

/** The four controlled business workflow groups, in processing order. */
export const WORKFLOW_ROLE_ORDER = [
  "Requisition Officer",
  "Line Supervisor",
  "Registrar",
  "Payment/Reconciliation Officer",
]

export const SYSTEM_ADMINISTRATOR = "System Administrator"

export function roleOf(user: AdminUser): AdminRole | null {
  return user.user_roles?.[0]?.role || null
}

export function sortRoles(roles: AdminRole[]): AdminRole[] {
  const rank = (role: AdminRole) => {
    if (role.name === SYSTEM_ADMINISTRATOR) return 900
    const index = WORKFLOW_ROLE_ORDER.indexOf(role.name)
    if (index >= 0) return index
    return role.workflow_sequence ?? 500
  }
  return [...roles].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

export function formatDate(value?: string | null) {
  if (!value) return "—"
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—"
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function initialsOf(user: Pick<AdminUser, "full_name" | "email">) {
  if (user.full_name) {
    return user.full_name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }
  return user.email.slice(0, 2).toUpperCase()
}
