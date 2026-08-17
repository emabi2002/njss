import { supabase } from './supabase'

export async function getActiveFinancialYear(fallbackYear = new Date().getFullYear()) {
  const { data, error } = await supabase
    .from('financial_year_config')
    .select('financial_year')
    .eq('is_active', true)
    .eq('status', 'OPEN')
    .maybeSingle()

  if (error) return fallbackYear
  return Number(data?.financial_year || fallbackYear)
}
