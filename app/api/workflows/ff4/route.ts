import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, requirePermission } from '@/lib/rbac/server'
import { toUserMessage } from '@/lib/errors'

type FF4WorkflowAction =
  | 'CREATE'
  | 'CREATE_DRAFT'
  | 'CREATE_AND_SUBMIT'
  | 'SUBMIT'
  | 'VERIFY'
  | 'APPROVE'
  | 'PROCESS'
  | 'MARK_PAID'
  | 'RECONCILE'
  | 'CANCEL'

const ACTION_PERMISSION: Record<FF4WorkflowAction, string[]> = {
  CREATE: ['ff4.create'],
  CREATE_DRAFT: ['ff4.create'],
  CREATE_AND_SUBMIT: ['ff4.create'],
  SUBMIT: ['ff4.create'],
  VERIFY: ['ff4.verify'],
  APPROVE: ['ff4.approve'],
  PROCESS: ['ff4.process'],
  MARK_PAID: ['ff4.process'],
  RECONCILE: ['ff4.process'],
  CANCEL: ['ff4.reject'],
}

function createdFf4Id(data: unknown) {
  if (!data || typeof data !== 'object') return null
  const root = data as Record<string, unknown>
  const header = root.header
  if (!header || typeof header !== 'object') return null
  const id = (header as Record<string, unknown>).id
  return typeof id === 'string' ? id : null
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const action = String(body.action || '').toUpperCase() as FF4WorkflowAction

  if (!ACTION_PERMISSION[action]) {
    return NextResponse.json({ error: 'Invalid FF4 workflow request' }, { status: 400 })
  }

  const guard = await requirePermission(request, ACTION_PERMISSION[action])
  if (guard.response) return guard.response

  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const userEmail = guard.context?.email || ''

  if (action === 'CREATE' || action === 'CREATE_DRAFT' || action === 'CREATE_AND_SUBMIT') {
    const { data, error } = await supabase.rpc('njss_create_ff4', {
      p_payload: body.payload || {},
      p_submit: action === 'CREATE_AND_SUBMIT' || Boolean(body.submit),
      p_user_email: userEmail,
    })
    if (error) {
      console.error('FF4 create workflow failed:', error)
      return NextResponse.json({ error: toUserMessage(error) }, { status: 400 })
    }

    const ff4Id = createdFf4Id(data)
    const paymentLines = Array.isArray(body.payload?.payment_lines) ? body.payload.payment_lines : []
    if (ff4Id && paymentLines.length > 0) {
      const { error: lineError } = await supabase.rpc('njss_save_ff4_payment_lines', {
        p_ff4_id: ff4Id,
        p_lines: paymentLines,
        p_user_email: userEmail,
      })
      if (lineError) {
        console.error('FF4 payment line persistence failed:', lineError)
        return NextResponse.json(
          { error: toUserMessage(lineError, 'FF4 was created but payment lines could not be saved.') },
          { status: 400 },
        )
      }
    }

    return NextResponse.json({ data })
  }

  const ff4Id = body.ff4Id as string
  if (!ff4Id) {
    return NextResponse.json({ error: 'FF4 id is required' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('njss_transition_ff4', {
    p_ff4_id: ff4Id,
    p_action: action,
    p_comments: body.comments || null,
    p_payment_reference: body.paymentReference || null,
    p_payment_date: body.paymentDate || null,
    p_payment_method: body.paymentMethod || null,
    p_cheque_number: body.chequeNumber || null,
    p_user_email: userEmail,
  })

  if (error) {
    console.error('FF4 transition workflow failed:', error)
    return NextResponse.json({ error: toUserMessage(error) }, { status: 400 })
  }
  return NextResponse.json({ data })
}
