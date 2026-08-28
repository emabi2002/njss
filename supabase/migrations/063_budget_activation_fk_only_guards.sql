-- =============================================================================
-- NJSS 063 — BUDGET ACTIVATION FK-ONLY TRANSACTION GUARDS
-- Approved Task 9 conformance hardening.
-- =============================================================================

BEGIN;

-- 1. Activation-line staging guard: approved organisation is resolved only from
--    immutable identifiers on the approved submission/division and canonical map.
CREATE OR REPLACE FUNCTION public.njss_guard_budget_activation_line_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected_department_id UUID;
  v_expected_section_id UUID;
  v_expected_cost_centre_id UUID;
  v_mapping public.finance_posting_mappings;
  v_errors JSONB := COALESCE(NEW.validation_errors, '[]'::jsonb);
  v_invalid BOOLEAN := false;
BEGIN
  SELECT
    COALESCE(s.department_id, bd.department_id),
    bd.section_id,
    bd.cost_centre_id
  INTO
    v_expected_department_id,
    v_expected_section_id,
    v_expected_cost_centre_id
  FROM public.budget_activation_batches bab
  JOIN public.divisional_budget_submissions s ON s.id = bab.submission_id
  JOIN public.budget_divisions bd ON bd.id = s.division_id
  WHERE bab.id = NEW.activation_batch_id;

  IF NOT FOUND THEN
    NEW.mapping_status := 'INVALID';
    NEW.mapped_amount := 0;
    NEW.validation_errors := v_errors || jsonb_build_array(
      'Approved budget organisational unit could not be resolved.'
    );
    RETURN NEW;
  END IF;

  IF v_expected_department_id IS NULL THEN
    v_invalid := true;
    v_errors := v_errors || jsonb_build_array(
      'Approved budget Department could not be resolved.'
    );
  ELSIF NEW.department_id IS DISTINCT FROM v_expected_department_id THEN
    v_invalid := true;
    v_errors := v_errors || jsonb_build_array(
      'Mapped Department does not match the approved budget organisational unit.'
    );
  END IF;

  IF v_expected_section_id IS NOT NULL
     AND NEW.section_id IS DISTINCT FROM v_expected_section_id THEN
    v_invalid := true;
    v_errors := v_errors || jsonb_build_array(
      'Mapped Section does not match the approved budget organisational unit.'
    );
  END IF;

  IF v_expected_cost_centre_id IS NULL THEN
    v_invalid := true;
    v_errors := v_errors || jsonb_build_array(
      'Approved budget Division has no exact Cost Centre mapping.'
    );
  ELSIF NEW.cost_centre_id IS DISTINCT FROM v_expected_cost_centre_id THEN
    v_invalid := true;
    v_errors := v_errors || jsonb_build_array(
      'Mapped Cost Centre does not match budget_divisions.cost_centre_id.'
    );
  END IF;

  IF NEW.finance_posting_mapping_id IS NULL THEN
    v_invalid := true;
    v_errors := v_errors || jsonb_build_array(
      'Activation line has no canonical Finance posting mapping.'
    );
  ELSE
    SELECT * INTO v_mapping
    FROM public.finance_posting_mappings
    WHERE id = NEW.finance_posting_mapping_id;

    IF NOT FOUND OR v_mapping.is_active IS DISTINCT FROM true THEN
      v_invalid := true;
      v_errors := v_errors || jsonb_build_array(
        'Activation line canonical Finance posting mapping is missing or inactive.'
      );
    ELSE
      IF v_mapping.expense_ledger_id IS DISTINCT FROM NEW.expense_ledger_id
         OR v_mapping.expense_code_registry_id IS DISTINCT FROM NEW.expense_code_registry_id
         OR v_mapping.chart_of_account_id IS DISTINCT FROM NEW.chart_of_account_id
         OR v_mapping.cost_centre_id IS DISTINCT FROM NEW.cost_centre_id
         OR v_mapping.department_id IS DISTINCT FROM NEW.department_id
         OR v_mapping.section_id IS DISTINCT FROM NEW.section_id THEN
        v_invalid := true;
        v_errors := v_errors || jsonb_build_array(
          'Activation line Finance/Posting/CoA/organisation lineage does not match the canonical mapping.'
        );
      END IF;
    END IF;
  END IF;

  NEW.validation_errors := v_errors;
  NEW.validation_snapshot := COALESCE(NEW.validation_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'organization_guard', true,
      'expected_department_id', v_expected_department_id,
      'expected_section_id', v_expected_section_id,
      'expected_cost_centre_id', v_expected_cost_centre_id,
      'finance_posting_mapping_id', NEW.finance_posting_mapping_id
    );

  IF v_invalid THEN
    NEW.mapping_status := 'INVALID';
    NEW.mapped_amount := 0;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_budget_activation_line_org_guard
  ON public.budget_activation_lines;
CREATE TRIGGER trg_budget_activation_line_org_guard
  BEFORE INSERT OR UPDATE OF
    activation_batch_id,
    finance_posting_mapping_id,
    expense_ledger_id,
    expense_code_registry_id,
    chart_of_account_id,
    department_id,
    section_id,
    cost_centre_id,
    mapping_status,
    mapped_amount,
    validation_errors,
    validation_snapshot
  ON public.budget_activation_lines
  FOR EACH ROW EXECUTE FUNCTION public.njss_guard_budget_activation_line_org();

REVOKE ALL ON FUNCTION public.njss_guard_budget_activation_line_org()
  FROM PUBLIC, anon, authenticated;

-- 2. Operational allocation guard: verify the actual insert/update against the
--    approved line, exact division FK, READY activation staging and active
--    canonical mapping.
CREATE OR REPLACE FUNCTION public.njss_guard_operational_allocation_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_submission_id UUID;
  v_division_id UUID;
  v_financial_year INTEGER;
  v_submission_status VARCHAR(40);
  v_submission_locked BOOLEAN;
  v_expected_department_id UUID;
  v_expected_section_id UUID;
  v_expected_cost_centre_id UUID;
  v_line_funding_source_id UUID;
  v_line_annual_estimate NUMERIC(15,2);
  v_expense_ledger_id UUID;
  v_activation_line_id UUID;
  v_finance_posting_mapping_id UUID;
  v_mapping public.finance_posting_mappings;
  v_monthly_cashflow JSONB;
  v_q1 NUMERIC(15,2);
  v_q2 NUMERIC(15,2);
  v_q3 NUMERIC(15,2);
  v_q4 NUMERIC(15,2);
  v_monthly_total NUMERIC(15,2);
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.source_module = 'EXCEL_BUDGET'
     AND OLD.source_budget_line_id IS NOT NULL
     AND OLD.is_active = true
     AND NEW.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Activated Excel-budget baseline allocations cannot be deactivated directly.';
  END IF;

  IF NEW.source_module IS DISTINCT FROM 'EXCEL_BUDGET'
     OR NEW.source_budget_line_id IS NULL
     OR NEW.is_active IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  SELECT
    s.id,
    s.division_id,
    s.budget_year,
    s.status,
    s.is_locked,
    COALESCE(s.department_id, bd.department_id),
    bd.section_id,
    bd.cost_centre_id,
    l.funding_source_id,
    l.annual_estimate,
    l.expense_ledger_id
  INTO
    v_submission_id,
    v_division_id,
    v_financial_year,
    v_submission_status,
    v_submission_locked,
    v_expected_department_id,
    v_expected_section_id,
    v_expected_cost_centre_id,
    v_line_funding_source_id,
    v_line_annual_estimate,
    v_expense_ledger_id
  FROM public.divisional_budget_lines l
  JOIN public.divisional_budget_submissions s ON s.id = l.submission_id
  JOIN public.budget_divisions bd ON bd.id = s.division_id
  WHERE l.id = NEW.source_budget_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operational allocation source budget line could not be resolved.';
  END IF;

  IF v_submission_status IS DISTINCT FROM 'APPROVED'
     OR v_submission_locked IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Operational allocation source budget is no longer APPROVED and locked.';
  END IF;

  IF NEW.source_budget_submission_id IS DISTINCT FROM v_submission_id THEN
    RAISE EXCEPTION 'Operational allocation source submission does not match the approved budget line.';
  END IF;
  IF NEW.budget_division_id IS DISTINCT FROM v_division_id THEN
    RAISE EXCEPTION 'Operational allocation budget division does not match the approved budget line.';
  END IF;
  IF NEW.financial_year IS DISTINCT FROM v_financial_year THEN
    RAISE EXCEPTION 'Operational allocation financial year does not match approved budget.';
  END IF;

  IF v_expected_department_id IS NULL
     OR NEW.department_id IS DISTINCT FROM v_expected_department_id THEN
    RAISE EXCEPTION 'Operational allocation Department does not match approved budget organisational unit.';
  END IF;
  IF v_expected_section_id IS NOT NULL
     AND NEW.section_id IS DISTINCT FROM v_expected_section_id THEN
    RAISE EXCEPTION 'Operational allocation Section does not match approved budget organisational unit.';
  END IF;
  IF v_expected_cost_centre_id IS NULL THEN
    RAISE EXCEPTION 'Approved budget Division has no exact Cost Centre mapping.';
  END IF;
  IF NEW.cost_centre_id IS DISTINCT FROM v_expected_cost_centre_id THEN
    RAISE EXCEPTION 'Operational allocation Cost Centre does not match budget_divisions.cost_centre_id.';
  END IF;

  IF NEW.funding_source_id IS DISTINCT FROM v_line_funding_source_id THEN
    RAISE EXCEPTION 'Operational allocation funding source does not match the approved budget line.';
  END IF;
  IF ABS(COALESCE(NEW.original_budget,0) - COALESCE(v_line_annual_estimate,0)) > 0.009 THEN
    RAISE EXCEPTION 'Operational allocation original budget does not match the approved budget line amount.';
  END IF;

  SELECT
    bal.id,
    bal.finance_posting_mapping_id
  INTO
    v_activation_line_id,
    v_finance_posting_mapping_id
  FROM public.budget_activation_batches bab
  JOIN public.budget_activation_lines bal
    ON bal.activation_batch_id = bab.id
   AND bal.budget_line_id = NEW.source_budget_line_id
  WHERE bab.submission_id = v_submission_id
    AND bab.status IN ('READY_FOR_ACTIVATION','ACTIVATED')
    AND bal.mapping_status = 'READY'
    AND bal.expense_ledger_id = v_expense_ledger_id
    AND bal.department_id = NEW.department_id
    AND bal.section_id IS NOT DISTINCT FROM NEW.section_id
    AND bal.cost_centre_id = NEW.cost_centre_id
    AND bal.expense_code_registry_id = NEW.expense_code_registry_id
    AND bal.chart_of_account_id = NEW.account_id
    AND ABS(COALESCE(bal.approved_amount,0) - COALESCE(NEW.original_budget,0)) <= 0.009
  ORDER BY CASE WHEN bab.status = 'READY_FOR_ACTIVATION' THEN 0 ELSE 1 END, bab.updated_at DESC
  LIMIT 1;

  IF v_activation_line_id IS NULL OR v_finance_posting_mapping_id IS NULL THEN
    RAISE EXCEPTION 'Operational allocation has no matching validated Task 9 activation line.';
  END IF;

  SELECT * INTO v_mapping
  FROM public.finance_posting_mappings
  WHERE id = v_finance_posting_mapping_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operational allocation has no matching active canonical Finance posting mapping.';
  END IF;

  IF v_mapping.expense_ledger_id IS DISTINCT FROM v_expense_ledger_id
     OR v_mapping.expense_code_registry_id IS DISTINCT FROM NEW.expense_code_registry_id
     OR v_mapping.chart_of_account_id IS DISTINCT FROM NEW.account_id
     OR v_mapping.cost_centre_id IS DISTINCT FROM NEW.cost_centre_id
     OR v_mapping.department_id IS DISTINCT FROM NEW.department_id
     OR v_mapping.section_id IS DISTINCT FROM NEW.section_id THEN
    RAISE EXCEPTION 'Operational allocation Finance/Posting/CoA lineage changed after activation validation.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.expense_ledger el
    JOIN public.expense_code_registry ecr ON ecr.id = v_mapping.expense_code_registry_id
    JOIN public.chart_of_accounts coa ON coa.id = v_mapping.chart_of_account_id
    JOIN public.cost_centres cc ON cc.id = v_mapping.cost_centre_id
    JOIN public.departments dep ON dep.id = v_mapping.department_id
    LEFT JOIN public.sections sec ON sec.id = v_mapping.section_id
    WHERE el.id = v_mapping.expense_ledger_id
      AND el.is_active = true
      AND el.is_posting = true
      AND ecr.is_active = true
      AND coa.is_active = true
      AND cc.is_active = true
      AND dep.is_active = true
      AND cc.department_id = v_mapping.department_id
      AND (v_mapping.section_id IS NULL OR (sec.is_active = true
           AND (cc.section_id IS NULL OR cc.section_id = v_mapping.section_id)))
      AND ecr.department_id = v_mapping.department_id
      AND ecr.cost_centre_id = v_mapping.cost_centre_id
      AND (ecr.section_id IS NULL OR ecr.section_id = v_mapping.section_id)
  ) THEN
    RAISE EXCEPTION 'Operational allocation canonical Finance mapping references are inactive or inconsistent.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.budget_allocations ba
    WHERE ba.source_budget_line_id = NEW.source_budget_line_id
      AND ba.source_module = 'EXCEL_BUDGET'
      AND ba.is_active = true
      AND (TG_OP = 'INSERT' OR ba.id IS DISTINCT FROM NEW.id)
  ) THEN
    RAISE EXCEPTION 'An active operational allocation already exists for this approved source budget line.';
  END IF;

  SELECT
    monthly_cashflow, q1, q2, q3, q4
  INTO
    v_monthly_cashflow, v_q1, v_q2, v_q3, v_q4
  FROM public.njss_budget_line_monthly_snapshot(NEW.source_budget_line_id);

  SELECT COALESCE(SUM(bma.amount),0)::NUMERIC(15,2)
  INTO v_monthly_total
  FROM public.budget_monthly_allocations bma
  WHERE bma.budget_line_id = NEW.source_budget_line_id;

  IF ABS(COALESCE(v_monthly_total,0) - COALESCE(v_line_annual_estimate,0)) > 0.009 THEN
    RAISE EXCEPTION 'Operational allocation monthly cash flow no longer reconciles to the approved budget line.';
  END IF;

  IF NEW.monthly_cashflow IS DISTINCT FROM v_monthly_cashflow
     OR ABS(COALESCE(NEW.q1_planned,0) - COALESCE(v_q1,0)) > 0.009
     OR ABS(COALESCE(NEW.q2_planned,0) - COALESCE(v_q2,0)) > 0.009
     OR ABS(COALESCE(NEW.q3_planned,0) - COALESCE(v_q3,0)) > 0.009
     OR ABS(COALESCE(NEW.q4_planned,0) - COALESCE(v_q4,0)) > 0.009 THEN
    RAISE EXCEPTION 'Operational allocation cash-flow snapshot does not match the approved budget line.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operational_allocation_org_guard
  ON public.budget_allocations;
CREATE TRIGGER trg_operational_allocation_org_guard
  BEFORE INSERT OR UPDATE OF
    financial_year,
    department_id,
    section_id,
    cost_centre_id,
    funding_source_id,
    account_id,
    expense_code_registry_id,
    source_budget_submission_id,
    source_budget_line_id,
    budget_division_id,
    source_module,
    original_budget,
    monthly_cashflow,
    q1_planned,
    q2_planned,
    q3_planned,
    q4_planned,
    is_active
  ON public.budget_allocations
  FOR EACH ROW EXECUTE FUNCTION public.njss_guard_operational_allocation_org();

REVOKE ALL ON FUNCTION public.njss_guard_operational_allocation_org()
  FROM PUBLIC, anon, authenticated;

-- 3. Queue exposes validation/fingerprint and immutable evidence counts without
--    adding a second authority model.
CREATE OR REPLACE VIEW public.v_budget_activation_queue
WITH (security_invoker = true)
AS
SELECT
  bab.*,
  s.submission_number,
  s.status AS submission_status,
  s.approved_at,
  s.approved_by,
  COALESCE(NULLIF(trim(approver.full_name), ''), approver.email) AS approved_by_name,
  bd.code AS division_code,
  bd.name AS division_name,
  d.code AS department_code,
  d.name AS department_name,
  COALESCE(NULLIF(trim(prep.full_name), ''), prep.email) AS prepared_by_name,
  COALESCE(NULLIF(trim(auth.full_name), ''), auth.email) AS authorised_by_name,
  COALESCE(snapshot_counts.snapshot_count, 0)::INTEGER AS activation_snapshot_count,
  CASE
    WHEN bab.status = 'ACTIVATED' THEN 'ACTIVATED'
    WHEN bab.validation_fingerprint IS NULL THEN 'NOT_VALIDATED'
    ELSE 'VALIDATED'
  END AS fingerprint_state
FROM public.budget_activation_batches bab
JOIN public.divisional_budget_submissions s ON s.id = bab.submission_id
LEFT JOIN public.budget_divisions bd ON bd.id = bab.budget_division_id
LEFT JOIN public.departments d ON d.id = bab.department_id
LEFT JOIN public.users approver ON approver.id = s.approved_by
LEFT JOIN public.users prep ON prep.id = bab.prepared_by
LEFT JOIN public.users auth ON auth.id = bab.authorised_by
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS snapshot_count
  FROM public.budget_activation_line_snapshots bals
  WHERE bals.activation_batch_id = bab.id
) snapshot_counts ON true;

REVOKE ALL ON public.v_budget_activation_queue FROM PUBLIC, anon;
GRANT SELECT ON public.v_budget_activation_queue TO authenticated;

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES (
  'latest_database_migration',
  '063_budget_activation_fk_only_guards',
  'Latest applied NJSS migration identifier.'
)
ON CONFLICT (setting_key) DO UPDATE SET
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  updated_at = NOW();

COMMIT;
