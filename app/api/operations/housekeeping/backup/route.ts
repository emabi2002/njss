import { NextResponse, type NextRequest } from 'next/server'
import { requirePermission } from '@/lib/rbac/server'

const BACKUP_PERMISSIONS = ['operations.manage', 'settings.manage', 'all']
type BackupType = 'FULL' | 'DIFFERENTIAL'

export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, BACKUP_PERMISSIONS)
  if (guard.response) return guard.response

  const authorization = request.headers.get('authorization') || ''
  if (!authorization) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as { backupType?: BackupType }
  const backupType: BackupType = body.backupType || 'FULL'
  if (backupType !== 'FULL' && backupType !== 'DIFFERENTIAL') {
    return NextResponse.json({ error: 'backupType must be FULL or DIFFERENTIAL.' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'Database backup service is not configured.' }, { status: 500 })
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/njss-database-backup`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ backupType }),
    cache: 'no-store',
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: `Backup service returned status ${response.status}.` }))
    return NextResponse.json(payload, { status: response.status })
  }

  const buffer = await response.arrayBuffer()
  const headers = new Headers({
    'Content-Type': response.headers.get('content-type') || 'application/zip',
    'Content-Disposition': response.headers.get('content-disposition') || 'attachment; filename="NJSS_Backup.zip"',
  })
  for (const name of ['X-NJSS-Backup-Id', 'X-NJSS-Backup-Type', 'X-NJSS-Backup-Filename']) {
    const value = response.headers.get(name)
    if (value) headers.set(name, value)
  }

  return new NextResponse(buffer, { status: 200, headers })
}
