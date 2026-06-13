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
