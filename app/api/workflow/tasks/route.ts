import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, getServerAccessContext, hasServerPermission } from '@/lib/rbac/server'
import { isRecordInScope } from '@/lib/rbac/scope'
import { resolveManagementReportScope } from '@/lib/reports/management-scope'

export const dynamic = 'force-dynamic'

type TaskRule = {
  requiredPermission: string
  action: string
  actionLabel: string
  summaryLabel: string
  responsibleRole: string
  ownerOnly?: boolean
}

const FF3_RULES: Record<string, TaskRule> = {
  DRAFT: {
    requiredPermission: 'ff3.edit',
    action: 'COMPLETE_FF3',
    actionLabel: 'Complete draft',
    summaryLabel: 'FF3 drafts requiring completion',
    responsibleRole: 'Requisition Officer',
    ownerOnly: true,
  },
  RETURNED: {
    requiredPermission: 'ff3.edit',
    action: 'CORRECT_FF3',
    actionLabel: 'Correct & resubmit',
    summaryLabel: 'FF3s requiring correction',
    responsibleRole: 'Requisition Officer',
    ownerOnly: true,
  },
  SUBMITTED: {
    requiredPermission: 'ff3.endorse',
    action: 'ENDORSE_FF3_SUPERVISOR',
    actionLabel: 'Supervisor endorsement',
    summaryLabel: 'FF3s awaiting endorsement',
    responsibleRole: 'Line Supervisor',
  },
  ENDORSED_SUPERVISOR: {
    requiredPermission: 'ff3.endorse',
    action: 'ENDORSE_FF3_SECTION_HEAD',
    actionLabel: 'Section-head endorsement',
    summaryLabel: 'FF3s awaiting endorsement',
    responsibleRole: 'Line Supervisor',
  },
  ENDORSED_SECTION_HEAD: {
    requiredPermission: 'ff3.approve',
    action: 'APPROVE_FF3',
    actionLabel: 'Registrar approval',
    summaryLabel: 'FF3s awaiting Registrar approval',
    responsibleRole: 'Registrar',
  },
}

const FF4_RULES: Record<string, TaskRule> = {
  DRAFT: {
    requiredPermission: 'ff4.edit',
    action: 'COMPLETE_FF4',
    actionLabel: 'Complete FF4',
    summaryLabel: 'FF4 drafts requiring completion',
    responsibleRole: 'Payment/Reconciliation Officer',
    ownerOnly: true,
  },
  SUBMITTED: {
    requiredPermission: 'ff4.verify',
    action: 'VERIFY_FF4',
    actionLabel: 'Verify FF4',
    summaryLabel: 'FF4s awaiting verification',
    responsibleRole: 'Payment/Reconciliation Officer',
  },
  VERIFIED: {
    requiredPermission: 'ff4.approve',
    action: 'APPROVE_FF4',
    actionLabel: 'Approve FF4',
    summaryLabel: 'FF4s awaiting approval',
    responsibleRole: 'Registrar',
  },
  APPROVED: {
    requiredPermission: 'ff4.process',
    action: 'PROCESS_FF4',
    actionLabel: 'Process payment',
    summaryLabel: 'FF4s awaiting processing',
    responsibleRole: 'Payment/Reconciliation Officer',
  },
  PROCESSED: {
    requiredPermission: 'ff4.process',
    action: 'MARK_FF4_PAID',
    actionLabel: 'Confirm payment',
    summaryLabel: 'Payments awaiting confirmation',
    responsibleRole: 'Payment/Reconciliation Officer',
  },
  PAID: {
    requiredPermission: 'ff4.reconcile',
    action: 'RECONCILE_FF4',
    actionLabel: 'Reconcile payment',
    summaryLabel: 'Payments awaiting reconciliation',
    responsibleRole: 'Payment/Reconciliation Officer',
  },
}

const DIVISION_BUDGET_REVIEW: TaskRule = {
  requiredPermission: 'budget.registrar.approve',
  action: 'REVIEW_DIVISION_BUDGET',
  actionLabel: 'Review division budget',
  summaryLabel: 'Division budgets awaiting Registrar review',
  responsibleRole: 'Registrar',
}

type RawTask = {
  id: string
  sourceType: 'FF3' | 'FF4' | 'BUDGET'
  referenceNumber: string
  status: string
  financialYear: number
  department_id: string | null
  section_id: string | null
  created_by: string | null
  requesting_officer_id?: string | null
  amount: number
  updatedAt: string
  href: string
  rule: TaskRule
}

type DepartmentLookup = { id: string; name: string }
type SectionLookup = { id: string; department_id: string | null; name: string }

function ageInfo(dateString: string) {
  const when = new Date(dateString)
  const diff = Math.max(0, Date.now() - when.getTime())
  const ageDays = Math.floor(diff / 86_400_000)
  if (ageDays === 0) return { ageDays, ageBucket: 'TODAY', ageLabel: 'Today' }
  if (ageDays <= 2) return { ageDays, ageBucket: '1_2_DAYS', ageLabel: '1–2 days' }
  if (ageDays <= 5) return { ageDays, ageBucket: '3_5_DAYS', ageLabel: '3–5 days' }
  return { ageDays, ageBucket: 'OVER_5_DAYS', ageLabel: 'Over 5 days' }
}

function hasPermission(permissions: string[], permission: string) {
  return permissions.includes('all') || permissions.includes(permission)
}

function canAct(task: RawTask, userId: string, permissions: string[], isAdministrator: boolean) {
  if (!hasPermission(permissions, task.rule.requiredPermission)) return false
  if (task.rule.ownerOnly && !isAdministrator) {
    return task.created_by === userId || task.requesting_officer_id === userId
  }
  return true
}

function makeSummary(tasks: Array<ReturnType<typeof presentTask>>) {
  const counts = new Map<string, { label: string; count: number; sourceType: 'FF3' | 'FF4' | 'BUDGET' }>()
  for (const task of tasks) {
    const key = task.summaryLabel
    const current = counts.get(key) || { label: key, count: 0, sourceType: task.sourceType }
    current.count += 1
    counts.set(key, current)
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function presentTask(
  task: RawTask,
  departments: Map<string, DepartmentLookup>,
  sections: Map<string, SectionLookup>,
) {
  const department = task.department_id ? departments.get(task.department_id) : undefined
  const section = task.section_id ? sections.get(task.section_id) : undefined
  return {
    id: `${task.sourceType}-${task.id}`,
    sourceId: task.id,
    sourceType: task.sourceType,
    referenceNumber: task.referenceNumber,
    status: task.status,
    financialYear: task.financialYear,
    amount: task.amount,
    departmentId: task.department_id,
    departmentName: department?.name || 'Unassigned Division',
    sectionId: task.section_id,
    sectionName: task.sourceType === 'BUDGET' ? 'Division budget' : section?.name || 'Unassigned Section',
    action: task.rule.action,
    actionLabel: task.rule.actionLabel,
    summaryLabel: task.rule.summaryLabel,
    requiredPermission: task.rule.requiredPermission,
    responsibleRole: task.rule.responsibleRole,
    waitingSince: task.updatedAt,
    ...ageInfo(task.updatedAt),
    href: task.href,
  }
}

export async function GET(request: NextRequest) {
  const context = await getServerAccessContext(request)
  if (!context) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!hasServerPermission(context, 'workflow.tasks.view')) {
    return NextResponse.json({ error: 'Workflow task inbox access denied' }, { status: 403 })
  }

  const supabase = createRequestSupabaseClient(request)
  const summaryOnly = request.nextUrl.searchParams.get('summary') === '1'
  const requestedDepartmentId = request.nextUrl.searchParams.get('departmentId')?.trim() || ''
  const requestedSectionId = request.nextUrl.searchParams.get('sectionId')?.trim() || ''
  const requestedType = request.nextUrl.searchParams.get('type')?.trim() || ''
  const requestedStage = request.nextUrl.searchParams.get('stage')?.trim() || ''
  const requestedAge = request.nextUrl.searchParams.get('age')?.trim() || ''

  try {
    const scope = await resolveManagementReportScope(supabase, context)
    const isAdministrator = context.permissions.includes('all') || context.roleNames.includes('System Administrator')

    const departmentResult = await supabase.from('departments')
      .select('id, name, court_location:court_locations!inner(location_type, is_active)')
      .eq('is_active', true).eq('court_location.is_active', true)
      .eq('court_location.location_type', 'HEADQUARTERS').order('name')
    if (departmentResult.error) throw departmentResult.error
    const departmentRows: DepartmentLookup[] = (departmentResult.data || []).filter((row) => scope.mode !== 'SECTION' || row.id === scope.departmentId)
    const departmentIds = departmentRows.map((row) => row.id)
    const sectionResult = departmentIds.length
      ? await supabase.from('sections').select('id, department_id, name').eq('is_active', true).in('department_id', departmentIds).order('name')
      : { data: [], error: null }
    if (sectionResult.error) throw sectionResult.error
    const sectionRows = ((sectionResult.data || []) as SectionLookup[]).filter((row) => scope.mode !== 'SECTION' || row.id === scope.sectionId)
    const sectionIds = sectionRows.map((row) => row.id)
    if (requestedDepartmentId && !departmentIds.includes(requestedDepartmentId)) return NextResponse.json({ error: 'Requested Division is outside your Head Office workflow scope.' }, { status: 403 })
    if (requestedSectionId && !sectionIds.includes(requestedSectionId)) return NextResponse.json({ error: 'Requested Section is outside your Head Office workflow scope.' }, { status: 403 })
    const [ff3Result, ff4Result, budgetResult] = await Promise.all([
      sectionIds.length ? supabase.from('ff3_headers')
        .select('id, ff3_number, status, financial_year, department_id, section_id, created_by, requesting_officer_id, total_estimated_amount, updated_at')
        .in('status', Object.keys(FF3_RULES)).in('department_id', departmentIds).in('section_id', sectionIds).order('updated_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      sectionIds.length ? supabase.from('ff4_headers')
        .select('id, ff4_number, status, financial_year, department_id, section_id, created_by, net_amount, updated_at')
        .in('status', Object.keys(FF4_RULES)).in('department_id', departmentIds).in('section_id', sectionIds).order('updated_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      departmentIds.length && hasPermission(context.permissions, 'budget.registrar.approve')
        ? supabase.from('division_budgets')
          .select('id, financial_year, division_id, reference_number, status, updated_at, lines:division_budget_lines(original_amount)')
          .in('division_id', departmentIds).eq('status', 'PENDING_REGISTRAR_APPROVAL').order('updated_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ])
    if (ff3Result.error) throw ff3Result.error
    if (ff4Result.error) throw ff4Result.error
    if (budgetResult.error) throw budgetResult.error
    const departments = new Map(departmentRows.map((row) => [row.id, row]))
    const sections = new Map(sectionRows.map((row) => [row.id, row]))

    const rawTasks: RawTask[] = [
      ...(ff3Result.data || []).map((row) => ({
        id: row.id,
        sourceType: 'FF3' as const,
        referenceNumber: row.ff3_number,
        status: row.status,
        financialYear: row.financial_year,
        department_id: row.department_id,
        section_id: row.section_id,
        created_by: row.created_by,
        requesting_officer_id: row.requesting_officer_id,
        amount: Number(row.total_estimated_amount || 0),
        updatedAt: row.updated_at,
        href: `/dashboard/ff3/${row.id}`,
        rule: FF3_RULES[row.status],
      })),
      ...(ff4Result.data || []).map((row) => ({
        id: row.id,
        sourceType: 'FF4' as const,
        referenceNumber: row.ff4_number,
        status: row.status,
        financialYear: row.financial_year,
        department_id: row.department_id,
        section_id: row.section_id,
        created_by: row.created_by,
        amount: Number(row.net_amount || 0),
        updatedAt: row.updated_at,
        href: `/dashboard/ff4/${row.id}`,
        rule: FF4_RULES[row.status],
      })),
      ...(budgetResult.data || []).map((row) => ({
        id: row.id,
        sourceType: 'BUDGET' as const,
        referenceNumber: row.reference_number || `Division budget FY${row.financial_year}`,
        status: row.status,
        financialYear: row.financial_year,
        department_id: row.division_id,
        section_id: null,
        created_by: null,
        amount: (row.lines || []).reduce((sum, line) => sum + Number(line.original_amount || 0), 0),
        updatedAt: row.updated_at,
        href: `/dashboard/budget-template?divisionBudgetId=${row.id}`,
        rule: DIVISION_BUDGET_REVIEW,
      })),
    ]

    const scopedTasks = rawTasks.filter((task) => departmentIds.includes(task.department_id || '')
      && (task.sourceType === 'BUDGET' || sectionIds.includes(task.section_id || ''))
      && isRecordInScope(context, { ...task, division_id: task.department_id }))
    let presented = scopedTasks.map((task) => presentTask(task, departments, sections))
    if (requestedDepartmentId) presented = presented.filter((task) => task.departmentId === requestedDepartmentId)
    if (requestedSectionId) presented = presented.filter((task) => task.sectionId === requestedSectionId)

    if (requestedType) presented = presented.filter((task) => task.sourceType === requestedType)
    if (requestedStage) presented = presented.filter((task) => task.status === requestedStage)
    if (requestedAge) presented = presented.filter((task) => task.ageBucket === requestedAge)

    const rawByKey = new Map(rawTasks.map((task) => [`${task.sourceType}-${task.id}`, task]))
    const actionRequired = presented.filter((task) => {
      const raw = rawByKey.get(task.id)
      return raw ? (raw.sourceType !== 'BUDGET' || context.roleNames.includes('Registrar'))
        && canAct(raw, context.userId, context.permissions, isAdministrator) : false
    })
    const systemWide = isAdministrator ? presented : []

    const actionSummary = makeSummary(actionRequired)
    const oversightSummary = makeSummary(systemWide)

    if (summaryOnly) {
      return NextResponse.json({
        isAdministrator,
        scope: { mode: scope.mode === 'SYSTEM' ? 'HEAD_OFFICE' : 'SECTION', label: scope.label },
        actionRequiredTotal: actionRequired.length,
        systemWideTotal: systemWide.length,
        actionSummary,
        oversightSummary,
      })
    }

    return NextResponse.json({
      isAdministrator,
      scope: { mode: scope.mode === 'SYSTEM' ? 'HEAD_OFFICE' : 'SECTION', label: scope.label },
      actionRequired,
      systemWide,
      actionSummary,
      oversightSummary,
      lookups: {
        departments: departmentRows,
        sections: sectionRows,
      },
    })
  } catch (error) {
    console.error('Unable to load workflow task inbox:', error)
    return NextResponse.json({ error: 'Unable to load workflow task inbox' }, { status: 500 })
  }
}
