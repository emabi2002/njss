import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, getServerAccessContext, hasAnyServerPermission } from '@/lib/rbac/server'
import { resolveManagementReportScope } from '@/lib/reports/management-scope'
import type { BudgetPositionRow } from '@/lib/head-office-budget'

export const dynamic = 'force-dynamic'
const REPORT_IDS = new Set(['management-financial-summary', 'division-financial-position', 'section-financial-position', 'ledger-financial-position', 'ff3-ff4-transaction-trace'])
const MONEY_KEYS = ['original_budget', 'supplementary_adjustments', 'reallocations_in', 'reallocations_out', 'current_approved_budget', 'outstanding_commitments', 'actual_expenditure', 'available_budget'] as const
const moneyColumns = MONEY_KEYS.map(key => ({ key, label: key.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()) + ' (K)', kind: 'money' }))
const numberValue = (value: unknown) => Number(value ?? 0)

export async function GET(request: NextRequest) {
  const context = await getServerAccessContext(request)
  if (!context) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!hasAnyServerPermission(context, ['reports.view', 'budget.report.view'])) return NextResponse.json({ error: 'Management report access denied' }, { status: 403 })
  const params = request.nextUrl.searchParams
  const report = params.get('report') || 'management-financial-summary'
  const lookupsOnly = params.get('lookupsOnly') === '1'
  if (!REPORT_IDS.has(report)) return NextResponse.json({ error: 'Unsupported management report' }, { status: 400 })
  if (['provinceId', 'fundingSourceId', 'costCentreId', 'expenseCodeRegistryId'].some(key => params.get(key))) return NextResponse.json({ error: 'Legacy report filters are unsupported.' }, { status: 400 })
  const requestedYear = params.get('financialYear')
  if (requestedYear !== null && (!Number.isInteger(Number(requestedYear)) || Number(requestedYear) < 2000 || Number(requestedYear) > 2200)) return NextResponse.json({ error: 'Invalid financial year' }, { status: 400 })
  const supabase = createRequestSupabaseClient(request)
  try {
    const scope = await resolveManagementReportScope(supabase, context)
    const [locations, divisionsResult, sectionsResult, ledgersResult, cyclesResult] = await Promise.all([
      supabase.from('court_locations').select('id').eq('location_type', 'HEADQUARTERS').eq('is_active', true),
      supabase.from('departments').select('id, name, court_location_id').eq('is_active', true).order('name'),
      supabase.from('sections').select('id, department_id, name').eq('is_active', true).order('name'),
      supabase.from('expense_ledger').select('id, ledger_number, standard_description').eq('is_active', true).eq('is_posting', true).order('ledger_number'),
      supabase.from('annual_budget_cycles').select('id, financial_year, status').order('financial_year', { ascending: false }),
    ])
    for (const result of [locations, divisionsResult, sectionsResult, ledgersResult, cyclesResult]) if (result.error) throw result.error
    const cycles = (cyclesResult.data || []).slice().sort((a, b) => b.financial_year - a.financial_year)
    const defaultCycle = cycles.find(cycle => cycle.status === 'ACTIVE') || cycles[0]
    const financialYear = requestedYear !== null ? Number(requestedYear) : defaultCycle?.financial_year || new Date().getFullYear()
    const budgetCycle = cycles.find(cycle => cycle.financial_year === financialYear) || null
    const budgetNotice = !budgetCycle ? `No annual budget cycle exists for FY${financialYear}.` : budgetCycle.status !== 'ACTIVE' ? `FY${financialYear} annual budget is ${budgetCycle.status.replaceAll('_', ' ').toLowerCase()}. There is no active approved budget position for this year. Review preparation budgets in the annual budget workspace.` : null
    const hqIds = new Set((locations.data || []).map(row => row.id))
    const departments = (divisionsResult.data || []).filter(row => hqIds.has(row.court_location_id) && (scope.mode !== 'SECTION' || row.id === scope.departmentId)).map(row => ({ id: row.id, name: row.name, province_id: null }))
    const divisionIds = new Set(departments.map(row => row.id))
    const sections = (sectionsResult.data || []).filter(row => divisionIds.has(row.department_id || '') && (scope.mode !== 'SECTION' || row.id === scope.sectionId))
    const ledgers = ledgersResult.data || []
    let departmentId = params.get('divisionId') || params.get('departmentId') || null
    let sectionId = params.get('sectionId') || null
    const expenseLedgerId = params.get('expenseLedgerId') || null
    if (scope.mode === 'SECTION') {
      if ((departmentId && departmentId !== scope.departmentId) || (sectionId && sectionId !== scope.sectionId)) return NextResponse.json({ error: 'Requested organisation is outside your reporting scope.' }, { status: 403 })
      departmentId = scope.departmentId
      sectionId = scope.sectionId
    }
    const selectedSection = sections.find(row => row.id === sectionId)
    if ((departmentId && !divisionIds.has(departmentId)) || (sectionId && !selectedSection) || (selectedSection && departmentId && selectedSection.department_id !== departmentId) || (expenseLedgerId && !ledgers.some(row => row.id === expenseLedgerId))) return NextResponse.json({ error: 'Requested filters are outside active Head Office reference data.' }, { status: 400 })
    if (selectedSection && !departmentId) departmentId = selectedSection.department_id
    const appliedFilters = { departmentId, sectionId, expenseLedgerId }
    const lookups = { provinces: [], departments, sections, ledgers }
    if (lookupsOnly) return NextResponse.json({ report: 'lookups', title: 'Head Office report filters', financialYear, scope, appliedFilters, columns: [], rows: [], lookups, budgetCycle, budgetNotice })
    const positionResult = budgetCycle?.status === 'ACTIVE' ? await supabase.rpc('get_current_budget_position', { p_financial_year: financialYear, p_division_id: departmentId, p_section_id: sectionId, p_expense_ledger_id: expenseLedgerId }) : { data: [], error: null }
    if (positionResult.error) throw positionResult.error
    // Defense in depth: the authenticated RPC and this allowlist both enforce scope.
    const positions = ((positionResult.data || []) as BudgetPositionRow[]).filter(row => divisionIds.has(row.division_id) && (!departmentId || row.division_id === departmentId) && (!sectionId || row.section_id === sectionId) && (!expenseLedgerId || row.expense_ledger_id === expenseLedgerId))
    let rows: Record<string, unknown>[] = []
    let columns: {key: string; label: string; kind?: string}[] = [{ key: 'name', label: 'Head Office' }, ...moneyColumns]
    let title = 'Head Office Annual Budget Position'
    const total = (group: BudgetPositionRow[]) => Object.fromEntries(MONEY_KEYS.map(key => [key, group.reduce((sum, row) => sum + numberValue(row[key]), 0)]))
    if (report === 'ff3-ff4-transaction-trace') {
      title = 'FF3 to FF4 Transaction Trace'
      // Select real FF3 identifiers by the canonical ledger, then preserve underlying posting linkage.
      let ff3Query = supabase.from('ff3_headers').select('id').eq('financial_year', financialYear).in('department_id', Array.from(divisionIds)).not('expense_ledger_id', 'is', null)
      if (departmentId) ff3Query = ff3Query.eq('department_id', departmentId)
      if (sectionId) ff3Query = ff3Query.eq('section_id', sectionId)
      if (expenseLedgerId) ff3Query = ff3Query.eq('expense_ledger_id', expenseLedgerId)
      const ff3Result = await ff3Query
      if (ff3Result.error) throw ff3Result.error
      const ids = (ff3Result.data || []).map(row => row.id)
      const traceResult = ids.length ? await supabase.from('v_ff3_ff4_transaction_trace').select('*').eq('financial_year', financialYear).in('ff3_header_id', ids).order('ff3_number') : { data: [], error: null }
      if (traceResult.error) throw traceResult.error
      const traceRows = traceResult.data || []
      columns = [{ key: 'ff3Number', label: 'FF3' }, { key: 'commitmentNumber', label: 'Commitment' }, { key: 'ff4Number', label: 'FF4' }, { key: 'supplierOrPayee', label: 'Supplier / Payee' }, { key: 'status', label: 'Status' }, { key: 'paymentDate', label: 'Payment date', kind: 'date' }, { key: 'paymentReference', label: 'Payment reference' }, { key: 'amount', label: 'Amount (K)', kind: 'money' }]
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
    } else {
      const dimension = report === 'division-financial-position' ? 'division_id' : report === 'section-financial-position' ? 'section_id' : report === 'ledger-financial-position' ? 'expense_ledger_id' : null
      const groups = new Map<string, BudgetPositionRow[]>()
      for (const row of positions) { const key = dimension === 'expense_ledger_id' ? `${row.division_id}:${row.section_id}:${row.expense_ledger_id}` : dimension ? row[dimension] : 'Head Office'; groups.set(key, [...(groups.get(key) || []), row]) }
      rows = Array.from(groups.entries()).map(([id, group]) => {
        const first = group[0]
        const name = dimension === 'division_id' ? departments.find(row => row.id === id)?.name : dimension === 'section_id' ? sections.find(row => row.id === id)?.name : dimension === 'expense_ledger_id' ? `${sections.find(row => row.id === first.section_id)?.name || first.section_id} — ${ledgers.find(row => row.id === first.expense_ledger_id)?.standard_description || first.expense_ledger_id}` : 'Head Office'
        const nextReport = !dimension ? 'division-financial-position' : dimension === 'division_id' ? 'section-financial-position' : dimension === 'section_id' ? 'ledger-financial-position' : 'ff3-ff4-transaction-trace'
        return { name: name || id, ...total(group), drilldown: { report: nextReport, params: { ...(departmentId ? { departmentId } : {}), ...(sectionId ? { sectionId } : {}), ...(dimension ? { departmentId: first.division_id } : {}), ...(dimension === 'section_id' || dimension === 'expense_ledger_id' ? { sectionId: first.section_id } : {}), ...(dimension === 'expense_ledger_id' ? { expenseLedgerId: first.expense_ledger_id } : {}) } } }
      })
    }
    return NextResponse.json({ report, title, financialYear, scope, appliedFilters, columns, rows, totals: budgetCycle?.status === 'ACTIVE' ? total(positions) : undefined, lookups, budgetCycle, budgetNotice })
  } catch (error) {
    console.error('Unable to load scoped Head Office report:', error)
    return NextResponse.json({ error: 'Unable to load management report for the assigned scope.' }, { status: 500 })
  }
}
