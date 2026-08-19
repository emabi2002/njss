import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, recordAudit } from '@/lib/rbac/admin'
import { getServerAccessContext } from '@/lib/rbac/server'
import { validatePassword } from '@/lib/password'

export const dynamic = 'force-dynamic'

/**
 * Reports whether the signed-in user is still holding an administrator-issued
 * password and must go through the Set New Password screen.
 */
export async function GET(request: NextRequest) {
  const context = await getServerAccessContext(request)
  if (!context) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('users')
    .select('must_change_password')
    .eq('id', context.userId)
    .maybeSingle()

  return NextResponse.json({ mustChangePassword: Boolean(data?.must_change_password) })
}

/**
 * Changes the signed-in user's own password and clears the forced-change flag.
 * The new password is never echoed back and never reaches the audit trail.
 */
export async function POST(request: NextRequest) {
  const context = await getServerAccessContext(request)
  if (!context) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  let body: { password?: string; confirmPassword?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const password = body.password || ''
  const errors = validatePassword(password, body.confirmPassword)
  if (errors.length) {
    return NextResponse.json({ error: errors[0], errors }, { status: 400 })
  }

  if (!context.authUserId) {
    return NextResponse.json(
      { error: 'This profile has no linked authentication account.' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()

  const { error: authError } = await admin.auth.admin.updateUserById(context.authUserId, { password })
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  const now = new Date().toISOString()
  await admin
    .from('users')
    .update({
      must_change_password: false,
      password_changed_at: now,
      updated_at: now,
    })
    .eq('id', context.userId)

  await recordAudit(admin, {
    actorContext: context,
    action: 'PASSWORD_CHANGED',
    entityType: 'USER',
    entityId: context.userId,
    entityReference: context.email,
    metadata: { self_service: true, forced_change_cleared: true },
    request,
  })

  return NextResponse.json({ ok: true })
}
