import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import JSZip from 'jszip'
import { requirePermission } from '@/lib/rbac/server'
import { createServerSupabaseClient } from '@/lib/supabase'

const READ_PERMISSIONS = ['operations.manage', 'settings.manage', 'all']
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
const MAX_ZIP_ENTRIES = 500
const FULL_TYPE = 'NJSS_FULL_DATABASE_BACKUP'
const DIFFERENTIAL_TYPE = 'NJSS_DIFFERENTIAL_DATABASE_BACKUP'

type ChecksumManifest = {
  algorithm?: string
  files?: Record<string, string>
}

async function verifyChecksums(zip: JSZip, issues: string[]) {
  const checksumFile = zip.file('checksums.json')
  if (!checksumFile) {
    issues.push('checksums.json is missing.')
    return { checkedFiles: 0 }
  }

  const checksumManifest = JSON.parse(await checksumFile.async('string')) as ChecksumManifest
  if (checksumManifest.algorithm !== 'SHA-256') {
    issues.push('Checksum algorithm must be SHA-256.')
  }

  const expected = checksumManifest.files || {}
  let checkedFiles = 0
  for (const [name, expectedHash] of Object.entries(expected)) {
    const entry = zip.file(name)
    if (!entry) {
      issues.push(`Checksum file is missing from ZIP: ${name}`)
      continue
    }
    const bytes = await entry.async('uint8array')
    const actualHash = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    checkedFiles += 1
    if (actualHash.toLowerCase() !== String(expectedHash).toLowerCase()) {
      issues.push(`SHA-256 checksum mismatch: ${name}`)
    }
  }

  if (Object.keys(expected).length === 0) {
    issues.push('No file checksums were recorded.')
  }
  return { checkedFiles }
}

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
    return NextResponse.json({ error: 'Uploaded backup exceeds the 100 MB validation limit.' }, { status: 400 })
  }

  try {
    const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()))
    const zipEntries = Object.keys(zip.files)
    if (zipEntries.length > MAX_ZIP_ENTRIES) {
      return NextResponse.json({ valid: false, status: 'Rejected', issues: ['ZIP contains too many entries for safe validation.'] }, { status: 400 })
    }

    const manifestFile = zip.file('manifest.json')
    if (!manifestFile) {
      return NextResponse.json({ valid: false, status: 'Rejected', issues: ['manifest.json is missing.'] }, { status: 400 })
    }

    const manifest = JSON.parse(await manifestFile.async('string')) as Record<string, unknown>
    const issues: string[] = []
    const backupType = String(manifest.type || '')
    if (backupType !== FULL_TYPE && backupType !== DIFFERENTIAL_TYPE) {
      issues.push(`Unsupported NJSS backup type: ${backupType || 'missing'}.`)
    }
    if (!manifest.backupId) issues.push('Backup ID is missing.')
    if (!manifest.createdAt) issues.push('Creation timestamp is missing.')

    const tableFiles = zipEntries.filter((name) => name.startsWith('tables/') && name.endsWith('.json'))
    const changeFiles = zipEntries.filter((name) => name.startsWith('changes/') && name.endsWith('.json'))

    if (backupType === FULL_TYPE) {
      if (!zip.file('schema/public-schema.json')) issues.push('Full backup schema/public-schema.json is missing.')
      if (tableFiles.length === 0) issues.push('Full backup contains no table data files.')
      if (!manifest.baselineChangeId && manifest.baselineChangeId !== 0) issues.push('Full backup baseline change cursor is missing.')
    }

    if (backupType === DIFFERENTIAL_TYPE) {
      if (!manifest.baselineBackupId) issues.push('Differential backup baseline Full Backup ID is missing.')
      if (!zip.file('changes/change-log.json')) issues.push('Differential backup changes/change-log.json is missing.')
      if (!zip.file('schema/schema-version.json')) issues.push('Differential backup schema/schema-version.json is missing.')
      if (!manifest.baselineChangeId && manifest.baselineChangeId !== 0) issues.push('Differential baseline change cursor is missing.')
      if (!manifest.throughChangeId && manifest.throughChangeId !== 0) issues.push('Differential through-change cursor is missing.')
    }

    const checksumResult = await verifyChecksums(zip, issues)

    const supabase = createServerSupabaseClient()
    await supabase.from('audit_logs').insert({
      user_id: guard.context?.userId || null,
      user_email: guard.context?.email || null,
      user_name: guard.context?.name || null,
      action: 'HOUSEKEEPING_BACKUP_VALIDATED',
      entity_type: 'SYSTEM_BACKUP',
      entity_reference: String(manifest.backupId || file.name),
      new_values: {
        filename: file.name,
        valid: issues.length === 0,
        backupType,
        issues,
        checkedFiles: checksumResult.checkedFiles,
      },
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
        backupType,
        createdAt: manifest.createdAt || null,
        createdBy: manifest.createdBy || null,
        baselineBackupId: manifest.baselineBackupId || null,
        baselineChangeId: manifest.baselineChangeId ?? null,
        throughChangeId: manifest.throughChangeId ?? null,
        tableCount: manifest.tableCount ?? tableFiles.length,
        totalRecords: manifest.totalRecords ?? null,
        changeCount: manifest.changeCount ?? null,
        tableFiles: tableFiles.length,
        changeFiles: changeFiles.length,
        checkedFiles: checksumResult.checkedFiles,
      },
      nextSteps: issues.length === 0
        ? backupType === DIFFERENTIAL_TYPE
          ? ['Keep the referenced Full Backup with this Differential package.', 'Review backup details before any restoration.', 'Require explicit confirmation before a future restore operation.']
          : ['Store the Full Backup in an approved secure location.', 'Use it as the baseline for future Differential backups.', 'Require explicit confirmation before a future restore operation.']
        : ['Reject this backup package.', 'Create or obtain a new NJSS Full/Differential ZIP Backup and validate it again.'],
    })
  } catch (error) {
    return NextResponse.json({
      valid: false,
      status: 'Rejected',
      issues: [error instanceof Error ? error.message : 'Unable to read ZIP file.'],
    }, { status: 400 })
  }
}
