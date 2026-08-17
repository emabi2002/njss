import { NextResponse, type NextRequest } from 'next/server'
import JSZip from 'jszip'
import { requirePermission } from '@/lib/rbac/server'
import { createServerSupabaseClient } from '@/lib/supabase'

const READ_PERMISSIONS = ['operations.manage', 'settings.manage', 'all']
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const MAX_ZIP_ENTRIES = 100

export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, READ_PERMISSIONS)
  if (guard.response) return guard.response

  const form = await request.formData()
  const file = form.get('backup')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Upload an NJSS ZIP backup file.' }, { status: 400 })
  }
  if (!file.name.toLowerCase().endsWith('.zip')) {
    return NextResponse.json({ error: 'Only .zip backup files can be validated.' }, { status: 400 })
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Uploaded export exceeds the 25 MB validation limit.' }, { status: 400 })
  }

  try {
    const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()))
    const zipEntries = Object.keys(zip.files)
    if (zipEntries.length > MAX_ZIP_ENTRIES) {
      return NextResponse.json({ valid: false, status: 'Rejected', issues: ['ZIP contains too many entries for safe validation.'] }, { status: 400 })
    }

    const manifestFile = zip.file('manifest.json')
    if (!manifestFile) return NextResponse.json({ valid: false, status: 'Rejected', issues: ['manifest.json is missing.'] }, { status: 400 })

    const manifest = JSON.parse(await manifestFile.async('string')) as Record<string, unknown>
    const issues: string[] = []
    if (manifest.type !== 'NJSS_PORTABLE_DATA_EXPORT') issues.push('Export type is not NJSS_PORTABLE_DATA_EXPORT.')
    if (!manifest.backupId) issues.push('Backup ID is missing.')
    if (!manifest.createdAt) issues.push('Creation timestamp is missing.')
    if (!zip.folder('database_export')) issues.push('database_export folder is missing.')

    const exportFiles = Object.keys(zip.files).filter((name) => name.startsWith('database_export/') && name.endsWith('.json'))
    if (exportFiles.length === 0) issues.push('No exported table files were found.')

    const supabase = createServerSupabaseClient()
    await supabase.from('audit_logs').insert({
      user_id: guard.context?.userId || null,
      user_email: guard.context?.email || null,
      user_name: guard.context?.name || null,
      action: 'HOUSEKEEPING_BACKUP_VALIDATED',
      entity_type: 'SYSTEM_BACKUP',
      entity_reference: String(manifest.backupId || file.name),
      new_values: { filename: file.name, valid: issues.length === 0, issues, manifest },
      metadata: { module: 'HOUSEKEEPING', operation: 'VALIDATE_BACKUP' },
    })

    return NextResponse.json({
      valid: issues.length === 0,
      status: issues.length === 0 ? 'Valid' : 'Rejected',
      issues,
      details: {
        filename: file.name,
        size: file.size,
        backupId: manifest.backupId || null,
        createdAt: manifest.createdAt || null,
        createdBy: manifest.createdBy || null,
        applicationVersion: manifest.applicationVersion || null,
        recordCounts: manifest.recordCounts || {},
        exportedFiles: exportFiles.length,
      },
      nextSteps: issues.length === 0 ? ['Review export details.', 'Create a safety backup of the current system using managed database tooling.', 'Require explicit confirmation before restoration.', 'Restore only through an approved server-side restoration procedure.'] : ['Reject this upload.', 'Ask the administrator to provide a complete NJSS portable data export ZIP.'],
    })
  } catch (error) {
    return NextResponse.json({ valid: false, status: 'Rejected', issues: [error instanceof Error ? error.message : 'Unable to read ZIP file.'] }, { status: 400 })
  }
}
