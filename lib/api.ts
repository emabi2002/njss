import { supabase } from './supabase'
import type {
  Department, Section, Role, Province, FundingSource, ChartOfAccount
} from './supabase'
import {
  notifyFF3Endorsed, notifyFF3Approved, notifyFF3Rejected,
  notifyFF4Verified, notifyFF4Approved, notifyFF4Processed, notifyFF4Paid, notifyFF4Cancelled,
  notifyCommitmentCreated, notifyCommitmentFullyPaid
} from './notifications'

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

  // NOTE: do NOT filter by status here. Actual expenditure must include the
  // paid amounts of FULLY_PAID commitments, otherwise "spent" is under-counted.
  const { data: commitments, error: comError } = await supabase
    .from('ff3_commitments')
    .select('committed_amount, paid_amount, status')
    .eq('financial_year', financialYear)

  if (comError) throw comError

  const totalBudget = allocations?.reduce((sum, a) => sum + (a.original_budget || 0) + (a.supplemental_budget || 0), 0) || 0
  const quarterlyReleased = releases?.reduce((sum, r) => sum + (r.released_amount || 0), 0) || 0
  // Outstanding (still-committed but unpaid) portion — excludes cancelled commitments
  const committedAmount = commitments?.reduce((sum, c) =>
    sum + (c.status === 'CANCELLED' ? 0 : (c.committed_amount || 0) - (c.paid_amount || 0)), 0) || 0
  // Actual expenditure = everything paid, regardless of commitment status
  const actualExpenditure = commitments?.reduce((sum, c) => sum + (c.paid_amount || 0), 0) || 0
  const availableBalance = quarterlyReleased - committedAmount - actualExpenditure

  return {
    totalBudget,
    quarterlyReleased,
    committedAmount,
    actualExpenditure,
    availableBalance
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
  return data
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
  // Insert header
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
      total_estimated_amount: data.items.reduce((sum, i) => sum + (i.quantity * i.estimated_unit_price), 0)
    })
    .select()
    .single()

  if (headerError) throw headerError

  // Insert items
  const itemsToInsert = data.items.map((item, index) => ({
    ff3_header_id: header.id,
    line_number: index + 1,
    item_description: item.item_description,
    quantity: item.quantity,
    estimated_unit_price: item.estimated_unit_price,
    unit_of_measure: item.unit_of_measure
  }))

  const { error: itemsError } = await supabase
    .from('ff3_items')
    .insert(itemsToInsert)

  if (itemsError) throw itemsError

  // Insert quotations
  const quotsToInsert = data.quotations.map(q => ({
    ff3_header_id: header.id,
    supplier_name: q.supplier_name,
    quotation_amount: q.quotation_amount,
    quotation_number: q.quotation_number,
    quotation_date: q.quotation_date,
    is_selected: q.is_selected || false
  }))

  const { error: quotsError } = await supabase
    .from('ff3_quotations')
    .insert(quotsToInsert)

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
  return data
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
  return data
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

  return { ff3Pending, ff4Pending }
}

// ==========================================
// FF3 APPROVAL WORKFLOW
// ==========================================

export type FF3ApprovalAction = 'ENDORSE_SUPERVISOR' | 'ENDORSE_SECTION_HEAD' | 'APPROVE' | 'REJECT'

export async function approveFF3(
  ff3Id: string,
  action: FF3ApprovalAction,
  comments?: string
) {
  const statusMap: Record<FF3ApprovalAction, string> = {
    'ENDORSE_SUPERVISOR': 'ENDORSED_SUPERVISOR',
    'ENDORSE_SECTION_HEAD': 'ENDORSED_SECTION_HEAD',
    'APPROVE': 'APPROVED',
    'REJECT': 'REJECTED'
  }

  const newStatus = statusMap[action]
  const now = new Date().toISOString()

  // Build an action-specific update so the right timestamp/field is set
  const headerUpdate: Record<string, unknown> = { status: newStatus, updated_at: now }
  if (action === 'ENDORSE_SUPERVISOR') headerUpdate.supervisor_endorsed_date = now
  if (action === 'ENDORSE_SECTION_HEAD') headerUpdate.section_head_endorsed_date = now
  if (action === 'APPROVE') headerUpdate.approved_date = now
  if (action === 'REJECT') headerUpdate.rejection_reason = comments || 'No reason provided'

  // Update FF3 header status
  const { data: header, error: headerError } = await supabase
    .from('ff3_headers')
    .update(headerUpdate)
    .eq('id', ff3Id)
    .select()
    .single()

  if (headerError) throw headerError

  // Record approval in ff3_approvals table
  const { error: approvalError } = await supabase
    .from('ff3_approvals')
    .insert({
      ff3_header_id: ff3Id,
      approval_level: action,
      action_taken: action === 'REJECT' ? 'REJECTED' : action === 'APPROVE' ? 'APPROVED' : 'ENDORSED',
      comments: comments || null,
      action_date: now
    })

  if (approvalError) throw approvalError

  // If approved, create a commitment (linked to a matching budget allocation when possible)
  if (action === 'APPROVE') {
    const { data: ff3, error: ff3Error } = await supabase
      .from('ff3_headers')
      .select('financial_year, total_estimated_amount, department_id, section_id, funding_source_id')
      .eq('id', ff3Id)
      .single()

    if (ff3Error) throw ff3Error

    // Best-effort: find a budget allocation for the same FY/department/section
    let budgetAllocationId: string | null = null
    try {
      let allocQuery = supabase
        .from('budget_allocations')
        .select('id')
        .eq('financial_year', ff3.financial_year)
        .eq('is_active', true)
        .limit(1)
      if (ff3.department_id) allocQuery = allocQuery.eq('department_id', ff3.department_id)
      if (ff3.section_id) allocQuery = allocQuery.eq('section_id', ff3.section_id)
      const { data: alloc } = await allocQuery.maybeSingle()
      budgetAllocationId = alloc?.id || null
    } catch {
      budgetAllocationId = null
    }

    // Create commitment record and read it back (for the commitment number)
    const { data: commitment, error: commitmentError } = await supabase
      .from('ff3_commitments')
      .insert({
        ff3_header_id: ff3Id,
        budget_allocation_id: budgetAllocationId,
        financial_year: ff3.financial_year,
        commitment_date: now.split('T')[0],
        committed_amount: ff3.total_estimated_amount || 0,
        paid_amount: 0,
        status: 'ACTIVE'
      })
      .select()
      .single()

    if (commitmentError) throw commitmentError

    // Send approval + commitment notifications
    await notifyFF3Approved(header.ff3_number, ff3Id, header.total_estimated_amount || 0)
    if (commitment) {
      await notifyCommitmentCreated(
        commitment.commitment_number,
        header.ff3_number,
        commitment.committed_amount || 0
      )
    }
  } else if (action === 'REJECT') {
    await notifyFF3Rejected(header.ff3_number, ff3Id, comments || 'No reason provided')
  } else {
    await notifyFF3Endorsed(header.ff3_number, ff3Id, action)
  }

  return header
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
  const statusMap: Record<FF4ApprovalAction, string> = {
    'VERIFY': 'VERIFIED',
    'APPROVE': 'APPROVED',
    'PROCESS': 'PROCESSED',
    'MARK_PAID': 'PAID',
    'RECONCILE': 'RECONCILED',
    'CANCEL': 'CANCELLED'
  }

  const newStatus = statusMap[action]
  const now = new Date().toISOString()
  const today = now.split('T')[0]

  const updateData: Record<string, unknown> = { status: newStatus, updated_at: now }
  if (action === 'VERIFY') updateData.verified_date = now
  if (action === 'APPROVE') updateData.approved_date = now
  if (action === 'RECONCILE') updateData.reconciled_date = now

  // Add payment details if marking as paid
  if (action === 'MARK_PAID') {
    updateData.payment_date = today
    updateData.paid_date = now
    if (paymentReference) {
      updateData.external_payment_reference = paymentReference
    }
  }

  // GUARD: prevent paying more than the remaining commitment balance
  if (action === 'MARK_PAID') {
    const { data: ff4, error: ff4Err } = await supabase
      .from('ff4_headers')
      .select('net_amount, commitment_id')
      .eq('id', ff4Id)
      .single()
    if (ff4Err) throw ff4Err

    if (ff4.commitment_id) {
      const { data: commitment, error: comErr } = await supabase
        .from('ff3_commitments')
        .select('paid_amount, committed_amount')
        .eq('id', ff4.commitment_id)
        .single()
      if (comErr) throw comErr

      const remaining = (commitment.committed_amount || 0) - (commitment.paid_amount || 0)
      if ((ff4.net_amount || 0) > remaining + 0.001) {
        throw new Error(
          `Payment of K ${(ff4.net_amount || 0).toLocaleString()} exceeds the remaining commitment balance of K ${remaining.toLocaleString()}.`
        )
      }
    }
  }

  // Update FF4 header status
  const { data: header, error: headerError } = await supabase
    .from('ff4_headers')
    .update(updateData)
    .eq('id', ff4Id)
    .select()
    .single()

  if (headerError) throw headerError

  // If paid, update the commitment balance + record a payment transaction
  let commitmentFullyPaid: { number: string; total: number } | null = null
  if (action === 'MARK_PAID' && header.commitment_id) {
    const { data: commitment, error: comError } = await supabase
      .from('ff3_commitments')
      .select('commitment_number, paid_amount, committed_amount')
      .eq('id', header.commitment_id)
      .single()

    if (comError) throw comError

    const newPaidAmount = (commitment.paid_amount || 0) + (header.net_amount || 0)
    const commitmentStatus = newPaidAmount >= (commitment.committed_amount || 0) ? 'FULLY_PAID' : 'PARTIALLY_PAID'

    const { error: updateComError } = await supabase
      .from('ff3_commitments')
      .update({ paid_amount: newPaidAmount, status: commitmentStatus })
      .eq('id', header.commitment_id)

    if (updateComError) throw updateComError

    // Record the payment transaction (ledger entry)
    await supabase.from('payment_transactions').insert({
      ff4_header_id: ff4Id,
      commitment_id: header.commitment_id,
      transaction_date: today,
      transaction_type: 'PAYMENT',
      amount: header.net_amount || 0,
      payment_reference: paymentReference || header.external_payment_reference || null,
      reconciled: false
    })

    if (commitmentStatus === 'FULLY_PAID') {
      commitmentFullyPaid = { number: commitment.commitment_number, total: newPaidAmount }
    }
  }

  // Mark payment transactions reconciled when the FF4 is reconciled
  if (action === 'RECONCILE') {
    await supabase
      .from('payment_transactions')
      .update({ reconciled: true })
      .eq('ff4_header_id', ff4Id)
  }

  // Send notifications based on action
  switch (action) {
    case 'VERIFY':
      await notifyFF4Verified(header.ff4_number, ff4Id)
      break
    case 'APPROVE':
      await notifyFF4Approved(header.ff4_number, ff4Id)
      break
    case 'PROCESS':
      await notifyFF4Processed(header.ff4_number, ff4Id)
      break
    case 'MARK_PAID':
      await notifyFF4Paid(header.ff4_number, ff4Id, header.net_amount || 0, paymentReference || '')
      break
    case 'CANCEL':
      await notifyFF4Cancelled(header.ff4_number, ff4Id, comments)
      break
  }

  // Notify when the linked commitment becomes fully paid
  if (commitmentFullyPaid) {
    await notifyCommitmentFullyPaid(commitmentFullyPaid.number, commitmentFullyPaid.total)
  }

  return header
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
  let q = supabase.from('cost_centres').select('*, section:sections(name), department:departments(name)').eq('is_active', true).order('code')
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
  let q = supabase.from('expense_items').select('*, category:expense_categories(code, name)').eq('is_active', true).order('code')
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

// full_expense_code is generated by the DB trigger (DEPT-CC-CAT-ITEM)
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
    .insert({ ...input, full_expense_code: 'PENDING' }) // overwritten by trigger
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getActivityTemplates() {
  const { data, error } = await supabase.from('activity_templates').select('*, category:expense_categories(name)').eq('is_active', true).order('name')
  if (error) throw error
  return data
}

export async function getFinancialYears() {
  const { data, error } = await supabase.from('financial_years').select('*').order('year', { ascending: false })
  if (error) throw error
  return data
}

// ==========================================
// ANNUAL ACTIVITY PLAN WORKFLOW
// DRAFT → SUBMITTED → REVIEWED → APPROVED_BY_DEPARTMENT
//       → AUTHORIZED_BY_REGISTRAR → BUDGET_CONFIRMED
// ==========================================

export type PlanAction = 'SUBMIT' | 'REVIEW' | 'APPROVE_DEPARTMENT' | 'AUTHORIZE_REGISTRAR' | 'CONFIRM_BUDGET' | 'REJECT' | 'RETURN'

const PLAN_STATUS_MAP: Record<PlanAction, string> = {
  SUBMIT: 'SUBMITTED',
  REVIEW: 'REVIEWED',
  APPROVE_DEPARTMENT: 'APPROVED_BY_DEPARTMENT',
  AUTHORIZE_REGISTRAR: 'AUTHORIZED_BY_REGISTRAR',
  CONFIRM_BUDGET: 'BUDGET_CONFIRMED',
  REJECT: 'REJECTED',
  RETURN: 'RETURNED_FOR_CORRECTION',
}

export async function transitionAnnualPlan(planId: string, action: PlanAction, comments?: string) {
  const newStatus = PLAN_STATUS_MAP[action]
  const now = new Date().toISOString()
  const update: Record<string, unknown> = { status: newStatus }
  if (action === 'SUBMIT') update.submitted_at = now
  if (action === 'REVIEW') update.reviewed_at = now
  if (action === 'APPROVE_DEPARTMENT') update.approved_at = now
  if (action === 'AUTHORIZE_REGISTRAR') update.registrar_authorized_at = now
  if (action === 'CONFIRM_BUDGET') update.budget_confirmed_at = now
  if (action === 'REJECT' || action === 'RETURN') update.rejection_reason = comments || null

  const { data, error } = await supabase.from('annual_plan_headers').update(update).eq('id', planId).select().single()
  if (error) throw error

  // When budget is confirmed, materialise the plan lines into budget allocations
  if (action === 'CONFIRM_BUDGET') {
    await confirmPlanToBudget(planId)
  }
  return data
}

// Turn an authorized plan's lines into active budget allocations
export async function confirmPlanToBudget(planId: string) {
  const { data: plan, error: pErr } = await supabase
    .from('annual_plan_headers')
    .select('id, financial_year, department_id, section_id, cost_centre_id')
    .eq('id', planId)
    .single()
  if (pErr) throw pErr

  const { data: lines, error: lErr } = await supabase
    .from('annual_plan_lines')
    .select('id, total_amount, account_id, funding_source_id, project_id, expense_code_registry_id, cost_centre_id')
    .eq('plan_header_id', planId)
  if (lErr) throw lErr
  if (!lines || lines.length === 0) return { created: 0 }

  // budget_allocations.account_id is NOT NULL — fall back to the first account
  const { data: fallbackAccount } = await supabase.from('chart_of_accounts').select('id').eq('is_active', true).limit(1).maybeSingle()

  const rows = lines.map((l) => ({
    financial_year: plan.financial_year,
    department_id: plan.department_id,
    section_id: plan.section_id,
    cost_centre_id: l.cost_centre_id || plan.cost_centre_id || null,
    expense_code_registry_id: l.expense_code_registry_id || null,
    account_id: l.account_id || fallbackAccount?.id,
    funding_source_id: l.funding_source_id || null,
    project_id: l.project_id || null,
    annual_plan_line_id: l.id,
    original_budget: l.total_amount || 0,
    is_active: true,
  })).filter((r) => r.account_id)

  if (rows.length === 0) return { created: 0 }
  const { error: insErr } = await supabase.from('budget_allocations').insert(rows)
  if (insErr) throw insErr
  return { created: rows.length }
}

// ==========================================
// BUDGET CONSOLIDATION (department roll-up of confirmed plans)
// ==========================================

export async function consolidateDepartmentBudget(financialYear: number, departmentId: string) {
  const { data: plans, error } = await supabase
    .from('annual_plan_headers')
    .select('id, section_id, total_planned_budget, status')
    .eq('financial_year', financialYear)
    .eq('department_id', departmentId)
    .in('status', ['AUTHORIZED_BY_REGISTRAR', 'BUDGET_CONFIRMED'])
  if (error) throw error

  const total = (plans || []).reduce((s, p) => s + (p.total_planned_budget || 0), 0)
  const sections = new Set((plans || []).map((p) => p.section_id).filter(Boolean))

  const { data, error: upErr } = await supabase
    .from('budget_consolidations')
    .upsert({
      financial_year: financialYear,
      department_id: departmentId,
      status: 'CONSOLIDATED',
      total_amount: total,
      section_count: sections.size,
      plan_count: (plans || []).length,
      consolidated_at: new Date().toISOString(),
    }, { onConflict: 'financial_year,department_id' })
    .select()
    .single()
  if (upErr) throw upErr
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
  const { data, error } = await supabase.from('v_budget_by_code').select('*').eq('financial_year', financialYear)
  if (error) throw error
  return data
}

// ==========================================
// QUARTERLY BUDGET RELEASES (per budget allocation / expense code)
// ==========================================

// Allocations available to release against (with code, approved & released-so-far)
export async function getAllocationsForRelease(financialYear: number) {
  const { data: allocs, error } = await supabase
    .from('budget_allocations')
    .select('id, revised_budget, department:departments(code, name), section:sections(name), cost_centre:cost_centres(code, name), expense_code:expense_code_registry(full_expense_code)')
    .eq('financial_year', financialYear)
    .eq('is_active', true)
  if (error) throw error

  const { data: releases } = await supabase
    .from('quarterly_releases')
    .select('budget_allocation_id, released_amount')
    .eq('financial_year', financialYear)
  const releasedByAlloc = new Map<string, number>()
  ;(releases || []).forEach((r) => {
    if (!r.budget_allocation_id) return
    releasedByAlloc.set(r.budget_allocation_id, (releasedByAlloc.get(r.budget_allocation_id) || 0) + (r.released_amount || 0))
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (allocs || []).map((a: any) => {
    const released = releasedByAlloc.get(a.id) || 0
    return {
      id: a.id,
      revised_budget: a.revised_budget || 0,
      released,
      releasable: Math.max(0, (a.revised_budget || 0) - released),
      department_name: a.department?.name || null,
      section_name: a.section?.name || null,
      cost_centre_code: a.cost_centre?.code || null,
      cost_centre_name: a.cost_centre?.name || null,
      full_expense_code: a.expense_code?.full_expense_code || null,
    }
  })
}

// All release lines for a year (from v_releases_by_code)
export async function getReleases(financialYear: number) {
  const { data, error } = await supabase
    .from('v_releases_by_code')
    .select('*')
    .eq('financial_year', financialYear)
    .order('release_date', { ascending: false })
  if (error) throw error
  return data
}

// Create a quarterly release; guards against releasing beyond the approved budget.
export async function createQuarterlyRelease(input: {
  budget_allocation_id: string
  financial_year: number
  quarter: number
  released_amount: number
  release_date?: string
}) {
  // Guard: cumulative releases must not exceed the allocation's revised budget
  const { data: alloc, error: aErr } = await supabase
    .from('budget_allocations')
    .select('revised_budget')
    .eq('id', input.budget_allocation_id)
    .single()
  if (aErr) throw aErr

  const { data: priorReleases } = await supabase
    .from('quarterly_releases')
    .select('released_amount')
    .eq('budget_allocation_id', input.budget_allocation_id)
  const alreadyReleased = (priorReleases || []).reduce((s, r) => s + (r.released_amount || 0), 0)
  const ceiling = alloc.revised_budget || 0
  if (alreadyReleased + input.released_amount > ceiling + 0.001) {
    throw new Error(
      `Release of K ${input.released_amount.toLocaleString()} would exceed the approved budget. ` +
      `Approved K ${ceiling.toLocaleString()}, already released K ${alreadyReleased.toLocaleString()}, ` +
      `remaining to release K ${(ceiling - alreadyReleased).toLocaleString()}.`
    )
  }

  const { data, error } = await supabase
    .from('quarterly_releases')
    .insert({
      budget_allocation_id: input.budget_allocation_id,
      financial_year: input.financial_year,
      quarter: input.quarter,
      released_amount: input.released_amount,
      release_date: input.release_date || new Date().toISOString().split('T')[0],
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// ==========================================
// BUDGET AVAILABILITY CHECK (used by FF3)
// ==========================================

export async function checkBudgetAvailability(params: { financialYear: number; expenseCodeId?: string | null; sectionId?: string | null; amount: number }) {
  // Find allocations matching the expense code (preferred) or the section
  let q = supabase.from('budget_allocations').select('id, revised_budget').eq('financial_year', params.financialYear).eq('is_active', true)
  if (params.expenseCodeId) q = q.eq('expense_code_registry_id', params.expenseCodeId)
  else if (params.sectionId) q = q.eq('section_id', params.sectionId)
  const { data: allocs, error } = await q
  if (error) throw error

  const revised = (allocs || []).reduce((s, a) => s + (a.revised_budget || 0), 0)
  const allocIds = (allocs || []).map((a) => a.id)

  let released = 0
  let committed = 0
  let spent = 0
  if (allocIds.length > 0) {
    const { data: rels } = await supabase
      .from('quarterly_releases')
      .select('released_amount, budget_allocation_id')
      .in('budget_allocation_id', allocIds)
    released = (rels || []).reduce((s, r) => s + (r.released_amount || 0), 0)

    const { data: coms } = await supabase
      .from('ff3_commitments')
      .select('committed_amount, paid_amount, status, budget_allocation_id')
      .in('budget_allocation_id', allocIds)
    committed = (coms || []).reduce((s, c) => s + (c.status === 'CANCELLED' ? 0 : (c.committed_amount || 0) - (c.paid_amount || 0)), 0)
    spent = (coms || []).reduce((s, c) => s + (c.paid_amount || 0), 0)
  }

  // Cash-control available = released - committed - spent (spec formula).
  const available = released - committed - spent
  // Approved-ceiling available, for context.
  const approvedAvailable = revised - committed - spent
  return {
    revised,
    released,
    committed,
    spent,
    available,
    approvedAvailable,
    unreleased: revised - released,
    requested: params.amount,
    withinBudget: params.amount <= available,
    hasAllocation: allocIds.length > 0,
  }
}
