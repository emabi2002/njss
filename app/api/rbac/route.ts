import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, requirePermission } from '@/lib/rbac/server'

export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, ['users.manage', 'roles.manage', 'permissions.manage', 'modules.manage', 'data_scope.manage'])
  if (guard.response) return guard.response

  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const [roles, permissions, rolePermissions, modules, menus, roleScopes] = await Promise.all([
    supabase.from('roles').select('id, name, description, is_active, data_scope_type').order('name'),
    supabase.from('permissions').select('code, module_code, menu_code, action, label, description, is_active').order('module_code').order('code'),
    supabase.from('role_permissions').select('role_id, permission, is_allowed'),
    supabase.from('modules').select('code, name, description, base_path, icon, sort_order, is_active').order('sort_order'),
    supabase.from('menu_items').select('code, module_code, parent_code, label, href, icon, sort_order, required_permissions, is_active').order('sort_order'),
    supabase.from('role_data_scopes').select('role_id, scope_type, department_ids, division_ids, branch_ids, province_ids'),
  ])

  const firstError = [roles, permissions, rolePermissions, modules, menus, roleScopes].find((result) => result.error)?.error
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 })

  return NextResponse.json({
    roles: roles.data || [],
    permissions: permissions.data || [],
    rolePermissions: rolePermissions.data || [],
    modules: modules.data || [],
    menus: menus.data || [],
    roleScopes: roleScopes.data || [],
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const action = body.action as string

  const required = action === 'save-role-permissions'
    ? ['permissions.manage']
    : action === 'save-role-scope'
      ? ['data_scope.manage']
      : action === 'save-module-menu'
        ? ['modules.manage']
        : ['roles.manage']

  const guard = await requirePermission(request, required)
  if (guard.response) return guard.response

  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)

  if (action === 'create-role' || action === 'update-role') {
    const role = body.role as { id?: string; name: string; description?: string | null; data_scope_type?: string; is_active?: boolean }
    if (!role?.name?.trim()) return NextResponse.json({ error: 'Role name is required' }, { status: 400 })

    const payload = {
      name: role.name.trim(),
      description: role.description || null,
      data_scope_type: role.data_scope_type || 'OWN_RECORDS',
      is_active: role.is_active ?? true,
    }

    const query = action === 'update-role' && role.id
      ? supabase.from('roles').update(payload).eq('id', role.id).select().single()
      : supabase.from('roles').insert(payload).select().single()

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await supabase.from('audit_logs').insert({
      user_id: guard.context?.userId || null,
      user_email: guard.context?.email || null,
      user_name: guard.context?.name || null,
      action: action === 'update-role' ? 'ROLE_UPDATED' : 'ROLE_CREATED',
      entity_type: 'ROLE',
      entity_id: data.id,
      new_values: data,
    })
    return NextResponse.json({ role: data })
  }

  if (action === 'save-role-permissions') {
    const roleId = body.roleId as string
    const permissions = (body.permissions || []) as string[]
    if (!roleId) return NextResponse.json({ error: 'roleId is required' }, { status: 400 })

    const { error: deleteError } = await supabase.from('role_permissions').delete().eq('role_id', roleId)
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

    if (permissions.length) {
      const { error: insertError } = await supabase
        .from('role_permissions')
        .insert(permissions.map((permission) => ({ role_id: roleId, permission, is_allowed: true })))
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    await supabase.from('audit_logs').insert({
      user_id: guard.context?.userId || null,
      user_email: guard.context?.email || null,
      user_name: guard.context?.name || null,
      action: 'PERMISSION_CHANGED',
      entity_type: 'ROLE',
      entity_id: roleId,
      new_values: { permissions },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'save-role-scope') {
    const roleId = body.roleId as string
    const scopeType = body.scopeType as string
    if (!roleId || !scopeType) return NextResponse.json({ error: 'roleId and scopeType are required' }, { status: 400 })

    const { error } = await supabase
      .from('role_data_scopes')
      .upsert({ role_id: roleId, scope_type: scopeType }, { onConflict: 'role_id,scope_type' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await supabase.from('roles').update({ data_scope_type: scopeType }).eq('id', roleId)
    await supabase.from('audit_logs').insert({
      user_id: guard.context?.userId || null,
      user_email: guard.context?.email || null,
      user_name: guard.context?.name || null,
      action: 'DATA_SCOPE_CHANGED',
      entity_type: 'ROLE',
      entity_id: roleId,
      new_values: { scopeType },
    })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unsupported RBAC action' }, { status: 400 })
}
