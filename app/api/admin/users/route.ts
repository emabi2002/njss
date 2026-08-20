import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  authorizeAdmin,
  detectSchema,
  recordAudit,
  MIGRATION_REQUIRED_MESSAGE,
  USER_LEGACY_FIELDS,
  USER_PUBLIC_FIELDS,
} from '@/lib/rbac/admin'
import { generateTemporaryPassword, validatePassword } from '@/lib/password'
import type { UserAccessContext } from '@/lib/rbac/types'

export const dynamic = 'force-dynamic'

const SYSTEM_ADMINISTRATOR = 'System Administrator'

/**
 * Shape returned by USER_PUBLIC_FIELDS / USER_LEGACY_FIELDS.
 * Declared explicitly because Supabase cannot infer column types from a
 * dynamically-built select list.
 */
type AdminUserRow = {
  id: string
  email: string
  full_name: string | null
  employee_id: string | null
  phone: string | null
  position: string | null
  department_id: string | null
  section_id: string | null
  is_active: boolean
  is_protected: boolean
  must_change_password: boolean
  auth_user_id: string | null
  password_set_at: string | null
  password_changed_at: string | null
  last_login_at: string | null
  invited_at: string | null
  archived_at: string | null
  archive_reason: string | null
  created_at: string
}

type AdminUserWithRole = AdminUserRow & {
  user_roles?: Array<{
    role?:
      | {
          id: string
          name: string
          is_business_role: boolean
          is_protected: boolean
          data_scope_type: string | null
        }
      | null
  }>
}

type ActionBody = {
  action?: string
  userId?: string
  reason?: string
  user?: {
    email?: string
    full_name?: string
    employee_id?: string | null
    phone?: string | null
    position?: string | null
    department_id?: string | null
    section_id?: string | null
    role_id?: string | null
    is_active?: boolean
  }
  password?: string
  confirmPassword?: string
  generatePassword?: boolean
  sendWelcomeEmail?: boolean
}

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** Post-041 column list when available, otherwise the pre-migration subset. */
async function userFields(admin: SupabaseClient) {
  const schema = await detectSchema(admin)
  return schema.userAdministration ? USER_PUBLIC_FIELDS : USER_LEGACY_FIELDS
}

/** Loads a user with its single assigned role. Never returns credential data. */
async function loadUser(admin: SupabaseClient, userId: string) {
  const fields = await userFields(admin)
  const { data, error } = await admin
    .from('users')
    .select(`${fields}, user_roles(role:roles(id, name, is_business_role, is_protected, data_scope_type))`)
    .eq('id', userId)
    .maybeSingle()
    .returns<AdminUserWithRole | null>()
  if (error) throw new Error(error.message)
  return data
}

async function assertAssignableRole(admin: SupabaseClient, roleId: string) {
  const { data, error } = await admin
    .from('roles')
    .select('id, name, is_business_role, is_protected, is_active')
    .eq('id', roleId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Selected role does not exist.')
  if (!data.is_active) throw new Error('Selected role is no longer active.')
  if (!data.is_business_role && data.name !== SYSTEM_ADMINISTRATOR) {
    throw new Error('Only the five controlled business roles can be assigned to staff accounts.')
  }
  return data
}

/** Replaces the user's role so exactly one workflow role is ever held. */
async function setSingleRole(admin: SupabaseClient, userId: string, roleId: string) {
  await admin.from('user_roles').delete().eq('user_id', userId)
  const { error } = await admin.from('user_roles').insert({ user_id: userId, role_id: roleId })
  if (error) throw new Error(error.message)
}

async function activeAdminCount(admin: SupabaseClient) {
  const { data, error } = await admin.rpc('njss_active_system_administrator_count')
  if (error) return null
  return typeof data === 'number' ? data : null
}

async function isSystemAdministrator(admin: SupabaseClient, userId: string) {
  const { data } = await admin
    .from('user_roles')
    .select('role:roles(name)')
    .eq('user_id', userId)
  return (data || []).some(
    (row) => (row.role as unknown as { name?: string } | null)?.name === SYSTEM_ADMINISTRATOR,
  )
}

async function activitySummary(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.rpc('njss_user_activity_summary', { p_user_id: userId })
  if (error) return null
  return data as Record<string, number | boolean> | null
}

// -----------------------------------------------------------------------------
// GET — list the user register, or view one user with its activity footprint
// -----------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, ['users.manage'], 'USER_LIST')
  if (!auth.ok) return auth.response

  const userId = request.nextUrl.searchParams.get('userId')
  const schema = await detectSchema(auth.admin)
  const fields = schema.userAdministration ? USER_PUBLIC_FIELDS : USER_LEGACY_FIELDS

  try {
    if (userId) {
      const user = await loadUser(auth.admin, userId)
      if (!user) return fail('User not found', 404)

      const [activity, authUser] = await Promise.all([
        activitySummary(auth.admin, userId),
        user.auth_user_id
          ? auth.admin.auth.admin.getUserById(user.auth_user_id)
          : Promise.resolve({ data: { user: null }, error: null }),
      ])

      await recordAudit(auth.admin, {
        actorContext: auth.context,
        action: 'USER_VIEWED',
        entityType: 'USER',
        entityId: userId,
        entityReference: user.email || null,
        request,
      })

      return NextResponse.json({
        user,
        activity,
        migrationApplied: schema.userAdministration,
        authAccount: authUser.data?.user
          ? {
              id: authUser.data.user.id,
              email: authUser.data.user.email,
              emailConfirmedAt: authUser.data.user.email_confirmed_at,
              lastSignInAt: authUser.data.user.last_sign_in_at,
              createdAt: authUser.data.user.created_at,
            }
          : null,
      })
    }

    const [usersRes, rolesRes, deptRes, sectionRes] = await Promise.all([
      auth.admin
        .from('users')
        .select(
          `${fields}, department:departments(id, name), section:sections(id, name), user_roles(role:roles(id, name, is_business_role, is_protected, data_scope_type))`,
        )
        .order('created_at', { ascending: false })
        .returns<AdminUserWithRole[]>(),
      auth.admin
        .from('roles')
        .select(
          schema.userAdministration
            ? 'id, name, description, data_scope_type, is_active, is_business_role, is_protected, workflow_sequence'
            : 'id, name, description, data_scope_type, is_active',
        )
        .order('name'),
      auth.admin.from('departments').select('id, name').eq('is_active', true).order('name'),
      auth.admin.from('sections').select('id, name, department_id').eq('is_active', true).order('name'),
    ])

    const firstError = [usersRes, rolesRes, deptRes, sectionRes].find((r) => r.error)?.error
    if (firstError) return fail(firstError.message, 500)

    return NextResponse.json({
      users: usersRes.data || [],
      roles: rolesRes.data || [],
      departments: deptRes.data || [],
      sections: sectionRes.data || [],
      migrationApplied: schema.userAdministration,
    })
  } catch (error) {
    console.error('User administration read failed:', error)
    return fail(error instanceof Error ? error.message : 'Unable to load users', 500)
  }
}

// -----------------------------------------------------------------------------
// POST — all mutating administration actions
// -----------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let body: ActionBody
  try {
    body = (await request.json()) as ActionBody
  } catch {
    return fail('Invalid request body')
  }

  const action = String(body.action || '').toUpperCase()
  const auth = await authorizeAdmin(request, ['users.manage'], action)
  if (!auth.ok) return auth.response

  const { admin, context } = auth

  // Every write below depends on account-state columns created by migration 041.
  const schema = await detectSchema(admin)
  if (!schema.userAdministration) return fail(MIGRATION_REQUIRED_MESSAGE, 409)

  try {
    switch (action) {
      case 'CREATE':
        return await handleCreate(request, admin, context, body)
      case 'UPDATE':
        return await handleUpdate(request, admin, context, body)
      case 'SET_ACTIVE':
        return await handleSetActive(request, admin, context, body)
      case 'RESET_PASSWORD':
        return await handleResetPassword(request, admin, context, body)
      case 'RESEND_INVITATION':
        return await handleResendInvitation(request, admin, context, body)
      case 'ARCHIVE':
        return await handleArchive(request, admin, context, body)
      case 'RESTORE':
        return await handleRestore(request, admin, context, body)
      case 'DELETE':
        return await handleDelete(request, admin, context, body)
      default:
        return fail('Unsupported user administration action')
    }
  } catch (error) {
    console.error(`User administration action ${action} failed:`, error)
    return fail(error instanceof Error ? error.message : 'Action failed', 400)
  }
}

// -----------------------------------------------------------------------------

async function handleCreate(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: ActionBody,
) {
  const input = body.user || {}
  const email = (input.email || '').trim().toLowerCase()
  const fullName = (input.full_name || '').trim()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('A valid email address is required.')
  if (!fullName) return fail('Full name is required.')
  if (!input.role_id) return fail('Exactly one workflow role must be selected.')

  const password = body.generatePassword ? generateTemporaryPassword() : body.password || ''
  const passwordErrors = body.generatePassword ? [] : validatePassword(password, body.confirmPassword)
  if (passwordErrors.length) return NextResponse.json({ error: passwordErrors[0], errors: passwordErrors }, { status: 400 })

  const role = await assertAssignableRole(admin, input.role_id)

  const { data: existing } = await admin.from('users').select('id').eq('email', email).maybeSingle()
  if (existing) return fail('A user with that email address already exists.')

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (authError || !created?.user) {
    return fail(authError?.message || 'Unable to create the authentication account.')
  }

  const { data: profile, error: profileError } = await admin
    .from('users')
    .insert({
      auth_user_id: created.user.id,
      email,
      full_name: fullName,
      employee_id: input.employee_id || null,
      phone: input.phone || null,
      position: input.position || null,
      department_id: input.department_id || null,
      section_id: input.section_id || null,
      is_active: input.is_active ?? true,
      must_change_password: true,
      password_set_at: new Date().toISOString(),
      invited_at: body.sendWelcomeEmail ? new Date().toISOString() : null,
    })
    .select(await userFields(admin))
    .single()
    .returns<AdminUserRow>()

  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
    return fail(profileError?.message || 'Unable to create the NJSS user profile.')
  }

  try {
    await setSingleRole(admin, profile.id, role.id)
  } catch (error) {
    await admin.from('users').delete().eq('id', profile.id)
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
    throw error
  }

  await recordAudit(admin, {
    actorContext: context,
    action: 'USER_CREATED',
    entityType: 'USER',
    entityId: profile.id,
    entityReference: email,
    newValues: profile,
    changes: { role: role.name, department_id: input.department_id, section_id: input.section_id },
    request,
  })
  await recordAudit(admin, {
    actorContext: context,
    action: 'USER_PASSWORD_SET',
    entityType: 'USER',
    entityId: profile.id,
    entityReference: email,
    metadata: {
      method: body.generatePassword ? 'GENERATED_TEMPORARY' : 'ADMINISTRATOR_SET',
      must_change_password: true,
    },
    request,
  })

  if (body.sendWelcomeEmail) {
    await recordAudit(admin, {
      actorContext: context,
      action: 'USER_INVITATION_SENT',
      entityType: 'USER',
      entityId: profile.id,
      entityReference: email,
      metadata: { includes_password: false },
      request,
    })
  }

  return NextResponse.json({
    user: profile,
    generatedPassword: body.generatePassword ? password : undefined,
  })
}

async function handleUpdate(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: ActionBody,
) {
  const userId = body.userId
  if (!userId) return fail('userId is required.')
  const input = body.user || {}

  const before = await loadUser(admin, userId)
  if (!before) return fail('User not found', 404)

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.full_name !== undefined) patch.full_name = input.full_name.trim()
  if (input.employee_id !== undefined) patch.employee_id = input.employee_id || null
  if (input.phone !== undefined) patch.phone = input.phone || null
  if (input.position !== undefined) patch.position = input.position || null
  if (input.department_id !== undefined) patch.department_id = input.department_id || null
  if (input.section_id !== undefined) patch.section_id = input.section_id || null

  const { data: updated, error } = await admin
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select(await userFields(admin))
    .single()
    .returns<AdminUserRow>()
  if (error) return fail(error.message)

  let roleChanged: string | null = null
  if (input.role_id) {
    const role = await assertAssignableRole(admin, input.role_id)
    const currentRoleId = before.user_roles?.[0]?.role?.id
    if (currentRoleId !== role.id) {
      await setSingleRole(admin, userId, role.id)
      roleChanged = role.name
    }
  }

  await recordAudit(admin, {
    actorContext: context,
    action: 'USER_UPDATED',
    entityType: 'USER',
    entityId: userId,
    entityReference: updated.email,
    oldValues: before,
    newValues: updated,
    changes: roleChanged ? { role: roleChanged } : undefined,
    request,
  })

  if (roleChanged) {
    await recordAudit(admin, {
      actorContext: context,
      action: 'USER_ROLE_CHANGED',
      entityType: 'USER',
      entityId: userId,
      entityReference: updated.email,
      newValues: { role: roleChanged },
      request,
    })
  }

  return NextResponse.json({ user: updated })
}

async function handleSetActive(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: ActionBody,
) {
  const userId = body.userId
  const nextActive = body.user?.is_active
  if (!userId || typeof nextActive !== 'boolean') return fail('userId and is_active are required.')

  const before = await loadUser(admin, userId)
  if (!before) return fail('User not found', 404)

  if (!nextActive) {
    if (userId === context.userId) return fail('You cannot deactivate your own account.')
    if (before.is_protected) {
      return fail('This is a protected technical account and cannot be deactivated.')
    }
    if (await isSystemAdministrator(admin, userId)) {
      const remaining = await activeAdminCount(admin)
      if (remaining !== null && remaining <= 1) {
        await recordAudit(admin, {
          actorContext: context,
          action: 'USER_DEACTIVATION_REJECTED',
          entityType: 'USER',
          entityId: userId,
          entityReference: before.email || null,
          metadata: { reason: 'Final active System Administrator' },
          request,
        })
        return fail('The final active System Administrator cannot be deactivated.')
      }
    }
  }

  const { data: updated, error } = await admin
    .from('users')
    .update({ is_active: nextActive, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select(await userFields(admin))
    .single()
    .returns<AdminUserRow>()
  if (error) return fail(error.message)

  if (!nextActive) await revokeSessions(admin, before)

  await recordAudit(admin, {
    actorContext: context,
    action: nextActive ? 'USER_RESTORED' : 'USER_DEACTIVATED',
    entityType: 'USER',
    entityId: userId,
    entityReference: updated.email,
    oldValues: { is_active: before.is_active },
    newValues: { is_active: nextActive },
    request,
  })

  return NextResponse.json({ user: updated })
}

async function handleResetPassword(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: ActionBody,
) {
  const userId = body.userId
  if (!userId) return fail('userId is required.')

  const user = await loadUser(admin, userId)
  if (!user) return fail('User not found', 404)

  const authUserId = user.auth_user_id
  if (!authUserId) return fail('This profile has no linked authentication account.')

  const password = body.generatePassword ? generateTemporaryPassword() : body.password || ''
  const errors = body.generatePassword ? [] : validatePassword(password, body.confirmPassword)
  if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 })

  const { error: authError } = await admin.auth.admin.updateUserById(authUserId, { password })
  if (authError) return fail(authError.message)

  await admin
    .from('users')
    .update({
      must_change_password: true,
      password_set_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  await revokeSessions(admin, user)

  await recordAudit(admin, {
    actorContext: context,
    action: 'USER_PASSWORD_SET',
    entityType: 'USER',
    entityId: userId,
    entityReference: user.email || null,
    metadata: {
      method: body.generatePassword ? 'GENERATED_TEMPORARY' : 'ADMINISTRATOR_RESET',
      must_change_password: true,
      sessions_revoked: true,
    },
    request,
  })

  return NextResponse.json({
    ok: true,
    generatedPassword: body.generatePassword ? password : undefined,
  })
}

async function handleResendInvitation(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: ActionBody,
) {
  const userId = body.userId
  if (!userId) return fail('userId is required.')

  const user = await loadUser(admin, userId)
  if (!user) return fail('User not found', 404)

  await admin
    .from('users')
    .update({ invited_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', userId)

  await recordAudit(admin, {
    actorContext: context,
    action: 'USER_INVITATION_SENT',
    entityType: 'USER',
    entityId: userId,
    entityReference: user.email || null,
    metadata: { includes_password: false, resend: true },
    request,
  })

  return NextResponse.json({ ok: true })
}

async function handleArchive(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: ActionBody,
) {
  const userId = body.userId
  const reason = (body.reason || '').trim()
  if (!userId) return fail('userId is required.')
  if (!reason) return fail('An administrator reason is required to archive an account.')
  if (userId === context.userId) return fail('You cannot archive your own account.')

  const user = await loadUser(admin, userId)
  if (!user) return fail('User not found', 404)
  if (user.is_protected) {
    return fail('This is a protected technical account and cannot be archived.')
  }

  if (await isSystemAdministrator(admin, userId)) {
    const remaining = await activeAdminCount(admin)
    if (remaining !== null && remaining <= 1) {
      return fail('The final active System Administrator cannot be archived.')
    }
  }

  const { data: updated, error } = await admin
    .from('users')
    .update({
      is_active: false,
      archived_at: new Date().toISOString(),
      archived_by: context.userId,
      archive_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select(await userFields(admin))
    .single()
    .returns<AdminUserRow>()
  if (error) return fail(error.message)

  await revokeSessions(admin, user)

  await recordAudit(admin, {
    actorContext: context,
    action: 'USER_ARCHIVED',
    entityType: 'USER',
    entityId: userId,
    entityReference: updated.email,
    oldValues: user,
    newValues: updated,
    metadata: {
      reason,
      archived_user_snapshot: {
        full_name: user.full_name,
        email: user.email,
      },
    },
    request,
  })

  return NextResponse.json({ user: updated, outcome: 'ARCHIVED' })
}

async function handleRestore(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: ActionBody,
) {
  const userId = body.userId
  if (!userId) return fail('userId is required.')

  const { data: updated, error } = await admin
    .from('users')
    .update({
      is_active: true,
      archived_at: null,
      archived_by: null,
      archive_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select(await userFields(admin))
    .single()
    .returns<AdminUserRow>()
  if (error) return fail(error.message)

  await recordAudit(admin, {
    actorContext: context,
    action: 'USER_RESTORED',
    entityType: 'USER',
    entityId: userId,
    entityReference: updated.email,
    newValues: updated,
    request,
  })

  return NextResponse.json({ user: updated })
}

async function handleDelete(
  request: NextRequest,
  admin: SupabaseClient,
  context: UserAccessContext,
  body: ActionBody,
) {
  const userId = body.userId
  const reason = (body.reason || '').trim()
  if (!userId) return fail('userId is required.')
  if (!reason) return fail('An administrator reason is required to delete an account.')

  if (userId === context.userId) {
    await recordAudit(admin, {
      actorContext: context,
      action: 'USER_DELETE_REJECTED',
      entityType: 'USER',
      entityId: userId,
      metadata: { reason: 'Self-deletion attempt' },
      request,
    })
    return fail('You cannot delete your own account.')
  }

  const user = await loadUser(admin, userId)
  if (!user) return fail('User not found', 404)

  if (user.is_protected) {
    await recordAudit(admin, {
      actorContext: context,
      action: 'USER_DELETE_REJECTED',
      entityType: 'USER',
      entityId: userId,
      entityReference: user.email || null,
      metadata: { reason: 'Protected technical account' },
      request,
    })
    return fail('This is a protected technical account. Archive it instead.')
  }

  if (await isSystemAdministrator(admin, userId)) {
    const remaining = await activeAdminCount(admin)
    if (remaining !== null && remaining <= 1) {
      await recordAudit(admin, {
        actorContext: context,
        action: 'USER_DELETE_REJECTED',
        entityType: 'USER',
        entityId: userId,
        entityReference: user.email || null,
        metadata: { reason: 'Final active System Administrator' },
        request,
      })
      return fail('The final active System Administrator cannot be deleted.')
    }
  }

  const activity = await activitySummary(admin, userId)
  const canHardDelete = activity ? activity.can_hard_delete === true : false

  if (!canHardDelete) {
    await recordAudit(admin, {
      actorContext: context,
      action: 'USER_DELETE_REJECTED',
      entityType: 'USER',
      entityId: userId,
      entityReference: user.email || null,
      metadata: { reason: 'User has historical records', activity },
      request,
    })
    return await handleArchive(request, admin, context, {
      userId,
      reason: `${reason} (converted to archive: historical records exist)`,
    })
  }

  await revokeSessions(admin, user)

  const authUserId = user.auth_user_id
  if (authUserId) {
    await admin.auth.admin.deleteUser(authUserId).catch((error) => {
      console.error('Auth account deletion failed:', error)
    })
  }

  await admin.from('user_roles').delete().eq('user_id', userId)
  const { error } = await admin.from('users').delete().eq('id', userId)
  if (error) return fail(error.message)

  await recordAudit(admin, {
    actorContext: context,
    action: 'USER_DELETED',
    entityType: 'USER',
    entityId: userId,
    entityReference: user.email || null,
    oldValues: user,
    metadata: {
      reason,
      activity,
      deleted_user_snapshot: {
        full_name: user.full_name,
        email: user.email,
      },
    },
    request,
  })

  return NextResponse.json({ ok: true, outcome: 'DELETED' })
}

/** Signs the user out everywhere so a disabled account loses access immediately. */
async function revokeSessions(admin: SupabaseClient, user: unknown) {
  const authUserId = (user as { auth_user_id?: string | null })?.auth_user_id
  if (!authUserId) return
  try {
    await admin.auth.admin.signOut(authUserId, 'global')
  } catch (error) {
    console.error('Session revocation failed:', error)
  }
}
