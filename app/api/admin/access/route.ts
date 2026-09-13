import { NextResponse, type NextRequest } from 'next/server'
import {
  authorizeAdmin,
  detectSchema,
  ROLE_ADMIN_FIELDS,
  ROLE_LEGACY_FIELDS,
} from '@/lib/rbac/admin'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || ''

const READ_PERMISSIONS = [
  'users.manage',
  'roles.manage',
  'permissions.manage',
  'modules.manage',
  'data_scope.manage',
]

const ACTION_PERMISSIONS: Record<string, string[]> = {
  UPDATE_ROLE: ['roles.manage'],
  SET_ROLE_PERMISSIONS: ['permissions.manage'],
  TOGGLE_ROLE_PERMISSION: ['permissions.manage'],
  GRANT_USER_PERMISSION: ['permissions.manage'],
  REVOKE_USER_PERMISSION: ['permissions.manage'],
  SAVE_MODULE: ['modules.manage'],
  DELETE_MODULE: ['modules.manage'],
  SAVE_MENU: ['modules.manage'],
  DELETE_MENU: ['modules.manage'],
  SAVE_ROLE_SCOPE: ['data_scope.manage'],
  SAVE_USER_SCOPE: ['data_scope.manage'],
  REVOKE_USER_SCOPE: ['data_scope.manage'],
}

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

// Reads stay constrained by the signed-in user's RLS-visible access context.
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, READ_PERMISSIONS, 'ACCESS_CONFIG_READ')
  if (!auth.ok) return auth.response

  const { admin } = auth
  const schema = await detectSchema(admin)
  const roleFields = schema.userAdministration ? ROLE_ADMIN_FIELDS : ROLE_LEGACY_FIELDS

  const [roles, permissions, rolePermissions, modules, menus, roleScopes, userScopes, userPermissions] =
    await Promise.all([
      admin.from('roles').select(roleFields).order('name'),
      admin
        .from('permissions')
        .select('code, module_code, menu_code, action, label, description, is_active')
        .order('module_code')
        .order('code'),
      admin.from('role_permissions').select('role_id, permission, is_allowed'),
      admin
        .from('modules')
        .select('id, code, name, description, base_path, icon, sort_order, is_active')
        .order('sort_order'),
      admin
        .from('menu_items')
        .select('id, code, module_code, parent_code, label, href, icon, sort_order, required_permissions, is_active')
        .order('sort_order'),
      admin.from('role_data_scopes').select('role_id, scope_type, department_ids, division_ids, branch_ids, province_ids'),
      admin.from('user_data_scopes').select('user_id, scope_type, department_ids, valid_until'),
      admin
        .from('user_permissions')
        .select('id, user_id, permission, effect, valid_from, valid_until, reason, granted_by'),
    ])

  const firstError = [roles, permissions, rolePermissions, modules, menus, roleScopes, userScopes, userPermissions]
    .find((result) => result.error)?.error
  if (firstError) return fail(firstError.message, 500)

  return NextResponse.json({
    roles: roles.data || [],
    permissions: permissions.data || [],
    rolePermissions: rolePermissions.data || [],
    modules: modules.data || [],
    menus: menus.data || [],
    roleScopes: roleScopes.data || [],
    userScopes: userScopes.data || [],
    userPermissions: userPermissions.data || [],
    migrationApplied: schema.userAdministration,
  })
}

// Writes are authorised twice: once by the NJSS server and again inside the
// JWT-verified Supabase Edge Function. The Edge Function owns service-role
// authority; the browser and Netlify runtime never receive that secret.
export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return fail('Supabase application configuration is unavailable.', 500)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return fail('Invalid request body')
  }

  const action = String(body.action || '').toUpperCase()
  const required = ACTION_PERMISSIONS[action]
  if (!required) return fail('Unsupported access administration action')

  const auth = await authorizeAdmin(request, required, action)
  if (!auth.ok) return auth.response

  const authorization = request.headers.get('authorization')?.trim() || ''
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    return fail('Authentication required', 401)
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/njss-admin-access`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const text = await response.text()
    return new NextResponse(text || null, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
    })
  } catch (error) {
    console.error('Access Control Edge Function request failed:', error)
    return fail('Unable to reach the access administration service. Please try again.', 502)
  }
}
