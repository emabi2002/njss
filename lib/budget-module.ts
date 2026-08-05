import { supabase } from './supabase'

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export type BudgetStatus = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'RESUBMITTED' | 'REVIEWED' | 'APPROVED' | 'REJECTED' | 'ARCHIVED'

export type ExpenseLedger = {
  id: string
  ledger_number: string
  finance_code: string
  standard_description: string
  budget_class: string
  expense_category: string
  is_posting: boolean
  is_active: boolean
  parent_ledger_id: string | null
  source_description: string | null
  correction_notes: string | null
}

export type BudgetCycle = {
  id: string
  budget_year: number
  cycle_type: string
  name: string
  status: string
  submission_deadline: string | null
  department_ceiling: number
}

export type BudgetDivision = {
  id: string
  code: string
  name: string
  cost_centre_code: string | null
  cost_centre_name: string | null
  department_id: string | null
}

export type BudgetSubmission = {
  id: string
  submission_number: string | null
  budget_year: number
  submission_reference: string | null
  version: number
  budget_ceiling: number
  status: BudgetStatus
  validation_status: string
  total_proposed_budget: number
  total_monthly_allocation: number
  unallocated_variance: number
  is_locked: boolean
  date_prepared: string
  division?: BudgetDivision | null
  cycle?: BudgetCycle | null
}

export type BudgetLine = {
  id: string
  budget_line_number: string | null
  submission_id: string
  line_number: number
  activity_reference: string | null
  expense_ledger_id: string
  line_item_description: string
  business_justification: string
  expected_output: string | null
  location_destination_provider: string | null
  beneficiary_custodian_officer: string | null
  start_date: string | null
  end_date: string | null
  quantity: number
  unit_of_measure: string | null
  unit_cost: number
  frequency_periods: number
  other_costs: number
  annual_estimate: number
  monthly_allocation_total: number
  allocation_variance: number
  priority: string
  funding_source_id: string | null
  procurement_method: string | null
  responsible_officer: string | null
  supporting_reference: string | null
  comments: string | null
  ledger?: ExpenseLedger | null
  allocations?: BudgetMonthlyAllocation[]
}

export type BudgetMonthlyAllocation = {
  id?: string
  budget_line_id?: string
  month_number: number
  month_name: string
  amount: number
}

export type BudgetWorkflowHistory = {
  id: string
  submission_id: string
  from_status: string | null
  to_status: string
  action: string
  comments: string | null
  changed_by_email: string | null
  created_at: string
}

export function annualEstimate(line: Pick<BudgetLine, 'quantity' | 'unit_cost' | 'frequency_periods' | 'other_costs'>) {
  return (Number(line.quantity) || 0) * (Number(line.unit_cost) || 0) * (Number(line.frequency_periods) || 0) + (Number(line.other_costs) || 0)
}

export function allocationTotal(allocations: Array<Pick<BudgetMonthlyAllocation, 'amount'>>) {
  return allocations.reduce((sum, month) => sum + (Number(month.amount) || 0), 0)
}

export function validateLineDraft(line: Partial<BudgetLine>, allocations: BudgetMonthlyAllocation[]) {
  const messages: string[] = []
  const estimate = annualEstimate({
    quantity: Number(line.quantity || 0),
    unit_cost: Number(line.unit_cost || 0),
    frequency_periods: Number(line.frequency_periods || 0),
    other_costs: Number(line.other_costs || 0),
  })
  const allocated = allocationTotal(allocations)
  if (!line.expense_ledger_id) messages.push('Finance code is required.')
  if (!line.line_item_description?.trim()) messages.push('Line-item/activity description is required.')
  if (!line.business_justification?.trim()) messages.push('Business justification is required.')
  if ((Number(line.quantity) || 0) <= 0) messages.push('Quantity must be greater than zero.')
  if ((Number(line.unit_cost) || 0) < 0) messages.push('Unit cost cannot be negative.')
  if ((Number(line.frequency_periods) || 0) <= 0) messages.push('Frequency/periods must be greater than zero.')
  if (Math.abs(estimate - allocated) > 0.009) messages.push('Monthly allocation must equal annual estimate.')
  return { valid: messages.length === 0, messages, estimate, allocated, variance: estimate - allocated }
}

export async function getBudgetLookups() {
  const [cycles, divisions, ledgers, fundingSources] = await Promise.all([
    supabase.from('budget_cycles').select('*').order('budget_year', { ascending: false }),
    supabase.from('budget_divisions').select('*').eq('is_active', true).order('name'),
    supabase.from('expense_ledger').select('*').eq('is_active', true).order('finance_code'),
    supabase.from('funding_sources').select('id, code, name').eq('is_active', true).order('name'),
  ])
  if (cycles.error) throw cycles.error
  if (divisions.error) throw divisions.error
  if (ledgers.error) throw ledgers.error
  if (fundingSources.error) throw fundingSources.error
  return { cycles: cycles.data || [], divisions: divisions.data || [], ledgers: ledgers.data || [], fundingSources: fundingSources.data || [] }
}

export async function getPostingLedgers(search = '') {
  let query = supabase
    .from('expense_ledger')
    .select('*')
    .eq('is_active', true)
    .eq('is_posting', true)
    .order('finance_code')
    .limit(100)
  if (search.trim()) query = query.or(`finance_code.ilike.%${search.trim()}%,standard_description.ilike.%${search.trim()}%`)
  const { data, error } = await query
  if (error) throw error
  return data as ExpenseLedger[]
}

export async function getBudgetDashboard() {
  const [cycles, submissions, cashflow] = await Promise.all([
    supabase.from('budget_cycles').select('*').in('status', ['OPEN', 'DRAFT']).order('budget_year', { ascending: false }),
    supabase.from('divisional_budget_submissions').select('*, division:budget_divisions(*), cycle:budget_cycles(*)').order('created_at', { ascending: false }),
    supabase.from('v_budget_monthly_cashflow').select('*').order('budget_year').order('month_number'),
  ])
  if (cycles.error) throw cycles.error
  if (submissions.error) throw submissions.error
  return { cycles: cycles.data || [], submissions: submissions.data || [], cashflow: cashflow.data || [] }
}

export async function getSubmissions(status?: string) {
  let query = supabase
    .from('divisional_budget_submissions')
    .select('*, division:budget_divisions(*), cycle:budget_cycles(*)')
    .order('updated_at', { ascending: false })
  if (status && status !== 'ALL') query = query.eq('status', status)
  const { data, error } = await query
  if (error) throw error
  return data as BudgetSubmission[]
}

export async function getSubmissionDetail(id: string) {
  const [submission, lines, history] = await Promise.all([
    supabase.from('divisional_budget_submissions').select('*, division:budget_divisions(*), cycle:budget_cycles(*)').eq('id', id).single(),
    supabase.from('divisional_budget_lines').select('*, ledger:expense_ledger(*), allocations:budget_monthly_allocations(*)').eq('submission_id', id).order('line_number'),
    supabase.from('budget_workflow_history').select('*').eq('submission_id', id).order('created_at', { ascending: false }),
  ])
  if (submission.error) throw submission.error
  if (lines.error) throw lines.error
  if (history.error) throw history.error
  return { submission: submission.data as BudgetSubmission, lines: lines.data as BudgetLine[], history: history.data as BudgetWorkflowHistory[] }
}

export async function createDraftSubmission(input: { cycle_id: string; budget_year: number; division_id: string; department_id?: string | null; cost_centre?: string | null; budget_ceiling?: number; submission_reference?: string | null; prepared_by?: string | null }) {
  const { data, error } = await supabase
    .from('divisional_budget_submissions')
    .insert({ ...input, status: 'DRAFT', validation_status: 'PENDING', date_prepared: new Date().toISOString().slice(0, 10) })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function saveBudgetLine(submissionId: string, line: Partial<BudgetLine>, allocations: BudgetMonthlyAllocation[]) {
  const payload = {
    submission_id: submissionId,
    line_number: line.line_number,
    activity_reference: line.activity_reference || null,
    expense_ledger_id: line.expense_ledger_id,
    line_item_description: line.line_item_description,
    business_justification: line.business_justification,
    expected_output: line.expected_output || null,
    location_destination_provider: line.location_destination_provider || null,
    beneficiary_custodian_officer: line.beneficiary_custodian_officer || null,
    start_date: line.start_date || null,
    end_date: line.end_date || null,
    quantity: line.quantity || 1,
    unit_of_measure: line.unit_of_measure || null,
    unit_cost: line.unit_cost || 0,
    frequency_periods: line.frequency_periods || 1,
    other_costs: line.other_costs || 0,
    priority: line.priority || 'MEDIUM',
    funding_source_id: line.funding_source_id || null,
    procurement_method: line.procurement_method || null,
    responsible_officer: line.responsible_officer || null,
    supporting_reference: line.supporting_reference || null,
    comments: line.comments || null,
  }
  const { data, error } = await supabase.from('divisional_budget_lines').upsert(payload, { onConflict: 'submission_id,line_number' }).select('id').single()
  if (error) throw error
  const budgetLineId = data.id as string
  const monthRows = allocations.map((month) => ({ ...month, budget_line_id: budgetLineId }))
  const { error: monthError } = await supabase.from('budget_monthly_allocations').upsert(monthRows, { onConflict: 'budget_line_id,month_number' })
  if (monthError) throw monthError
  return budgetLineId
}

export async function deleteBudgetLine(lineId: string) {
  const { error } = await supabase.from('divisional_budget_lines').delete().eq('id', lineId)
  if (error) throw error
}

export async function transitionSubmission(id: string, action: 'SUBMIT' | 'RETURN' | 'RESUBMIT' | 'REVIEW' | 'APPROVE' | 'REJECT', comments = '', userEmail = '') {
  const { data, error } = await supabase.rpc('transition_divisional_budget_submission', {
    p_submission_id: id,
    p_action: action,
    p_comments: comments,
    p_user_email: userEmail,
  })
  if (error) throw error
  return data
}

export async function getConsolidatedBudget() {
  const { data, error } = await supabase.from('v_department_consolidated_budget').select('*').order('division_name').order('finance_code')
  if (error) throw error
  return data || []
}

export async function getBudgetAuditHistory() {
  const [audit, workflow] = await Promise.all([
    supabase.from('audit_logs').select('*').in('entity_type', ['EXPENSE_LEDGER', 'BUDGET_SUBMISSION', 'BUDGET_LINE', 'BUDGET_MONTHLY_ALLOCATION']).order('created_at', { ascending: false }).limit(200),
    supabase.from('budget_workflow_history').select('*, submission:divisional_budget_submissions(submission_number)').order('created_at', { ascending: false }).limit(200),
  ])
  if (audit.error) throw audit.error
  if (workflow.error) throw workflow.error
  return { audit: audit.data || [], workflow: workflow.data || [] }
}
