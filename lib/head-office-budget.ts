import { supabase } from './supabase'

export type AnnualBudgetCycleStatus = 'PREPARATION' | 'READY_FOR_ACTIVATION' | 'ACTIVE' | 'CLOSED'
export type DivisionBudgetStatus = 'DRAFT' | 'LOCKED'

export type AnnualBudgetCycle = {
  id: string
  financial_year: number
  status: AnnualBudgetCycleStatus
  activation_authority_document_id: string | null
  activated_by: string | null
  activated_at: string | null
  created_at: string
  updated_at: string
}

export type DivisionReference = {
  id: string
  code: string
  name: string
  court_location_id: string | null
}

export type SectionReference = {
  id: string
  code: string
  name: string
  department_id: string | null
}

export type LedgerReference = {
  id: string
  ledger_number: string
  finance_code: string
  standard_description: string
  budget_class: string
  expense_category: string
  is_posting: boolean
  is_active: boolean
}

export type DivisionBudgetLine = {
  id: string
  division_budget_id: string
  section_id: string
  expense_ledger_id: string
  original_amount: number
  created_at: string
  updated_at: string
  section?: SectionReference | null
  ledger?: LedgerReference | null
}

export type BudgetDocument = {
  id: string
  financial_year: number
  division_budget_id: string | null
  related_entity_type: string
  related_entity_id: string | null
  document_type: string
  reference_number: string | null
  document_date: string | null
  description: string | null
  storage_bucket: string
  storage_path: string
  original_filename: string
  mime_type: string | null
  version_number: number
  supersedes_document_id: string | null
  uploaded_by: string | null
  uploaded_at: string
}

export type DivisionBudget = {
  id: string
  annual_budget_cycle_id: string
  financial_year: number
  division_id: string
  status: DivisionBudgetStatus
  reference_number: string | null
  approval_date: string | null
  entered_by: string | null
  locked_by: string | null
  locked_at: string | null
  created_at: string
  updated_at: string
  division?: DivisionReference | null
  lines?: DivisionBudgetLine[]
  documents?: BudgetDocument[]
}

export type DivisionBudgetDashboardRow = DivisionBudget & {
  division_total: number
  official_document_count: number
}

export type HeadOfficeBudgetDashboard = {
  cycle: AnnualBudgetCycle | null
  divisions: DivisionBudgetDashboardRow[]
  headOfficeTotal: number
}

export type DivisionBudgetDetail = {
  budget: DivisionBudget
  lines: DivisionBudgetLine[]
  documents: BudgetDocument[]
}

export type BudgetPositionRow = {
  annual_budget_cycle_id: string
  financial_year: number
  division_budget_id: string
  division_id: string
  section_id: string
  expense_ledger_id: string
  original_budget: number
  supplementary_adjustments: number
  reallocations_in: number
  reallocations_out: number
  current_approved_budget: number
  outstanding_commitments: number
  actual_expenditure: number
  available_budget: number
}

export type SupplementaryBudgetAdjustmentStatus = 'DRAFT' | 'POSTED'
export type SupplementaryBudgetAdjustment = {
  id: string
  transaction_number: string
  annual_budget_cycle_id: string
  financial_year: number
  division_budget_id: string
  section_id: string
  expense_ledger_id: string
  adjustment_amount: number
  reason: string
  status: SupplementaryBudgetAdjustmentStatus
  authority_document_id: string | null
  entered_by: string
  entered_at: string
  posted_by: string | null
  posted_at: string | null
  created_at: string
  updated_at: string
}

export type BudgetReallocationStatus = 'REQUESTED' | 'REGISTRAR_APPROVED' | 'REJECTED' | 'EXECUTED'
export type BudgetReallocation = {
  id: string
  reallocation_number: string
  annual_budget_cycle_id: string
  financial_year: number
  status: BudgetReallocationStatus
  requesting_division_id: string | null
  source_division_budget_id: string
  source_section_id: string
  source_expense_ledger_id: string
  destination_division_budget_id: string
  destination_section_id: string
  destination_expense_ledger_id: string
  transfer_amount: number
  reason: string
  requested_by: string
  requested_at: string
  registrar_approved_by: string | null
  registrar_approved_at: string | null
  registrar_authority_document_id: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string | null
  executed_by: string | null
  executed_at: string | null
  created_at: string
  updated_at: string
}

type DashboardLineSummary = { original_amount: number | string | null }
type DashboardDocumentSummary = { document_type: string }

const numeric = (value: unknown) => Number(value || 0)

export async function createOrGetHeadOfficeBudgetCycle(financialYear: number) {
  const { data, error } = await supabase.rpc('create_or_get_head_office_budget_cycle', {
    p_financial_year: financialYear,
  })
  if (error) throw error
  return data as string
}

export async function getHeadOfficeBudgetDashboard(financialYear: number): Promise<HeadOfficeBudgetDashboard> {
  const cycleResult = await supabase
    .from('annual_budget_cycles')
    .select('*')
    .eq('financial_year', financialYear)
    .maybeSingle()

  if (cycleResult.error) throw cycleResult.error
  if (!cycleResult.data) {
    return { cycle: null, divisions: [], headOfficeTotal: 0 }
  }

  const divisionResult = await supabase
    .from('division_budgets')
    .select(`
      *,
      division:departments(id, code, name, court_location_id),
      lines:division_budget_lines(id, original_amount),
      documents:budget_documents(id, document_type)
    `)
    .eq('annual_budget_cycle_id', cycleResult.data.id)
    .order('created_at', { ascending: true })

  if (divisionResult.error) throw divisionResult.error

  const divisions = (divisionResult.data || []).map((row) => {
    const lines = (Array.isArray(row.lines) ? row.lines : []) as DashboardLineSummary[]
    const documents = (Array.isArray(row.documents) ? row.documents : []) as DashboardDocumentSummary[]
    return {
      ...row,
      division_total: lines.reduce((sum: number, line: DashboardLineSummary) => sum + numeric(line.original_amount), 0),
      official_document_count: documents.filter((document: DashboardDocumentSummary) => document.document_type === 'OFFICIAL_APPROVED_BUDGET').length,
    } as DivisionBudgetDashboardRow
  })

  return {
    cycle: cycleResult.data as AnnualBudgetCycle,
    divisions,
    headOfficeTotal: divisions.reduce((sum, division) => sum + division.division_total, 0),
  }
}

export async function getAnnualBudgetActivationAuthorities(cycleId: string): Promise<BudgetDocument[]> {
  const { data, error } = await supabase
    .from('budget_documents')
    .select('*')
    .eq('related_entity_type', 'ANNUAL_BUDGET_CYCLE')
    .eq('related_entity_id', cycleId)
    .eq('document_type', 'REGISTRAR_ACTIVATION_AUTHORITY')
    .order('version_number', { ascending: false })
    .order('uploaded_at', { ascending: false })

  if (error) throw error
  return (data || []) as BudgetDocument[]
}

export async function getDivisionBudget(divisionBudgetId: string): Promise<DivisionBudgetDetail> {
  const budgetResult = await supabase
    .from('division_budgets')
    .select('*, division:departments(id, code, name, court_location_id)')
    .eq('id', divisionBudgetId)
    .single()
  if (budgetResult.error) throw budgetResult.error

  const [lineResult, documentResult] = await Promise.all([
    supabase
      .from('division_budget_lines')
      .select(`
        *,
        section:sections(id, code, name, department_id),
        ledger:expense_ledger(id, ledger_number, finance_code, standard_description, budget_class, expense_category, is_posting, is_active)
      `)
      .eq('division_budget_id', divisionBudgetId)
      .order('created_at', { ascending: true }),
    supabase
      .from('budget_documents')
      .select('*')
      .eq('division_budget_id', divisionBudgetId)
      .order('uploaded_at', { ascending: false }),
  ])

  if (lineResult.error) throw lineResult.error
  if (documentResult.error) throw documentResult.error

  const lines = (lineResult.data || []).map((line) => ({
    ...line,
    original_amount: numeric(line.original_amount),
  })) as DivisionBudgetLine[]

  return {
    budget: budgetResult.data as DivisionBudget,
    lines,
    documents: (documentResult.data || []) as BudgetDocument[],
  }
}

export async function createOrGetDivisionBudget(financialYear: number, divisionId: string) {
  const { data, error } = await supabase.rpc('create_or_get_division_budget', {
    p_financial_year: financialYear,
    p_division_id: divisionId,
  })
  if (error) throw error
  return data as string
}

export async function updateDivisionBudgetDraftHeader(input: {
  divisionBudgetId: string
  referenceNumber?: string | null
  approvalDate?: string | null
}) {
  const { error } = await supabase.rpc('update_division_budget_draft_header', {
    p_division_budget_id: input.divisionBudgetId,
    p_reference_number: input.referenceNumber || null,
    p_approval_date: input.approvalDate || null,
  })
  if (error) throw error
}

export async function saveDivisionBudgetLine(input: {
  divisionBudgetId: string
  sectionId: string
  expenseLedgerId: string
  originalAmount: number
}) {
  const { data, error } = await supabase.rpc('upsert_division_budget_line', {
    p_division_budget_id: input.divisionBudgetId,
    p_section_id: input.sectionId,
    p_expense_ledger_id: input.expenseLedgerId,
    p_original_amount: input.originalAmount,
  })
  if (error) throw error
  return data as string | null
}

export async function registerBudgetDocument(input: {
  financialYear: number
  divisionBudgetId?: string | null
  relatedEntityType: 'DIVISION_BUDGET' | 'ANNUAL_BUDGET_CYCLE' | 'SUPPLEMENTARY' | 'REALLOCATION' | 'OTHER'
  relatedEntityId?: string | null
  documentType: 'WORKING_SPREADSHEET' | 'OFFICIAL_APPROVED_BUDGET' | 'REGISTRAR_ACTIVATION_AUTHORITY' | 'SUPPLEMENTARY_AUTHORITY' | 'REGISTRAR_REALLOCATION_AUTHORITY' | 'OTHER'
  referenceNumber?: string | null
  documentDate?: string | null
  description?: string | null
  storagePath: string
  originalFilename: string
  mimeType?: string | null
  supersedesDocumentId?: string | null
}) {
  const { data, error } = await supabase.rpc('register_budget_document', {
    p_financial_year: input.financialYear,
    p_division_budget_id: input.divisionBudgetId || null,
    p_related_entity_type: input.relatedEntityType,
    p_related_entity_id: input.relatedEntityId || null,
    p_document_type: input.documentType,
    p_reference_number: input.referenceNumber || null,
    p_document_date: input.documentDate || null,
    p_description: input.description || null,
    p_storage_path: input.storagePath,
    p_original_filename: input.originalFilename,
    p_mime_type: input.mimeType || null,
    p_supersedes_document_id: input.supersedesDocumentId || null,
  })
  if (error) throw error
  return data as string
}

export async function lockDivisionBudget(divisionBudgetId: string) {
  const { error } = await supabase.rpc('lock_division_budget', {
    p_division_budget_id: divisionBudgetId,
  })
  if (error) throw error
}

export async function activateAnnualBudget(cycleId: string, authorityDocumentId: string) {
  const { error } = await supabase.rpc('activate_annual_budget', {
    p_cycle_id: cycleId,
    p_authority_document_id: authorityDocumentId,
  })
  if (error) throw error
}

export async function getCurrentBudgetPositions(
  financialYear: number,
  filters: { divisionId?: string | null; sectionId?: string | null; expenseLedgerId?: string | null } = {},
): Promise<BudgetPositionRow[]> {
  const { data, error } = await supabase.rpc('get_current_budget_position', {
    p_financial_year: financialYear,
    p_division_id: filters.divisionId || null,
    p_section_id: filters.sectionId || null,
    p_expense_ledger_id: filters.expenseLedgerId || null,
  })
  if (error) throw error
  return (data || []).map((row: Record<string, unknown>) => ({
    ...row,
    original_budget: numeric(row.original_budget),
    supplementary_adjustments: numeric(row.supplementary_adjustments),
    reallocations_in: numeric(row.reallocations_in),
    reallocations_out: numeric(row.reallocations_out),
    current_approved_budget: numeric(row.current_approved_budget),
    outstanding_commitments: numeric(row.outstanding_commitments),
    actual_expenditure: numeric(row.actual_expenditure),
    available_budget: numeric(row.available_budget),
  })) as BudgetPositionRow[]
}

export async function getSupplementaryAdjustments(financialYear: number): Promise<SupplementaryBudgetAdjustment[]> {
  const { data, error } = await supabase
    .from('budget_supplementary_adjustments')
    .select('*')
    .eq('financial_year', financialYear)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((row) => ({ ...row, adjustment_amount: numeric(row.adjustment_amount) })) as SupplementaryBudgetAdjustment[]
}

export async function createSupplementaryDraft(input: {
  financialYear: number
  divisionBudgetId: string
  sectionId: string
  expenseLedgerId: string
  adjustmentAmount: number
  reason: string
}) {
  const { data, error } = await supabase.rpc('create_budget_supplementary_draft', {
    p_financial_year: input.financialYear,
    p_division_budget_id: input.divisionBudgetId,
    p_section_id: input.sectionId,
    p_expense_ledger_id: input.expenseLedgerId,
    p_adjustment_amount: input.adjustmentAmount,
    p_reason: input.reason,
  })
  if (error) throw error
  return data as string
}

export async function updateSupplementaryDraft(input: {
  adjustmentId: string
  adjustmentAmount: number
  reason: string
}) {
  const { error } = await supabase.rpc('update_budget_supplementary_draft', {
    p_adjustment_id: input.adjustmentId,
    p_adjustment_amount: input.adjustmentAmount,
    p_reason: input.reason,
  })
  if (error) throw error
}

export async function postSupplementaryAdjustment(adjustmentId: string, authorityDocumentId: string) {
  const { error } = await supabase.rpc('post_budget_supplementary_adjustment', {
    p_adjustment_id: adjustmentId,
    p_authority_document_id: authorityDocumentId,
  })
  if (error) throw error
}

export async function getBudgetReallocations(financialYear: number): Promise<BudgetReallocation[]> {
  const { data, error } = await supabase
    .from('budget_reallocations')
    .select('*')
    .eq('financial_year', financialYear)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((row) => ({ ...row, transfer_amount: numeric(row.transfer_amount) })) as BudgetReallocation[]
}

export async function requestBudgetReallocation(input: {
  financialYear: number
  requestingDivisionId?: string | null
  sourceDivisionBudgetId: string
  sourceSectionId: string
  sourceExpenseLedgerId: string
  destinationDivisionBudgetId: string
  destinationSectionId: string
  destinationExpenseLedgerId: string
  transferAmount: number
  reason: string
}) {
  const { data, error } = await supabase.rpc('request_budget_reallocation', {
    p_financial_year: input.financialYear,
    p_requesting_division_id: input.requestingDivisionId || null,
    p_source_division_budget_id: input.sourceDivisionBudgetId,
    p_source_section_id: input.sourceSectionId,
    p_source_expense_ledger_id: input.sourceExpenseLedgerId,
    p_destination_division_budget_id: input.destinationDivisionBudgetId,
    p_destination_section_id: input.destinationSectionId,
    p_destination_expense_ledger_id: input.destinationExpenseLedgerId,
    p_transfer_amount: input.transferAmount,
    p_reason: input.reason,
  })
  if (error) throw error
  return data as string
}

export async function approveBudgetReallocation(reallocationId: string) {
  const { error } = await supabase.rpc('approve_budget_reallocation', {
    p_reallocation_id: reallocationId,
  })
  if (error) throw error
}

export async function rejectBudgetReallocation(reallocationId: string, reason: string) {
  const { error } = await supabase.rpc('reject_budget_reallocation', {
    p_reallocation_id: reallocationId,
    p_reason: reason,
  })
  if (error) throw error
}

export async function executeBudgetReallocation(reallocationId: string, authorityDocumentId: string) {
  const { error } = await supabase.rpc('execute_budget_reallocation', {
    p_reallocation_id: reallocationId,
    p_authority_document_id: authorityDocumentId,
  })
  if (error) throw error
}
