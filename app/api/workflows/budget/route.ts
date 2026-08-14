import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, requirePermission } from '@/lib/rbac/server'

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
