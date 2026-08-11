export const RBAC_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'submit',
  'verify',
  'approve',
  'reject',
  'print',
  'export',
  'manage',
] as const

export type RbacAction = (typeof RBAC_ACTIONS)[number]

export type DataScopeType =
  | 'OWN_RECORDS'
  | 'OWN_DIVISION'
  | 'OWN_BRANCH'
  | 'OWN_PROVINCE'
  | 'DEPARTMENT_WIDE'
  | 'SYSTEM_WIDE'

export type PermissionCode = string

export type RbacModule = {
  id?: string
  code: string
  name: string
  description?: string | null
  base_path: string
  icon?: string | null
  sort_order: number
  is_active: boolean
}

export type RbacMenuItem = {
  id?: string
  code: string
  module_code: string
  parent_code?: string | null
  label: string
  href: string
  icon?: string | null
  sort_order: number
  required_permissions: PermissionCode[]
  is_active: boolean
}

export type RbacPermission = {
  code: PermissionCode
  module_code: string
  menu_code?: string | null
  action: RbacAction | 'access'
  label: string
  description?: string | null
  is_active: boolean
}

export type RbacDataScope = {
  scope_type: DataScopeType
  department_ids?: string[]
  division_ids?: string[]
  branch_ids?: string[]
  province_ids?: string[]
}

export type RbacRole = {
  id: string
  name: string
  description: string | null
  data_scope_type?: DataScopeType | null
}

export type UserAccessContext = {
  userId: string
  authUserId?: string | null
  email: string
  name: string
  roles: RbacRole[]
  roleNames: string[]
  permissions: PermissionCode[]
  scopes: RbacDataScope[]
  departmentId?: string | null
  sectionId?: string | null
}

export type ScopeableRecord = {
  created_by?: string | null
  requesting_officer_id?: string | null
  user_id?: string | null
  department_id?: string | null
  section_id?: string | null
  division_id?: string | null
  branch_id?: string | null
  province_id?: string | null
}
