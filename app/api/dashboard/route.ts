import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, getServerAccessContext } from '@/lib/rbac/server'

export const dynamic = 'force-dynamic'

const NATIONAL_ROLES = new Set(['System Administrator', 'Registrar'])
const SUPERVISOR_ROLE = 'Line Supervisor'
const PENDING_FF3_STATUSES = ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD']
const PENDING_FF4_STATUSES = ['SUBMITTED', 'VERIFIED', 'PROCESSED']

function numberValue(value: unknown) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function sumRows(rows: Array<Record<string, unknown>>, key: string) {
  return rows.reduce((total, row) => total + numberValue(row[key]), 0)
}

async function resolveScopeLabel(
  supabase: ReturnType<typeof createRequestSupabaseClient>,
  context: NonNullable<Awaited<ReturnType<typeof getServerAccessContext>>>,
  national: boolean,
) {
  if (national) {
    return {
      mode: 'NATIONAL' as const,
      label: 'National Judiciary — All Provinces & Court Locations',
      province: null,
      courtLocation: null,
      department: null,
      section: null,
    }
  }

  const sectionId = context.sectionId
  const departmentId = context.departmentId
  if (!sectionId || !departmentId) {
    throw new Error('Line Supervisor is missing a Department or Section assignment.')
  }

  const [sectionResult, departmentResult] = await Promise.all([
    supabase.from('sections').select('id, name, department_id').eq('id', sectionId).maybeSingle(),
    supabase.from('departments').select('id, name, court_location_id').eq('id', departmentId).maybeSingle(),
  ])

  if (sectionResult.error) throw sectionResult.error
  if (departmentResult.error) throw departmentResult.error

  const department = departmentResult.data
  let courtLocation: { id: string; name: string; province_id: string | null } | null = null
  let province: { id: string; name: string } | null = null

  if (department?.court_location_id) {
    const locationResult = await supabase
      .from('court_locations')
      .select('id, name, province_id')
      .eq('id', department.court_location_id)
      .maybeSingle()
    if (locationResult.error) throw locationResult.error
    courtLocation = locationResult.data

    if (courtLocation?.province_id) {
      const provinceResult = await supabase
        .from('provinces')
        .select('id, name')
        .eq('id', courtLocation.province_id)
        .maybeSingle()
      if (provinceResult.error) throw provinceResult.error
      province = provinceResult.data
    }
  }

  const section = sectionResult.data
  const labelParts = [province?.name, courtLocation?.name, department?.name, section?.name].filter(Boolean)

  return {
    mode: 'SECTION' as const,
    label: labelParts.join(' › ') || 'Assigned Section',
    province: province ? { id: province.id, name: province.name } : null,
    courtLocation: courtLocation ? { id: courtLocation.id, name: courtLocation.name } : null,
    department: department ? { id: department.id, name: department.name } : null,
    section: section ? { id: section.id, name: section.name } : null,
  }
}

export async function GET(request: NextRequest) {
  const context = await getServerAccessContext(request)
  if (!context) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const hasDashboardAccess = context.permissions.includes('all') || context.permissions.includes('dashboard.view')
  if (!hasDashboardAccess) {
    return NextResponse.json({ error: 'Dashboard access denied' }, { status: 403 })
  }

  const national = context.roleNames.some((role) => NATIONAL_ROLES.has(role))
  const isSupervisor = context.roleNames.includes(SUPERVISOR_ROLE)
  if (!national && !isSupervisor) {
    return NextResponse.json({ error: 'Dashboard is limited to the Registrar, System Administrator and Line Supervisor.' }, { status: 403 })
  }

  if (isSupervisor && !national && !context.sectionId) {
    return NextResponse.json({ error: 'Line Supervisor has no assigned Section.' }, { status: 409 })
  }

  const requestedYear = Number(request.nextUrl.searchParams.get('financialYear') || new Date().getFullYear())
  const financialYear = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2200
    ? requestedYear
    : new Date().getFullYear()

  const supabase = createRequestSupabaseClient(request)

  try {
    const scope = await resolveScopeLabel(supabase, context, national)

    let positionQuery = supabase
      .from('v_authoritative_budget_position')
      .select('budget_allocation_id, section_id, approved_budget, funded_amount, released_amount, pending_amount, outstanding_commitment, actual_expenditure, available_amount, unfunded_amount, unreleased_funding, projected_available_after_pending')
      .eq('financial_year', financialYear)

    let expenditureQuery = supabase
      .from('v_quarterly_expenditure_summary')
      .select('quarter, section_id, actual_expenditure')
      .eq('financial_year', financialYear)

    let costCentreQuery = supabase
      .from('v_cost_centre_financial_position')
      .select('section_id, cost_centre_code, cost_centre_name, section_name, approved_budget, available_balance')
      .eq('financial_year', financialYear)

    let pendingFf3Query = supabase
      .from('ff3_headers')
      .select('ff3_number, purpose, total_estimated_amount, status, urgency_level, created_at, section_id, section:sections(name)')
      .eq('financial_year', financialYear)
      .in('status', PENDING_FF3_STATUSES)
      .order('created_at', { ascending: false })
      .limit(5)

    let ff3StatusQuery = supabase
      .from('ff3_headers')
      .select('status, section_id')
      .eq('financial_year', financialYear)

    let ff4StatusQuery = supabase
      .from('ff4_headers')
      .select('status, section_id')
      .eq('financial_year', financialYear)

    if (!national) {
      positionQuery = positionQuery.eq('section_id', context.sectionId)
      expenditureQuery = expenditureQuery.eq('section_id', context.sectionId)
      costCentreQuery = costCentreQuery.eq('section_id', context.sectionId)
      pendingFf3Query = pendingFf3Query.eq('section_id', context.sectionId)
      ff3StatusQuery = ff3StatusQuery.eq('section_id', context.sectionId)
      ff4StatusQuery = ff4StatusQuery.eq('section_id', context.sectionId)
    }

    const [yearsResult, positionResult, expenditureResult, costCentreResult, pendingFf3Result, ff3StatusResult, ff4StatusResult] = await Promise.all([
      supabase.from('financial_years').select('year').order('year', { ascending: false }),
      positionQuery,
      expenditureQuery,
      costCentreQuery,
      pendingFf3Query,
      ff3StatusQuery,
      ff4StatusQuery,
    ])

    const firstError = [positionResult, expenditureResult, costCentreResult, pendingFf3Result, ff3StatusResult, ff4StatusResult]
      .find((result) => result.error)?.error
    if (firstError) throw firstError

    const positions = (positionResult.data || []) as Array<Record<string, unknown>>
    const budgetAllocationIds = Array.from(new Set(
      positions
        .map((row) => String(row.budget_allocation_id || ''))
        .filter(Boolean),
    ))

    let releases: Array<{ quarter: number | null; released_amount: number | null }> = []
    if (national || budgetAllocationIds.length > 0) {
      let releaseQuery = supabase
        .from('quarterly_releases')
        .select('quarter, released_amount, budget_allocation_id')
        .eq('financial_year', financialYear)
        .order('quarter')
      if (!national) releaseQuery = releaseQuery.in('budget_allocation_id', budgetAllocationIds)
      const releaseResult = await releaseQuery
      if (releaseResult.error) throw releaseResult.error
      releases = (releaseResult.data || []) as Array<{ quarter: number | null; released_amount: number | null }>
    }

    let budgetSubmissions: Array<{ status: string | null; total_proposed_budget: number | null }> = []
    if (national) {
      const budgetResult = await supabase
        .from('divisional_budget_submissions')
        .select('status, total_proposed_budget')
        .eq('budget_year', financialYear)
      if (budgetResult.error) throw budgetResult.error
      budgetSubmissions = budgetResult.data || []
    } else {
      const divisionResult = await supabase
        .from('budget_divisions')
        .select('id, section_id')
        .eq('section_id', context.sectionId)
        .eq('is_active', true)
      if (divisionResult.error) throw divisionResult.error
      const divisionIds = (divisionResult.data || []).map((row) => row.id)
      if (divisionIds.length) {
        const budgetResult = await supabase
          .from('divisional_budget_submissions')
          .select('status, total_proposed_budget, division_id')
          .eq('budget_year', financialYear)
          .in('division_id', divisionIds)
        if (budgetResult.error) throw budgetResult.error
        budgetSubmissions = budgetResult.data || []
      }
    }

    const ff3Statuses = (ff3StatusResult.data || []).map((row) => String(row.status || ''))
    const ff4Statuses = (ff4StatusResult.data || []).map((row) => String(row.status || ''))
    const expenditures = (expenditureResult.data || []) as Array<{ quarter?: number | null; actual_expenditure?: number | null }>

    const summary = {
      approvedBudget: sumRows(positions, 'approved_budget'),
      fundedAmount: sumRows(positions, 'funded_amount'),
      releasedAmount: sumRows(positions, 'released_amount'),
      pendingFF3: sumRows(positions, 'pending_amount'),
      outstandingCommitments: sumRows(positions, 'outstanding_commitment'),
      actualExpenditure: sumRows(positions, 'actual_expenditure'),
      availableBalance: sumRows(positions, 'available_amount'),
      unfundedBudget: sumRows(positions, 'unfunded_amount'),
      unreleasedFunding: sumRows(positions, 'unreleased_funding'),
      projectedAvailableAfterPending: sumRows(positions, 'projected_available_after_pending'),
    }

    const quarterlyData = [1, 2, 3, 4].map((quarter) => ({
      quarter: `Q${quarter}`,
      released: releases
        .filter((row) => Number(row.quarter) === quarter)
        .reduce((total, row) => total + numberValue(row.released_amount), 0),
      spent: expenditures
        .filter((row) => Number(row.quarter) === quarter)
        .reduce((total, row) => total + numberValue(row.actual_expenditure), 0),
    }))

    const centreSpend = ((costCentreResult.data || []) as Array<Record<string, unknown>>)
      .map((row) => ({
        name: String(row.cost_centre_code || row.cost_centre_name || row.section_name || 'Unassigned'),
        approved: numberValue(row.approved_budget),
        available: numberValue(row.available_balance),
      }))
      .sort((a, b) => b.approved - a.approved)
      .slice(0, 6)

    const budgetPrepStats = {
      draft: budgetSubmissions.filter((row) => row.status === 'DRAFT').length,
      submitted: budgetSubmissions.filter((row) => row.status === 'SUBMITTED' || row.status === 'RESUBMITTED').length,
      returned: budgetSubmissions.filter((row) => row.status === 'RETURNED').length,
      reviewed: budgetSubmissions.filter((row) => row.status === 'REVIEWED').length,
      approved: budgetSubmissions.filter((row) => row.status === 'APPROVED').length,
      approvedValue: budgetSubmissions
        .filter((row) => row.status === 'APPROVED')
        .reduce((total, row) => total + numberValue(row.total_proposed_budget), 0),
    }

    const pendingFF3s = ((pendingFf3Result.data || []) as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      daysWaiting: Math.max(0, Math.floor((Date.now() - new Date(String(row.created_at)).getTime()) / 86_400_000)),
    }))

    const ff3Stats = {
      total: ff3Statuses.length,
      pending: ff3Statuses.filter((status) => PENDING_FF3_STATUSES.includes(status)).length,
      approved: ff3Statuses.filter((status) => status === 'APPROVED' || status === 'COMMITTED').length,
      rejected: ff3Statuses.filter((status) => status === 'REJECTED').length,
    }

    const ff4Stats = {
      total: ff4Statuses.length,
      pending: ff4Statuses.filter((status) => PENDING_FF4_STATUSES.includes(status)).length,
      paid: ff4Statuses.filter((status) => status === 'PAID').length,
      reconciled: ff4Statuses.filter((status) => status === 'RECONCILED').length,
    }

    const availableFinancialYears = Array.from(new Set([
      financialYear,
      ...((yearsResult.data || []) as Array<{ year?: number | null }>)
        .map((row) => Number(row.year))
        .filter((year) => Number.isInteger(year)),
    ])).sort((a, b) => b - a)

    return NextResponse.json({
      financialYear,
      availableFinancialYears,
      scope,
      summary,
      quarterlyData,
      centreSpend,
      budgetPrepStats,
      pendingFF3s,
      ff3Stats,
      ff4Stats,
    })
  } catch (error) {
    console.error('Unable to load scoped dashboard data:', error)
    return NextResponse.json({ error: 'Unable to load dashboard data for the assigned scope.' }, { status: 500 })
  }
}
