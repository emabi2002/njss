import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, requirePermission } from '@/lib/rbac/server'

type BudgetActivationOperation = 'prepare' | 'submit' | 'activate'
type BudgetActivationRpc =
  | 'njss_prepare_budget_activation'
  | 'njss_submit_budget_activation'
  | 'njss_activate_approved_budget'

export async function POST(request: NextRequest) {
  let body: { operation?: string; batchId?: string }
  try {
    body = (await request.json()) as { operation?: string; batchId?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid budget activation request.' }, { status: 400 })
  }

  const operation = body.operation as BudgetActivationOperation | undefined
  if (!body.batchId) {
    return NextResponse.json({ error: 'Budget activation batch is required.' }, { status: 400 })
  }

  if (operation === 'prepare') {
    return runRpc(request, body.batchId, ['budget.activation.prepare'], 'njss_prepare_budget_activation')
  }
  if (operation === 'submit') {
    return runRpc(request, body.batchId, ['budget.activation.submit'], 'njss_submit_budget_activation')
  }
  if (operation === 'activate') {
    return runRpc(request, body.batchId, ['budget.activation.authorize'], 'njss_activate_approved_budget')
  }

  return NextResponse.json({ error: 'Unsupported budget activation operation.' }, { status: 400 })
}

async function runRpc(
  request: NextRequest,
  batchId: string,
  permissions: string[],
  rpc: BudgetActivationRpc,
) {
  const guard = await requirePermission(request, permissions)
  if (guard.response) return guard.response

  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const { data, error } = await supabase.rpc(rpc, {
    p_activation_batch_id: batchId,
    p_user_email: guard.context?.email || '',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}
