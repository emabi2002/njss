import { supabase } from './supabase'
import type { LookupOption } from '@/components/LookupSelect'

export type LookupTable =
  | 'priority_levels'
  | 'urgency_levels'
  | 'procurement_methods'
  | 'units_of_measure'
  | 'payee_types'
  | 'payment_methods'
  | 'suppliers'
  | 'workflow_statuses'
  | 'budget_periods'
  | 'rbac_data_scope_types'

export function labelFromRow(row: Record<string, unknown>) {
  return String(row.name || row.display_name || row.period_name || row.supplier_name || row.label || row.full_name || row.email || row.code || row.status_code || row.period_code || 'Unnamed')
}

export function codeFromRow(row: Record<string, unknown>) {
  return (row.code || row.status_code || row.period_code || row.supplier_code || null) as string | null
}

export async function loadLookup(table: LookupTable, options?: { moduleCode?: string; budgetCycleId?: string; order?: string }) {
  if (table === 'suppliers') {
    const { data, error } = await supabase
      .from('v_suppliers_directory')
      .select('id, supplier_code, supplier_name, legal_name, trading_name, supplier_type, ipa_registration_number, tin, primary_contact_name, phone, email, province, status, compliance_status, is_active')
      .eq('is_active', true)
      .eq('status', 'APPROVED')
      .order(options?.order || 'supplier_name')
    if (error) throw error
    return (data || []).map((row) => {
      const record = row as Record<string, unknown>
      return {
        id: String(record.id || record.code),
        code: codeFromRow(record),
        name: labelFromRow(record),
        description: (record.description as string | null) || null,
        ...record,
      } satisfies LookupOption
    })
  }

  let query = supabase.from(table).select('*').eq('is_active', true)
  if (table === 'workflow_statuses' && options?.moduleCode) query = query.eq('module_code', options.moduleCode).eq('is_filterable', true)
  if (table === 'budget_periods' && options?.budgetCycleId) query = query.eq('budget_cycle_id', options.budgetCycleId)
  const orderColumn = options?.order || (table === 'rbac_data_scope_types' ? 'sort_order' : 'sort_order')
  query = query.order(orderColumn)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row) => {
    const record = row as Record<string, unknown>
    return {
      id: String(record.id || record.code),
      code: codeFromRow(record),
      name: labelFromRow(record),
      description: (record.description as string | null) || null,
      ...record,
    } satisfies LookupOption
  })
}

export async function loadActiveUsers() {
  const { data, error } = await supabase.from('users').select('id, email, full_name').eq('is_active', true).order('full_name')
  if (error) throw error
  return (data || []).map((user) => ({
    ...user,
    id: user.id,
    code: user.email,
    name: user.full_name || user.email,
  })) satisfies LookupOption[]
}
