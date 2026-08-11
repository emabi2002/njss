import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, requirePermission } from '@/lib/rbac/server'
import type { FF4ApprovalAction } from '@/lib/api'

const ACTION_PERMISSION: Record<FF4ApprovalAction, string[]> = {
  VERIFY: ['ff4.verify'],
  APPROVE: ['ff4.approve'],
  PROCESS: ['ff4.process'],
  MARK_PAID: ['ff4.process'],
  RECONCILE: ['ff4.process'],
  CANCEL: ['ff4.reject', 'ff4.process'],
}

const STATUS_MAP: Record<FF4ApprovalAction, string> = {
  VERIFY: 'VERIFIED',
  APPROVE: 'APPROVED',
  PROCESS: 'PROCESSED',
  MARK_PAID: 'PAID',
  RECONCILE: 'RECONCILED',
  CANCEL: 'CANCELLED',
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const ff4Id = body.ff4Id as string
  const action = body.action as FF4ApprovalAction
  const paymentReference = body.paymentReference as string | undefined
  const comments = body.comments as string | undefined

  if (!ff4Id || !ACTION_PERMISSION[action]) {
    return NextResponse.json({ error: 'Invalid FF4 workflow request' }, { status: 400 })
  }

  const guard = await requirePermission(request, ACTION_PERMISSION[action])
  if (guard.response) return guard.response

  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const now = new Date().toISOString()
  const today = now.split('T')[0]

  const { data: current, error: currentError } = await supabase
    .from('ff4_headers')
    .select('id, ff4_number, net_amount, commitment_id, created_by, verified_by, approved_by, external_payment_reference')
    .eq('id', ff4Id)
    .single()

  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 })

  if (action === 'APPROVE') {
    const { data: allowed } = await supabase.rpc('fn_check_segregation_of_duties', {
      p_entity_type: 'FF4',
      p_created_by: current.created_by,
      p_verified_by: current.verified_by,
      p_approved_by: null,
    })
    if (allowed === false) {
      return NextResponse.json({ error: 'Segregation of duties prevents the same user from creating/verifying/approving this FF4.' }, { status: 403 })
    }
  }

  if (action === 'MARK_PAID' && current.commitment_id) {
    const { data: commitment, error: commitmentError } = await supabase
      .from('ff3_commitments')
      .select('paid_amount, committed_amount')
      .eq('id', current.commitment_id)
      .single()
    if (commitmentError) return NextResponse.json({ error: commitmentError.message }, { status: 500 })
    const remaining = (commitment.committed_amount || 0) - (commitment.paid_amount || 0)
    if ((current.net_amount || 0) > remaining + 0.001) {
      return NextResponse.json({ error: `Payment exceeds the remaining commitment balance of K ${remaining.toLocaleString()}.` }, { status: 400 })
    }
  }

  const updateData: Record<string, unknown> = { status: STATUS_MAP[action], updated_at: now }
  if (action === 'VERIFY') {
    updateData.verified_date = now
    updateData.verified_by = guard.context?.userId || null
  }
  if (action === 'APPROVE') {
    updateData.approved_date = now
    updateData.approved_by = guard.context?.userId || null
  }
  if (action === 'RECONCILE') updateData.reconciled_date = now
  if (action === 'MARK_PAID') {
    updateData.payment_date = today
    updateData.paid_date = now
    if (paymentReference) updateData.external_payment_reference = paymentReference
  }

  const { data: header, error: headerError } = await supabase
    .from('ff4_headers')
    .update(updateData)
    .eq('id', ff4Id)
    .select()
    .single()

  if (headerError) return NextResponse.json({ error: headerError.message }, { status: 500 })

  if (action === 'MARK_PAID' && header.commitment_id) {
    const { data: commitment, error: commitmentError } = await supabase
      .from('ff3_commitments')
      .select('commitment_number, paid_amount, committed_amount')
      .eq('id', header.commitment_id)
      .single()
    if (commitmentError) return NextResponse.json({ error: commitmentError.message }, { status: 500 })

    const newPaidAmount = (commitment.paid_amount || 0) + (header.net_amount || 0)
    const commitmentStatus = newPaidAmount >= (commitment.committed_amount || 0) ? 'FULLY_PAID' : 'PARTIALLY_PAID'
    const { error: updateCommitmentError } = await supabase
      .from('ff3_commitments')
      .update({ paid_amount: newPaidAmount, status: commitmentStatus })
      .eq('id', header.commitment_id)
    if (updateCommitmentError) return NextResponse.json({ error: updateCommitmentError.message }, { status: 500 })

    await supabase.from('payment_transactions').insert({
      ff4_header_id: ff4Id,
      commitment_id: header.commitment_id,
      transaction_date: today,
      transaction_type: 'PAYMENT',
      amount: header.net_amount || 0,
      payment_reference: paymentReference || header.external_payment_reference || null,
      reconciled: false,
    })
  }

  if (action === 'RECONCILE') {
    await supabase.from('payment_transactions').update({ reconciled: true }).eq('ff4_header_id', ff4Id)
  }

  await supabase.from('audit_logs').insert({
    user_id: guard.context?.userId || null,
    user_email: guard.context?.email || null,
    user_name: guard.context?.name || null,
    action: `FF4_${action}`,
    entity_type: 'FF4',
    entity_id: ff4Id,
    entity_reference: current.ff4_number,
    new_values: { status: STATUS_MAP[action], paymentReference, comments },
  })

  return NextResponse.json({ header })
}
