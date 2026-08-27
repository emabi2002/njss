import { supabase } from './supabase'
import type { BudgetRevisionType, BudgetRevisionWorkflowResult } from './budget-revision'

export type EligibleLineSupervisor = {
  user_id: string
  full_name: string | null
  email: string | null
  department_id: string | null
  section_id: string | null
}

export type BudgetRevisionQueueState = 'SUPERVISOR_ACTION' | 'REGISTRAR_ACTION' | 'COMPLETED'

export type BudgetRevisionQueueItem = {
  revision_id: string
  revision_number: string
  revision_type: BudgetRevisionType
  status: string
  queue_state: BudgetRevisionQueueState
  reason: string
  authority_reference: string | null
  supporting_reference: string | null
  effective_date: string
  budget_year: number
  department_id: string | null
  department_name: string | null
  section_id: string | null
  section_name: string | null
  division_id: string
  division_code: string | null
  division_name: string | null
  parent_submission_id: string
  parent_submission_number: string | null
  parent_version: number | null
  revision_submission_id: string
  revision_submission_number: string | null
  revision_version: number | null
  assigned_line_supervisor_id: string | null
  assigned_line_supervisor_name: string | null
  assigned_line_supervisor_email: string | null
  requested_by: string | null
  requested_by_name: string | null
  requested_by_email: string | null
  request_instruction: string | null
  requested_change_amount: number | null
  original_budget: number
  current_revised_budget: number
  proposed_revised_budget: number
  actual_expenditure: number
  outstanding_commitment: number
  protected_minimum: number
  created_at: string
  assigned_at: string | null
  approved_at: string | null
}

export type CreateBudgetRevisionRequestInput = {
  parentSubmissionId: string
  revisionType: BudgetRevisionType
  reason: string
  authorityReference?: string | null
  effectiveDate?: string | null
  supportingReference?: string | null
  assignedLineSupervisorId: string
  requestInstruction?: string | null
  requestedChangeAmount?: number | null
}

export type CreateBudgetRevisionRequestResult = BudgetRevisionWorkflowResult & {
  assigned_line_supervisor_id: string
  assigned_line_supervisor_name: string | null
  request_instruction: string | null
  requested_change_amount: number | null
}

export type ApprovedBudgetSummary = {
  original_budget: number
  current_revised_budget: number
  actual_expenditure: number
  outstanding_commitment: number
  budget_available: number
  released_available: number
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

export async function getBudgetRevisionWorkQueue(): Promise<BudgetRevisionQueueItem[]> {
  const { data, error } = await supabase
    .from('v_budget_revision_work_queue')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as BudgetRevisionQueueItem[]
}

export async function getEligibleLineSupervisors(divisionId: string): Promise<EligibleLineSupervisor[]> {
  const { data, error } = await supabase.rpc('njss_get_eligible_line_supervisors', {
    p_division_id: divisionId,
  })
  if (error) throw error
  return (data || []) as EligibleLineSupervisor[]
}

export async function getApprovedBudgetSummary(parentSubmissionId: string): Promise<ApprovedBudgetSummary> {
  const { data: allocations, error: allocationError } = await supabase
    .from('budget_allocations')
    .select('id')
    .eq('source_budget_submission_id', parentSubmissionId)
    .eq('is_active', true)
  if (allocationError) throw allocationError

  const ids = (allocations || []).map((row) => row.id as string)
  if (ids.length === 0) {
    return {
      original_budget: 0,
      current_revised_budget: 0,
      actual_expenditure: 0,
      outstanding_commitment: 0,
      budget_available: 0,
      released_available: 0,
    }
  }

  const { data, error } = await supabase
    .from('v_authoritative_budget_position')
    .select('budget_allocation_id, original_budget, current_revised_budget, actual_expenditure, outstanding_commitment, budget_available, released_available')
    .in('budget_allocation_id', ids)
  if (error) throw error

  return (data || []).reduce<ApprovedBudgetSummary>(
    (total, row) => ({
      original_budget: total.original_budget + Number(row.original_budget || 0),
      current_revised_budget: total.current_revised_budget + Number(row.current_revised_budget || 0),
      actual_expenditure: total.actual_expenditure + Number(row.actual_expenditure || 0),
      outstanding_commitment: total.outstanding_commitment + Number(row.outstanding_commitment || 0),
      budget_available: total.budget_available + Number(row.budget_available || 0),
      released_available: total.released_available + Number(row.released_available || 0),
    }),
    {
      original_budget: 0,
      current_revised_budget: 0,
      actual_expenditure: 0,
      outstanding_commitment: 0,
      budget_available: 0,
      released_available: 0,
    },
  )
}

export async function createBudgetRevisionRequest(
  input: CreateBudgetRevisionRequestInput,
): Promise<CreateBudgetRevisionRequestResult> {
  const response = await authJsonFetch('/api/workflows/budget', {
    method: 'POST',
    body: JSON.stringify({
      operation: 'create-budget-revision-request',
      parentSubmissionId: input.parentSubmissionId,
      revisionType: input.revisionType,
      reason: input.reason,
      authorityReference: input.authorityReference || null,
      effectiveDate: input.effectiveDate || null,
      supportingReference: input.supportingReference || null,
      assignedLineSupervisorId: input.assignedLineSupervisorId,
      requestInstruction: input.requestInstruction || null,
      requestedChangeAmount: input.requestedChangeAmount ?? null,
    }),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || 'Could not create budget revision request')
  return json.data as CreateBudgetRevisionRequestResult
}
