import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, requirePermission } from '@/lib/rbac/server'

const FUNDING_AUTHORITY_PERMISSION: Record<string, string[]> = {
  SUBMIT: ['funding.submit'],
  VERIFY: ['funding.verify'],
  APPROVE: ['funding.approve'],
  REJECT: ['funding.reject'],
}

const FUNDING_RECEIPT_PERMISSION: Record<string, string[]> = FUNDING_AUTHORITY_PERMISSION

// Legacy Annual Plan workflow is retired from active use. Historical records remain read-only.

const SUBMISSION_PERMISSION: Record<string, string[]> = {
  SUBMIT: ['budget.template.submit'],
  RESUBMIT: ['budget.template.submit'],
  REVIEW: ['budget.template.review'],
  APPROVE: ['budget.template.approve'],
  REJECT: ['budget.template.review', 'budget.template.approve'],
  RETURN: ['budget.template.review'],
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const operation = body.operation as string

  if (operation === 'transition-plan') {
    return NextResponse.json({ error: 'Annual Activity Plan workflow is retired. Use Budget Preparation for submission, review and approval.' }, { status: 410 })
  }
  if (operation === 'create-quarterly-release') {
    return createRelease(request, body)
  }
  if (operation === 'transition-submission') {
    return transitionSubmission(request, body)
  }
  if (operation === 'create-funding-authority') {
    return createFundingAuthority(request, body)
  }
  if (operation === 'transition-funding-authority') {
    return transitionFundingAuthority(request, body)
  }
  if (operation === 'create-funding-receipt') {
    return createFundingReceipt(request, body)
  }
  if (operation === 'transition-funding-receipt') {
    return transitionFundingReceipt(request, body)
  }
  if (operation === 'allocate-funding') {
    return allocateFunding(request, body)
  }
  if (operation === 'approve-funding-allocation') {
    return approveFundingAllocation(request, body)
  }

  return NextResponse.json({ error: 'Unsupported budget workflow operation' }, { status: 400 })
}

// Legacy Annual Plan transition and Confirm to Budget functions intentionally removed from active API use.

async function createRelease(request: NextRequest, body: Record<string, unknown>) {
  const guard = await requirePermission(request, ['budget.release'])
  if (guard.response) return guard.response

  const input = body.input as {
    budget_allocation_id: string
    financial_year: number
    quarter: number
    released_amount: number
    release_date?: string
    funding_allocation_id?: string | null
    notes?: string | null
  }
  if (!input?.budget_allocation_id || !input.financial_year || !input.quarter || !input.released_amount) {
    return NextResponse.json({ error: 'Invalid quarterly release request' }, { status: 400 })
  }

  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const { data, error } = await supabase.rpc('njss_create_budget_release', {
    p_budget_allocation_id: input.budget_allocation_id,
    p_financial_year: input.financial_year,
    p_quarter: input.quarter,
    p_released_amount: input.released_amount,
    p_release_date: input.release_date || new Date().toISOString().split('T')[0],
    p_funding_allocation_id: input.funding_allocation_id || null,
    p_notes: input.notes || null,
    p_user_email: guard.context?.email || '',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ data })
}

async function createFundingAuthority(request: NextRequest, body: Record<string, unknown>) {
  const guard = await requirePermission(request, ['funding.create'])
  if (guard.response) return guard.response
  const input = body.input as Record<string, unknown>
  if (!input?.financial_year || !input.authority_type || !input.approved_amount) {
    return NextResponse.json({ error: 'Invalid funding authority request' }, { status: 400 })
  }
  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const { data, error } = await supabase.rpc('njss_create_funding_authority', {
    p_financial_year: input.financial_year,
    p_authority_type: input.authority_type,
    p_funding_source_id: input.funding_source_id || null,
    p_approved_amount: input.approved_amount,
    p_effective_date: input.effective_date || new Date().toISOString().split('T')[0],
    p_expiry_date: input.expiry_date || null,
    p_source_agency: input.source_agency || null,
    p_source_department: input.source_department || null,
    p_appropriation_reference: input.appropriation_reference || null,
    p_warrant_number: input.warrant_number || null,
    p_warrant_date: input.warrant_date || null,
    p_donor_agreement_reference: input.donor_agreement_reference || null,
    p_project_reference: input.project_reference || null,
    p_description: input.description || null,
    p_supporting_document_url: input.supporting_document_url || null,
    p_supporting_document_name: input.supporting_document_name || null,
    p_restricted_project_id: input.restricted_project_id || null,
    p_restricted_department_id: input.restricted_department_id || null,
    p_restricted_section_id: input.restricted_section_id || null,
    p_restricted_cost_centre_id: input.restricted_cost_centre_id || null,
    p_restricted_expense_code_registry_id: input.restricted_expense_code_registry_id || null,
    p_restriction_notes: input.restriction_notes || null,
    p_user_email: guard.context?.email || '',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

async function transitionFundingAuthority(request: NextRequest, body: Record<string, unknown>) {
  const id = body.id as string
  const action = body.action as string
  if (!id || !FUNDING_AUTHORITY_PERMISSION[action]) return NextResponse.json({ error: 'Invalid funding authority workflow request' }, { status: 400 })
  const guard = await requirePermission(request, FUNDING_AUTHORITY_PERMISSION[action])
  if (guard.response) return guard.response
  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const { data, error } = await supabase.rpc('njss_transition_funding_authority', {
    p_authority_id: id,
    p_action: action,
    p_comments: (body.comments as string | undefined) || null,
    p_user_email: guard.context?.email || '',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

async function createFundingReceipt(request: NextRequest, body: Record<string, unknown>) {
  const guard = await requirePermission(request, ['funding.create'])
  if (guard.response) return guard.response
  const input = body.input as Record<string, unknown>
  if (!input?.funding_authority_id || !input.amount_received) {
    return NextResponse.json({ error: 'Invalid funding receipt request' }, { status: 400 })
  }
  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const { data, error } = await supabase.rpc('njss_create_funding_receipt', {
    p_funding_authority_id: input.funding_authority_id,
    p_receipt_date: input.receipt_date || new Date().toISOString().split('T')[0],
    p_amount_received: input.amount_received,
    p_source_agency: input.source_agency || null,
    p_finance_ifms_reference: input.finance_ifms_reference || null,
    p_external_reference: input.external_reference || null,
    p_bank_reference: input.bank_reference || null,
    p_description: input.description || null,
    p_supporting_document_url: input.supporting_document_url || null,
    p_supporting_document_name: input.supporting_document_name || null,
    p_user_email: guard.context?.email || '',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

async function transitionFundingReceipt(request: NextRequest, body: Record<string, unknown>) {
  const id = body.id as string
  const action = body.action as string
  if (!id || !FUNDING_RECEIPT_PERMISSION[action]) return NextResponse.json({ error: 'Invalid funding receipt workflow request' }, { status: 400 })
  const guard = await requirePermission(request, FUNDING_RECEIPT_PERMISSION[action])
  if (guard.response) return guard.response
  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const { data, error } = await supabase.rpc('njss_transition_funding_receipt', {
    p_receipt_id: id,
    p_action: action,
    p_comments: (body.comments as string | undefined) || null,
    p_user_email: guard.context?.email || '',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

async function allocateFunding(request: NextRequest, body: Record<string, unknown>) {
  const guard = await requirePermission(request, ['funding.allocate'])
  if (guard.response) return guard.response
  const input = body.input as Record<string, unknown>
  if (!input?.funding_receipt_id || !input.budget_allocation_id || !input.allocated_amount) {
    return NextResponse.json({ error: 'Invalid funding allocation request' }, { status: 400 })
  }
  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const { data, error } = await supabase.rpc('njss_allocate_funding', {
    p_funding_receipt_id: input.funding_receipt_id,
    p_budget_allocation_id: input.budget_allocation_id,
    p_allocated_amount: input.allocated_amount,
    p_allocation_date: input.allocation_date || new Date().toISOString().split('T')[0],
    p_notes: input.notes || null,
    p_approve_immediately: input.approve_immediately || false,
    p_user_email: guard.context?.email || '',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

async function approveFundingAllocation(request: NextRequest, body: Record<string, unknown>) {
  const id = body.id as string
  if (!id) return NextResponse.json({ error: 'Invalid funding allocation approval request' }, { status: 400 })
  const guard = await requirePermission(request, ['funding.allocation.approve'])
  if (guard.response) return guard.response
  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const { data, error } = await supabase.rpc('njss_approve_funding_allocation', {
    p_allocation_id: id,
    p_comments: (body.comments as string | undefined) || null,
    p_user_email: guard.context?.email || '',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

async function transitionSubmission(request: NextRequest, body: Record<string, unknown>) {
  const id = body.id as string
  const action = body.action as string
  const comments = (body.comments as string | undefined) || ''
  if (!id || !SUBMISSION_PERMISSION[action]) return NextResponse.json({ error: 'Invalid submission workflow request' }, { status: 400 })

  const guard = await requirePermission(request, SUBMISSION_PERMISSION[action])
  if (guard.response) return guard.response

  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const { data, error } = await supabase.rpc('transition_divisional_budget_submission', {
    p_submission_id: id,
    p_action: action,
    p_comments: comments,
    p_user_email: guard.context?.email || '',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('audit_logs').insert({
    user_id: guard.context?.userId || null,
    user_email: guard.context?.email || null,
    user_name: guard.context?.name || null,
    action: `BUDGET_SUBMISSION_${action}`,
    entity_type: 'BUDGET_SUBMISSION',
    entity_id: id,
    new_values: { comments },
  })

  return NextResponse.json({ data })
}
