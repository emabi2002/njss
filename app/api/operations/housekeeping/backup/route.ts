import { NextResponse, type NextRequest } from 'next/server'
import JSZip from 'jszip'
import packageJson from '@/package.json'
import { requirePermission } from '@/lib/rbac/server'
import { createServerSupabaseClient } from '@/lib/supabase'

const READ_PERMISSIONS = ['operations.manage', 'settings.manage', 'all']
const EXPORT_PAGE_SIZE = 1000
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
    const rows: unknown[] = []
    let from = 0
    let totalCount: number | null = null

    while (true) {
      const to = from + EXPORT_PAGE_SIZE - 1
      const { data, error, count } = await supabase.from(table).select('*', { count: from === 0 ? 'exact' : undefined }).range(from, to)
      if (error) return { table, status: 'error', count: rows.length, rows, error: error.message }
      if (from === 0) totalCount = count ?? null
      rows.push(...(data || []))
      if (!data || data.length < EXPORT_PAGE_SIZE) break
      from += EXPORT_PAGE_SIZE
    }

    return { table, status: 'exported', count: totalCount ?? rows.length, rows, error: null }
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
  const filename = `NJSS_Portable_Data_Export_${stamp(now)}.zip`
  const exports = await Promise.all(EXPORT_TABLES.map((table) => tableExport(supabase, table)))
  const recordCounts = Object.fromEntries(exports.map((item) => [item.table, item.count]))

  const systemSettings = exports.find((item) => item.table === 'system_settings')?.rows as Array<Record<string, unknown>> | undefined
  const manifest = {
    backupId,
    type: 'NJSS_PORTABLE_DATA_EXPORT',
    createdAt: now.toISOString(),
    createdBy: guard.context?.email || guard.context?.name || 'Unknown administrator',
    application: 'NJSS CREMS',
    applicationVersion: process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version || 'Not Available',
    databaseSchemaVersion: systemSettings?.find((row) => row.setting_key === 'latest_database_migration') || null,
    recordCounts,
    exportPolicy: 'This is a portable application data export, not a full managed database backup. Production backup must be handled through approved Supabase/database backup tooling that captures schema, data, RPCs, triggers, views, indexes, RLS, storage metadata, sequences and migration state.',
    restorePolicy: 'No destructive restoration is performed by this endpoint. Restoration requires Upload, Validate, Review, Safety Backup, Explicit Confirmation, Restore, Verify and Restore Report controls.',
  }

  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('README.txt', 'NJSS portable application data export. This is not a full database backup. Validate before any restoration. Do not edit export contents.\n')
  const exportFolder = zip.folder('database_export')
  for (const item of exports) {
    exportFolder?.file(`${item.table}.json`, JSON.stringify({ table: item.table, status: item.status, count: item.count, error: item.error, rows: item.rows }, null, 2))
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  await supabase.from('audit_logs').insert({
    user_id: guard.context?.userId || null,
    user_email: guard.context?.email || null,
    user_name: guard.context?.name || null,
    action: 'HOUSEKEEPING_PORTABLE_EXPORT_CREATED',
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
