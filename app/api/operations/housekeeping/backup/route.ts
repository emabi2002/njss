import { NextResponse, type NextRequest } from 'next/server'
import JSZip from 'jszip'
import packageJson from '@/package.json'
import { requirePermission } from '@/lib/rbac/server'
import { createServerSupabaseClient } from '@/lib/supabase'

const READ_PERMISSIONS = ['operations.view', 'operations.manage', 'settings.manage', 'all']
const EXPORT_TABLES = [
  'departments',
  'sections',
  'users',
  'roles',
  'user_roles',
  'budget_allocations',
  'ff3_headers',
  'ff3_items',
  'ff3_commitments',
  'ff4_headers',
  'payment_transactions',
  'documents',
  'audit_logs',
  'system_settings',
]

function stamp(date = new Date()) {
  const day = date.toISOString().slice(0, 10)
  const time = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
  return `${day}_${time}`
}

async function tableExport(supabase: ReturnType<typeof createServerSupabaseClient>, table: string) {
  try {
    const { data, error, count } = await supabase.from(table).select('*', { count: 'exact' }).limit(5000)
    return { table, status: error ? 'error' : 'exported', count: count || data?.length || 0, rows: data || [], error: error?.message || null }
  } catch (error) {
    return { table, status: 'error', count: 0, rows: [], error: error instanceof Error ? error.message : 'Export failed' }
  }
}

export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, READ_PERMISSIONS)
  if (guard.response) return guard.response

  const supabase = createServerSupabaseClient()
  const now = new Date()
  const backupId = `NJSS-${now.getTime()}`
  const filename = `NJSS_Backup_${stamp(now)}.zip`
  const exports = await Promise.all(EXPORT_TABLES.map((table) => tableExport(supabase, table)))
  const recordCounts = Object.fromEntries(exports.map((item) => [item.table, item.count]))

  const manifest = {
    backupId,
    type: 'NJSS_PORTABLE_BACKUP',
    createdAt: now.toISOString(),
    createdBy: guard.context?.email || guard.context?.name || 'Unknown administrator',
    application: 'NJSS CREMS',
    applicationVersion: process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version || 'Not Available',
    databaseSchemaVersion: exports.find((item) => item.table === 'system_settings')?.rows?.find((row: Record<string, unknown>) => row.setting_key === 'latest_database_migration') || null,
    recordCounts,
    tableLimitNotice: 'Table exports are capped at 5,000 rows per table in this in-application portable backup package. Use managed database tools for full infrastructure-level snapshots when required.',
    restorePolicy: 'Upload backups must be validated, reviewed, explicitly confirmed, safety-backed-up, restored, and verified. This endpoint does not perform destructive restoration.',
  }

  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('README.txt', 'NJSS portable database backup package. Validate before any restoration. Do not edit backup contents.\n')
  const exportFolder = zip.folder('database_export')
  for (const item of exports) {
    exportFolder?.file(`${item.table}.json`, JSON.stringify({ table: item.table, status: item.status, count: item.count, error: item.error, rows: item.rows }, null, 2))
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  await supabase.from('audit_logs').insert({
    user_id: guard.context?.userId || null,
    user_email: guard.context?.email || null,
    user_name: guard.context?.name || null,
    action: 'HOUSEKEEPING_BACKUP_CREATED',
    entity_type: 'SYSTEM_BACKUP',
    entity_reference: backupId,
    new_values: { backupId, filename, recordCounts, bytes: buffer.length },
    metadata: { module: 'HOUSEKEEPING', operation: 'CREATE_BACKUP' },
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-NJSS-Backup-Id': backupId,
      'X-NJSS-Backup-Filename': filename,
    },
  })
}
