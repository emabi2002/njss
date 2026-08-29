-- =============================================================================
-- NJSS 065 — BUDGET ACTIVATION PERFORMANCE INDEXES
-- Focused indexes for Task 9 FK enforcement and operational lookup paths.
-- =============================================================================

BEGIN;

-- Redundant with unique constraints created on the same leading columns.
DROP INDEX IF EXISTS public.idx_budget_activation_batches_submission;
DROP INDEX IF EXISTS public.idx_budget_activation_snapshots_batch;

-- Activation batch actor / organisation foreign keys.
CREATE INDEX IF NOT EXISTS idx_budget_activation_batches_department
  ON public.budget_activation_batches(department_id)
  WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budget_activation_batches_division
  ON public.budget_activation_batches(budget_division_id)
  WHERE budget_division_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budget_activation_batches_prepared_by
  ON public.budget_activation_batches(prepared_by)
  WHERE prepared_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budget_activation_batches_submitted_by
  ON public.budget_activation_batches(submitted_for_activation_by)
  WHERE submitted_for_activation_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budget_activation_batches_authorised_by
  ON public.budget_activation_batches(authorised_by)
  WHERE authorised_by IS NOT NULL;

-- Validation-line foreign keys not covered as leading columns by existing indexes.
CREATE INDEX IF NOT EXISTS idx_budget_activation_lines_budget_line
  ON public.budget_activation_lines(budget_line_id);
CREATE INDEX IF NOT EXISTS idx_budget_activation_lines_expense_ledger
  ON public.budget_activation_lines(expense_ledger_id)
  WHERE expense_ledger_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budget_activation_lines_posting_code
  ON public.budget_activation_lines(expense_code_registry_id)
  WHERE expense_code_registry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budget_activation_lines_chart_account
  ON public.budget_activation_lines(chart_of_account_id)
  WHERE chart_of_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budget_activation_lines_department
  ON public.budget_activation_lines(department_id)
  WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budget_activation_lines_section
  ON public.budget_activation_lines(section_id)
  WHERE section_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budget_activation_lines_cost_centre
  ON public.budget_activation_lines(cost_centre_id)
  WHERE cost_centre_id IS NOT NULL;

-- Immutable activation evidence foreign keys.
CREATE INDEX IF NOT EXISTS idx_budget_activation_snapshots_source_line
  ON public.budget_activation_line_snapshots(source_budget_line_id);
CREATE INDEX IF NOT EXISTS idx_budget_activation_snapshots_finance_mapping
  ON public.budget_activation_line_snapshots(finance_posting_mapping_id);
CREATE INDEX IF NOT EXISTS idx_budget_activation_snapshots_expense_ledger
  ON public.budget_activation_line_snapshots(expense_ledger_id);
CREATE INDEX IF NOT EXISTS idx_budget_activation_snapshots_posting_code
  ON public.budget_activation_line_snapshots(expense_code_registry_id);
CREATE INDEX IF NOT EXISTS idx_budget_activation_snapshots_chart_account
  ON public.budget_activation_line_snapshots(chart_of_account_id);
CREATE INDEX IF NOT EXISTS idx_budget_activation_snapshots_cost_centre
  ON public.budget_activation_line_snapshots(cost_centre_id);

-- Canonical mapping FK enforcement / administration lookups.
CREATE INDEX IF NOT EXISTS idx_finance_posting_mappings_posting_code
  ON public.finance_posting_mappings(expense_code_registry_id);
CREATE INDEX IF NOT EXISTS idx_finance_posting_mappings_chart_account
  ON public.finance_posting_mappings(chart_of_account_id);
CREATE INDEX IF NOT EXISTS idx_finance_posting_mappings_cost_centre
  ON public.finance_posting_mappings(cost_centre_id);
CREATE INDEX IF NOT EXISTS idx_finance_posting_mappings_department
  ON public.finance_posting_mappings(department_id);
CREATE INDEX IF NOT EXISTS idx_finance_posting_mappings_section
  ON public.finance_posting_mappings(section_id)
  WHERE section_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_posting_mappings_created_by
  ON public.finance_posting_mappings(created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_posting_mappings_updated_by
  ON public.finance_posting_mappings(updated_by)
  WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_posting_mappings_deactivated_by
  ON public.finance_posting_mappings(deactivated_by)
  WHERE deactivated_by IS NOT NULL;

-- Used by Finance Mapping scope filtering and Cost Centre FK administration.
CREATE INDEX IF NOT EXISTS idx_cost_centres_department
  ON public.cost_centres(department_id)
  WHERE department_id IS NOT NULL;

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES (
  'latest_database_migration',
  to_jsonb('065_budget_activation_performance_indexes'::TEXT),
  'Latest applied NJSS migration identifier.'
)
ON CONFLICT (setting_key) DO UPDATE SET
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  updated_at = NOW();

COMMIT;
