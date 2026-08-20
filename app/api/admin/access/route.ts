import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  authorizeAdmin,
  detectSchema,
  recordAudit,
  ROLE_ADMIN_FIELDS,
  ROLE_LEGACY_FIELDS,
} from '@/lib/rbac/admin'
import type { UserAccessContext } from '@/lib/rbac/types'

export const dynamic = 'force-dynamic'

const READ_PERMISSIONS = [
  'users.manage',
  'roles.manage',
  'permissions.manage',
  'modules.manage',
  'data_scope.manage',
]

/** Maps each write action to the permission that authorises it. */
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

// -----------------------------------------------------------------------------
// GET — the full access-control configuration
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// POST — controlled write actions
// -----------------------------------------------------------------------------

export async function POST(request: NextRequest) {
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

  const { admin, context } = auth

  try {
    switch (action) {
      case 'UPDATE_ROLE':
        return await updateRole(request, admin, context, body)
      case 'SET_ROLE_PERMISSIONS':
        return await setRolePermissions(request, admin, context, body)
      case 'TOGGLE_ROLE_PERMISSION':
        return await toggleRolePermission(request, admin, context, body)
      case 'GRANT_USER_PERMISSION':
        return await grantUserPermission(request, admin, context, body)
      case 'REVOKE_USER_PERMISSION':
        return await revokeUserPermission(request, admin, context, body)
      case 'SAVE_MODULE':
        return await saveModule(request, admin, context, body)
      case 'DELETE_MODULE':
        return await deleteModule(request, admin, context, body)
      case 'SAVE_MENU':
        return await saveMenu(request, admin, context, body)
      case 'DELETE_MENU':
        return await deleteMenu(request, admin, context, body)
      case 'SAVE_ROLE_SCOPE':
        return await saveRoleScope(request, admin, context, body)
      case 'SAVE_USER_SCOPE':
        return await saveUserScope(request, admin, context, body)
      case 'REVOKE_USER_SCOPE':
        return await revokeUserScope(request, admin, context, body)
      default:
        return fail('Unsupported access administration action')
    }
  } catch (error) {
    console.error(`Access administration action ${action} failed:`, error)
    return fail(error instanceof Error ? error.message : 'Action failed')
  }
}

// -----------------------------------------------------------------------------
// Roles — description and scope only. The five workflow roles are fixed.
// -----------------------------------------------------------------------------

async function updateRole(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: Record<string, unknown>,
) {
  const roleId = String(body.roleId || '')
  if (!roleId) return fail('roleId is required.')

  const { data: before } = await admin.from('roles').select('*').eq('id', roleId).maybeSingle()
  if (!before) return fail('Role not found', 404)

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.description !== undefined) patch.description = String(body.description || '') || null
  if (body.dataScopeType !== undefined) patch.data_scope_type = String(body.dataScopeType)

  // Protected roles keep their name, active state and protected flag.
  if (!before.is_protected) {
    if (body.name !== undefined) patch.name = String(body.name).trim()
    if (body.isActive !== undefined) patch.is_active = Boolean(body.isActive)
  }

  const { data: updated, error } = await admin
    .from('roles')
    .update(patch)
    .eq('id', roleId)
    .select()
    .single()
  if (error) return fail(error.message)

  if (body.dataScopeType !== undefined) {
    await admin
      .from('role_data_scopes')
      .upsert({ role_id: roleId, scope_type: String(body.dataScopeType) }, { onConflict: 'role_id,scope_type' })
  }

  await recordAudit(admin, {
    actorContext: context,
    action: 'ROLE_UPDATED',
    entityType: 'ROLE',
    entityId: roleId,
    entityReference: updated.name,
    oldValues: before,
    newValues: updated,
    request,
  })

  return NextResponse.json({ role: updated })
}

async function setRolePermissions(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: Record<string, unknown>,
) {
  const roleId = String(body.roleId || '')
  const permissions = Array.isArray(body.permissions) ? (body.permissions as string[]) : []
  if (!roleId) return fail('roleId is required.')

  const { data: role } = await admin.from('roles').select('id, name').eq('id', roleId).maybeSingle()
  if (!role) return fail('Role not found', 404)

  const { data: before } = await admin
    .from('role_permissions')
    .select('permission')
    .eq('role_id', roleId)
    .eq('is_allowed', true)

  const { error: deleteError } = await admin.from('role_permissions').delete().eq('role_id', roleId)
  if (deleteError) return fail(deleteError.message)

  if (permissions.length) {
    const { error: insertError } = await admin
      .from('role_permissions')
      .insert(permissions.map((permission) => ({ role_id: roleId, permission, is_allowed: true })))
    if (insertError) return fail(insertError.message)
  }

  await recordAudit(admin, {
    actorContext: context,
    action: 'ROLE_PERMISSIONS_CHANGED',
    entityType: 'ROLE',
    entityId: roleId,
    entityReference: role.name,
    oldValues: { permissions: (before || []).map((row) => row.permission) },
    newValues: { permissions },
    request,
  })

  return NextResponse.json({ ok: true })
}

async function toggleRolePermission(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: Record<string, unknown>,
) {
  const roleId = String(body.roleId || '')
  const permission = String(body.permission || '')
  const grant = Boolean(body.grant)
  if (!roleId || !permission) return fail('roleId and permission are required.')

  const { data: role } = await admin.from('roles').select('id, name').eq('id', roleId).maybeSingle()
  if (!role) return fail('Role not found', 404)

  if (grant) {
    const { error } = await admin
      .from('role_permissions')
      .upsert({ role_id: roleId, permission, is_allowed: true }, { onConflict: 'role_id,permission' })
    if (error) return fail(error.message)
  } else {
    const { error } = await admin
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId)
      .eq('permission', permission)
    if (error) return fail(error.message)
  }

  await recordAudit(admin, {
    actorContext: context,
    action: grant ? 'PERMISSION_GRANTED' : 'PERMISSION_REVOKED',
    entityType: 'ROLE',
    entityId: roleId,
    entityReference: role.name,
    newValues: { permission, granted: grant },
    request,
  })

  return NextResponse.json({ ok: true })
}

// -----------------------------------------------------------------------------
// Temporary individual permissions
// -----------------------------------------------------------------------------

async function grantUserPermission(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: Record<string, unknown>,
) {
  const userId = String(body.userId || '')
  const permission = String(body.permission || '')
  const effect = String(body.effect || 'ALLOW').toUpperCase()
  const reason = String(body.reason || '').trim()
  const validUntil = body.validUntil ? String(body.validUntil) : null

  if (!userId || !permission) return fail('userId and permission are required.')
  if (!['ALLOW', 'DENY'].includes(effect)) return fail('Effect must be ALLOW or DENY.')
  if (!reason) return fail('A reason is required for an individual permission grant.')
  if (!validUntil) return fail('An expiry date is required for an individual permission grant.')

  const { data, error } = await admin
    .from('user_permissions')
    .upsert(
      {
        user_id: userId,
        permission,
        effect,
        reason,
        valid_from: new Date().toISOString(),
        valid_until: validUntil,
        granted_by: context.userId,
      },
      { onConflict: 'user_id,permission' },
    )
    .select()
    .single()
  if (error) return fail(error.message)

  await recordAudit(admin, {
    actorContext: context,
    action: 'USER_PERMISSION_GRANTED',
    entityType: 'USER',
    entityId: userId,
    newValues: { permission, effect, valid_until: validUntil, reason },
    request,
  })

  return NextResponse.json({ userPermission: data })
}

async function revokeUserPermission(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: Record<string, unknown>,
) {
  const id = String(body.id || '')
  if (!id) return fail('id is required.')

  const { data: before } = await admin.from('user_permissions').select('*').eq('id', id).maybeSingle()
  const { error } = await admin.from('user_permissions').delete().eq('id', id)
  if (error) return fail(error.message)

  await recordAudit(admin, {
    actorContext: context,
    action: 'USER_PERMISSION_REVOKED',
    entityType: 'USER',
    entityId: before?.user_id || null,
    oldValues: before,
    request,
  })

  return NextResponse.json({ ok: true })
}

// -----------------------------------------------------------------------------
// Modules and menus
// -----------------------------------------------------------------------------

async function saveModule(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: Record<string, unknown>,
) {
  const moduleInput = (body.module || {}) as Record<string, unknown>
  const code = String(moduleInput.code || '').trim()
  if (!code) return fail('Module code is required.')

  const { data: before } = await admin.from('modules').select('*').eq('code', code).maybeSingle()

  const payload = {
    code,
    name: String(moduleInput.name || code).trim(),
    description: moduleInput.description ? String(moduleInput.description) : null,
    base_path: String(moduleInput.base_path || `/dashboard/${code}`),
    icon: moduleInput.icon ? String(moduleInput.icon) : null,
    sort_order: Number(moduleInput.sort_order ?? 100),
    is_active: moduleInput.is_active === undefined ? true : Boolean(moduleInput.is_active),
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await admin
    .from('modules')
    .upsert(payload, { onConflict: 'code' })
    .select()
    .single()
  if (error) return fail(error.message)

  await recordAudit(admin, {
    actorContext: context,
    action: before ? 'MODULE_UPDATED' : 'MODULE_CREATED',
    entityType: 'MODULE',
    entityId: data.id,
    entityReference: code,
    oldValues: before,
    newValues: data,
    request,
  })

  return NextResponse.json({ module: data })
}

async function deleteModule(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: Record<string, unknown>,
) {
  const code = String(body.code || '')
  if (!code) return fail('Module code is required.')

  const { count } = await admin
    .from('menu_items')
    .select('code', { count: 'exact', head: true })
    .eq('module_code', code)
  if ((count || 0) > 0) {
    return fail('This module still has menus attached. Remove or reassign them first.')
  }

  const { data: before } = await admin.from('modules').select('*').eq('code', code).maybeSingle()
  const { error } = await admin.from('modules').delete().eq('code', code)
  if (error) return fail(error.message)

  await recordAudit(admin, {
    actorContext: context,
    action: 'MODULE_DELETED',
    entityType: 'MODULE',
    entityReference: code,
    oldValues: before,
    request,
  })

  return NextResponse.json({ ok: true })
}

async function saveMenu(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: Record<string, unknown>,
) {
  const menu = (body.menu || {}) as Record<string, unknown>
  const code = String(menu.code || '').trim()
  if (!code) return fail('Menu code is required.')
  if (!menu.module_code) return fail('Menu must belong to a module.')

  const { data: before } = await admin.from('menu_items').select('*').eq('code', code).maybeSingle()

  const payload = {
    code,
    module_code: String(menu.module_code),
    parent_code: menu.parent_code ? String(menu.parent_code) : null,
    label: String(menu.label || code),
    href: String(menu.href || '#'),
    icon: menu.icon ? String(menu.icon) : null,
    sort_order: Number(menu.sort_order ?? 100),
    required_permissions: Array.isArray(menu.required_permissions) ? menu.required_permissions : [],
    is_active: menu.is_active === undefined ? true : Boolean(menu.is_active),
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await admin
    .from('menu_items')
    .upsert(payload, { onConflict: 'code' })
    .select()
    .single()
  if (error) return fail(error.message)

  await recordAudit(admin, {
    actorContext: context,
    action: before ? 'MENU_UPDATED' : 'MENU_CREATED',
    entityType: 'MENU',
    entityId: data.id,
    entityReference: code,
    oldValues: before,
    newValues: data,
    request,
  })

  return NextResponse.json({ menu: data })
}

async function deleteMenu(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: Record<string, unknown>,
) {
  const code = String(body.code || '')
  if (!code) return fail('Menu code is required.')

  const { data: before } = await admin.from('menu_items').select('*').eq('code', code).maybeSingle()
  const { error } = await admin.from('menu_items').delete().eq('code', code)
  if (error) return fail(error.message)

  await recordAudit(admin, {
    actorContext: context,
    action: 'MENU_DELETED',
    entityType: 'MENU',
    entityReference: code,
    oldValues: before,
    request,
  })

  return NextResponse.json({ ok: true })
}

// -----------------------------------------------------------------------------
// Data scopes
// -----------------------------------------------------------------------------

async function saveRoleScope(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: Record<string, unknown>,
) {
  const roleId = String(body.roleId || '')
  const scopeType = String(body.scopeType || '')
  if (!roleId || !scopeType) return fail('roleId and scopeType are required.')

  const { data: role } = await admin.from('roles').select('id, name, data_scope_type').eq('id', roleId).maybeSingle()
  if (!role) return fail('Role not found', 404)

  await admin.from('role_data_scopes').delete().eq('role_id', roleId)
  const { error } = await admin.from('role_data_scopes').insert({
    role_id: roleId,
    scope_type: scopeType,
    department_ids: Array.isArray(body.departmentIds) ? body.departmentIds : [],
  })
  if (error) return fail(error.message)

  await admin.from('roles').update({ data_scope_type: scopeType }).eq('id', roleId)

  await recordAudit(admin, {
    actorContext: context,
    action: 'DATA_SCOPE_CHANGED',
    entityType: 'ROLE',
    entityId: roleId,
    entityReference: role.name,
    oldValues: { scope_type: role.data_scope_type },
    newValues: { scope_type: scopeType },
    request,
  })

  return NextResponse.json({ ok: true })
}

async function saveUserScope(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: Record<string, unknown>,
) {
  const userId = String(body.userId || '')
  const scopeType = String(body.scopeType || '')
  if (!userId || !scopeType) return fail('userId and scopeType are required.')

  await admin.from('user_data_scopes').delete().eq('user_id', userId)
  const { data, error } = await admin
    .from('user_data_scopes')
    .insert({
      user_id: userId,
      scope_type: scopeType,
      department_ids: Array.isArray(body.departmentIds) ? body.departmentIds : [],
      valid_until: body.validUntil ? String(body.validUntil) : null,
      assigned_by: context.userId,
    })
    .select()
    .single()
  if (error) return fail(error.message)

  await recordAudit(admin, {
    actorContext: context,
    action: 'USER_DATA_SCOPE_CHANGED',
    entityType: 'USER',
    entityId: userId,
    newValues: data,
    request,
  })

  return NextResponse.json({ userScope: data })
}

async function revokeUserScope(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: Record<string, unknown>,
) {
  const userId = String(body.userId || '')
  if (!userId) return fail('userId is required.')

  const { data: before } = await admin.from('user_data_scopes').select('*').eq('user_id', userId)
  const { error } = await admin.from('user_data_scopes').delete().eq('user_id', userId)
  if (error) return fail(error.message)

  await recordAudit(admin, {
    actorContext: context,
    action: 'USER_DATA_SCOPE_REVOKED',
    entityType: 'USER',
    entityId: userId,
    oldValues: before,
    request,
  })

  return NextResponse.json({ ok: true })
}
