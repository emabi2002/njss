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

export type CommitmentTransaction = {
  id: string
  commitment_id: string
  ff3_header_id: string | null
  budget_allocation_id: string
  transaction_number: string | null
  transaction_type: string
  amount: number
  transaction_date: string
  reason_code: string | null
  reason: string | null
  reference: string | null
  previous_balance: number
  new_balance: number
  approved_by: string | null
  created_by: string | null
  created_at: string
}

export type CommitmentAdjustmentInput = {
  commitment_id: string
  action: 'INCREASE' | 'DECREASE' | 'CANCEL' | 'RELEASE_UNUSED_BALANCE'
  amount?: number | null
  reason: string
  reference?: string | null
}

export type SupplierStatus = 'ACTIVE' | 'INACTIVE'

export type SupplierRegisterRow = {
  id: string
  supplier_code: string | null
  supplier_name: string
  legal_name: string | null
  trading_name: string | null
  supplier_type: string | null
  ipa_registration_number: string | null
  tin: string | null
  primary_contact_name: string | null
  phone: string | null
  email: string | null
  address?: string | null
  physical_address?: string | null
  province: string | null
  country: string | null
  status: SupplierStatus | string
  active_commitments?: number
  outstanding_commitment_value?: number
  total_spend?: number
  actual_expenditure?: number
  created_at?: string
  updated_at?: string
}

export type SupplierPayload = {
  legal_name: string
  trading_name?: string
  supplier_type?: string
  ipa_registration_number?: string
  tin?: string
  primary_contact_name?: string
  phone?: string
  email?: string
  physical_address?: string
  address?: string
  province?: string
  country?: string
  notes?: string
  is_active?: boolean
}

export type FF4WorkflowResult = {
  header?: Record<string, unknown>
  commitment?: Record<string, unknown> | null
  payment_transaction?: Record<string, unknown> | null
  financial_position_before?: Record<string, unknown> | null
  financial_position_after?: Record<string, unknown> | null
}

export type FF4CreatePayload = {
  ff3_header_id: string
  commitment_id: string
  payee_type?: string | null
  payee_type_id?: string | null
  payee_name: string
  supplier_id?: string | null
  payee_user_id?: string | null
  supplier_code?: string | null
  invoice_number?: string | null
  invoice_date?: string | null
  claim_reference?: string | null
  payment_description?: string | null
  gross_amount: number
  tax_amount?: number
  deductions?: number
  payment_method?: string | null
  payment_method_id?: string | null
  external_payment_reference?: string | null
  cheque_number?: string | null
  remarks?: string | null
  is_partial_payment?: boolean
  payment_lines?: Array<{
    line_number: number
    source: 'FF3_ITEM' | 'SELECTED_QUOTE' | 'INVOICE' | 'MANUAL'
    reference?: string | null
    description: string
    quantity: number
    unit?: string | null
    unit_price: number
    gross_amount: number
    tax_amount?: number
    deduction_amount?: number
    net_amount: number
    notes?: string | null
  }>
  attachments?: Array<{ file_name?: string; name?: string; file_type?: string; type?: string; file_url?: string; url?: string; attachment_type?: string }>
  comments?: string | null
}

export type PayableCommitmentRow = {
  commitment_id: string
  commitment_number: string | null
  ff3_header_id: string
  ff3_number: string | null
  purpose: string | null
  financial_year: number
  supplier_id: string | null
  supplier_name: string | null
  supplier_code: string | null
  original_commitment: number
  current_commitment: number
  paid_amount: number
  outstanding_commitment: number
  pending_ff4_amount: number
  available_for_ff4: number
  commitment_status: string
}

async function authJsonFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  return fetch(input, { ...init, headers })
}

async function postSupplierWorkflow<T>(body: Record<string, unknown>): Promise<T> {
  const response = await authJsonFetch('/api/workflows/suppliers', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || 'Supplier workflow operation failed')
  return json.data as T
}

async function postFF4Workflow<T>(body: Record<string, unknown>): Promise<T> {
  const response = await authJsonFetch('/api/workflows/ff4', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || 'FF4 workflow operation failed')
  return (json.data || json) as T
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

export async function createFundingSource(input: { code: string; name: string; source_type?: string | null; is_active?: boolean }) {
  const code = input.code.trim().toUpperCase()
  const name = input.name.trim()
  if (!code || !name) throw new Error('Funding source code and name are required')

  const { data: existing, error: existingError } = await supabase
    .from('funding_sources')
    .select('*')
    .ilike('code', code)
    .limit(1)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    if (!existing.is_active) throw new Error(`Funding source ${code} already exists but is inactive. Reactivate it in master data before using it.`)
    return existing as FundingSource
  }

  const { data, error } = await supabase
    .from('funding_sources')
    .insert({ code, name, source_type: input.source_type?.trim() || null, is_active: input.is_active ?? true })
    .select('*')
    .single()
  if (error) throw error
  return data as FundingSource
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

export async function getSupplierRegisterRows() {
  const { data, error } = await supabase
    .from('v_supplier_register')
    .select('*')
    .order('supplier_name')
  if (error) throw error
  return (data || []) as SupplierRegisterRow[]
}

export async function getSupplierCommitmentPosition(supplierId: string) {
  const { data, error } = await supabase
    .from('v_supplier_commitment_position')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('financial_year', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getSupplierDocuments(supplierId: string) {
  const { data, error } = await supabase
    .from('v_supplier_document_expiry_buckets')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('expiry_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data || []
}

// ==========================================
// BUDGET
// ==========================================

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

export async function getPayableCommitments(financialYear: number) {
  const { data, error } = await supabase
    .from('v_ff4_payable_commitments')
    .select('*')
    .eq('financial_year', financialYear)
    .order('ff3_number', { ascending: false })
  if (error) throw error
  return data as PayableCommitmentRow[]
}

export async function createFF4Controlled(payload: FF4CreatePayload, submit = false) {
  return postFF4Workflow<FF4WorkflowResult>({ action: submit ? 'CREATE_AND_SUBMIT' : 'CREATE_DRAFT', payload })
}

// ==========================================
// FF3 APPROVAL WORKFLOW
// ==========================================

export type FF3ApprovalAction = 'SUBMIT' | 'ENDORSE_SUPERVISOR' | 'ENDORSE_SECTION_HEAD' | 'APPROVE' | 'REJECT' | 'CANCEL' | 'RETURN'

export async function approveFF3(ff3Id: string, action: FF3ApprovalAction, comments?: string) {
  const response = await authJsonFetch('/api/workflows/ff3', {
    method: 'POST',
    body: JSON.stringify({ ff3Id, action, comments }),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || 'FF3 workflow action failed')
  return json
}

export async function getCommitmentTransactions(commitmentId: string) {
  const { data, error } = await supabase
    .from('commitment_transactions')
    .select('*')
    .eq('commitment_id', commitmentId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as CommitmentTransaction[]
}

export async function adjustCommitment(input: CommitmentAdjustmentInput) {
  const response = await authJsonFetch('/api/workflows/commitments', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || 'Commitment adjustment failed')
  return json
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

export type FF4ApprovalAction = 'SUBMIT' | 'VERIFY' | 'APPROVE' | 'PROCESS' | 'MARK_PAID' | 'RECONCILE' | 'CANCEL'

export async function approveFF4(
  ff4Id: string,
  action: FF4ApprovalAction,
  paymentReference?: string,
  comments?: string,
  paymentDetails?: { paymentDate?: string; paymentMethod?: string; chequeNumber?: string }
) {
  return postFF4Workflow<FF4WorkflowResult>({
    ff4Id,
    action,
    paymentReference,
    comments,
    paymentDate: paymentDetails?.paymentDate,
    paymentMethod: paymentDetails?.paymentMethod,
    chequeNumber: paymentDetails?.chequeNumber,
  })
}

export async function getFF4PaymentTransactions(ff4Id: string) {
  const { data, error } = await supabase
    .from('payment_transactions')
    .select('*')
    .eq('ff4_header_id', ff4Id)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getFF4Approvals(ff4Id: string) {
  const { data, error } = await supabase
    .from('ff4_approvals')
    .select('*, approver:users(full_name, email)')
    .eq('ff4_header_id', ff4Id)
    .order('action_date', { ascending: true })
  if (error) throw error
  return data || []
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

export async function createSupplier(payload: SupplierPayload, allowPossibleDuplicate = false) {
  return postSupplierWorkflow<{ created?: boolean; requires_review?: boolean; possible_duplicates?: SupplierRegisterRow[]; supplier?: SupplierRegisterRow }>({
    action: 'CREATE',
    payload,
    allowPossibleDuplicate,
  })
}

export async function updateSupplier(supplierId: string, payload: SupplierPayload) {
  return postSupplierWorkflow<SupplierRegisterRow>({ action: 'UPDATE', supplierId, payload })
}
