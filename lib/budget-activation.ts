import { supabase } from './supabase'

export type BudgetActivationStatus =
  | 'DRAFT_MAPPING'
  | 'VALIDATION_FAILED'
  | 'READY_FOR_ACTIVATION'
  | 'ACTIVATED'
  | 'CANCELLED'

export type BudgetActivationBatch = {
  id: string
  submission_id: string
  financial_year: number
  department_id: string | null
  budget_division_id: string | null
  approved_line_count: number
  approved_total: number
  mapped_line_count: number
  unmapped_line_count: number
  activation_total: number
  variance: number
  status: BudgetActivationStatus
  validation_fingerprint: string | null
  validation_error_count: number
  prepared_against_submission_updated_at: string | null
  fingerprint_state?: 'NOT_VALIDATED' | 'VALIDATED' | 'ACTIVATED'
  activation_snapshot_count?: number
  prepared_by: string | null
  prepared_by_email: string | null
  prepared_at: string | null
  validated_at: string | null
  submitted_for_activation_by: string | null
  submitted_for_activation_at: string | null
  authorised_by: string | null
  authorised_by_email: string | null
  authorised_at: string | null
  activated_at: string | null
  validation_snapshot: Record<string, unknown> | null
  created_at: string
  updated_at: string
  submission_number: string | null
  submission_status: string
  approved_at: string | null
  approved_by?: string | null
  approved_by_name?: string | null
  division_code: string | null
  division_name: string | null
  department_code: string | null
  department_name: string | null
  prepared_by_name: string | null
  authorised_by_name: string | null
}

export type BudgetActivationLine = {
  id: string
  activation_batch_id: string
  submission_id: string
  budget_line_id: string
  expense_ledger_id: string | null
  finance_code: string | null
  finance_posting_mapping_id: string | null
  expense_code_registry_id: string | null
  chart_of_account_id: string | null
  department_id: string | null
  section_id: string | null
  cost_centre_id: string | null
  approved_amount: number
  mapped_amount: number
  mapping_status: 'READY' | 'INVALID'
  validation_errors: string[]
  validation_snapshot: Record<string, unknown> | null
  source_line_updated_at: string | null
  source_monthly_updated_at: string | null
  created_at: string
  updated_at: string
  finance_description?: string | null
  posting_code?: string | null
  posting_description?: string | null
  chart_account_code?: string | null
  chart_account_name?: string | null
  department_code?: string | null
  department_name?: string | null
  section_code?: string | null
  section_name?: string | null
  cost_centre_code?: string | null
  cost_centre_name?: string | null
}

export type BudgetActivationSnapshot = {
  id: string
  activation_batch_id: string
  source_budget_submission_id: string
  source_budget_line_id: string
  budget_allocation_id: string
  finance_posting_mapping_id: string
  expense_ledger_id: string
  finance_code_snapshot: string
  finance_description_snapshot: string | null
  expense_code_registry_id: string
  posting_code_snapshot: string
  posting_description_snapshot: string | null
  chart_of_account_id: string
  chart_account_code_snapshot: string
  chart_account_name_snapshot: string | null
  cost_centre_id: string
  cost_centre_code_snapshot: string
  cost_centre_name_snapshot: string | null
  approved_amount: number
  monthly_cashflow_snapshot: Record<string, number>
  created_at: string
}

type LookupRow = Record<string, unknown> & { id: string }

async function authJsonFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  return fetch(input, { ...init, headers })
}

export async function getBudgetActivationQueue(): Promise<BudgetActivationBatch[]> {
  const { data, error } = await supabase
    .from('v_budget_activation_queue')
    .select('*')
    .order('financial_year', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as BudgetActivationBatch[]
}

async function lookupByIds(table: string, select: string, ids: Array<string | null>) {
  const cleanIds = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (!cleanIds.length) return new Map<string, LookupRow>()
  const { data, error } = await supabase.from(table).select(select).in('id', cleanIds)
  if (error) throw error
  const rows = (data || []) as unknown as LookupRow[]
  return new Map(rows.map((row) => [row.id, row]))
}

export async function getBudgetActivationLines(batchId: string): Promise<BudgetActivationLine[]> {
  const { data, error } = await supabase
    .from('budget_activation_lines')
    .select('*')
    .eq('activation_batch_id', batchId)
    .order('created_at', { ascending: true })
  if (error) throw error

  const lines = (data || []) as BudgetActivationLine[]
  if (!lines.length) return []

  const [ledgers, postingCodes, accounts, departments, sections, costCentres] = await Promise.all([
    lookupByIds('expense_ledger', 'id, standard_description', lines.map((line) => line.expense_ledger_id)),
    lookupByIds('expense_code_registry', 'id, full_expense_code, description', lines.map((line) => line.expense_code_registry_id)),
    lookupByIds('chart_of_accounts', 'id, account_code, account_name', lines.map((line) => line.chart_of_account_id)),
    lookupByIds('departments', 'id, code, name', lines.map((line) => line.department_id)),
    lookupByIds('sections', 'id, code, name', lines.map((line) => line.section_id)),
    lookupByIds('cost_centres', 'id, code, name', lines.map((line) => line.cost_centre_id)),
  ])

  return lines.map((line) => {
    const ledger = line.expense_ledger_id ? ledgers.get(line.expense_ledger_id) : undefined
    const posting = line.expense_code_registry_id ? postingCodes.get(line.expense_code_registry_id) : undefined
    const account = line.chart_of_account_id ? accounts.get(line.chart_of_account_id) : undefined
    const department = line.department_id ? departments.get(line.department_id) : undefined
    const section = line.section_id ? sections.get(line.section_id) : undefined
    const costCentre = line.cost_centre_id ? costCentres.get(line.cost_centre_id) : undefined
    return {
      ...line,
      validation_errors: Array.isArray(line.validation_errors) ? line.validation_errors.map(String) : [],
      finance_description: (ledger?.standard_description as string | null | undefined) ?? null,
      posting_code: (posting?.full_expense_code as string | null | undefined) ?? null,
      posting_description: (posting?.description as string | null | undefined) ?? null,
      chart_account_code: (account?.account_code as string | null | undefined) ?? null,
      chart_account_name: (account?.account_name as string | null | undefined) ?? null,
      department_code: (department?.code as string | null | undefined) ?? null,
      department_name: (department?.name as string | null | undefined) ?? null,
      section_code: (section?.code as string | null | undefined) ?? null,
      section_name: (section?.name as string | null | undefined) ?? null,
      cost_centre_code: (costCentre?.code as string | null | undefined) ?? null,
      cost_centre_name: (costCentre?.name as string | null | undefined) ?? null,
    }
  })
}

export async function getBudgetActivationSnapshots(batchId: string): Promise<BudgetActivationSnapshot[]> {
  const { data, error } = await supabase
    .from('budget_activation_line_snapshots')
    .select('*')
    .eq('activation_batch_id', batchId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []) as BudgetActivationSnapshot[]
}

async function mutateBudgetActivation(operation: 'prepare' | 'submit' | 'activate', batchId: string) {
  const response = await authJsonFetch('/api/budget-activation', {
    method: 'POST',
    body: JSON.stringify({ operation, batchId }),
  })
  const payload = (await response.json()) as { data?: BudgetActivationBatch; error?: string }
  if (!response.ok) throw new Error(payload.error || 'Budget activation request failed.')
  if (!payload.data) throw new Error('Budget activation request returned no data.')
  return payload.data
}

export async function prepareBudgetActivation(batchId: string) {
  return mutateBudgetActivation('prepare', batchId)
}

export async function submitBudgetActivation(batchId: string) {
  return mutateBudgetActivation('submit', batchId)
}

export async function activateApprovedBudget(batchId: string) {
  return mutateBudgetActivation('activate', batchId)
}
