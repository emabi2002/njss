import { supabase } from './supabase'
import type {
  Department,
  Section,
  Role,
  Province,
  FundingSource,
  ChartOfAccount,
} from './supabase'
import { filterRowsToCurrentScope } from './rbac/scope'

export type AuthoritativeBudgetPosition = {
  budget_allocation_id: string
  financial_year: number
  department_id: string | null
  department_name: string | null
  section_id: string | null
  section_name: string | null
  cost_centre_id: string | null
  cost_centre_code: string | null
  cost_centre_name: string | null
  project_id?: string | null
  funding_source_id: string | null
  funding_source_code?: string | null
  funding_source_name?: string | null
  expense_code_registry_id: string | null
  full_expense_code: string | null
  approved_budget: number
  funded_amount: number
  released_amount: number
  pending_amount: number
  outstanding_commitment: number
  actual_expenditure: number
  available_amount: number
  unfunded_amount: number
  unreleased_funding: number
  revised_budget?: number
  committed_amount?: number
}

export type FundingAuthorityRow = {
  id: string
  authority_number: string | null
  financial_year: number
  authority_type: string
  funding_source_id: string | null
  funding_source_code?: string | null
  funding_source_name?: string | null
  source_agency: string | null
  source_department: string | null
  appropriation_reference: string | null
  warrant_number: string | null
  warrant_date: string | null
  donor_agreement_reference: string | null
  project_reference: string | null
  approved_amount: number
  effective_date: string
  expiry_date: string | null
  description: string | null
  status: string
  supporting_document_url: string | null
  supporting_document_name: string | null
  restricted_project_id?: string | null
  restricted_department_id?: string | null
  restricted_section_id?: string | null
  restricted_cost_centre_id?: string | null
  restricted_expense_code_registry_id?: string | null
  restriction_notes?: string | null
  approved_receipts?: number
  authority_remaining?: number
  approved_allocations?: number
  created_at: string
}

export type FundingReceiptRow = {
  id: string
  receipt_number: string | null
  financial_year: number
  funding_authority_id: string
  authority_number?: string | null
  authority_amount?: number
  funding_source_id: string | null
  funding_source_code?: string | null
  funding_source_name?: string | null
  receipt_date: string
  amount_received: number
  source_agency: string | null
  finance_ifms_reference: string | null
  external_reference: string | null
  bank_reference: string | null
  description: string | null
  supporting_document_url: string | null
  supporting_document_name: string | null
  status: string
  previous_approved_receipts?: number
  authority_balance_before_this_receipt?: number
  approved_allocations?: number
  receipt_unallocated_balance?: number
  created_at: string
}

export type FundingAllocationRow = {
  id: string
  allocation_number: string | null
  financial_year: number
  funding_receipt_id: string
  receipt_number?: string | null
  funding_authority_id: string | null
  authority_number?: string | null
  funding_source_id: string | null
  funding_source_code?: string | null
  funding_source_name?: string | null
  budget_allocation_id: string
  department_name?: string | null
  section_name?: string | null
  cost_centre_code?: string | null
  cost_centre_name?: string | null
  full_expense_code?: string | null
  approved_budget?: number
  allocated_amount: number
  allocation_date: string
  status: string
  notes: string | null
  released_from_allocation?: number
  allocation_unreleased_balance?: number
  created_at: string
}

export type FundingAuthorityInput = Partial<FundingAuthorityRow> & {
  financial_year: number
  authority_type: string
  approved_amount: number
  funding_source_id?: string | null
  effective_date?: string | null
}

export type FundingReceiptInput = {
  funding_authority_id: string
  receipt_date?: string | null
  amount_received: number
  source_agency?: string | null
  finance_ifms_reference?: string | null
  external_reference?: string | null
  bank_reference?: string | null
  description?: string | null
  supporting_document_url?: string | null
  supporting_document_name?: string | null
}

export type FundingAllocationInput = {
  funding_receipt_id: string
  budget_allocation_id: string
  allocated_amount: number
  allocation_date?: string | null
  notes?: string | null
}

export type BudgetReleaseFundingLineInput = {
  funding_allocation_id: string
  amount: number
}

async function postBudgetWorkflow<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/workflows/budget', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || 'Budget workflow operation failed')
  return json.data as T
}

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

  const { data: commitments, error: comError } = await supabase
    .from('ff3_commitments')
    .select('committed_amount, paid_amount, status')
    .eq('financial_year', financialYear)

  if (comError) throw comError

  const totalBudget =
    allocations?.reduce((sum, a) => sum + (a.original_budget || 0) + (a.supplemental_budget || 0), 0) || 0
  const quarterlyReleased = releases?.reduce((sum, r) => sum + (r.released_amount || 0), 0) || 0
  const committedAmount =
    commitments?.reduce(
      (sum, c) => sum + (c.status === 'CANCELLED' ? 0 : (c.committed_amount || 0) - (c.paid_amount || 0)),
      0
    ) || 0
  const actualExpenditure = commitments?.reduce((sum, c) => sum + (c.paid_amount || 0), 0) || 0
  const availableBalance = quarterlyReleased - committedAmount - actualExpenditure

  return {
    totalBudget,
    quarterlyReleased,
    committedAmount,
    actualExpenditure,
    availableBalance,
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
      total_estimated_amount: data.items.reduce((sum, i) => sum + i.quantity * i.estimated_unit_price, 0),
    })
    .select()
    .single()

  if (headerError) throw headerError

  const itemsToInsert = data.items.map((item, index) => ({
    ff3_header_id: header.id,
    line_number: index + 1,
    item_description: item.item_description,
    quantity: item.quantity,
    estimated_unit_price: item.estimated_unit_price,
    unit_of_measure: item.unit_of_measure,
  }))

  const { error: itemsError } = await supabase.from('ff3_items').insert(itemsToInsert)
  if (itemsError) throw itemsError

  const quotsToInsert = data.quotations.map((q) => ({
    ff3_header_id: header.id,
    supplier_name: q.supplier_name,
    quotation_amount: q.quotation_amount,
    quotation_number: q.quotation_number,
    quotation_date: q.quotation_date,
    is_selected: q.is_selected || false,
  }))

  const { error: quotsError } = await supabase.from('ff3_quotations').insert(quotsToInsert)
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

export async function approveFF3(ff3Id: string, action: FF3ApprovalAction, comments?: string) {
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
  let q = supabase
    .from('cost_centres')
    .select('*, section:sections(name), department:departments(name)')
    .eq('is_active', true)
    .order('code')
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
  let q = supabase
    .from('expense_items')
    .select('*, category:expense_categories(code, name)')
    .eq('is_active', true)
    .order('code')
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
    .insert({ ...input, full_expense_code: 'PENDING' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getActivityTemplates() {
  const { data, error } = await supabase
    .from('activity_templates')
    .select('*, category:expense_categories(name)')
    .eq('is_active', true)
    .order('name')
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

export type PlanAction =
  | 'SUBMIT'
  | 'REVIEW'
  | 'APPROVE_DEPARTMENT'
  | 'AUTHORIZE_REGISTRAR'
  | 'CONFIRM_BUDGET'
  | 'REJECT'
  | 'RETURN'

export async function transitionAnnualPlan(_planId: string, _action: PlanAction, _comments?: string) {
  void _planId
  void _action
  void _comments
  throw new Error('Annual Activity Plan workflow is retired. Use Budget Preparation for submission, review and approval.')
}

export async function confirmPlanToBudget(_planId: string) {
  void _planId
  throw new Error(
    'Confirm to Budget is retired. Approval of an Excel Budget Preparation submission now creates operational allocations automatically.'
  )
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
  const { data, error } = await supabase
    .from('v_authoritative_budget_position')
    .select('*')
    .eq('financial_year', financialYear)
  if (error) throw error
  const scoped = await filterRowsToCurrentScope(data)
  return (scoped || []).map((row) => {
    const r = row as AuthoritativeBudgetPosition
    return {
      ...r,
      revised_budget: r.approved_budget || 0,
      committed_amount: r.outstanding_commitment || 0,
    }
  })
}

// ==========================================
// QUARTERLY BUDGET RELEASES (per budget allocation / expense code)
// ==========================================

export async function getAllocationsForRelease(financialYear: number) {
  const [{ data: positionRows, error: positionError }, { data: fundingRows, error: fundingError }] = await Promise.all([
    supabase
      .from('v_authoritative_budget_position')
      .select('*')
      .eq('financial_year', financialYear),
    supabase
      .from('v_funding_allocation_register')
      .select('id, budget_allocation_id, allocation_number, allocated_amount, released_from_allocation, allocation_unreleased_balance, funding_source_code, funding_source_name, status')
      .eq('financial_year', financialYear)
      .eq('status', 'APPROVED'),
  ])
  if (positionError) throw positionError
  if (fundingError) throw fundingError

  const scopedRows = await filterRowsToCurrentScope(positionRows)
  const fundingByBudget = new Map<string, Array<{
    funding_allocation_id: string
    allocation_number: string | null
    funding_source_code: string | null
    funding_source_name: string | null
    allocated_amount: number
    released_from_allocation: number
    allocation_unreleased_balance: number
  }>>()

  for (const row of (fundingRows || []) as Array<{
    id: string
    budget_allocation_id: string
    allocation_number: string | null
    funding_source_code: string | null
    funding_source_name: string | null
    allocated_amount: number
    released_from_allocation: number | null
    allocation_unreleased_balance: number | null
  }>) {
    const remaining = row.allocation_unreleased_balance || 0
    if (remaining <= 0) continue
    const list = fundingByBudget.get(row.budget_allocation_id) || []
    list.push({
      funding_allocation_id: row.id,
      allocation_number: row.allocation_number,
      funding_source_code: row.funding_source_code,
      funding_source_name: row.funding_source_name,
      allocated_amount: row.allocated_amount || 0,
      released_from_allocation: row.released_from_allocation || 0,
      allocation_unreleased_balance: remaining,
    })
    fundingByBudget.set(row.budget_allocation_id, list)
  }

  return ((scopedRows || []) as AuthoritativeBudgetPosition[]).map((a) => ({
    id: a.budget_allocation_id,
    revised_budget: a.approved_budget || 0,
    funded: a.funded_amount || 0,
    released: a.released_amount || 0,
    unreleased_funding: a.unreleased_funding || 0,
    releasable: Math.max(0, Math.min((a.approved_budget || 0) - (a.released_amount || 0), a.unreleased_funding || 0)),
    funding_options: fundingByBudget.get(a.budget_allocation_id) || [],
    department_name: a.department_name || null,
    section_name: a.section_name || null,
    cost_centre_code: a.cost_centre_code || null,
    cost_centre_name: a.cost_centre_name || null,
    full_expense_code: a.full_expense_code || null,
  }))
}

export async function getReleases(financialYear: number) {
  const { data, error } = await supabase
    .from('v_releases_by_code')
    .select('*')
    .eq('financial_year', financialYear)
    .order('release_date', { ascending: false })
  if (error) throw error
  return filterRowsToCurrentScope(data)
}

export type QuarterlyReleaseResult = {
  id: string
  release_number: string | null
  budget_allocation_id: string
  financial_year: number
  quarter: number
  release_date: string
  released_amount: number
  funding_lines?: BudgetReleaseFundingLineInput[]
}
export async function createQuarterlyRelease(input: {
  budget_allocation_id: string
  financial_year: number
  quarter: number
  released_amount: number
  release_date?: string
  funding_lines: BudgetReleaseFundingLineInput[]
  notes?: string | null
}) {
  return postBudgetWorkflow<QuarterlyReleaseResult>({ operation: 'create-quarterly-release', input })
}

// ==========================================
// PHASE 1 FUNDING MANAGEMENT
// ==========================================

export async function getAuthoritativeBudgetPosition(financialYear: number) {
  const { data, error } = await supabase
    .from('v_authoritative_budget_position')
    .select('*')
    .eq('financial_year', financialYear)
    .order('department_name')
  if (error) throw error
  return filterRowsToCurrentScope(data) as Promise<AuthoritativeBudgetPosition[]>
}

export async function getFundingAuthorities(financialYear: number) {
  const { data, error } = await supabase
    .from('v_funding_authority_register')
    .select('*')
    .eq('financial_year', financialYear)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as FundingAuthorityRow[]
}

export async function getFundingReceipts(financialYear: number) {
  const { data, error } = await supabase
    .from('v_funding_receipt_register')
    .select('*')
    .eq('financial_year', financialYear)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as FundingReceiptRow[]
}

export async function getFundingAllocations(financialYear: number) {
  const { data, error } = await supabase
    .from('v_funding_allocation_register')
    .select('*')
    .eq('financial_year', financialYear)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as FundingAllocationRow[]
}

export async function createFundingAuthority(input: FundingAuthorityInput) {
  return postBudgetWorkflow<FundingAuthorityRow>({ operation: 'create-funding-authority', input })
}

export async function transitionFundingAuthority(
  id: string,
  action: 'SUBMIT' | 'VERIFY' | 'APPROVE' | 'REJECT',
  comments?: string
) {
  return postBudgetWorkflow<FundingAuthorityRow>({ operation: 'transition-funding-authority', id, action, comments })
}

export async function createFundingReceipt(input: FundingReceiptInput) {
  return postBudgetWorkflow<FundingReceiptRow>({ operation: 'create-funding-receipt', input })
}

export async function transitionFundingReceipt(
  id: string,
  action: 'SUBMIT' | 'VERIFY' | 'APPROVE' | 'REJECT',
  comments?: string
) {
  return postBudgetWorkflow<FundingReceiptRow>({ operation: 'transition-funding-receipt', id, action, comments })
}

export async function allocateFunding(input: FundingAllocationInput) {
  return postBudgetWorkflow<FundingAllocationRow>({ operation: 'allocate-funding', input })
}

export async function approveFundingAllocation(id: string, comments?: string) {
  return postBudgetWorkflow<FundingAllocationRow>({ operation: 'approve-funding-allocation', id, comments })
}

// ==========================================
// BUDGET AVAILABILITY CHECK (used by FF3)
// ==========================================

export async function checkBudgetAvailability(params: {
  financialYear: number
  expenseCodeId?: string | null
  sectionId?: string | null
  amount: number
}) {
  let q = supabase.from('v_authoritative_budget_position').select('*').eq('financial_year', params.financialYear)
  if (params.expenseCodeId) q = q.eq('expense_code_registry_id', params.expenseCodeId)
  else if (params.sectionId) q = q.eq('section_id', params.sectionId)
  const { data: rows, error } = await q
  if (error) throw error

  const scopedRows = (await filterRowsToCurrentScope(rows)) as AuthoritativeBudgetPosition[]
  const revised = scopedRows.reduce((s, a) => s + (a.approved_budget || 0), 0)
  const funded = scopedRows.reduce((s, a) => s + (a.funded_amount || 0), 0)
  const released = scopedRows.reduce((s, a) => s + (a.released_amount || 0), 0)
  const committed = scopedRows.reduce((s, a) => s + (a.outstanding_commitment || 0), 0)
  const spent = scopedRows.reduce((s, a) => s + (a.actual_expenditure || 0), 0)
  const available = released - committed - spent
  const approvedAvailable = revised - committed - spent
  return {
    revised,
    funded,
    released,
    committed,
    spent,
    available,
    approvedAvailable,
    unreleased: funded - released,
    unfunded: revised - funded,
    requested: params.amount,
    withinBudget: params.amount <= available,
    hasAllocation: scopedRows.length > 0,
  }
}
