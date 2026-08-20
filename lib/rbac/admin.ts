import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { getServerAccessContext, hasAnyServerPermission } from './server'
import type { PermissionCode, UserAccessContext } from './types'
import { redactSensitive } from '@/lib/password'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''

/**
 * Service-role client. Never import this from a client component and never
 * expose the key. It is only used AFTER the caller has been authorised through
 * their own session token by `authorizeAdmin` below.
 */
export function createAdminClient(): SupabaseClient {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured on the server.')
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export type AdminAuthorization =
  | { ok: true; context: UserAccessContext; admin: SupabaseClient }
  | { ok: false; response: NextResponse }

export function clientIp(request: NextRequest) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null
  )
}

/**
 * Verifies the caller's own session and permissions using the anon-key client,
 * then hands back a service-role client for the privileged write.
 * Every denial is recorded in the immutable Access Audit.
 */
export async function authorizeAdmin(
  request: NextRequest,
  permissions: PermissionCode[],
  action: string,
): Promise<AdminAuthorization> {
  const context = await getServerAccessContext(request)

  if (!context) {
    await recordAudit(null, {
      actorContext: null,
      action: 'ACCESS_DENIED',
      entityType: 'AUTHORIZATION',
      request,
      metadata: { attempted_action: action, reason: 'No authenticated NJSS profile' },
    })
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    }
  }

  if (!hasAnyServerPermission(context, permissions)) {
    await recordAudit(null, {
      actorContext: context,
      action: 'ACCESS_DENIED',
      entityType: 'AUTHORIZATION',
      request,
      metadata: {
        attempted_action: action,
        required_permissions: permissions,
        pathname: request.nextUrl.pathname,
      },
    })
    return {
      ok: false,
      response: NextResponse.json({ error: 'Access denied' }, { status: 403 }),
    }
  }

  return { ok: true, context, admin: createAdminClient() }
}

export type AuditInput = {
  actorContext: UserAccessContext | null
  action: string
  entityType: string
  entityId?: string | null
  entityReference?: string | null
  oldValues?: unknown
  newValues?: unknown
  changes?: Record<string, unknown>
  metadata?: Record<string, unknown>
  request?: NextRequest
}

/**
 * Appends an Access Audit record. All payloads pass through `redactSensitive`
 * so no password, hash or strength detail can ever reach the audit trail.
 */
export async function recordAudit(client: SupabaseClient | null, input: AuditInput) {
  try {
    const supabase = client || createAdminClient()
    const { error } = await supabase.from('audit_logs').insert({
      user_id: input.actorContext?.userId || null,
      user_email: input.actorContext?.email || null,
      user_name: input.actorContext?.name || null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId || null,
      entity_reference: input.entityReference || null,
      old_values: input.oldValues ? redactSensitive(input.oldValues) : null,
      new_values: input.newValues ? redactSensitive(input.newValues) : null,
      changes: input.changes ? redactSensitive(input.changes) : null,
      ip_address: input.request ? clientIp(input.request) : null,
      user_agent: input.request?.headers.get('user-agent') || null,
      metadata: input.metadata ? redactSensitive(input.metadata) : null,
    })

    if (error) throw error
    return true
  } catch (error) {
    // Audit must never mask or fail the security decision it is describing.
    console.error('Access Audit write failed:', error)
    return false
  }
}

/** Fields the administration API is allowed to return for a user. */
export const USER_PUBLIC_FIELDS =
  'id, email, full_name, employee_id, phone, position, department_id, section_id, ' +
  'is_active, is_protected, must_change_password, auth_user_id, password_set_at, ' +
  'password_changed_at, last_login_at, invited_at, archived_at, archive_reason, created_at'

/** Subset that exists before migration 041 has been applied to the environment. */
export const USER_LEGACY_FIELDS =
  'id, email, full_name, employee_id, phone, position, department_id, section_id, ' +
  'is_active, auth_user_id, created_at'

export const ROLE_ADMIN_FIELDS =
  'id, name, description, data_scope_type, is_active, is_business_role, is_protected, ' +
  'workflow_sequence, deactivated_at, deactivation_reason'

export const ROLE_LEGACY_FIELDS = 'id, name, description, data_scope_type, is_active'

export const MIGRATION_REQUIRED_MESSAGE =
  'Database migration 041 (User Administration and Access Control) has not been applied to this ' +
  'environment yet. User administration is read-only until it is applied.'

let schemaCache: { userAdministration: boolean } | null = null

/**
 * Probes for a column that only migration 041 creates.
 *
 * Administration screens stay readable before the migration lands, and every
 * write is refused with one clear message instead of a raw Postgres
 * "column does not exist" failure surfacing in the UI.
 */
export async function detectSchema(admin: SupabaseClient) {
  if (schemaCache) return schemaCache
  const { error } = await admin.from('users').select('must_change_password').limit(1)
  schemaCache = { userAdministration: !error }
  return schemaCache
}

/** Clears the cached probe. Call after applying a migration in a long-lived process. */
export function resetSchemaCache() {
  schemaCache = null
}
