import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, requirePermission } from '@/lib/rbac/server'

const ACTION_PERMISSION: Record<string, string[]> = {
  INCREASE: ['commitment.adjust'],
  DECREASE: ['commitment.adjust'],
  CANCEL: ['commitment.cancel'],
  RELEASE_UNUSED_BALANCE: ['commitment.release'],
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const commitmentId = body.commitment_id as string
  const action = body.action as string
  const amount = body.amount === undefined || body.amount === null ? null : Number(body.amount)
  const reason = body.reason as string | undefined
  const reference = body.reference as string | undefined

  if (!commitmentId || !ACTION_PERMISSION[action]) {
    return NextResponse.json({ error: 'Invalid commitment adjustment request' }, { status: 400 })
  }

  const guard = await requirePermission(request, ACTION_PERMISSION[action])
  if (guard.response) return guard.response

  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const { data, error } = await supabase.rpc('njss_adjust_commitment', {
    p_commitment_id: commitmentId,
    p_action: action,
    p_amount: amount,
    p_reason: reason || null,
    p_reference: reference || null,
    p_user_email: guard.context?.email || '',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
