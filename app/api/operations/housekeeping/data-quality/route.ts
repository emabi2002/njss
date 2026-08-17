import { NextResponse, type NextRequest } from 'next/server'
import { requirePermission } from '@/lib/rbac/server'
import { createServerSupabaseClient } from '@/lib/supabase'

const READ_PERMISSIONS = ['operations.view', 'operations.manage', 'settings.manage', 'all']

type CountResult = { count: number | null; error: { message: string } | null }
type CountQuery = PromiseLike<CountResult> & {
  is: (column: string, value: unknown) => CountQuery
  lt: (column: string, value: unknown) => CountQuery
  gt: (column: string, value: unknown) => CountQuery
  eq: (column: string, value: unknown) => CountQuery
  or: (filters: string) => CountQuery
}

async function safeCount(table: string, apply?: (query: CountQuery) => CountQuery) {
  try {
    const supabase = createServerSupabaseClient()
    let query = supabase.from(table).select('*', { count: 'exact', head: true }) as unknown as CountQuery
    if (apply) query = apply(query)
    const result = await query
    if (result.error) return null
    return result.count || 0
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, READ_PERMISSIONS)
  if (guard.response) return guard.response

  const [
    missingInvoiceReferences,
    missingDepartments,
    orphanedDocuments,
    invalidFf4Dates,
    invalidStatuses,
    missingUsers,
    longPendingFf3,
    unreconciledPayments,
    orphanedFf4Payments,
  ] = await Promise.all([
    safeCount('ff4_headers', (q) => q.or('invoice_number.is.null,invoice_number.eq.')),
    safeCount('users', (q) => q.is('department_id', null)),
    safeCount('documents', (q) => q.is('reference_id', null)),
    safeCount('ff4_headers', (q) => q.lt('payment_date', '1900-01-01')),
    safeCount('ff3_headers', (q) => q.or('status.is.null,status.eq.')),
    safeCount('users', (q) => q.or('email.is.null,full_name.is.null')),
    safeCount('ff3_headers', (q) => q.or('status.eq.SUBMITTED,status.eq.RETURNED')),
    safeCount('payment_transactions', (q) => q.eq('reconciled', false)),
    safeCount('payment_transactions', (q) => q.is('ff4_header_id', null)),
  ])

  const summary = [
    { validation: 'Missing Invoice References', issues: missingInvoiceReferences ?? 'Not Available', detail: 'FF4 records with blank invoice references requiring completion or documented exception.' },
    { validation: 'Missing Mandatory Fields', issues: (missingDepartments ?? 0) + (missingUsers ?? 0), detail: 'Users or operational records missing required owner/department/profile fields.' },
    { validation: 'Invalid References', issues: orphanedFf4Payments ?? 'Not Available', detail: 'Detected child financial records without a valid FF4 parent reference.' },
    { validation: 'Orphaned Documents', issues: orphanedDocuments ?? 'Not Available', detail: 'Documents without a valid parent reference.' },
    { validation: 'Invalid Dates', issues: invalidFf4Dates ?? 'Not Available', detail: 'Payment or approval dates outside configured periods.' },
    { validation: 'Invalid Statuses', issues: invalidStatuses ?? 'Not Available', detail: 'Records with missing or invalid workflow status.' },
    { validation: 'Missing Department', issues: missingDepartments ?? 'Not Available', detail: 'Users or records without department assignment.' },
    { validation: 'Broken Relationships', issues: (orphanedDocuments ?? 0) + (orphanedFf4Payments ?? 0), detail: 'Child records that need reassignment, repair, archive, or safe deletion review.' },
  ]

  const supabase = createServerSupabaseClient()
  await supabase.from('audit_logs').insert({
    user_id: guard.context?.userId || null,
    user_email: guard.context?.email || null,
    user_name: guard.context?.name || null,
    action: 'HOUSEKEEPING_DATA_QUALITY_SCAN',
    entity_type: 'DATA_QUALITY',
    new_values: { summary, longPendingFf3, unreconciledPayments },
    metadata: { module: 'HOUSEKEEPING', operation: 'SCAN_DATABASE' },
  })

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    summary,
    archiveCandidates: {
      longPendingFf3: longPendingFf3 ?? 0,
      unreconciledPayments: unreconciledPayments ?? 0,
      note: 'Archive candidates must be previewed and selected before any archive operation. No automatic deletion is performed.',
    },
    cleanupWizard: ['Scan Database', 'Identify Issues', 'Review Issues', 'Select Corrective Action', 'Preview Changes', 'Create Automatic Backup', 'Apply Cleanup', 'Validate Database', 'Generate Cleanup Report'],
    safetyNotice: 'This endpoint is read-only. Bulk cleanup and restoration require explicit confirmation and a safety backup first.',
  })
}
