import type { ReportCategory } from "./types"
import { ReportAgentError } from "./types"

// Operational reporting projection; retired budget and funding relations are excluded.
// It intentionally exposes only columns needed for operational/management reporting.
// Sensitive implementation/authentication fields are not supplied to the model.
export const SCHEMA_PROJECT_REF = "qzsmmalfeinoagvronpb"
export const SCHEMA_GENERATED_AT = "2026-09-11"

export const SCHEMA_RELATIONS: Record<string, string> = {
  departments: "id uuid, code varchar, name varchar, description text, is_active boolean, court_location_id uuid",
  sections: "id uuid, department_id uuid, code varchar, name varchar, is_active boolean",
  cost_centres: "id uuid, code varchar, name varchar, department_id uuid, section_id uuid, is_active boolean",
  financial_years: "id uuid, year integer, name varchar, start_date date, end_date date, is_active boolean, is_open boolean",
  projects: "id uuid, code varchar, name varchar, description text, department_id uuid, start_date date, end_date date, is_active boolean",
  provinces: "id uuid, code varchar, name varchar, region varchar, is_active boolean",
  court_locations: "id uuid, province_id uuid, code varchar, name varchar, location_type varchar, town varchar, is_headquarters boolean, is_active boolean",
  chart_of_accounts: "id uuid, account_code varchar, account_name varchar, account_type varchar, is_open_head boolean, is_active boolean",
  expense_categories: "id uuid, code varchar, name varchar, is_active boolean",
  expense_items: "id uuid, expense_category_id uuid, code varchar, name varchar, default_unit varchar, is_active boolean, unit_of_measure_id uuid",
  expense_code_registry: "id uuid, financial_year integer, department_id uuid, section_id uuid, cost_centre_id uuid, expense_category_id uuid, expense_item_id uuid, full_expense_code varchar, description text, is_active boolean, expense_ledger_id uuid, chart_of_account_id uuid",
  expense_ledger: "id uuid, ledger_number varchar, finance_code varchar, standard_description varchar, budget_class varchar, expense_category varchar, is_posting boolean, is_active boolean, parent_ledger_id uuid, parent_finance_code varchar, sort_order integer, expense_code_registry_id uuid, budget_class_id uuid, budget_expense_category_id uuid",
  funding_sources: "id uuid, code varchar, name varchar, source_type varchar, is_active boolean",



  ff3_headers: "id uuid, ff3_number varchar, financial_year integer, request_date date, requesting_officer_id uuid, department_id uuid, section_id uuid, project_id uuid, province_id uuid, funding_source_id uuid, purpose text, justification text, required_by_date date, urgency_level varchar, procurement_method varchar, selected_supplier_name varchar, status varchar, submitted_date timestamptz, supervisor_endorsed_date timestamptz, section_head_endorsed_date timestamptz, approved_date timestamptz, total_estimated_amount numeric, rejection_reason text, cost_centre_id uuid, expense_code_registry_id uuid, cancellation_reason text, cancelled_at timestamptz, returned_reason text, selected_supplier_id uuid, selected_quotation_id uuid, supplier_not_required boolean, supplier_not_required_expenditure_type varchar",
  ff3_items: "id uuid, ff3_header_id uuid, line_number integer, item_description text, specifications text, quantity numeric, unit_of_measure varchar, estimated_unit_price numeric, total_amount numeric, account_id uuid, unit_of_measure_id uuid",
  ff3_quotations: "id uuid, ff3_header_id uuid, supplier_name varchar, quotation_number varchar, quotation_date date, quotation_amount numeric, is_selected boolean, supplier_id uuid, legacy_imported boolean, supplier_mapping_required boolean",
  ff3_approvals: "id uuid, ff3_header_id uuid, approval_level varchar, approver_id uuid, action_taken varchar, comments text, action_date timestamptz",
  ff3_commitments: "id uuid, commitment_number varchar, ff3_header_id uuid, financial_year integer, commitment_date date, committed_amount numeric, paid_amount numeric, remaining_balance numeric, status varchar, original_committed_amount numeric, current_committed_amount numeric, outstanding_amount numeric, supplier_id uuid, supplier_code_snapshot text, supplier_name_snapshot text, supplier_registration_snapshot text",
  commitment_transactions: "id uuid, commitment_id uuid, ff3_header_id uuid, transaction_number varchar, transaction_type varchar, amount numeric, transaction_date date, reason_code varchar, reason text, reference varchar, previous_balance numeric, new_balance numeric",

  ff4_headers: "id uuid, ff4_number varchar, ff3_header_id uuid, commitment_id uuid, financial_year integer, payment_request_date date, payee_type varchar, payee_name varchar, supplier_code varchar, invoice_number varchar, invoice_date date, claim_reference varchar, payment_description text, gross_amount numeric, tax_amount numeric, deductions numeric, net_amount numeric, department_id uuid, section_id uuid, account_id uuid, payment_method varchar, external_payment_reference varchar, cheque_number varchar, payment_date date, status varchar, submitted_date timestamptz, verified_date timestamptz, approved_date timestamptz, paid_date timestamptz, reconciled_date timestamptz, is_locked boolean, payee_type_id uuid, payment_method_id uuid, supplier_id uuid, expense_code_registry_id uuid, cost_centre_id uuid, funding_source_id uuid, payment_type varchar, processed_date timestamptz, cancellation_reason text, rejection_reason text, returned_reason text, remarks text, is_partial_payment boolean",
  ff4_approvals: "id uuid, ff4_header_id uuid, approval_level varchar, approver_id uuid, action_taken varchar, comments text, action_date timestamptz, old_status varchar, new_status varchar, amount numeric, reference varchar",
  payment_transactions: "id uuid, ff4_header_id uuid, commitment_id uuid, transaction_date date, transaction_type varchar, amount numeric, payment_reference varchar, reconciled boolean, financial_year integer, payment_method_id uuid, status varchar, reversal_of_id uuid, reconciled_at timestamptz",

  suppliers: "id uuid, supplier_code varchar, supplier_name varchar, trading_name varchar, supplier_type varchar, company_registration_number varchar, contact_person varchar, province_id uuid, is_active boolean, legal_name text, registration_type text, ipa_registration_number text, gst_registration_number text, primary_contact_name text, province text, country text, status text, compliance_status text, notes text, verified_at timestamptz, approved_at timestamptz, rejected_at timestamptz, rejection_reason text, suspended_at timestamptz, suspension_reason text, legacy_imported boolean, supplier_mapping_required boolean",
  supplier_categories: "id uuid, code text, name text, description text, is_active boolean, sort_order integer",
  supplier_category_assignments: "id uuid, supplier_id uuid, category_id uuid, created_at timestamptz",
  supplier_documents: "id uuid, supplier_id uuid, document_type text, document_number text, issuing_authority text, issue_date date, expiry_date date, verification_status text, verified_at timestamptz, notes text, created_at timestamptz",
  supplier_document_requirements: "id uuid, category_id uuid, supplier_type text, document_type text, is_required boolean, is_active boolean",
  supplier_followups: "id uuid, supplier_id uuid, related_entity_type text, related_entity_id uuid, issue_type text, issue_description text, follow_up_date date, contact_person text, contact_method text, supplier_response text, next_action text, next_follow_up_date date, escalation_level integer, status text, created_at timestamptz, updated_at timestamptz",
  supplier_status_history: "id uuid, supplier_id uuid, previous_status text, new_status text, action text, reason text, actor_email text, created_at timestamptz",

  audit_logs: "id uuid, user_id uuid, user_email varchar, user_name varchar, action varchar, entity_type varchar, entity_id uuid, entity_reference varchar, old_values jsonb, new_values jsonb, changes jsonb, metadata jsonb, created_at timestamptz",
  workflow_statuses: "id uuid, module_code varchar, status_code varchar, display_name varchar, description text, sort_order integer, is_terminal boolean, is_filterable boolean, is_active boolean",
}

export const ALLOWED_REPORT_TABLES = new Set(Object.keys(SCHEMA_RELATIONS))

const COMMON_RELATIONS = [
  "departments",
  "sections",
  "cost_centres",
  "financial_years",
  "projects",
  "provinces",
  "court_locations",
  "chart_of_accounts",
  "expense_categories",
  "expense_items",
  "expense_code_registry",
  "expense_ledger",
  "funding_sources",
] as const

const CATEGORY_RELATIONS: Record<ReportCategory, readonly string[]> = {
  management: [
    "ff3_headers",
    "ff3_commitments",
    "commitment_transactions",
    "ff4_headers",
    "payment_transactions",
  ],
  budget: [],
  funding: [],
  commitment: ["ff3_headers", "ff3_items", "ff3_quotations", "ff3_approvals", "ff3_commitments", "commitment_transactions", "suppliers"],
  expenditure: ["ff4_headers", "ff4_approvals", "payment_transactions", "ff3_commitments", "ff3_headers", "suppliers"],
  supplier: ["suppliers", "supplier_categories", "supplier_category_assignments", "supplier_documents", "supplier_document_requirements", "supplier_followups", "supplier_status_history", "ff3_headers", "ff4_headers"],
  audit: ["audit_logs", "workflow_statuses"],
}

export function getSchemaForCategory(category: ReportCategory) {
  if (category === "budget" || category === "funding") {
    throw new ReportAgentError("ANNUAL_REPORT_REQUIRED", "Use the standard annual reports at /dashboard/reports for approved budget and funding positions.", 410)
  }
  const names = Array.from(new Set([...COMMON_RELATIONS, ...CATEGORY_RELATIONS[category]]))
  return names.map((name) => `${name}(${SCHEMA_RELATIONS[name]})`).join("\n")
}
