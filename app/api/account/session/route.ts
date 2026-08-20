import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, recordAudit } from '@/lib/rbac/admin'
import { getServerAccessContext } from '@/lib/rbac/server'

export const dynamic = 'force-dynamic'

/** Records an explicit successful sign-in using the NJSS profile identity. */
export async function POST(request: NextRequest) {
  const context = await getServerAccessContext(request)
  if (!context) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

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

  return NextResponse.json({ ok: true })
}
