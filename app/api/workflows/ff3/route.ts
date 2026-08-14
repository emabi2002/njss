import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, requirePermission } from '@/lib/rbac/server'
import type { FF3ApprovalAction } from '@/lib/api'

const ACTION_PERMISSION: Record<FF3ApprovalAction, string[]> = {
  ENDORSE_SUPERVISOR: ['ff3.endorse'],
  ENDORSE_SECTION_HEAD: ['ff3.endorse'],
  APPROVE: ['ff3.approve'],
  REJECT: ['ff3.reject'],
}

const STATUS_MAP: Record<FF3ApprovalAction, string> = {
  ENDORSE_SUPERVISOR: 'ENDORSED_SUPERVISOR',
  ENDORSE_SECTION_HEAD: 'ENDORSED_SECTION_HEAD',
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const ff3Id = body.ff3Id as string
  const action = body.action as FF3ApprovalAction
  const comments = body.comments as string | undefined

  if (!ff3Id || !ACTION_PERMISSION[action]) {
    return NextResponse.json({ error: 'Invalid FF3 workflow request' }, { status: 400 })
  }

  const guard = await requirePermission(request, ACTION_PERMISSION[action])
  if (guard.response) return guard.response

  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const now = new Date().toISOString()

  const { data: current, error: currentError } = await supabase
    .from('ff3_headers')
    .select('id, ff3_number, financial_year, total_estimated_amount, department_id, section_id, expense_code_registry_id, funding_source_id, created_by, requesting_officer_id, supervisor_endorsed_by, section_head_endorsed_by')
    .eq('id', ff3Id)
    .single()

  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 })

  if (action === 'APPROVE') {
    const { data: allowed } = await supabase.rpc('fn_check_segregation_of_duties', {
      p_entity_type: 'FF3',
      p_created_by: current.created_by || current.requesting_officer_id,
      p_verified_by: current.supervisor_endorsed_by || current.section_head_endorsed_by,
      p_approved_by: null,
    })
    if (allowed === false) {
      return NextResponse.json({ error: 'Segregation of duties prevents the same user from creating/verifying/approving this FF3.' }, { status: 403 })
    }
  }

  const headerUpdate: Record<string, unknown> = { status: STATUS_MAP[action], updated_at: now }
  if (action === 'ENDORSE_SUPERVISOR') {
    headerUpdate.supervisor_endorsed_date = now
    headerUpdate.supervisor_endorsed_by = guard.context?.userId || null
  }
  if (action === 'ENDORSE_SECTION_HEAD') {
    headerUpdate.section_head_endorsed_date = now
    headerUpdate.section_head_endorsed_by = guard.context?.userId || null
  }
  if (action === 'APPROVE') {
    headerUpdate.approved_date = now
    headerUpdate.approved_by = guard.context?.userId || null
  }
  if (action === 'REJECT') headerUpdate.rejection_reason = comments || 'No reason provided'

  const { data: header, error: headerError } = await supabase
    .from('ff3_headers')
    .update(headerUpdate)
    .eq('id', ff3Id)
    .select()
    .single()

  if (headerError) return NextResponse.json({ error: headerError.message }, { status: 500 })

  const { error: approvalError } = await supabase.from('ff3_approvals').insert({
    ff3_header_id: ff3Id,
    approver_id: guard.context?.userId || null,
    approval_level: action,
    action_taken: action === 'REJECT' ? 'REJECTED' : action === 'APPROVE' ? 'APPROVED' : 'ENDORSED',
    comments: comments || null,
    action_date: now,
  })

  if (approvalError) return NextResponse.json({ error: approvalError.message }, { status: 500 })

  let commitment = null
  if (action === 'APPROVE') {
    let budgetAllocationId: string | null = null
    let allocQuery = supabase
      .from('budget_allocations')
      .select('id, revised_budget')
      .eq('financial_year', current.financial_year)
      .eq('is_active', true)
      .limit(1)
    if (current.expense_code_registry_id) allocQuery = allocQuery.eq('expense_code_registry_id', current.expense_code_registry_id)
    if (current.department_id) allocQuery = allocQuery.eq('department_id', current.department_id)
    if (current.section_id) allocQuery = allocQuery.eq('section_id', current.section_id)
    if (current.funding_source_id) allocQuery = allocQuery.eq('funding_source_id', current.funding_source_id)
    let { data: alloc } = await allocQuery.maybeSingle()

    if (!alloc && current.expense_code_registry_id) {
      let fallbackQuery = supabase
        .from('budget_allocations')
        .select('id, revised_budget')
        .eq('financial_year', current.financial_year)
        .eq('expense_code_registry_id', current.expense_code_registry_id)
        .eq('is_active', true)
        .limit(1)
      if (current.department_id) fallbackQuery = fallbackQuery.eq('department_id', current.department_id)
      const fallback = await fallbackQuery.maybeSingle()
      alloc = fallback.data
    }

    if (!alloc) {
      return NextResponse.json({ error: 'No approved Excel budget allocation found for this FF3 finance code/section.' }, { status: 400 })
    }
    budgetAllocationId = alloc.id

    const { data: createdCommitment, error: commitmentError } = await supabase
      .from('ff3_commitments')
      .insert({
        ff3_header_id: ff3Id,
        budget_allocation_id: budgetAllocationId,
        financial_year: current.financial_year,
        commitment_date: now.split('T')[0],
        committed_amount: current.total_estimated_amount || 0,
        paid_amount: 0,
        status: 'ACTIVE',
      })
      .select()
      .single()

    if (commitmentError) return NextResponse.json({ error: commitmentError.message }, { status: 500 })
    commitment = createdCommitment
  }

  await supabase.from('audit_logs').insert({
    user_id: guard.context?.userId || null,
    user_email: guard.context?.email || null,
    user_name: guard.context?.name || null,
    action: `FF3_${action}`,
    entity_type: 'FF3',
    entity_id: ff3Id,
    entity_reference: current.ff3_number,
    new_values: { status: STATUS_MAP[action], comments },
  })

  return NextResponse.json({ header, commitment })
}
