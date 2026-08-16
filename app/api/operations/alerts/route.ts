import { NextResponse, type NextRequest } from 'next/server'
import { requirePermission } from '@/lib/rbac/server'
import { createServerSupabaseClient } from '@/lib/supabase'

const WRITE_PERMISSIONS = ['operations.manage', 'settings.manage', 'all']

type AlertPayload = {
  code?: string
  threshold_value?: number | null
  enabled?: boolean
  notes?: string | null
}

export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, WRITE_PERMISSIONS)
  if (guard.response) return guard.response

  const body = (await request.json()) as AlertPayload
  if (!body.code?.trim()) {
    return NextResponse.json({ error: 'Alert code is required.' }, { status: 400 })
  }

  const supabase = createServerSupabaseClient()
  const payload = {
    threshold_value: typeof body.threshold_value === 'number' && Number.isFinite(body.threshold_value) ? body.threshold_value : null,
    enabled: body.enabled ?? true,
    notes: body.notes || null,
    updated_by: guard.context?.userId || null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('system_alert_settings')
    .update(payload)
    .eq('code', body.code.trim())
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await supabase.from('audit_logs').insert({
    user_id: guard.context?.userId || null,
    user_email: guard.context?.email || null,
    user_name: guard.context?.name || null,
    action: 'SYSTEM_ALERT_SETTING_UPDATED',
    entity_type: 'SYSTEM_ALERT_SETTING',
    entity_reference: data.code,
    new_values: data,
  })

  return NextResponse.json({ data })
}
