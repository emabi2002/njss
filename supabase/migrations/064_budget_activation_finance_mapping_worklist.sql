-- =============================================================================
-- NJSS 064 — BUDGET ACTIVATION FINANCE MAPPING WORKLIST
-- Read-only operational aid for System Administrator and Registrar.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.njss_budget_activation_mapping_worklist()
RETURNS TABLE (
  submission_id UUID,
  submission_number VARCHAR,
  financial_year INTEGER,
  budget_line_id UUID,
  line_number INTEGER,
  annual_estimate NUMERIC,
  budget_division_id UUID,
  division_code VARCHAR,
  division_name VARCHAR,
  department_id UUID,
  section_id UUID,
  cost_centre_id UUID,
  cost_centre_code VARCHAR,
  cost_centre_name VARCHAR,
  expense_ledger_id UUID,
  finance_code VARCHAR,
  finance_description VARCHAR,
  finance_expense_category VARCHAR,
  legacy_posting_code_id UUID,
  legacy_posting_code VARCHAR,
  legacy_posting_description TEXT,
  canonical_mapping_id UUID,
  canonical_posting_code_id UUID,
  canonical_posting_code VARCHAR,
  chart_of_account_id UUID,
  chart_account_code VARCHAR,
  chart_account_name VARCHAR,
  mapping_status TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (
    public.njss_current_user_has_role('System Administrator')
    OR public.njss_current_user_has_role('Registrar')
  ) THEN
    RAISE EXCEPTION 'Budget activation Finance mapping worklist is restricted to System Administrator and Registrar.';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.submission_number,
    s.budget_year,
    l.id,
    l.line_number,
    l.annual_estimate,
    bd.id,
    bd.code,
    bd.name,
    COALESCE(s.department_id, bd.department_id),
    bd.section_id,
    bd.cost_centre_id,
    cc.code,
    cc.name,
    el.id,
    el.finance_code,
    el.standard_description,
    el.expense_category,
    legacy.id,
    legacy.full_expense_code,
    legacy.description,
    fpm.id,
    mapped_posting.id,
    mapped_posting.full_expense_code,
    fpm.chart_of_account_id,
    coa.account_code,
    coa.account_name,
    CASE
      WHEN bd.cost_centre_id IS NULL THEN 'COST_CENTRE_REQUIRED'
      WHEN cc.id IS NULL OR cc.is_active IS DISTINCT FROM true THEN 'COST_CENTRE_INACTIVE'
      WHEN fpm.id IS NULL THEN 'MAPPING_REQUIRED'
      WHEN mapped_posting.id IS NULL OR mapped_posting.is_active IS DISTINCT FROM true THEN 'POSTING_CODE_INACTIVE'
      WHEN coa.id IS NULL OR coa.is_active IS DISTINCT FROM true THEN 'CHART_ACCOUNT_INACTIVE'
      ELSE 'READY'
    END::TEXT
  FROM public.divisional_budget_submissions s
  JOIN public.budget_divisions bd ON bd.id = s.division_id
  JOIN public.divisional_budget_lines l ON l.submission_id = s.id
  JOIN public.expense_ledger el ON el.id = l.expense_ledger_id
  LEFT JOIN public.cost_centres cc ON cc.id = bd.cost_centre_id
  LEFT JOIN public.expense_code_registry legacy ON legacy.id = el.expense_code_registry_id
  LEFT JOIN LATERAL (
    SELECT m.*
    FROM public.finance_posting_mappings m
    WHERE m.is_active = true
      AND m.expense_ledger_id = l.expense_ledger_id
      AND m.cost_centre_id = bd.cost_centre_id
      AND (m.financial_year = s.budget_year OR m.financial_year IS NULL)
    ORDER BY CASE WHEN m.financial_year = s.budget_year THEN 0 ELSE 1 END, m.updated_at DESC, m.id
    LIMIT 1
  ) fpm ON true
  LEFT JOIN public.expense_code_registry mapped_posting ON mapped_posting.id = fpm.expense_code_registry_id
  LEFT JOIN public.chart_of_accounts coa ON coa.id = fpm.chart_of_account_id
  WHERE s.status = 'APPROVED'
  ORDER BY s.submission_number, l.line_number;
END;
$$;

REVOKE ALL ON FUNCTION public.njss_budget_activation_mapping_worklist() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_budget_activation_mapping_worklist() TO authenticated;

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES (
  'latest_database_migration',
  to_jsonb('064_budget_activation_finance_mapping_worklist'::TEXT),
  'Latest applied NJSS migration identifier.'
)
ON CONFLICT (setting_key) DO UPDATE SET
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  updated_at = NOW();

COMMIT;
