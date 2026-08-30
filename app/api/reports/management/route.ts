import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, getServerAccessContext } from '@/lib/rbac/server'
import { resolveManagementReportScope } from '@/lib/reports/management-scope'

export const dynamic = 'force-dynamic'

const REPORT_IDS = new Set([
  'management-financial-summary',
  'department-financial-position',
  'section-financial-position',
  'cost-centre-financial-position',
  'expense-code-financial-position',
  'funding-source-financial-position',
  'ff3-ff4-transaction-trace',
])

const PENDING_FF3 = ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD']
const PENDING_FF4 = ['SUBMITTED', 'VERIFIED', 'PROCESSED']

const MONEY_KEYS = [
  'approved_budget',
  'funded_amount',
  'released_amount',
  'pending_amount',
  'outstanding_commitment',
  'actual_expenditure',
  'available_amount',
  'unfunded_amount',
  'unreleased_funding',
  'projected_available_after_pending',
] as const

type PositionRow = {
  budget_allocation_id: string
  financial_year: number
  department_id: string | null
  department_name: string | null
  section_id: string | null
  section_name: string | null
  cost_centre_id: string | null
  cost_centre_code: string | null
  cost_centre_name: string | null
  expense_code_registry_id: string | null
  full_expense_code: string | null
  funding_source_id: string | null
  funding_source_name: string | null
  approved_budget: number | null
  funded_amount: number | null
  released_amount: number | null
  pending_amount: number | null
  outstanding_commitment: number | null
  actual_expenditure: number | null
  available_amount: number | null
  unfunded_amount: number | null
  unreleased_funding: number | null
  projected_available_after_pending: number | null
}

type Drilldown = { report: string; params: Record<string, string> }

type ReportColumn = {
  key: string
  label: string
  kind?: 'text' | 'money' | 'number' | 'date' | 'status'
}

type ReportRow = Record<string, unknown> & {
  drilldown?: Drilldown
  ff3Href?: string
  ff4Href?: string
}

function numberValue(value: unknown) {
  const valueAsNumber = Number(value ?? 0)
  return Number.isFinite(valueAsNumber) ? valueAsNumber : 0
}

function parseYear(value: string | null) {
  const year = Number(value || new Date().getFullYear())
  return Number.isInteger(year) && year >= 2000 && year <= 2200 ? year : new Date().getFullYear()
}

function cleanId(value: string | null) {
  return value?.trim() || null
}

function aggregate(rows: PositionRow[]) {
  const sums = Object.fromEntries(MONEY_KEYS.map((key) => [key, 0])) as Record<(typeof MONEY_KEYS)[number], number>
  for (const row of rows) {
    for (const key of MONEY_KEYS) sums[key] += numberValue(row[key])
  }
  return sums
}

function positionColumns(label: string): ReportColumn[] {
  return [
    { key: 'name', label },
    { key: 'budgetLineCount', label: 'Budget Lines', kind: 'number' },
    { key: 'approvedBudget', label: 'Approved Budget (K)', kind: 'money' },
    { key: 'fundedAmount', label: 'Funded (K)', kind: 'money' },
    { key: 'releasedAmount', label: 'Released (K)', kind: 'money' },
    { key: 'pendingFF3', label: 'Pending FF3 (K)', kind: 'money' },
    { key: 'outstandingCommitments', label: 'Outstanding Commitments (K)', kind: 'money' },
    { key: 'actualExpenditure', label: 'Actual Expenditure (K)', kind: 'money' },
    { key: 'availableBalance', label: 'Available Balance (K)', kind: 'money' },
    { key: 'unfundedBudget', label: 'Unfunded (K)', kind: 'money' },
    { key: 'unreleasedFunding', label: 'Unreleased Funding (K)', kind: 'money' },
    { key: 'utilisationPct', label: 'Utilisation %', kind: 'number' },
  ]
}

function positionRecord(name: string, rows: PositionRow[], drilldown?: Drilldown): ReportRow {
  const sums = aggregate(rows)
  const utilisation = sums.released_amount > 0
    ? ((sums.outstanding_commitment + sums.actual_expenditure) / sums.released_amount) * 100
    : 0
  return {
    name,
    budgetLineCount: new Set(rows.map((row) => row.budget_allocation_id)).size,
    approvedBudget: sums.approved_budget,
    fundedAmount: sums.funded_amount,
    releasedAmount: sums.released_amount,
    pendingFF3: sums.pending_amount,
    outstandingCommitments: sums.outstanding_commitment,
    actualExpenditure: sums.actual_expenditure,
    availableBalance: sums.available_amount,
    unfundedBudget: sums.unfunded_amount,
    unreleasedFunding: sums.unreleased_funding,
    utilisationPct: Math.round(utilisation * 10) / 10,
    ...(drilldown ? { drilldown } : {}),
  }
}

function groupPositions(
  rows: PositionRow[],
  keyOf: (row: PositionRow) => string,
  nameOf: (row: PositionRow) => string,
  drilldownOf: (row: PositionRow) => Drilldown | undefined,
) {
  const groups = new Map<string, PositionRow[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const list = groups.get(key) || []
    list.push(row)
    groups.set(key, list)
  }
  return Array.from(groups.values())
    .map((group) => positionRecord(nameOf(group[0]), group, drilldownOf(group[0])))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

function hasReportPermission(permissions: string[]) {
  return permissions.includes('all')
    || permissions.includes('reports.view')
    || permissions.includes('budget.report.view')
}

export async function GET(request: NextRequest) {
  const context = await getServerAccessContext(request)
  if (!context) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!hasReportPermission(context.permissions)) {
    return NextResponse.json({ error: 'Management report access denied' }, { status: 403 })
  }

  const report = request.nextUrl.searchParams.get('report') || 'management-financial-summary'
  if (!REPORT_IDS.has(report)) return NextResponse.json({ error: 'Unsupported management report' }, { status: 400 })

  const financialYear = parseYear(request.nextUrl.searchParams.get('financialYear'))
  const requestedDepartmentId = cleanId(request.nextUrl.searchParams.get('departmentId'))
  const requestedSectionId = cleanId(request.nextUrl.searchParams.get('sectionId'))
  const costCentreId = cleanId(request.nextUrl.searchParams.get('costCentreId'))
  const expenseCodeRegistryId = cleanId(request.nextUrl.searchParams.get('expenseCodeRegistryId'))
  const fundingSourceId = cleanId(request.nextUrl.searchParams.get('fundingSourceId'))
  const status = request.nextUrl.searchParams.get('status')?.trim() || null
  const startDate = request.nextUrl.searchParams.get('startDate')?.trim() || null
  const endDate = request.nextUrl.searchParams.get('endDate')?.trim() || null

  const supabase = createRequestSupabaseClient(request)

  try {
    const scope = await resolveManagementReportScope(supabase, context)
    let departmentId = requestedDepartmentId
    let sectionId = requestedSectionId

    if (scope.mode === 'SECTION') {
      if (requestedDepartmentId && requestedDepartmentId !== scope.departmentId) {
        return NextResponse.json({ error: 'Requested Department is outside your reporting scope.' }, { status: 403 })
      }
      if (requestedSectionId && requestedSectionId !== scope.sectionId) {
        return NextResponse.json({ error: 'Requested Section is outside your reporting scope.' }, { status: 403 })
      }
      departmentId = scope.departmentId
      sectionId = scope.sectionId
    } else if (requestedSectionId) {
      const sectionCheck = await supabase
        .from('sections')
        .select('id, department_id')
        .eq('id', requestedSectionId)
        .maybeSingle()
      if (sectionCheck.error) throw sectionCheck.error
      if (!sectionCheck.data) return NextResponse.json({ error: 'Requested Section does not exist.' }, { status: 400 })
      if (requestedDepartmentId && sectionCheck.data.department_id !== requestedDepartmentId) {
        return NextResponse.json({ error: 'Requested Section does not belong to the selected Department.' }, { status: 400 })
      }
    }

    let positionQuery = supabase
      .from('v_authoritative_budget_position')
      .select('budget_allocation_id, financial_year, department_id, department_name, section_id, section_name, cost_centre_id, cost_centre_code, cost_centre_name, expense_code_registry_id, full_expense_code, funding_source_id, funding_source_name, approved_budget, funded_amount, released_amount, pending_amount, outstanding_commitment, actual_expenditure, available_amount, unfunded_amount, unreleased_funding, projected_available_after_pending')
      .eq('financial_year', financialYear)

    if (departmentId) positionQuery = positionQuery.eq('department_id', departmentId)
    if (sectionId) positionQuery = positionQuery.eq('section_id', sectionId)
    if (costCentreId) positionQuery = positionQuery.eq('cost_centre_id', costCentreId)
    if (expenseCodeRegistryId) positionQuery = positionQuery.eq('expense_code_registry_id', expenseCodeRegistryId)
    if (fundingSourceId) positionQuery = positionQuery.eq('funding_source_id', fundingSourceId)

    const positionResult = await positionQuery
    if (positionResult.error) throw positionResult.error
    const positions = (positionResult.data || []) as PositionRow[]

    let title = 'Management Financial Summary'
    let columns: ReportColumn[] = []
    let rows: ReportRow[] = []
    let totals: Record<string, number> | undefined

    if (report === 'management-financial-summary') {
      const sums = aggregate(positions)
      let ff3Query = supabase
        .from('ff3_headers')
        .select('status, department_id, section_id, cost_centre_id, expense_code_registry_id, funding_source_id, request_date')
        .eq('financial_year', financialYear)
      let ff4Query = supabase
        .from('ff4_headers')
        .select('status, department_id, section_id, cost_centre_id, expense_code_registry_id, funding_source_id, payment_request_date')
        .eq('financial_year', financialYear)

      if (departmentId) { ff3Query = ff3Query.eq('department_id', departmentId); ff4Query = ff4Query.eq('department_id', departmentId) }
      if (sectionId) { ff3Query = ff3Query.eq('section_id', sectionId); ff4Query = ff4Query.eq('section_id', sectionId) }
      if (costCentreId) { ff3Query = ff3Query.eq('cost_centre_id', costCentreId); ff4Query = ff4Query.eq('cost_centre_id', costCentreId) }
      if (expenseCodeRegistryId) { ff3Query = ff3Query.eq('expense_code_registry_id', expenseCodeRegistryId); ff4Query = ff4Query.eq('expense_code_registry_id', expenseCodeRegistryId) }
      if (fundingSourceId) { ff3Query = ff3Query.eq('funding_source_id', fundingSourceId); ff4Query = ff4Query.eq('funding_source_id', fundingSourceId) }
      if (startDate) { ff3Query = ff3Query.gte('request_date', startDate); ff4Query = ff4Query.gte('payment_request_date', startDate) }
      if (endDate) { ff3Query = ff3Query.lte('request_date', endDate); ff4Query = ff4Query.lte('payment_request_date', endDate) }

      const [ff3Result, ff4Result] = await Promise.all([ff3Query, ff4Query])
      if (ff3Result.error) throw ff3Result.error
      if (ff4Result.error) throw ff4Result.error
      const ff3Statuses = (ff3Result.data || []).map((row) => String(row.status || ''))
      const ff4Statuses = (ff4Result.data || []).map((row) => String(row.status || ''))
      const nextReport = scope.mode === 'SECTION' ? 'cost-centre-financial-position' : 'department-financial-position'
      const drilldown: Drilldown = {
        report: nextReport,
        params: Object.fromEntries([
          departmentId ? ['departmentId', departmentId] : null,
          sectionId ? ['sectionId', sectionId] : null,
        ].filter(Boolean) as Array<[string, string]>),
      }
      columns = [
        { key: 'metric', label: 'Metric' },
        { key: 'amount', label: 'Amount (K)', kind: 'money' },
        { key: 'count', label: 'Count', kind: 'number' },
      ]
      rows = [
        { metric: 'Approved Budget', amount: sums.approved_budget, count: null, drilldown },
        { metric: 'Funded Amount', amount: sums.funded_amount, count: null, drilldown },
        { metric: 'Released Amount', amount: sums.released_amount, count: null, drilldown },
        { metric: 'Pending FF3', amount: sums.pending_amount, count: null, drilldown },
        { metric: 'Outstanding Commitments', amount: sums.outstanding_commitment, count: null, drilldown },
        { metric: 'Actual Expenditure', amount: sums.actual_expenditure, count: null, drilldown },
        { metric: 'Available Balance', amount: sums.available_amount, count: null, drilldown },
        { metric: 'Unfunded Budget', amount: sums.unfunded_amount, count: null, drilldown },
        { metric: 'Unreleased Funding', amount: sums.unreleased_funding, count: null, drilldown },
        { metric: 'Projected Available After Pending FF3', amount: sums.projected_available_after_pending, count: null, drilldown },
        { metric: 'FF3 Awaiting Action', amount: null, count: ff3Statuses.filter((value) => PENDING_FF3.includes(value)).length, drilldown },
        { metric: 'FF4 Awaiting Action', amount: null, count: ff4Statuses.filter((value) => PENDING_FF4.includes(value)).length, drilldown },
        { metric: 'Paid Awaiting Reconciliation', amount: null, count: ff4Statuses.filter((value) => value === 'PAID').length, drilldown },
      ]
      totals = {
        approvedBudget: sums.approved_budget,
        fundedAmount: sums.funded_amount,
        releasedAmount: sums.released_amount,
        pendingFF3: sums.pending_amount,
        outstandingCommitments: sums.outstanding_commitment,
        actualExpenditure: sums.actual_expenditure,
        availableBalance: sums.available_amount,
      }
    } else if (report === 'department-financial-position') {
      title = 'Department Financial Position'
      columns = positionColumns('Department')
      rows = groupPositions(
        positions,
        (row) => row.department_id || 'unassigned',
        (row) => row.department_name || 'Unassigned',
        (row) => row.department_id ? { report: 'section-financial-position', params: { departmentId: row.department_id } } : undefined,
      )
    } else if (report === 'section-financial-position') {
      title = 'Section Financial Position'
      columns = positionColumns('Section')
      rows = groupPositions(
        positions,
        (row) => row.section_id || 'unassigned',
        (row) => row.section_name || 'Unassigned',
        (row) => row.section_id ? {
          report: 'cost-centre-financial-position',
          params: Object.fromEntries([
            row.department_id ? ['departmentId', row.department_id] : null,
            ['sectionId', row.section_id],
          ].filter(Boolean) as Array<[string, string]>),
        } : undefined,
      )
    } else if (report === 'cost-centre-financial-position') {
      title = 'Cost Centre Financial Position'
      columns = positionColumns('Cost Centre')
      rows = groupPositions(
        positions,
        (row) => row.cost_centre_id || `${row.section_id || 'none'}:unassigned`,
        (row) => row.cost_centre_code ? `${row.cost_centre_code} — ${row.cost_centre_name || ''}` : row.cost_centre_name || 'Unassigned',
        (row) => row.cost_centre_id ? {
          report: 'expense-code-financial-position',
          params: Object.fromEntries([
            row.department_id ? ['departmentId', row.department_id] : null,
            row.section_id ? ['sectionId', row.section_id] : null,
            ['costCentreId', row.cost_centre_id],
          ].filter(Boolean) as Array<[string, string]>),
        } : undefined,
      )
    } else if (report === 'expense-code-financial-position') {
      title = 'Expense Code Financial Position'
      columns = positionColumns('Expense Code')
      rows = groupPositions(
        positions,
        (row) => row.expense_code_registry_id || `${row.cost_centre_id || 'none'}:${row.full_expense_code || 'unassigned'}`,
        (row) => row.full_expense_code || 'Unassigned',
        (row) => row.expense_code_registry_id ? {
          report: 'ff3-ff4-transaction-trace',
          params: Object.fromEntries([
            row.department_id ? ['departmentId', row.department_id] : null,
            row.section_id ? ['sectionId', row.section_id] : null,
            row.cost_centre_id ? ['costCentreId', row.cost_centre_id] : null,
            ['expenseCodeRegistryId', row.expense_code_registry_id],
          ].filter(Boolean) as Array<[string, string]>),
        } : undefined,
      )
    } else if (report === 'funding-source-financial-position') {
      title = 'Funding Source Financial Position'
      columns = positionColumns('Funding Source')
      rows = groupPositions(
        positions,
        (row) => row.funding_source_id || 'unassigned',
        (row) => row.funding_source_name || 'Unassigned',
        (row) => row.funding_source_id ? {
          report: 'ff3-ff4-transaction-trace',
          params: Object.fromEntries([
            departmentId ? ['departmentId', departmentId] : null,
            sectionId ? ['sectionId', sectionId] : null,
            ['fundingSourceId', row.funding_source_id],
          ].filter(Boolean) as Array<[string, string]>),
        } : undefined,
      )
    } else {
      title = 'FF3 to FF4 Transaction Trace'
      columns = [
        { key: 'ff3Number', label: 'FF3 Number' },
        { key: 'purpose', label: 'Purpose' },
        { key: 'commitmentNumber', label: 'Commitment' },
        { key: 'ff4Number', label: 'FF4 Number' },
        { key: 'supplierOrPayee', label: 'Supplier / Payee' },
        { key: 'status', label: 'Status', kind: 'status' },
        { key: 'paymentDate', label: 'Payment Date', kind: 'date' },
        { key: 'paymentReference', label: 'Payment Reference' },
        { key: 'reconciled', label: 'Reconciled' },
        { key: 'amount', label: 'Amount (K)', kind: 'money' },
      ]

      let traceQuery = supabase
        .from('v_ff3_ff4_transaction_trace')
        .select('financial_year, ff3_header_id, ff3_number, ff3_request_date, ff3_status, ff3_purpose, ff3_amount, department_id, section_id, cost_centre_id, expense_code_registry_id, funding_source_id, commitment_id, commitment_number, commitment_status, commitment_paid_amount, commitment_outstanding_amount, ff4_header_id, ff4_number, ff4_status, supplier_or_payee, payment_date, payment_reference, payment_amount, ff4_net_amount, reconciled')
        .eq('financial_year', financialYear)
        .order('ff3_number')

      if (departmentId) traceQuery = traceQuery.eq('department_id', departmentId)
      if (sectionId) traceQuery = traceQuery.eq('section_id', sectionId)
      if (costCentreId) traceQuery = traceQuery.eq('cost_centre_id', costCentreId)
      if (expenseCodeRegistryId) traceQuery = traceQuery.eq('expense_code_registry_id', expenseCodeRegistryId)
      if (fundingSourceId) traceQuery = traceQuery.eq('funding_source_id', fundingSourceId)
      if (startDate) traceQuery = traceQuery.gte('ff3_request_date', startDate)
      if (endDate) traceQuery = traceQuery.lte('ff3_request_date', endDate)

      const traceResult = await traceQuery
      if (traceResult.error) throw traceResult.error
      const traceRows = (traceResult.data || []).filter((row) => !status || row.ff4_status === status || row.ff3_status === status)
      rows = traceRows.map((row) => ({
        ff3Number: row.ff3_number || '-',
        purpose: row.ff3_purpose || '-',
        commitmentNumber: row.commitment_number || '-',
        ff4Number: row.ff4_number || '-',
        supplierOrPayee: row.supplier_or_payee || '-',
        status: row.ff4_status || row.commitment_status || row.ff3_status || '-',
        paymentDate: row.payment_date || null,
        paymentReference: row.payment_reference || '-',
        reconciled: row.reconciled ? 'Yes' : 'No',
        amount: numberValue(row.payment_amount || row.ff4_net_amount || row.ff3_amount),
        ff3Href: row.ff3_number ? `/dashboard/ff3/${encodeURIComponent(row.ff3_number)}` : undefined,
        ff4Href: row.ff4_number ? `/dashboard/ff4/${encodeURIComponent(row.ff4_number)}` : undefined,
      }))
    }

    let departments: Array<{ id: string; name: string }> = []
    let sections: Array<{ id: string; department_id: string | null; name: string }> = []
    if (scope.mode === 'SECTION') {
      departments = scope.department ? [scope.department] : []
      sections = scope.section ? [{ ...scope.section, department_id: scope.departmentId }] : []
    } else {
      const [departmentResult, sectionResult] = await Promise.all([
        supabase.from('departments').select('id, name').eq('is_active', true).order('name'),
        supabase.from('sections').select('id, department_id, name').eq('is_active', true).order('name'),
      ])
      if (departmentResult.error) throw departmentResult.error
      if (sectionResult.error) throw sectionResult.error
      departments = departmentResult.data || []
      sections = sectionResult.data || []
    }

    return NextResponse.json({
      report,
      title,
      financialYear,
      scope,
      appliedFilters: {
        departmentId,
        sectionId,
        costCentreId,
        expenseCodeRegistryId,
        fundingSourceId,
        status,
        startDate,
        endDate,
      },
      columns,
      rows,
      totals,
      lookups: { departments, sections },
    })
  } catch (error) {
    console.error('Unable to load scoped management report:', error)
    return NextResponse.json({ error: 'Unable to load management report for the assigned scope.' }, { status: 500 })
  }
}
