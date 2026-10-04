import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, getServerAccessContext, hasServerPermission } from '@/lib/rbac/server'
import { isRecordInScope } from '@/lib/rbac/scope'

export const dynamic = 'force-dynamic'
const HEAD_OFFICE_ROLES = new Set(['System Administrator', 'Registrar'])
const PENDING_FF3_STATUSES = ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD']
const PENDING_FF4_STATUSES = ['SUBMITTED', 'VERIFIED', 'PROCESSED']
const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const sum = (rows: Array<Record<string, unknown>>, key: string) => rows.reduce((total, row) => total + numeric(row[key]), 0)

export async function GET(request: NextRequest) {
  const context = await getServerAccessContext(request)
  if (!context) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!hasServerPermission(context, 'dashboard.view')) return NextResponse.json({ error: 'Dashboard access denied' }, { status: 403 })
  const headOffice = context.roleNames.some((role) => HEAD_OFFICE_ROLES.has(role))
    && (context.permissions.includes('all') || context.scopes.some((scope) => scope.scope_type === 'SYSTEM_WIDE'))
  if (!headOffice && !context.roleNames.includes('Line Supervisor')) {
    return NextResponse.json({ error: 'Dashboard is limited to the Registrar, System Administrator and Line Supervisor.' }, { status: 403 })
  }
  if (!headOffice && (!context.departmentId || !context.sectionId)) {
    return NextResponse.json({ error: 'Line Supervisor has no assigned Division or Section.' }, { status: 409 })
  }
  const yearParameter = request.nextUrl.searchParams.get('financialYear')
  const requestedYear = Number(yearParameter)
  const supabase = createRequestSupabaseClient(request)
  try {
    const divisionsResult = await supabase.from('departments')
      .select('id, name, court_location:court_locations!inner(location_type, is_active)')
      .eq('court_location.location_type', 'HEADQUARTERS')
      .eq('court_location.is_active', true)
      .eq('is_active', true)
    if (divisionsResult.error) throw divisionsResult.error
    const divisions = (divisionsResult.data || []).filter((row) => headOffice || row.id === context.departmentId)
    const divisionIds = divisions.map((row) => row.id)
    if (!headOffice && !divisionIds.length) return NextResponse.json({ error: 'Assigned Division is outside Head Office.' }, { status: 403 })
    const sectionsResult = divisionIds.length
      ? await supabase.from('sections').select('id, name, department_id').in('department_id', divisionIds)
      : { data: [], error: null }
    if (sectionsResult.error) throw sectionsResult.error
    const sections = (sectionsResult.data || []).filter((row) => headOffice || row.id === context.sectionId)
    const sectionIds = sections.map((row) => row.id)
    if (!headOffice && !sectionIds.length) return NextResponse.json({ error: 'Assigned Section does not belong to the Head Office Division.' }, { status: 403 })
    const scope = { mode: headOffice ? 'HEAD_OFFICE' : 'SECTION', label: headOffice ? 'Head Office — All Divisions' : `Head Office › ${divisions[0].name} › ${sections[0].name}` }
    const cyclesResult = await supabase.from('annual_budget_cycles').select('id, financial_year, status').order('financial_year', { ascending: false })
    if (cyclesResult.error) throw cyclesResult.error
    const defaultCycle = (cyclesResult.data || []).find((row) => row.status === 'ACTIVE') || cyclesResult.data?.[0]
    const financialYear = yearParameter && Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2200 ? requestedYear : defaultCycle?.financial_year || new Date().getFullYear()
    const [positionResult, budgetsResult, ff3Result, ff4Result] = await Promise.all([
      supabase.rpc('get_current_budget_position', { p_financial_year: financialYear, p_division_id: headOffice ? null : context.departmentId, p_section_id: headOffice ? null : context.sectionId, p_expense_ledger_id: null }),
      divisionIds.length ? supabase.from('division_budgets').select('id, status, division_id, lines:division_budget_lines(section_id, original_amount)').eq('financial_year', financialYear).in('division_id', divisionIds) : Promise.resolve({ data: [], error: null }),
      sectionIds.length ? supabase.from('ff3_headers').select('ff3_number, purpose, total_estimated_amount, status, urgency_level, created_at, section_id, requesting_officer_id, created_by').eq('financial_year', financialYear).in('section_id', sectionIds).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
      sectionIds.length ? supabase.from('ff4_headers').select('status, section_id, created_by').eq('financial_year', financialYear).in('section_id', sectionIds) : Promise.resolve({ data: [], error: null }),
    ])
    const error = [cyclesResult, positionResult, budgetsResult, ff3Result, ff4Result].find((result) => result.error)?.error
    if (error) throw error
    const cycle = (cyclesResult.data || []).find((row) => row.financial_year === financialYear)
    const positions = cycle?.status === 'ACTIVE' ? ((positionResult.data || []) as Array<Record<string, unknown>>).filter((row) => divisionIds.includes(String(row.division_id)) && sectionIds.includes(String(row.section_id))) : []
    const summary = { originalBudget: sum(positions, 'original_budget'), supplementaryAdjustments: sum(positions, 'supplementary_adjustments'), netReallocations: sum(positions, 'reallocations_in') - sum(positions, 'reallocations_out'), approvedBudget: sum(positions, 'current_approved_budget'), outstandingCommitments: sum(positions, 'outstanding_commitments'), actualExpenditure: sum(positions, 'actual_expenditure'), availableBalance: sum(positions, 'available_budget') }
    const budgets = budgetsResult.data || []
    const budgetPrepStats = { draft: budgets.filter((row) => row.status === 'DRAFT').length, pendingApproval: budgets.filter((row) => row.status === 'PENDING_REGISTRAR_APPROVAL').length, returned: budgets.filter((row) => row.status === 'RETURNED').length, locked: budgets.filter((row) => row.status === 'LOCKED').length, draftOriginalValue: budgets.filter((row) => row.status === 'DRAFT' || row.status === 'RETURNED').reduce((total, row) => total + (row.lines || []).filter((line) => sectionIds.includes(line.section_id)).reduce((amount, line) => amount + numeric(line.original_amount), 0), 0) }
    const recordScope = (row: { section_id: string | null; requesting_officer_id?: string | null; created_by?: string | null }) => isRecordInScope(context, { ...row, department_id: sections.find((section) => section.id === row.section_id)?.department_id, division_id: sections.find((section) => section.id === row.section_id)?.department_id })
    const ff3 = (ff3Result.data || []).filter(recordScope)
    const ff4 = (ff4Result.data || []).filter(recordScope)
    const pendingFF3s = ff3.filter((row) => PENDING_FF3_STATUSES.includes(row.status)).slice(0, 5).map((row) => ({ ...row, daysWaiting: Math.max(0, Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86_400_000)) }))
    const centreSpend = divisions.map((division) => ({ name: division.name, approved: sum(positions.filter((row) => row.division_id === division.id), 'current_approved_budget'), available: sum(positions.filter((row) => row.division_id === division.id), 'available_budget') })).filter((row) => row.approved !== 0 || row.available !== 0).sort((a, b) => b.approved - a.approved).slice(0, 6)
    return NextResponse.json({ financialYear, availableFinancialYears: [...new Set([financialYear, ...(cyclesResult.data || []).map((row) => row.financial_year)])].sort((a, b) => b - a), cycleStatus: cycle?.status || null, scope, summary, centreSpend, budgetPrepStats, pendingFF3s, ff3Stats: { total: ff3.length, pending: ff3.filter((row) => PENDING_FF3_STATUSES.includes(row.status)).length, approved: ff3.filter((row) => ['APPROVED', 'COMMITTED'].includes(row.status)).length, rejected: ff3.filter((row) => row.status === 'REJECTED').length }, ff4Stats: { total: ff4.length, pending: ff4.filter((row) => PENDING_FF4_STATUSES.includes(row.status)).length, paid: ff4.filter((row) => row.status === 'PAID').length, reconciled: ff4.filter((row) => row.status === 'RECONCILED').length } })
  } catch (error) {
    console.error('Unable to load scoped dashboard data:', error)
    return NextResponse.json({ error: 'Unable to load dashboard data for the assigned scope.' }, { status: 500 })
  }
}
