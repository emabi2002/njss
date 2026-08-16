import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, requirePermission } from '@/lib/rbac/server'
import type { FF3ApprovalAction } from '@/lib/api'

const ACTION_PERMISSION: Record<FF3ApprovalAction, string[]> = {
  SUBMIT: ['ff3.submit'],
  ENDORSE_SUPERVISOR: ['ff3.endorse'],
  ENDORSE_SECTION_HEAD: ['ff3.endorse'],
  APPROVE: ['ff3.approve'],
  REJECT: ['ff3.reject'],
  CANCEL: ['ff3.cancel'],
  RETURN: ['ff3.endorse'],
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
  const { data, error } = await supabase.rpc('njss_transition_ff3', {
    p_ff3_id: ff3Id,
    p_action: action,
    p_comments: comments || null,
    p_user_email: guard.context?.email || '',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({
    header: data?.header ?? data,
    commitment: data?.commitment ?? null,
    financialPositionBefore: data?.financial_position_before ?? null,
    financialPositionAfter: data?.financial_position_after ?? null,
  })
}
