import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, requirePermission } from '@/lib/rbac/server'

const ACTION_PERMISSION: Record<string, string[]> = {
  CREATE: ['supplier.create'],
  UPDATE: ['supplier.edit'],
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
  } else {
    return NextResponse.json({ error: 'Unsupported supplier request' }, { status: 400 })
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 })
  return NextResponse.json({ data: result.data })
}
