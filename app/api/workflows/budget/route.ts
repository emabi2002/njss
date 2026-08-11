import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, requirePermission } from '@/lib/rbac/server'
import type { PlanAction } from '@/lib/api'

const PLAN_STATUS_MAP: Record<PlanAction, string> = {
  SUBMIT: 'SUBMITTED',
  REVIEW: 'REVIEWED',
  APPROVE_DEPARTMENT: 'APPROVED_BY_DEPARTMENT',
  AUTHORIZE_REGISTRAR: 'AUTHORIZED_BY_REGISTRAR',
  CONFIRM_BUDGET: 'BUDGET_CONFIRMED',
  REJECT: 'REJECTED',
  RETURN: 'RETURNED_FOR_CORRECTION',
}

const PLAN_PERMISSION: Record<PlanAction, string[]> = {
  SUBMIT: ['plans.submit'],
  REVIEW: ['plans.review'],
  APPROVE_DEPARTMENT: ['plans.approve'],
  AUTHORIZE_REGISTRAR: ['plans.authorize'],
  CONFIRM_BUDGET: ['plans.confirm'],
  REJECT: ['plans.review', 'plans.approve', 'plans.authorize'],
  RETURN: ['plans.review', 'plans.approve', 'plans.authorize'],
}

const SUBMISSION_PERMISSION: Record<string, string[]> = {
  SUBMIT: ['budget.module.submit', 'budget.template.submit'],
  RESUBMIT: ['budget.module.submit', 'budget.template.submit'],
  REVIEW: ['budget.module.review', 'budget.template.review'],
  APPROVE: ['budget.module.approve', 'budget.template.approve'],
  REJECT: ['budget.module.review', 'budget.template.review', 'budget.module.approve', 'budget.template.approve'],
  RETURN: ['budget.module.review', 'budget.template.review'],
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const operation = body.operation as string

  if (operation === 'transition-plan') {
    return transitionPlan(request, body)
  }
  if (operation === 'create-quarterly-release') {
    return createRelease(request, body)
  }
  if (operation === 'transition-submission') {
    return transitionSubmission(request, body)
  }

  return NextResponse.json({ error: 'Unsupported budget workflow operation' }, { status: 400 })
}

async function transitionPlan(request: NextRequest, body: Record<string, unknown>) {
  const planId = body.planId as string
  const action = body.action as PlanAction
  const comments = body.comments as string | undefined
  if (!planId || !PLAN_PERMISSION[action]) return NextResponse.json({ error: 'Invalid plan workflow request' }, { status: 400 })

  const guard = await requirePermission(request, PLAN_PERMISSION[action])
  if (guard.response) return guard.response

  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const now = new Date().toISOString()
  const update: Record<string, unknown> = { status: PLAN_STATUS_MAP[action] }
  if (action === 'SUBMIT') update.submitted_at = now
  if (action === 'REVIEW') update.reviewed_at = now
  if (action === 'APPROVE_DEPARTMENT') update.approved_at = now
  if (action === 'AUTHORIZE_REGISTRAR') update.registrar_authorized_at = now
  if (action === 'CONFIRM_BUDGET') update.budget_confirmed_at = now
  if (action === 'REJECT' || action === 'RETURN') update.rejection_reason = comments || null

  const { data, error } = await supabase.from('annual_plan_headers').update(update).eq('id', planId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let allocationResult: { created: number } | null = null
  if (action === 'CONFIRM_BUDGET') {
    allocationResult = await confirmPlanToBudget(supabase, planId)
  }

  await supabase.from('audit_logs').insert({
    user_id: guard.context?.userId || null,
    user_email: guard.context?.email || null,
    user_name: guard.context?.name || null,
    action: `PLAN_${action}`,
    entity_type: 'ANNUAL_PLAN',
    entity_id: planId,
    new_values: { status: PLAN_STATUS_MAP[action], comments, allocationResult },
  })

  return NextResponse.json({ data, allocationResult })
}

async function confirmPlanToBudget(supabase: ReturnType<typeof createRequestSupabaseClient>, planId: string) {
  const { data: plan, error: planError } = await supabase
    .from('annual_plan_headers')
    .select('id, financial_year, department_id, section_id, cost_centre_id')
    .eq('id', planId)
    .single()
  if (planError) throw planError

  const { data: lines, error: lineError } = await supabase
    .from('annual_plan_lines')
    .select('id, total_amount, account_id, funding_source_id, project_id, expense_code_registry_id, cost_centre_id')
    .eq('plan_header_id', planId)
  if (lineError) throw lineError
  if (!lines?.length) return { created: 0 }

  const { data: fallbackAccount } = await supabase.from('chart_of_accounts').select('id').eq('is_active', true).limit(1).maybeSingle()
  const rows = lines.map((line) => ({
    financial_year: plan.financial_year,
    department_id: plan.department_id,
    section_id: plan.section_id,
    cost_centre_id: line.cost_centre_id || plan.cost_centre_id || null,
    expense_code_registry_id: line.expense_code_registry_id || null,
    account_id: line.account_id || fallbackAccount?.id,
    funding_source_id: line.funding_source_id || null,
    project_id: line.project_id || null,
    annual_plan_line_id: line.id,
    original_budget: line.total_amount || 0,
    is_active: true,
  })).filter((row) => row.account_id)

  if (!rows.length) return { created: 0 }
  const { error } = await supabase.from('budget_allocations').insert(rows)
  if (error) throw error
  return { created: rows.length }
}

async function createRelease(request: NextRequest, body: Record<string, unknown>) {
  const guard = await requirePermission(request, ['budget.release'])
  if (guard.response) return guard.response

  const input = body.input as {
    budget_allocation_id: string
    financial_year: number
    quarter: number
    released_amount: number
    release_date?: string
  }
  if (!input?.budget_allocation_id || !input.financial_year || !input.quarter) {
    return NextResponse.json({ error: 'Invalid quarterly release request' }, { status: 400 })
  }

  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const { data: alloc, error: allocError } = await supabase
    .from('budget_allocations')
    .select('revised_budget')
    .eq('id', input.budget_allocation_id)
    .single()
  if (allocError) return NextResponse.json({ error: allocError.message }, { status: 500 })

  const { data: priorReleases } = await supabase
    .from('quarterly_releases')
    .select('released_amount')
    .eq('budget_allocation_id', input.budget_allocation_id)
  const alreadyReleased = (priorReleases || []).reduce((sum, row) => sum + (row.released_amount || 0), 0)
  const ceiling = alloc.revised_budget || 0
  if (alreadyReleased + input.released_amount > ceiling + 0.001) {
    return NextResponse.json({ error: 'Release would exceed the approved budget.' }, { status: 400 })
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('audit_logs').insert({
    user_id: guard.context?.userId || null,
    user_email: guard.context?.email || null,
    user_name: guard.context?.name || null,
    action: 'BUDGET_RELEASE_CREATED',
    entity_type: 'QUARTERLY_RELEASE',
    entity_id: data.id,
    new_values: data,
  })

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
