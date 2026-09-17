import { supabase } from './supabase'

export type FF3BudgetControlStatus =
  | 'UNASSESSED'
  | 'SUFFICIENT'
  | 'INSUFFICIENT_BUDGET_BLOCKED'
  | 'MAPPING_REQUIRED'

export type FF3BudgetCheck = {
  budgetAllocationId: string | null
  mappingStatus: string
  allocationCount: number
  revised: number
  funded: number
  released: number
  pending: number
  committed: number
  spent: number
  available: number
  approvedAvailable: number
  projectedAvailableAfterPending: number
  unreleased: number
  unfunded: number
  requested: number
  withinBudget: boolean
  hasAllocation: boolean
  budgetControlStatus: FF3BudgetControlStatus
  budgetControlSource: string
  expenseLedgerId: string | null
  currentApproved: number
  originalBudget: number
  supplementaryAdjustments: number
  reallocationsIn: number
  reallocationsOut: number
  shortfall: number
}

type BudgetRpcRow = Partial<Record<keyof FF3BudgetCheck, unknown>>

const numberValue = (value: unknown) => Number(value || 0)

export async function checkFF3BudgetAvailability(params: {
  financialYear: number
  expenseCodeId?: string | null
  sectionId?: string | null
  departmentId?: string | null
  costCentreId?: string | null
  fundingSourceId?: string | null
  projectId?: string | null
  amount: number
}): Promise<FF3BudgetCheck> {
  const { data, error } = await supabase.rpc('check_ff3_budget_position', {
    p_financial_year: params.financialYear,
    p_department_id: params.departmentId || null,
    p_section_id: params.sectionId || null,
    p_expense_code_registry_id: params.expenseCodeId || null,
    p_cost_centre_id: params.costCentreId || null,
    p_funding_source_id: params.fundingSourceId || null,
    p_project_id: params.projectId || null,
    p_amount: params.amount,
  })
  if (error) throw error

  const row = (data || {}) as BudgetRpcRow
  const status = String(row.budgetControlStatus || 'MAPPING_REQUIRED') as FF3BudgetControlStatus
  return {
    budgetAllocationId: typeof row.budgetAllocationId === 'string' ? row.budgetAllocationId : null,
    mappingStatus: String(row.mappingStatus || 'BUDGET_MAPPING_REQUIRED'),
    allocationCount: numberValue(row.allocationCount),
    revised: numberValue(row.revised),
    funded: numberValue(row.funded),
    released: numberValue(row.released),
    pending: numberValue(row.pending),
    committed: numberValue(row.committed),
    spent: numberValue(row.spent),
    available: numberValue(row.available),
    approvedAvailable: numberValue(row.approvedAvailable),
    projectedAvailableAfterPending: numberValue(row.projectedAvailableAfterPending),
    unreleased: numberValue(row.unreleased),
    unfunded: numberValue(row.unfunded),
    requested: numberValue(row.requested ?? params.amount),
    withinBudget: Boolean(row.withinBudget),
    hasAllocation: Boolean(row.hasAllocation),
    budgetControlStatus: status,
    budgetControlSource: String(row.budgetControlSource || 'LEGACY_ALLOCATION'),
    expenseLedgerId: typeof row.expenseLedgerId === 'string' ? row.expenseLedgerId : null,
    currentApproved: numberValue(row.currentApproved ?? row.revised),
    originalBudget: numberValue(row.originalBudget),
    supplementaryAdjustments: numberValue(row.supplementaryAdjustments),
    reallocationsIn: numberValue(row.reallocationsIn),
    reallocationsOut: numberValue(row.reallocationsOut),
    shortfall: numberValue(row.shortfall),
  }
}
