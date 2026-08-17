import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getRoutePermissions } from './client'
import type { DataScopeType, PermissionCode, RbacRole, UserAccessContext } from './types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

function bearerToken(request: NextRequest) {
  const header = request.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

export function createRequestSupabaseClient(request: NextRequest, response: NextResponse = NextResponse.next()) {
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    global: bearerToken(request)
      ? {
          headers: { Authorization: `Bearer ${bearerToken(request)}` },
        }
      : undefined,
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })
}

export async function getServerAccessContext(request: NextRequest, response: NextResponse = NextResponse.next()): Promise<UserAccessContext | null> {
  if (!supabaseUrl || !supabaseAnonKey) return null
  const supabase = createRequestSupabaseClient(request, response)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('id, auth_user_id, email, full_name, department_id, section_id, user_roles(role:roles(id, name, description, data_scope_type))')
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email || ''}`)
    .limit(1)
    .maybeSingle()

  if (!profile) {
    return {
      userId: user.id,
      authUserId: user.id,
      email: user.email || '',
      name: user.email?.split('@')[0] || 'User',
      roles: [],
      roleNames: [],
      permissions: [],
      scopes: [{ scope_type: 'OWN_RECORDS' }],
    }
  }

  const roles = ((profile.user_roles || []) as unknown as Array<{ role: { id: string; name: string; description: string | null; data_scope_type?: string | null } | null }>)
    .map((row) => row.role)
    .filter((role): role is { id: string; name: string; description: string | null; data_scope_type?: string | null } => Boolean(role?.id))
    .map((role): RbacRole => ({
      id: role.id,
      name: role.name,
      description: role.description,
      data_scope_type: (role.data_scope_type || 'OWN_RECORDS') as DataScopeType,
    }))

  const roleIds = roles.map((role) => role.id)
  let permissions: string[] = []
  if (roleIds.length) {
    const { data: rows } = await supabase
      .from('role_permissions')
      .select('permission')
      .eq('is_allowed', true)
      .in('role_id', roleIds)
    permissions = Array.from(new Set((rows || []).map((row) => row.permission)))
  }

  let scopes = roles.map((role) => ({ scope_type: (role.data_scope_type || 'OWN_RECORDS') as UserAccessContext['scopes'][number]['scope_type'] }))
  try {
    const [roleScopes, userScopes] = await Promise.all([
      roleIds.length ? supabase.from('role_data_scopes').select('scope_type, department_ids, division_ids, branch_ids, province_ids').in('role_id', roleIds) : Promise.resolve({ data: [], error: null }),
      supabase.from('user_data_scopes').select('scope_type, department_ids, division_ids, branch_ids, province_ids').eq('user_id', profile.id),
    ])
    const dataScopes = [...(roleScopes.data || []), ...(userScopes.data || [])]
    if (dataScopes.length) scopes = dataScopes as UserAccessContext['scopes']
  } catch {
    // Additive RBAC tables may not exist before migration; role defaults remain active.
  }

  return {
    userId: profile.id,
    authUserId: profile.auth_user_id,
    email: profile.email || user.email || '',
    name: profile.full_name || user.email?.split('@')[0] || 'User',
    roles,
    roleNames: roles.map((role) => role.name),
    permissions,
    scopes,
    departmentId: profile.department_id,
    sectionId: profile.section_id,
  }
}

export function hasServerPermission(context: UserAccessContext | null, permission: PermissionCode) {
  if (!context) return false
  return context.permissions.includes('all') || context.permissions.includes(permission)
}

export function hasAnyServerPermission(context: UserAccessContext | null, permissions: PermissionCode[]) {
  if (!permissions.length) return true
  if (!context) return false
  return context.permissions.includes('all') || permissions.some((permission) => context.permissions.includes(permission))
}

export async function logServerAccessEvent(request: NextRequest, context: UserAccessContext | null, input: { action: string; entityType?: string; entityId?: string | null; metadata?: Record<string, unknown> }) {
  try {
    const response = NextResponse.next()
    const supabase = createRequestSupabaseClient(request, response)
    await supabase.from('audit_logs').insert({
      user_id: context?.userId || null,
      user_email: context?.email || null,
      user_name: context?.name || null,
      action: input.action,
      entity_type: input.entityType || 'ACCESS',
      entity_id: input.entityId || null,
      ip_address: request.headers.get('x-forwarded-for')?.split(',')[0] || null,
      user_agent: request.headers.get('user-agent'),
      metadata: input.metadata || null,
    })
  } catch {
    // Audit failures should never mask the authorization response.
  }
}

export async function requirePermission(request: NextRequest, permissions: PermissionCode[]) {
  const response = NextResponse.next()
  const context = await getServerAccessContext(request, response)
  if (!hasAnyServerPermission(context, permissions)) {
    await logServerAccessEvent(request, context, {
      action: 'ACCESS_DENIED',
      entityType: 'AUTHORIZATION',
      metadata: { pathname: request.nextUrl.pathname, required_permissions: permissions },
    })
    return { context, response: NextResponse.json({ error: 'Access denied' }, { status: 403 }) }
  }
  return { context, response: null }
}

export async function guardDashboardRoute(request: NextRequest) {
  const response = NextResponse.next()
  const context = await getServerAccessContext(request, response)
  if (!context) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  const required = getRoutePermissions(request.nextUrl.pathname)
  if (!hasAnyServerPermission(context, required)) {
    await logServerAccessEvent(request, context, {
      action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
      entityType: 'AUTHORIZATION',
      metadata: { pathname: request.nextUrl.pathname, required_permissions: required },
    })
    return NextResponse.rewrite(new URL('/dashboard/no-access', request.url))
  }

  return response
}
