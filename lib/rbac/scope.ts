import { supabase, isSupabaseNetworkEnabled } from '@/lib/supabase'
import type { DataScopeType, RbacDataScope, ScopeableRecord } from './types'

export type ScopeContext = {
  userId: string
  departmentId?: string | null
  sectionId?: string | null
  scopes: RbacDataScope[]
  permissions: string[]
}

export async function getCurrentScopeContext(): Promise<ScopeContext | null> {
  if (!isSupabaseNetworkEnabled) return null

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('id, department_id, section_id, is_active, user_roles(role:roles(id, data_scope_type))')
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email || ''}`)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!profile) return null

  const roleRows = (profile.user_roles || []) as unknown as Array<{ role: { id: string; data_scope_type?: DataScopeType | null } | null }>
  const roleIds = roleRows.map((row) => row.role?.id).filter(Boolean) as string[]

  const [permissionRows, roleScopeRows, userScopeRows] = await Promise.all([
    roleIds.length
      ? supabase.from('role_permissions').select('permission').eq('is_allowed', true).in('role_id', roleIds)
      : Promise.resolve({ data: [], error: null }),
    roleIds.length
      ? supabase.from('role_data_scopes').select('scope_type, department_ids, division_ids, branch_ids, province_ids').in('role_id', roleIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('user_data_scopes').select('scope_type, department_ids, division_ids, branch_ids, province_ids').eq('user_id', profile.id),
  ])

  const permissions = Array.from(new Set((permissionRows.data || []).map((row) => row.permission)))
  const scopes = [...(roleScopeRows.data || []), ...(userScopeRows.data || [])] as RbacDataScope[]
  const fallbackScopes = roleRows.map((row) => ({ scope_type: row.role?.data_scope_type || 'OWN_RECORDS' }) as RbacDataScope)

  return {
    userId: profile.id,
    departmentId: profile.department_id,
    sectionId: profile.section_id,
    scopes: scopes.length ? scopes : fallbackScopes,
    permissions,
  }
}

export function isRecordInScope(context: ScopeContext | null, record: ScopeableRecord) {
  if (!context) return false
  if (context.permissions.includes('all')) return true

  const scopes = context.scopes.length ? context.scopes : [{ scope_type: 'OWN_RECORDS' as DataScopeType }]
  return scopes.some((scope) => {
    switch (scope.scope_type) {
      case 'SYSTEM_WIDE':
        return true
      case 'DEPARTMENT_WIDE':
        return Boolean(context.departmentId && record.department_id === context.departmentId)
      case 'OWN_DIVISION':
        return Boolean(record.division_id && scope.division_ids?.includes(record.division_id))
      case 'OWN_BRANCH':
        return Boolean(record.branch_id && scope.branch_ids?.includes(record.branch_id))
      case 'OWN_PROVINCE':
        return Boolean(record.province_id && scope.province_ids?.includes(record.province_id))
      case 'OWN_RECORDS':
      default:
        return record.created_by === context.userId || record.requesting_officer_id === context.userId || record.user_id === context.userId
    }
  })
}

export async function filterRowsToCurrentScope<T extends ScopeableRecord>(rows: T[] | null | undefined) {
  const list = rows || []
  const context = await getCurrentScopeContext()
  return list.filter((row) => isRecordInScope(context, row))
}
