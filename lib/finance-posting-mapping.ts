import { supabase } from './supabase'

export type FinancePostingMapping = {
  id: string
  financial_year: number | null
  expense_ledger_id: string
  finance_code: string
  finance_description: string | null
  expense_code_registry_id: string
  posting_code: string
  posting_description: string | null
  chart_of_account_id: string
  chart_account_code: string
  chart_account_name: string | null
  department_id: string
  department_code: string
  department_name: string
  section_id: string | null
  section_code: string | null
  section_name: string | null
  cost_centre_id: string
  cost_centre_code: string
  cost_centre_name: string
  expense_category_id: string | null
  expense_category_code: string | null
  expense_category_name: string | null
  expense_item_id: string | null
  expense_item_code: string | null
  expense_item_name: string | null
  mapping_status: string
  is_active: boolean
  mapping_notes: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_by: string | null
  updated_by_name: string | null
  updated_at: string
}

export type SaveFinancePostingMappingInput = {
  mappingId: string | null
  financialYear: number | null
  expenseLedgerId: string
  expenseCodeRegistryId: string
  chartOfAccountId: string
  costCentreId: string
  departmentId: string
  sectionId: string | null
  mappingNotes: string | null
}

export async function getFinancePostingMappings(): Promise<FinancePostingMapping[]> {
  const { data, error } = await supabase
    .from('v_finance_posting_mapping_admin')
    .select('*')
    .order('finance_code')
    .order('cost_centre_code')
    .order('financial_year', { ascending: false, nullsFirst: false })
  if (error) throw error
  return (data || []) as FinancePostingMapping[]
}

export async function saveFinancePostingMapping(input: SaveFinancePostingMappingInput) {
  const { data, error } = await supabase.rpc('njss_upsert_finance_posting_mapping', {
    p_mapping_id: input.mappingId,
    p_financial_year: input.financialYear,
    p_expense_ledger_id: input.expenseLedgerId,
    p_expense_code_registry_id: input.expenseCodeRegistryId,
    p_chart_of_account_id: input.chartOfAccountId,
    p_cost_centre_id: input.costCentreId,
    p_department_id: input.departmentId,
    p_section_id: input.sectionId,
    p_mapping_notes: input.mappingNotes,
  })
  if (error) throw error
  return data as FinancePostingMapping
}

export async function deactivateFinancePostingMapping(mappingId: string, reason: string) {
  const cleanReason = reason.trim()
  if (!cleanReason) throw new Error('A deactivation reason is required.')
  const { data, error } = await supabase.rpc('njss_deactivate_finance_posting_mapping', {
    p_mapping_id: mappingId,
    p_reason: cleanReason,
  })
  if (error) throw error
  return data as FinancePostingMapping
}
