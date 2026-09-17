import { supabase } from './supabase'

export type HeadOfficeFF3BudgetStatus =
  | 'NOT_CHECKED'
  | 'SUFFICIENT'
  | 'INSUFFICIENT_BUDGET_BLOCKED'
  | 'NO_ACTIVE_BUDGET'
  | 'POSTING_MAPPING_REQUIRED'

export type HeadOfficeFF3BudgetCheck = {
  status: HeadOfficeFF3BudgetStatus
  positionExists: boolean
  financialYear: number
  departmentId: string | null
  sectionId: string | null
  expenseLedgerId: string | null
  requested: number
  originalBudget: number
  supplementaryAdjustments: number
  reallocationsIn: number
  reallocationsOut: number
  currentApprovedBudget: number
  outstandingCommitments: number
  actualExpenditure: number
  availableBudget: number
  shortfall: number
  postingMappingCount: number
}

const n = (value: unknown) => Number(value || 0)
const s = (value: unknown) => (typeof value === 'string' && value ? value : null)

export async function checkHeadOfficeFF3Budget(input: {
  financialYear: number
  departmentId: string
  sectionId: string
  expenseLedgerId: string
  costCentreId?: string | null
  amount: number
}): Promise<HeadOfficeFF3BudgetCheck> {
  const { data, error } = await supabase.rpc('check_head_office_ff3_budget', {
    p_financial_year: input.financialYear,
    p_department_id: input.departmentId,
    p_section_id: input.sectionId,
    p_expense_ledger_id: input.expenseLedgerId,
    p_cost_centre_id: input.costCentreId || null,
    p_amount: input.amount,
  })
  if (error) throw error

  const row = (data || {}) as Record<string, unknown>
  return {
    status: String(row.status || 'NOT_CHECKED') as HeadOfficeFF3BudgetStatus,
    positionExists: Boolean(row.position_exists),
    financialYear: n(row.financial_year || input.financialYear),
    departmentId: s(row.department_id) || input.departmentId,
    sectionId: s(row.section_id) || input.sectionId,
    expenseLedgerId: s(row.expense_ledger_id) || input.expenseLedgerId,
    requested: n(row.requested ?? input.amount),
    originalBudget: n(row.original_budget),
    supplementaryAdjustments: n(row.supplementary_adjustments),
    reallocationsIn: n(row.reallocations_in),
    reallocationsOut: n(row.reallocations_out),
    currentApprovedBudget: n(row.current_approved_budget),
    outstandingCommitments: n(row.outstanding_commitments),
    actualExpenditure: n(row.actual_expenditure),
    availableBudget: n(row.available_budget),
    shortfall: n(row.shortfall),
    postingMappingCount: n(row.posting_mapping_count),
  }
}
