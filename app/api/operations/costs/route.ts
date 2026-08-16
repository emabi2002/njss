import { NextResponse, type NextRequest } from 'next/server'
import { requirePermission } from '@/lib/rbac/server'
import { createServerSupabaseClient } from '@/lib/supabase'

const WRITE_PERMISSIONS = ['operations.manage', 'settings.manage', 'all']

type CostPayload = {
  id?: string
  service_provider?: string
  cost_category?: string
  billing_month?: string
  currency?: string
  monthly_fixed_cost?: number
  usage_cost?: number
  other_cost?: number
  invoice_reference?: string | null
  payment_status?: string
  notes?: string | null
  operational_budget?: number | null
}

function asNumber(value: unknown) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

function normalizeMonth(value: string) {
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return ''
}

export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, WRITE_PERMISSIONS)
  if (guard.response) return guard.response

  const body = (await request.json()) as CostPayload
  const billingMonth = normalizeMonth(body.billing_month || '')
  if (!body.service_provider?.trim() || !body.cost_category?.trim() || !billingMonth) {
    return NextResponse.json({ error: 'Service/provider, cost category and billing month are required.' }, { status: 400 })
  }

  const supabase = createServerSupabaseClient()
  const payload = {
    service_provider: body.service_provider.trim(),
    cost_category: body.cost_category.trim(),
    billing_month: billingMonth,
    currency: (body.currency || 'PGK').trim().toUpperCase(),
    monthly_fixed_cost: asNumber(body.monthly_fixed_cost),
    usage_cost: asNumber(body.usage_cost),
    other_cost: asNumber(body.other_cost),
    invoice_reference: body.invoice_reference || null,
    payment_status: body.payment_status || 'Pending',
    notes: body.notes || null,
    updated_by: guard.context?.userId || null,
    updated_at: new Date().toISOString(),
  }

  const query = body.id
    ? supabase.from('system_operating_costs').update(payload).eq('id', body.id).select().single()
    : supabase.from('system_operating_costs').insert({ ...payload, created_by: guard.context?.userId || null }).select().single()

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await supabase.from('audit_logs').insert({
    user_id: guard.context?.userId || null,
    user_email: guard.context?.email || null,
    user_name: guard.context?.name || null,
    action: body.id ? 'OPERATING_COST_UPDATED' : 'OPERATING_COST_CREATED',
    entity_type: 'SYSTEM_OPERATING_COST',
    entity_id: data.id,
    entity_reference: `${data.billing_month}:${data.service_provider}`,
    new_values: data,
  })

  if (typeof body.operational_budget === 'number' && Number.isFinite(body.operational_budget)) {
    const settingValue = { monthly_operating_budget: body.operational_budget }
    await supabase.from('system_settings').upsert({
      setting_key: 'operations_manual_metrics',
      setting_value: settingValue,
      description: 'Administrator-maintained operations metrics and budgets',
      updated_by: guard.context?.userId || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'setting_key' })
    await supabase.from('audit_logs').insert({
      user_id: guard.context?.userId || null,
      user_email: guard.context?.email || null,
      user_name: guard.context?.name || null,
      action: 'OPERATIONS_BUDGET_UPDATED',
      entity_type: 'SYSTEM_SETTING',
      entity_reference: 'operations_manual_metrics',
      new_values: settingValue,
    })
  }

  return NextResponse.json({ data })
}
