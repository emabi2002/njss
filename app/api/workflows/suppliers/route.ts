import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, requirePermission } from '@/lib/rbac/server'

const ACTION_PERMISSION: Record<string, string[]> = {
  CREATE: ['supplier.create'],
  UPDATE: ['supplier.edit'],
  SUBMIT: ['supplier.submit'],
  VERIFY: ['supplier.verify'],
  APPROVE: ['supplier.approve'],
  REJECT: ['supplier.reject'],
  SUSPEND: ['supplier.suspend'],
  REACTIVATE: ['supplier.reactivate'],
  ADD_DOCUMENT: ['supplier.compliance.manage'],
  VERIFY_DOCUMENT: ['supplier.compliance.manage'],
  CREATE_FOLLOWUP: ['supplier.followup.manage'],
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const action = String(body.action || '').toUpperCase()

  if (!ACTION_PERMISSION[action]) {
    return NextResponse.json({ error: 'Invalid supplier workflow request' }, { status: 400 })
  }

  const guard = await requirePermission(request, ACTION_PERMISSION[action])
  if (guard.response) return guard.response

  const response = NextResponse.next()
  const supabase = createRequestSupabaseClient(request, response)
  const userEmail = guard.context?.email || ''

  let result
  if (action === 'CREATE') {
    result = await supabase.rpc('njss_create_supplier', {
      p_payload: body.payload || {},
      p_allow_possible_duplicate: Boolean(body.allowPossibleDuplicate),
      p_user_email: userEmail,
    })
  } else if (action === 'UPDATE') {
    result = await supabase.rpc('njss_update_supplier', {
      p_supplier_id: body.supplierId,
      p_payload: body.payload || {},
      p_user_email: userEmail,
    })
  } else if (['SUBMIT', 'VERIFY', 'APPROVE', 'REJECT', 'SUSPEND', 'REACTIVATE'].includes(action)) {
    result = await supabase.rpc('njss_transition_supplier', {
      p_supplier_id: body.supplierId,
      p_action: action,
      p_reason: body.reason || null,
      p_user_email: userEmail,
    })
  } else if (action === 'ADD_DOCUMENT') {
    result = await supabase.rpc('njss_add_supplier_document', {
      p_supplier_id: body.supplierId,
      p_payload: body.payload || {},
      p_user_email: userEmail,
    })
  } else if (action === 'VERIFY_DOCUMENT') {
    result = await supabase.rpc('njss_verify_supplier_document', {
      p_document_id: body.documentId,
      p_status: body.status || 'VERIFIED',
      p_notes: body.notes || null,
      p_user_email: userEmail,
    })
  } else {
    result = await supabase.rpc('njss_create_supplier_followup', {
      p_supplier_id: body.supplierId,
      p_payload: body.payload || {},
      p_user_email: userEmail,
    })
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 })
  return NextResponse.json({ data: result.data })
}
