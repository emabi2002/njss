import type { ReportCategory } from "./types"

// Reporting-safe projection generated from the live NJSS Supabase schema on 2026-09-11.
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
  budget_divisions: "id uuid, code varchar, name varchar, department_id uuid, cost_centre_code varchar, cost_centre_name varchar, sort_order integer, is_active boolean, section_id uuid, cost_centre_id uuid",
  chart_of_accounts: "id uuid, account_code varchar, account_name varchar, account_type varchar, is_open_head boolean, is_active boolean",
  expense_categories: "id uuid, code varchar, name varchar, is_active boolean",
  expense_items: "id uuid, expense_category_id uuid, code varchar, name varchar, default_unit varchar, is_active boolean, unit_of_measure_id uuid",
  expense_code_registry: "id uuid, financial_year integer, department_id uuid, section_id uuid, cost_centre_id uuid, expense_category_id uuid, expense_item_id uuid, full_expense_code varchar, description text, is_active boolean, expense_ledger_id uuid, chart_of_account_id uuid",
  expense_ledger: "id uuid, ledger_number varchar, finance_code varchar, standard_description varchar, budget_class varchar, expense_category varchar, is_posting boolean, is_active boolean, parent_ledger_id uuid, parent_finance_code varchar, sort_order integer, expense_code_registry_id uuid, budget_class_id uuid, budget_expense_category_id uuid",
  funding_sources: "id uuid, code varchar, name varchar, source_type varchar, is_active boolean",

  budget_cycles: "id uuid, budget_year integer, cycle_type varchar, name varchar, status varchar, department_id uuid, opens_on date, submission_deadline date, closes_on date, department_ceiling numeric, notes text",
  budget_division_ceilings: "id uuid, cycle_id uuid, division_id uuid, ceiling_amount numeric, notes text",
  divisional_budget_submissions: "id uuid, submission_number varchar, cycle_id uuid, budget_year integer, department_id uuid, division_id uuid, cost_centre varchar, submission_reference varchar, version integer, parent_submission_id uuid, superseded_by_id uuid, budget_ceiling numeric, ceiling_exception_approved boolean, ceiling_exception_reference varchar, prepared_by varchar, reviewed_by varchar, approved_by varchar, date_prepared date, status varchar, validation_status varchar, line_count integer, total_proposed_budget numeric, total_monthly_allocation numeric, unallocated_variance numeric, is_locked boolean, submitted_at timestamptz, returned_at timestamptz, reviewed_at timestamptz, approved_at timestamptz, notes text",
  divisional_budget_lines: "id uuid, budget_line_number varchar, submission_id uuid, line_number integer, activity_reference varchar, expense_ledger_id uuid, line_item_description text, business_justification text, expected_output text, location_destination_provider varchar, start_date date, end_date date, quantity numeric, unit_of_measure varchar, unit_cost numeric, frequency_periods numeric, other_costs numeric, annual_estimate numeric, monthly_allocation_total numeric, allocation_variance numeric, priority varchar, funding_source_id uuid, procurement_method varchar, responsible_officer varchar, supporting_reference varchar, comments text, priority_level_id uuid, procurement_method_id uuid, unit_of_measure_id uuid",
  budget_allocations: "id uuid, financial_year integer, department_id uuid, section_id uuid, project_id uuid, funding_source_id uuid, account_id uuid, annual_plan_line_id uuid, original_budget numeric, supplemental_budget numeric, revised_budget numeric, is_active boolean, cost_centre_id uuid, expense_code_registry_id uuid, source_budget_submission_id uuid, source_budget_line_id uuid, budget_division_id uuid, source_module varchar, q1_planned numeric, q2_planned numeric, q3_planned numeric, q4_planned numeric, revision_adjustment numeric",
  budget_monthly_allocations: "id uuid, budget_line_id uuid, month_number integer, month_name varchar, amount numeric",
  budget_periods: "id uuid, budget_cycle_id uuid, period_type varchar, period_number integer, period_code varchar, period_name varchar, start_date date, end_date date, is_open boolean, is_active boolean",
  budget_revisions: "id uuid, revision_number varchar, parent_submission_id uuid, revision_submission_id uuid, budget_year integer, division_id uuid, revision_type varchar, reason text, authority_reference varchar, effective_date date, status varchar, requested_by uuid, requested_by_email varchar, approved_by uuid, approved_at timestamptz, supporting_reference varchar, assigned_line_supervisor_id uuid, request_instruction text, requested_change_amount numeric, assigned_at timestamptz",
  budget_revision_lines: "id uuid, budget_revision_id uuid, source_budget_allocation_id uuid, source_budget_line_id uuid, revision_budget_line_id uuid, original_budget numeric, current_revised_budget numeric, actual_expenditure_at_submission numeric, outstanding_commitment_at_submission numeric, protected_minimum_at_submission numeric, actual_expenditure_at_approval numeric, outstanding_commitment_at_approval numeric, protected_minimum_at_approval numeric, proposed_revised_budget numeric, adjustment_amount numeric, adjustment_reason text",
  budget_release_funding_lines: "id uuid, quarterly_release_id uuid, funding_allocation_id uuid, amount numeric",

  funding_authorities: "id uuid, authority_number varchar, financial_year integer, authority_type varchar, funding_source_id uuid, source_agency varchar, source_department varchar, appropriation_reference varchar, warrant_number varchar, warrant_date date, donor_agreement_reference varchar, project_reference varchar, approved_amount numeric, effective_date date, expiry_date date, description text, status varchar, restricted_project_id uuid, restricted_department_id uuid, restricted_section_id uuid, restricted_cost_centre_id uuid, restricted_expense_code_registry_id uuid, restriction_notes text, verified_at timestamptz, approved_at timestamptz, rejection_reason text",
  funding_receipts: "id uuid, receipt_number varchar, financial_year integer, funding_authority_id uuid, funding_source_id uuid, receipt_date date, amount_received numeric, source_agency varchar, finance_ifms_reference varchar, external_reference varchar, bank_reference varchar, description text, status varchar, verified_at timestamptz, approved_at timestamptz, rejection_reason text",
  funding_allocations: "id uuid, allocation_number varchar, financial_year integer, funding_receipt_id uuid, funding_authority_id uuid, funding_source_id uuid, budget_allocation_id uuid, department_id uuid, section_id uuid, cost_centre_id uuid, budget_division_id uuid, project_id uuid, expense_code_registry_id uuid, allocated_amount numeric, allocation_date date, status varchar, notes text, approved_at timestamptz, cancellation_reason text",
  quarterly_releases: "id uuid, budget_allocation_id uuid, financial_year integer, quarter integer, release_number varchar, release_date date, released_amount numeric, funding_allocation_id uuid, notes text",

  ff3_headers: "id uuid, ff3_number varchar, financial_year integer, request_date date, requesting_officer_id uuid, department_id uuid, section_id uuid, project_id uuid, province_id uuid, funding_source_id uuid, annual_plan_line_id uuid, purpose text, justification text, required_by_date date, urgency_level varchar, procurement_method varchar, selected_supplier_name varchar, status varchar, submitted_date timestamptz, supervisor_endorsed_date timestamptz, section_head_endorsed_date timestamptz, approved_date timestamptz, total_estimated_amount numeric, is_within_budget boolean, rejection_reason text, cost_centre_id uuid, expense_code_registry_id uuid, budget_allocation_id uuid, budget_mapping_status varchar, cancellation_reason text, cancelled_at timestamptz, returned_reason text, selected_supplier_id uuid, selected_quotation_id uuid, supplier_not_required boolean, supplier_not_required_expenditure_type varchar",
  ff3_items: "id uuid, ff3_header_id uuid, line_number integer, item_description text, specifications text, quantity numeric, unit_of_measure varchar, estimated_unit_price numeric, total_amount numeric, account_id uuid, unit_of_measure_id uuid",
  ff3_quotations: "id uuid, ff3_header_id uuid, supplier_name varchar, quotation_number varchar, quotation_date date, quotation_amount numeric, is_selected boolean, supplier_id uuid, legacy_imported boolean, supplier_mapping_required boolean",
  ff3_approvals: "id uuid, ff3_header_id uuid, approval_level varchar, approver_id uuid, action_taken varchar, comments text, action_date timestamptz",
  ff3_commitments: "id uuid, commitment_number varchar, ff3_header_id uuid, budget_allocation_id uuid, financial_year integer, commitment_date date, committed_amount numeric, paid_amount numeric, remaining_balance numeric, status varchar, original_committed_amount numeric, current_committed_amount numeric, outstanding_amount numeric, supplier_id uuid, supplier_code_snapshot text, supplier_name_snapshot text, supplier_registration_snapshot text",
  commitment_transactions: "id uuid, commitment_id uuid, ff3_header_id uuid, budget_allocation_id uuid, transaction_number varchar, transaction_type varchar, amount numeric, transaction_date date, reason_code varchar, reason text, reference varchar, previous_balance numeric, new_balance numeric",

  ff4_headers: "id uuid, ff4_number varchar, ff3_header_id uuid, commitment_id uuid, financial_year integer, payment_request_date date, payee_type varchar, payee_name varchar, supplier_code varchar, invoice_number varchar, invoice_date date, claim_reference varchar, payment_description text, gross_amount numeric, tax_amount numeric, deductions numeric, net_amount numeric, department_id uuid, section_id uuid, account_id uuid, payment_method varchar, external_payment_reference varchar, cheque_number varchar, payment_date date, status varchar, submitted_date timestamptz, verified_date timestamptz, approved_date timestamptz, paid_date timestamptz, reconciled_date timestamptz, is_locked boolean, payee_type_id uuid, payment_method_id uuid, supplier_id uuid, budget_allocation_id uuid, expense_code_registry_id uuid, cost_centre_id uuid, funding_source_id uuid, payment_type varchar, processed_date timestamptz, cancellation_reason text, rejection_reason text, returned_reason text, remarks text, is_partial_payment boolean",
  ff4_approvals: "id uuid, ff4_header_id uuid, approval_level varchar, approver_id uuid, action_taken varchar, comments text, action_date timestamptz, old_status varchar, new_status varchar, amount numeric, reference varchar",
  payment_transactions: "id uuid, ff4_header_id uuid, commitment_id uuid, transaction_date date, transaction_type varchar, amount numeric, payment_reference varchar, reconciled boolean, financial_year integer, budget_allocation_id uuid, payment_method_id uuid, status varchar, reversal_of_id uuid, reconciled_at timestamptz",

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
  "budget_divisions",
  "chart_of_accounts",
  "expense_categories",
  "expense_items",
  "expense_code_registry",
  "expense_ledger",
  "funding_sources",
] as const

const CATEGORY_RELATIONS: Record<ReportCategory, readonly string[]> = {
  management: [
    "budget_allocations",
    "funding_authorities",
    "funding_receipts",
    "funding_allocations",
    "quarterly_releases",
    "ff3_headers",
    "ff3_commitments",
    "commitment_transactions",
    "ff4_headers",
    "payment_transactions",
  ],
  budget: [
    "budget_cycles",
    "budget_division_ceilings",
    "divisional_budget_submissions",
    "divisional_budget_lines",
    "budget_allocations",
    "budget_monthly_allocations",
    "budget_periods",
    "budget_revisions",
    "budget_revision_lines",
    "budget_release_funding_lines",
  ],
  funding: ["funding_authorities", "funding_receipts", "funding_allocations", "quarterly_releases", "budget_release_funding_lines", "budget_allocations"],
  commitment: ["ff3_headers", "ff3_items", "ff3_quotations", "ff3_approvals", "ff3_commitments", "commitment_transactions", "budget_allocations", "suppliers"],
  expenditure: ["ff4_headers", "ff4_approvals", "payment_transactions", "ff3_commitments", "ff3_headers", "budget_allocations", "suppliers"],
  supplier: ["suppliers", "supplier_categories", "supplier_category_assignments", "supplier_documents", "supplier_document_requirements", "supplier_followups", "supplier_status_history", "ff3_headers", "ff4_headers"],
  audit: ["audit_logs", "workflow_statuses"],
}

export function getSchemaForCategory(category: ReportCategory) {
  const names = Array.from(new Set([...COMMON_RELATIONS, ...CATEGORY_RELATIONS[category]]))
  return names.map((name) => `${name}(${SCHEMA_RELATIONS[name]})`).join("\n")
}
