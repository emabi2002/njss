import { supabase } from './supabase'

export type BudgetRevisionType =
  | 'VIREMENT'
  | 'SUPPLEMENTARY'
  | 'REDUCTION'
  | 'RECLASSIFICATION'
  | 'REFORECAST'

export type BudgetRevisionAction =
  | 'SUBMIT'
  | 'RESUBMIT'
  | 'RETURN'
  | 'REJECT'
  | 'APPROVE'

export type BudgetRevision = {
  id: string
  revision_number: string
  parent_submission_id: string
  revision_submission_id: string
  budget_year: number
  division_id: string
  revision_type: BudgetRevisionType
  reason: string
  authority_reference: string | null
  effective_date: string
  status: string
  requested_by: string | null
  requested_by_email: string | null
  approved_by: string | null
  approved_at: string | null
  supporting_reference: string | null
  created_at: string
  updated_at: string
}

export type BudgetRevisionPosition = {
  revision_id: string
  revision_number: string
  revision_type: BudgetRevisionType
  revision_status: string
  parent_submission_id: string
  revision_submission_id: string
  budget_year: number
  division_id: string
  revision_line_id: string
  revision_budget_line_id: string
  source_budget_line_id: string | null
  source_budget_allocation_id: string | null
  original_budget: number
  current_revised_budget: number
  actual_expenditure: number
  outstanding_commitment: number
  protected_minimum: number
  proposed_revised_budget: number
  adjustment_amount: number
  available_after_revision: number
  actual_monthly: Record<string, number>
  closed_month_numbers: number[]
}

export type CreateBudgetRevisionInput = {
  parentSubmissionId: string
  revisionType: BudgetRevisionType
  reason: string
  authorityReference?: string | null
  effectiveDate?: string | null
  supportingReference?: string | null
}

export type BudgetRevisionWorkflowResult = {
  revision_id: string
  revision_submission_id: string
  revision_number: string
  status?: string
  version?: number
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

export async function getRevisionForSubmission(submissionId: string) {
  const { data, error } = await supabase
    .from('budget_revisions')
    .select('*')
    .eq('revision_submission_id', submissionId)
    .maybeSingle()
  if (error) throw error
  return data as BudgetRevision | null
}

export async function getBudgetRevisionPosition(revisionId: string) {
  const { data, error } = await supabase
    .from('v_budget_revision_position')
    .select('*')
    .eq('revision_id', revisionId)
    .order('revision_budget_line_id')
  if (error) throw error
  return (data || []) as BudgetRevisionPosition[]
}

export async function getBudgetRevisionHistory(parentSubmissionId: string) {
  const { data, error } = await supabase
    .from('budget_revisions')
    .select('*, revision_submission:divisional_budget_submissions(id, submission_number, version, status, total_proposed_budget, submitted_at, approved_at, prepared_by_email, approved_by)')
    .eq('parent_submission_id', parentSubmissionId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createBudgetRevision(input: CreateBudgetRevisionInput) {
  const response = await authJsonFetch('/api/workflows/budget', {
    method: 'POST',
    body: JSON.stringify({
      operation: 'create-budget-revision',
      parentSubmissionId: input.parentSubmissionId,
      revisionType: input.revisionType,
      reason: input.reason,
      authorityReference: input.authorityReference || null,
      effectiveDate: input.effectiveDate || null,
      supportingReference: input.supportingReference || null,
    }),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || 'Could not create budget revision')
  return json.data as BudgetRevisionWorkflowResult
}

export async function transitionBudgetRevision(revisionId: string, action: BudgetRevisionAction, comments = '') {
  const response = await authJsonFetch('/api/workflows/budget', {
    method: 'POST',
    body: JSON.stringify({
      operation: 'transition-budget-revision',
      revisionId,
      action,
      comments,
    }),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || 'Budget revision workflow action failed')
  return json.data as BudgetRevisionWorkflowResult
}
