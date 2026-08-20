import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, recordAudit } from '@/lib/rbac/admin'
import { createRequestSupabaseClient, getServerAccessContext } from '@/lib/rbac/server'

export const dynamic = 'force-dynamic'

/** Records an explicit successful sign-in using the NJSS profile identity. */
export async function POST(request: NextRequest) {
  let body: { accessToken?: string; refreshToken?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.accessToken || !body.refreshToken) {
    return NextResponse.json({ error: 'Authentication tokens are required' }, { status: 400 })
  }

  const response = NextResponse.json({ ok: true })
  const requestClient = createRequestSupabaseClient(request, response)
  const { error: sessionError } = await requestClient.auth.setSession({
    access_token: body.accessToken,
    refresh_token: body.refreshToken,
  })

  if (sessionError) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const context = await getServerAccessContext(request, response)
  if (!context) return NextResponse.json({ error: 'NJSS profile not found' }, { status: 403 })

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { error: updateError } = await admin
    .from('users')
    .update({ last_login_at: now, updated_at: now })
    .eq('id', context.userId)

  if (updateError) {
    console.error('Unable to update last login time:', updateError)
  }

  const auditRecorded = await recordAudit(admin, {
    actorContext: context,
    action: 'LOGIN',
    entityType: 'AUTH',
    entityId: context.userId,
    entityReference: context.email,
    metadata: { authentication: 'PASSWORD' },
    request,
  })

  if (!auditRecorded) {
    return NextResponse.json({ error: 'Unable to record the login audit.' }, { status: 500 })
  }

  return response
}
