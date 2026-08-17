import { supabase, isSupabaseNetworkEnabled } from '@/lib/supabase'
import { ROUTE_PERMISSIONS } from './config'
import type { PermissionCode, RbacDataScope, RbacMenuItem, RbacModule, RbacRole, ScopeableRecord, UserAccessContext } from './types'

export const DEFAULT_DATA_SCOPE: RbacDataScope = { scope_type: 'OWN_RECORDS' }

export function normalizePermissions(perms: Array<string | null | undefined>) {
  return Array.from(new Set(perms.filter(Boolean) as string[])).sort()
}

export function canPerformAction(permissions: PermissionCode[], permission: PermissionCode) {
  return permissions.includes('all') || permissions.includes(permission)
}

export function canPerformAnyAction(permissions: PermissionCode[], required: PermissionCode[] = []) {
  if (!required.length) return true
  return permissions.includes('all') || required.some((permission) => permissions.includes(permission))
}

export function canPerformAllActions(permissions: PermissionCode[], required: PermissionCode[] = []) {
  if (!required.length) return true
  return permissions.includes('all') || required.every((permission) => permissions.includes(permission))
}

export function canAccessModule(permissions: PermissionCode[], module: RbacModule) {
  if (permissions.includes('all')) return true
  return permissions.some((permission) => permission.startsWith(`${module.code}:`))
}

export function canAccessMenu(permissions: PermissionCode[], menu: RbacMenuItem) {
  return canPerformAnyAction(permissions, menu.required_permissions)
}

export function getAuthorizedMenus(permissions: PermissionCode[], menus: RbacMenuItem[]) {
  return menus
    .filter((menu) => menu.is_active && canAccessMenu(permissions, menu))
    .sort((a, b) => a.sort_order - b.sort_order)
}

export function getRoutePermissions(pathname: string) {
  const matched = ROUTE_PERMISSIONS.find((route) => route.pattern.test(pathname))
  if (matched) return matched.permissions
  return pathname.startsWith('/dashboard') ? ['__deny_unmapped_route__'] : []
}

export function canAccessRoute(permissions: PermissionCode[], pathname: string) {
  return canPerformAnyAction(permissions, getRoutePermissions(pathname))
}

export function canAccessRecord(context: Pick<UserAccessContext, 'userId' | 'departmentId' | 'sectionId' | 'scopes' | 'permissions'>, record: ScopeableRecord) {
  if (context.permissions.includes('all')) return true
  const scopes = context.scopes.length ? context.scopes : [DEFAULT_DATA_SCOPE]
  return scopes.some((scope) => {
    switch (scope.scope_type) {
      case 'SYSTEM_WIDE':
        return true
      case 'DEPARTMENT_WIDE':
        return !!context.departmentId && record.department_id === context.departmentId
      case 'OWN_DIVISION':
        return !!record.division_id && !!scope.division_ids?.includes(record.division_id)
      case 'OWN_BRANCH':
        return !!record.branch_id && !!scope.branch_ids?.includes(record.branch_id)
      case 'OWN_PROVINCE':
        return !!record.province_id && !!scope.province_ids?.includes(record.province_id)
      case 'OWN_RECORDS':
      default:
        return record.created_by === context.userId || record.requesting_officer_id === context.userId || record.user_id === context.userId
    }
  })
}

export async function getUserRoles(userId: string): Promise<RbacRole[]> {
  if (!isSupabaseNetworkEnabled) return []
  const { data, error } = await supabase
    .from('user_roles')
    .select('role:roles(id, name, description, data_scope_type)')
    .eq('user_id', userId)

  if (error) throw error
  return (data || [])
    .map((row) => row.role as unknown as RbacRole | null)
    .filter((role): role is RbacRole => Boolean(role?.id))
}

export async function getUserPermissions(userId: string): Promise<PermissionCode[]> {
  if (!isSupabaseNetworkEnabled) return []

  try {
    const { data: roleRows, error: roleError } = await supabase
      .from('user_roles')
      .select('role_id')
      .eq('user_id', userId)

    if (roleError) throw roleError
    const roleIds = (roleRows || []).map((row) => row.role_id).filter(Boolean)
    if (!roleIds.length) return []

    const { data: permissions, error: permError } = await supabase
      .from('role_permissions')
      .select('permission')
      .eq('is_allowed', true)
      .in('role_id', roleIds)

    if (permError) throw permError

    const { data: userOverrides } = await supabase
      .from('user_permissions')
      .select('permission, effect')
      .eq('user_id', userId)
      .or('valid_until.is.null,valid_until.gte.now()')

    const allowed = normalizePermissions((permissions || []).map((row) => row.permission))
    const denied = new Set((userOverrides || []).filter((row) => row.effect === 'DENY').map((row) => row.permission))
    const directAllow = (userOverrides || []).filter((row) => row.effect === 'ALLOW').map((row) => row.permission)
    return normalizePermissions([...allowed.filter((permission) => !denied.has(permission)), ...directAllow])
  } catch (error) {
    console.warn('Database RBAC permission lookup failed:', error)
    return []
  }
}

export async function getUserDataScopes(userId: string, roles: RbacRole[]): Promise<RbacDataScope[]> {
  if (!isSupabaseNetworkEnabled) return roles.map((role) => ({ scope_type: role.data_scope_type || 'OWN_RECORDS' }))
  try {
    const roleIds = roles.map((role) => role.id)
    const [roleScopes, userScopes] = await Promise.all([
      roleIds.length
        ? supabase.from('role_data_scopes').select('scope_type, department_ids, division_ids, branch_ids, province_ids').in('role_id', roleIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('user_data_scopes').select('scope_type, department_ids, division_ids, branch_ids, province_ids').eq('user_id', userId),
    ])

    if (roleScopes.error) throw roleScopes.error
    if (userScopes.error) throw userScopes.error
    const scopes = [...(roleScopes.data || []), ...(userScopes.data || [])] as RbacDataScope[]
    if (scopes.length) return scopes
  } catch (error) {
    console.warn('Data scope lookup failed; using role defaults:', error)
  }
  return roles.map((role) => ({ scope_type: role.data_scope_type || 'OWN_RECORDS' }))
}

export async function loadRbacNavigation(permissions: PermissionCode[]) {
  if (!isSupabaseNetworkEnabled) return []
  try {
    const { data, error } = await supabase
      .from('menu_items')
      .select('code, module_code, parent_code, label, href, icon, sort_order, required_permissions, is_active')
      .eq('is_active', true)
      .order('sort_order')

    if (error) throw error
    return getAuthorizedMenus(permissions, (data || []) as RbacMenuItem[])
  } catch (error) {
    console.warn('Database RBAC navigation lookup failed:', error)
    return []
  }
}

export async function loadRbacModules() {
  if (!isSupabaseNetworkEnabled) return []
  try {
    const { data, error } = await supabase
      .from('modules')
      .select('code, name, description, base_path, icon, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order')
    if (error) throw error
    return (data || []) as RbacModule[]
  } catch (error) {
    console.warn('Database RBAC module lookup failed:', error)
    return []
  }
}

export async function logAccessEvent(input: {
  userId?: string | null
  userEmail?: string | null
  userName?: string | null
  action: string
  module?: string
  entityType?: string
  entityId?: string | null
  oldValues?: unknown
  newValues?: unknown
  metadata?: Record<string, unknown>
}) {
  if (!isSupabaseNetworkEnabled) return
  try {
    await supabase.from('audit_logs').insert({
      user_id: input.userId || null,
      user_email: input.userEmail || null,
      user_name: input.userName || null,
      action: input.action,
      entity_type: input.entityType || input.module || 'ACCESS',
      entity_id: input.entityId || null,
      old_values: input.oldValues || null,
      new_values: input.newValues || null,
      metadata: input.metadata || null,
    })
  } catch (error) {
    console.warn('Audit logging failed:', error)
  }
}
