// Database-backed RBAC permission helpers.
// Role and permission assignments are stored in Supabase tables, not in source.

export type Permission = string

export function permissionsForRoles(): Permission[] {
  return []
}

export function hasPermission(_role: string | undefined | null, _perm: Permission): boolean {
  void _role
  void _perm
  return false
}

export function hasAnyRolePermission(_roles: Array<string | undefined | null>, _perm: Permission): boolean {
  void _roles
  void _perm
  return false
}

export function hasAnyPermission(_role: string | undefined | null, _perms: Permission[]): boolean {
  void _role
  void _perms
  return false
}

export function hasAnyPermissionForRoles(_roles: Array<string | undefined | null>, _perms: Permission[]): boolean {
  void _roles
  void _perms
  return false
}
