import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Client-side Supabase client with proper auth config
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: 'njss-frems-auth',
    lock: undefined, // Disable lock to prevent the error
  }
})

// Server-side Supabase client (with service role for admin operations)
export function createServerSupabaseClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}

// Database types for TypeScript
export type Department = {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type Section = {
  id: string
  department_id: string
  code: string
  name: string
  is_active: boolean
  created_at: string
}

export type Role = {
  id: string
  name: string
  description: string | null
  permissions: Record<string, boolean>
  is_active: boolean
}

export type Province = {
  id: string
  code: string
  name: string
  region: string | null
  is_active: boolean
}

export type FundingSource = {
  id: string
  code: string
  name: string
  source_type: string | null
  is_active: boolean
}

export type ChartOfAccount = {
  id: string
  account_code: string
  account_name: string
  account_type: string | null
  is_open_head: boolean
  is_active: boolean
}

export type BudgetAllocation = {
  id: string
  financial_year: number
  department_id: string | null
  section_id: string | null
  project_id: string | null
  funding_source_id: string | null
  account_id: string
  original_budget: number
  supplemental_budget: number
  revised_budget: number
  is_active: boolean
  created_at: string
}

export type FF3Header = {
  id: string
  ff3_number: string
  financial_year: number
  request_date: string
  requesting_officer_id: string | null
  department_id: string | null
  section_id: string | null
  project_id: string | null
  province_id: string | null
  funding_source_id: string | null
  purpose: string
  justification: string | null
  required_by_date: string | null
  urgency_level: string | null
  procurement_method: string | null
  selected_supplier_name: string | null
  status: 'DRAFT' | 'SUBMITTED' | 'ENDORSED_SUPERVISOR' | 'ENDORSED_SECTION_HEAD' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
  total_estimated_amount: number | null
  is_within_budget: boolean | null
  created_at: string
  updated_at: string
}

export type FF3Item = {
  id: string
  ff3_header_id: string
  line_number: number
  item_description: string
  specifications: string | null
  quantity: number
  unit_of_measure: string | null
  estimated_unit_price: number | null
  total_amount: number
  account_id: string | null
}

export type FF3Quotation = {
  id: string
  ff3_header_id: string
  supplier_name: string
  quotation_number: string | null
  quotation_date: string | null
  quotation_amount: number
  attachment_url: string | null
  is_selected: boolean
  created_at: string
}

export type FF3Commitment = {
  id: string
  commitment_number: string
  ff3_header_id: string | null
  budget_allocation_id: string | null
  financial_year: number
  commitment_date: string
  committed_amount: number
  paid_amount: number
  remaining_balance: number
  status: 'ACTIVE' | 'PARTIALLY_PAID' | 'FULLY_PAID' | 'CANCELLED'
  created_at: string
}

export type FF4Header = {
  id: string
  ff4_number: string
  ff3_header_id: string | null
  commitment_id: string | null
  financial_year: number
  payment_request_date: string
  payee_type: string | null
  payee_name: string
  supplier_code: string | null
  invoice_number: string | null
  invoice_date: string | null
  payment_description: string | null
  gross_amount: number
  tax_amount: number
  deductions: number
  net_amount: number
  payment_method: string | null
  external_payment_reference: string | null
  status: 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'APPROVED' | 'PROCESSED' | 'PAID' | 'RECONCILED' | 'CANCELLED'
  created_at: string
  updated_at: string
}
