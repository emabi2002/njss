import { supabase } from './supabase'
import type {
  Department, Section, Role, Province, FundingSource, ChartOfAccount
} from './supabase'
import { filterRowsToCurrentScope } from './rbac/scope'

// ==========================================
// MASTER DATA
// ==========================================

export async function getDepartments() {
  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('is_active', true)
    .order('name')

  if (error) throw error
  return data as Department[]
}

export async function getSections(departmentId?: string) {
  let query = supabase
    .from('sections')
    .select('*')
    .eq('is_active', true)
    .order('name')

  if (departmentId) {
    query = query.eq('department_id', departmentId)
  }

  const { data, error } = await query
  if (error) throw error
  return data as Section[]
}

export async function getRoles() {
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .eq('is_active', true)
    .order('name')

  if (error) throw error
  return data as Role[]
}

export async function getProvinces() {
  const { data, error } = await supabase
    .from('provinces')
    .select('*')
    .eq('is_active', true)
    .order('name')

  if (error) throw error
  return data as Province[]
}

export async function getFundingSources() {
  const { data, error } = await supabase
    .from('funding_sources')
    .select('*')
    .eq('is_active', true)
    .order('name')

  if (error) throw error
  return data as FundingSource[]
}

export async function getChartOfAccounts() {
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('*')
    .eq('is_active', true)
    .order('account_code')

  if (error) throw error
  return data as ChartOfAccount[]
}

// ==========================================
// BUDGET
// ==========================================

export async function getBudgetAllocations(financialYear: number) {
  const { data, error } = await supabase
    .from('budget_allocations')
    .select(`
      *,
      department:departments(code, name),
      section:sections(code, name),
      account:chart_of_accounts(account_code, account_name),
      funding_source:funding_sources(code, name)
    `)
    .eq('financial_year', financialYear)
    .eq('is_active', true)

  if (error) throw error
  return data
}

export async function getQuarterlyReleases(financialYear: number) {
  const { data, error } = await supabase
    .from('quarterly_releases')
    .select('*')
    .eq('financial_year', financialYear)
    .order('quarter')

  if (error) throw error
  return data
}

export async function getBudgetSummary(financialYear: number) {
  const { data: allocations, error: allocError } = await supabase
    .from('budget_allocations')
    .select('original_budget, supplemental_budget')
    .eq('financial_year', financialYear)
    .eq('is_active', true)

  if (allocError) throw allocError

  const { data: releases, error: relError } = await supabase
    .from('quarterly_releases')
    .select('released_amount')
    .eq('financial_year', financialYear)

  if (relError) throw relError

  // NOTE: do NOT filter by status here. Actual expenditure must include the
  // paid amounts of FULLY_PAID commitments, otherwise "spent" is under-counted.
  const { data: commitments, error: comError } = await supabase
    .from('ff3_commitments')
    .select('committed_amount, paid_amount, status')
    .eq('financial_year', financialYear)

  if (comError) throw comError

  const totalBudget = allocations?.reduce((sum, a) => sum + (a.original_budget || 0) + (a.supplemental_budget || 0), 0) || 0
  const quarterlyReleased = releases?.reduce((sum, r) => sum + (r.released_amount || 0), 0) || 0
  // Outstanding (still-committed but unpaid) portion — excludes cancelled commitments
  const committedAmount = commitments?.reduce((sum, c) =>
    sum + (c.status === 'CANCELLED' ? 0 : (c.committed_amount || 0) - (c.paid_amount || 0)), 0) || 0
  // Actual expenditure = everything paid, regardless of commitment status
  const actualExpenditure = commitments?.reduce((sum, c) => sum + (c.paid_amount || 0), 0) || 0
  const availableBalance = quarterlyReleased - committedAmount - actualExpenditure

  return {
    totalBudget,
    quarterlyReleased,
    committedAmount,
    actualExpenditure,
    availableBalance
  }
}

// ==========================================
// FF3 REQUISITIONS
// ==========================================

export async function getFF3List(filters?: { status?: string; financialYear?: number }) {
  let query = supabase
    .from('ff3_headers')
    .select(`
      *,
      department:departments(code, name),
      section:sections(code, name)
    `)
    .order('created_at', { ascending: false })

  if (filters?.status && filters.status !== 'ALL') {
    query = query.eq('status', filters.status)
  }

  if (filters?.financialYear) {
    query = query.eq('financial_year', filters.financialYear)
  }

  const { data, error } = await query
  if (error) throw error
  return filterRowsToCurrentScope(data)
}

export async function getFF3Detail(ff3Number: string) {
  const { data: header, error: headerError } = await supabase
    .from('ff3_headers')
    .select(`
      *,
      department:departments(code, name),
      section:sections(code, name),
      province:provinces(code, name),
      funding_source:funding_sources(code, name)
    `)
    .eq('ff3_number', ff3Number)
    .single()

  if (headerError) throw headerError

  const { data: items, error: itemsError } = await supabase
    .from('ff3_items')
    .select('*')
    .eq('ff3_header_id', header.id)
    .order('line_number')

  if (itemsError) throw itemsError

  const { data: quotations, error: quotError } = await supabase
    .from('ff3_quotations')
    .select('*')
    .eq('ff3_header_id', header.id)

  if (quotError) throw quotError

  return { header, items, quotations }
}

export async function createFF3(data: {
  financial_year: number
  department_id: string
  section_id: string
  purpose: string
  justification: string
  urgency_level: string
  items: Array<{
    item_description: string
    quantity: number
    estimated_unit_price: number
    unit_of_measure?: string
  }>
  quotations: Array<{
    supplier_name: string
    quotation_amount: number
    quotation_number?: string
    quotation_date?: string
    is_selected?: boolean
  }>
}) {
  // Insert header
  const { data: header, error: headerError } = await supabase
    .from('ff3_headers')
    .insert({
      financial_year: data.financial_year,
      department_id: data.department_id,
      section_id: data.section_id,
      purpose: data.purpose,
      justification: data.justification,
      urgency_level: data.urgency_level,
      status: 'DRAFT',
      total_estimated_amount: data.items.reduce((sum, i) => sum + (i.quantity * i.estimated_unit_price), 0)
    })
    .select()
    .single()

  if (headerError) throw headerError

  // Insert items
  const itemsToInsert = data.items.map((item, index) => ({
    ff3_header_id: header.id,
    line_number: index + 1,
    item_description: item.item_description,
    quantity: item.quantity,
    estimated_unit_price: item.estimated_unit_price,
    unit_of_measure: item.unit_of_measure
  }))

  const { error: itemsError } = await supabase
    .from('ff3_items')
    .insert(itemsToInsert)

  if (itemsError) throw itemsError

  // Insert quotations
  const quotsToInsert = data.quotations.map(q => ({
    ff3_header_id: header.id,
    supplier_name: q.supplier_name,
    quotation_amount: q.quotation_amount,
    quotation_number: q.quotation_number,
    quotation_date: q.quotation_date,
    is_selected: q.is_selected || false
  }))

  const { error: quotsError } = await supabase
    .from('ff3_quotations')
    .insert(quotsToInsert)

  if (quotsError) throw quotsError

  return header
}

// ==========================================
// FF3 COMMITMENTS
// ==========================================

export async function getCommitments(financialYear: number) {
  const { data, error } = await supabase
    .from('ff3_commitments')
    .select(`
      *,
      ff3:ff3_headers(ff3_number, purpose)
    `)
    .eq('financial_year', financialYear)
    .order('created_at', { ascending: false })

  if (error) throw error
  return filterRowsToCurrentScope(data)
}

// ==========================================
// FF4 EXPENSES
// ==========================================

export async function getFF4List(filters?: { status?: string; financialYear?: number }) {
  let query = supabase
    .from('ff4_headers')
    .select(`
      *,
      ff3:ff3_headers(ff3_number),
      commitment:ff3_commitments(commitment_number)
    `)
    .order('created_at', { ascending: false })

  if (filters?.status && filters.status !== 'ALL') {
    query = query.eq('status', filters.status)
  }

  if (filters?.financialYear) {
    query = query.eq('financial_year', filters.financialYear)
  }

  const { data, error } = await query
  if (error) throw error
  return filterRowsToCurrentScope(data)
}

export async function getPendingApprovals() {
  const { data: ff3Pending, error: ff3Error } = await supabase
    .from('ff3_headers')
    .select(`
      *,
      department:departments(name),
      section:sections(name)
    `)
    .in('status', ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD'])
    .order('created_at', { ascending: false })
    .limit(5)

  if (ff3Error) throw ff3Error

  const { data: ff4Pending, error: ff4Error } = await supabase
    .from('ff4_headers')
    .select('*')
    .in('status', ['SUBMITTED', 'VERIFIED'])
    .order('created_at', { ascending: false })
    .limit(5)

  if (ff4Error) throw ff4Error

  const scopedFF3Pending = await filterRowsToCurrentScope(ff3Pending)
  const scopedFF4Pending = await filterRowsToCurrentScope(ff4Pending)
  return { ff3Pending: scopedFF3Pending, ff4Pending: scopedFF4Pending }
}

// ==========================================
// FF3 APPROVAL WORKFLOW
// ==========================================

export type FF3ApprovalAction = 'ENDORSE_SUPERVISOR' | 'ENDORSE_SECTION_HEAD' | 'APPROVE' | 'REJECT'

export async function approveFF3(
  ff3Id: string,
  action: FF3ApprovalAction,
  comments?: string
) {
  const response = await fetch('/api/workflows/ff3', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ff3Id, action, comments }),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || 'FF3 workflow action failed')
  return json.header
}

export async function getFF3Approvals(ff3Id: string) {
  const { data, error } = await supabase
    .from('ff3_approvals')
    .select('*')
    .eq('ff3_header_id', ff3Id)
    .order('action_date', { ascending: true })

  if (error) throw error
  return data
}

// ==========================================
// FF4 APPROVAL WORKFLOW
// ==========================================

export type FF4ApprovalAction = 'VERIFY' | 'APPROVE' | 'PROCESS' | 'MARK_PAID' | 'RECONCILE' | 'CANCEL'

export async function approveFF4(
  ff4Id: string,
  action: FF4ApprovalAction,
  paymentReference?: string,
  comments?: string
) {
  const response = await fetch('/api/workflows/ff4', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ff4Id, action, paymentReference, comments }),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || 'FF4 workflow action failed')
  return json.header
}

export async function getFF4Detail(ff4Number: string) {
  const { data: header, error: headerError } = await supabase
    .from('ff4_headers')
    .select(`
      *,
      ff3:ff3_headers(ff3_number, purpose),
      commitment:ff3_commitments(commitment_number, committed_amount, paid_amount)
    `)
    .eq('ff4_number', ff4Number)
    .single()

  if (headerError) throw headerError

  return header
}

// ==========================================
// CODE REGISTRY: cost centres, expense items, full codes, templates
// ==========================================

export async function getCostCentres(sectionId?: string) {
  let q = supabase.from('cost_centres').select('*, section:sections(name), department:departments(name)').eq('is_active', true).order('code')
  if (sectionId) q = q.eq('section_id', sectionId)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function createCostCentre(input: { code: string; name: string; department_id?: string | null; section_id?: string | null }) {
  const { data, error } = await supabase.from('cost_centres').insert(input).select().single()
  if (error) throw error
  return data
}

export async function getExpenseItems(categoryId?: string) {
  let q = supabase.from('expense_items').select('*, category:expense_categories(code, name)').eq('is_active', true).order('code')
  if (categoryId) q = q.eq('expense_category_id', categoryId)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function createExpenseItem(input: { expense_category_id: string; code: string; name: string; default_unit?: string }) {
  const { data, error } = await supabase.from('expense_items').insert(input).select().single()
  if (error) throw error
  return data
}

export async function getExpenseCodes(filters?: { financialYear?: number; sectionId?: string }) {
  let q = supabase
    .from('expense_code_registry')
    .select('*, department:departments(code, name), section:sections(code, name), cost_centre:cost_centres(code, name), category:expense_categories(code, name), item:expense_items(code, name)')
    .eq('is_active', true)
    .order('full_expense_code')
  if (filters?.financialYear) q = q.eq('financial_year', filters.financialYear)
  if (filters?.sectionId) q = q.eq('section_id', filters.sectionId)
  const { data, error } = await q
  if (error) throw error
  return data
}

// full_expense_code is generated by the DB trigger (DEPT-CC-CAT-ITEM)
export async function createExpenseCode(input: {
  financial_year?: number
  department_id: string
  section_id?: string | null
  cost_centre_id: string
  expense_category_id: string
  expense_item_id: string
  description?: string
}) {
  const { data, error } = await supabase
    .from('expense_code_registry')
    .insert({ ...input, full_expense_code: 'PENDING' }) // overwritten by trigger
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getActivityTemplates() {
  const { data, error } = await supabase.from('activity_templates').select('*, category:expense_categories(name)').eq('is_active', true).order('name')
  if (error) throw error
  return data
}

export async function getFinancialYears() {
  const { data, error } = await supabase.from('financial_years').select('*').order('year', { ascending: false })
  if (error) throw error
  return data
}

// ==========================================
// HISTORICAL ANNUAL ACTIVITY PLAN WORKFLOW (retired)
// New budgets use Budget Preparation: DRAFT → SUBMITTED/RESUBMITTED
// → REVIEWED → APPROVED, which creates operational allocations.
// ==========================================

export type PlanAction = 'SUBMIT' | 'REVIEW' | 'APPROVE_DEPARTMENT' | 'AUTHORIZE_REGISTRAR' | 'CONFIRM_BUDGET' | 'REJECT' | 'RETURN'

export async function transitionAnnualPlan(_planId: string, _action: PlanAction, _comments?: string) {
  void _planId
  void _action
  void _comments
  throw new Error('Annual Activity Plan workflow is retired. Use Budget Preparation for submission, review and approval.')
}

// Historical Annual Plan data is preserved read-only; Confirm to Budget is retired.
export async function confirmPlanToBudget(_planId: string) {
  void _planId
  throw new Error('Confirm to Budget is retired. Approval of an Excel Budget Preparation submission now creates operational allocations automatically.')
}

// ==========================================
// BUDGET CONSOLIDATION (approved Excel divisional budgets)
// ==========================================

export async function consolidateDepartmentBudget(financialYear: number, departmentId: string) {
  const { data, error } = await supabase.rpc('consolidate_approved_excel_budgets', {
    p_financial_year: financialYear,
    p_department_id: departmentId,
  })
  if (error) throw error
  return data
}

export async function getConsolidations(financialYear: number) {
  const { data, error } = await supabase
    .from('budget_consolidations')
    .select('*, department:departments(code, name)')
    .eq('financial_year', financialYear)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getBudgetByCode(financialYear: number) {
  const { data, error } = await supabase.from('v_budget_by_code').select('*').eq('financial_year', financialYear)
  if (error) throw error
  return filterRowsToCurrentScope(data)
}

// ==========================================
// QUARTERLY BUDGET RELEASES (per budget allocation / expense code)
// ==========================================

// Allocations available to release against (with code, approved & released-so-far)
export async function getAllocationsForRelease(financialYear: number) {
  const { data: allocs, error } = await supabase
    .from('budget_allocations')
    .select('id, revised_budget, department_id, section_id, created_by, department:departments(code, name), section:sections(name), cost_centre:cost_centres(code, name), expense_code:expense_code_registry(full_expense_code)')
    .eq('financial_year', financialYear)
    .eq('is_active', true)
  if (error) throw error

  const scopedAllocs = await filterRowsToCurrentScope(allocs)

  const { data: releases } = await supabase
    .from('quarterly_releases')
    .select('budget_allocation_id, released_amount')
    .eq('financial_year', financialYear)
  const releasedByAlloc = new Map<string, number>()
  ;(releases || []).forEach((r) => {
    if (!r.budget_allocation_id) return
    releasedByAlloc.set(r.budget_allocation_id, (releasedByAlloc.get(r.budget_allocation_id) || 0) + (r.released_amount || 0))
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (scopedAllocs || []).map((a: any) => {
    const released = releasedByAlloc.get(a.id) || 0
    return {
      id: a.id,
      revised_budget: a.revised_budget || 0,
      released,
      releasable: Math.max(0, (a.revised_budget || 0) - released),
      department_name: a.department?.name || null,
      section_name: a.section?.name || null,
      cost_centre_code: a.cost_centre?.code || null,
      cost_centre_name: a.cost_centre?.name || null,
      full_expense_code: a.expense_code?.full_expense_code || null,
    }
  })
}

// All release lines for a year (from v_releases_by_code)
export async function getReleases(financialYear: number) {
  const { data, error } = await supabase
    .from('v_releases_by_code')
    .select('*')
    .eq('financial_year', financialYear)
    .order('release_date', { ascending: false })
  if (error) throw error
  return filterRowsToCurrentScope(data)
}

// Create a quarterly release; guards against releasing beyond the approved budget.
export async function createQuarterlyRelease(input: {
  budget_allocation_id: string
  financial_year: number
  quarter: number
  released_amount: number
  release_date?: string
}) {
  const response = await fetch('/api/workflows/budget', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'create-quarterly-release', input }),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || 'Quarterly release failed')
  return json.data
}

// ==========================================
// BUDGET AVAILABILITY CHECK (used by FF3)
// ==========================================

export async function checkBudgetAvailability(params: { financialYear: number; expenseCodeId?: string | null; sectionId?: string | null; amount: number }) {
  // Find allocations matching the expense code (preferred) or the section
  let q = supabase.from('budget_allocations').select('id, revised_budget').eq('financial_year', params.financialYear).eq('is_active', true)
  if (params.expenseCodeId) q = q.eq('expense_code_registry_id', params.expenseCodeId)
  else if (params.sectionId) q = q.eq('section_id', params.sectionId)
  const { data: allocs, error } = await q
  if (error) throw error

  const revised = (allocs || []).reduce((s, a) => s + (a.revised_budget || 0), 0)
  const allocIds = (allocs || []).map((a) => a.id)

  let released = 0
  let committed = 0
  let spent = 0
  if (allocIds.length > 0) {
    const { data: rels } = await supabase
      .from('quarterly_releases')
      .select('released_amount, budget_allocation_id')
      .in('budget_allocation_id', allocIds)
    released = (rels || []).reduce((s, r) => s + (r.released_amount || 0), 0)

    const { data: coms } = await supabase
      .from('ff3_commitments')
      .select('committed_amount, paid_amount, status, budget_allocation_id')
      .in('budget_allocation_id', allocIds)
    committed = (coms || []).reduce((s, c) => s + (c.status === 'CANCELLED' ? 0 : (c.committed_amount || 0) - (c.paid_amount || 0)), 0)
    spent = (coms || []).reduce((s, c) => s + (c.paid_amount || 0), 0)
  }

  // Cash-control available = released - committed - spent (spec formula).
  const available = released - committed - spent
  // Approved-ceiling available, for context.
  const approvedAvailable = revised - committed - spent
  return {
    revised,
    released,
    committed,
    spent,
    available,
    approvedAvailable,
    unreleased: revised - released,
    requested: params.amount,
    withinBudget: params.amount <= available,
    hasAllocation: allocIds.length > 0,
  }
}
