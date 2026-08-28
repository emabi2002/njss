-- =============================================================================
-- NJSS 060 — TASK 9 LIVE OPERATIONAL ALLOCATION GUARD
-- Final transaction-boundary protection for Excel-budget operational allocations.
-- Rechecks source lineage, Finance mapping and organisational ownership on the
-- actual INSERT (and on later attempts to change protected lineage fields).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.njss_guard_operational_allocation_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_submission_id UUID;
  v_division_id UUID;
  v_submission_department_id UUID;
  v_division_department_id UUID;
  v_division_code_department_id UUID;
  v_expected_department_id UUID;
  v_expected_section_id UUID;
  v_expected_cost_centre_code TEXT;
  v_expected_cost_centre_name TEXT;
  v_submission_cost_centre TEXT;
  v_mapped_cost_centre_code TEXT;
  v_mapped_cost_centre_name TEXT;
  v_line_funding_source_id UUID;
  v_line_annual_estimate NUMERIC(15,2);
  v_expense_ledger_id UUID;
  v_current_registry_id UUID;
  v_current_chart_of_account_id UUID;
  v_monthly_total NUMERIC(15,2);
BEGIN
  IF NEW.source_module IS DISTINCT FROM 'EXCEL_BUDGET'
     OR NEW.source_budget_line_id IS NULL
     OR NEW.is_active IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  SELECT
    s.id,
    s.division_id,
    s.department_id,
    bd.department_id,
    code_department.id,
    bd.section_id,
    NULLIF(trim(bd.cost_centre_code), ''),
    NULLIF(trim(bd.cost_centre_name), ''),
    NULLIF(trim(s.cost_centre), ''),
    l.funding_source_id,
    l.annual_estimate,
    l.expense_ledger_id,
    el.expense_code_registry_id,
    ecr.chart_of_account_id
  INTO
    v_submission_id,
    v_division_id,
    v_submission_department_id,
    v_division_department_id,
    v_division_code_department_id,
    v_expected_section_id,
    v_expected_cost_centre_code,
    v_expected_cost_centre_name,
    v_submission_cost_centre,
    v_line_funding_source_id,
    v_line_annual_estimate,
    v_expense_ledger_id,
    v_current_registry_id,
    v_current_chart_of_account_id
  FROM divisional_budget_lines l
  JOIN divisional_budget_submissions s ON s.id = l.submission_id
  JOIN budget_divisions bd ON bd.id = s.division_id
  LEFT JOIN departments code_department
    ON code_department.code = bd.code
   AND code_department.is_active = true
  JOIN expense_ledger el
    ON el.id = l.expense_ledger_id
   AND el.is_active = true
   AND el.is_posting = true
  JOIN expense_code_registry ecr
    ON ecr.id = el.expense_code_registry_id
   AND ecr.is_active = true
   AND ecr.expense_ledger_id = el.id
  JOIN chart_of_accounts coa
    ON coa.id = ecr.chart_of_account_id
   AND coa.is_active = true
  WHERE l.id = NEW.source_budget_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operational allocation source line or active Finance mapping is no longer valid.';
  END IF;

  v_expected_department_id := COALESCE(
    v_submission_department_id,
    v_division_department_id,
    v_division_code_department_id
  );

  IF NEW.source_budget_submission_id IS DISTINCT FROM v_submission_id THEN
    RAISE EXCEPTION 'Operational allocation source submission does not match the approved budget line.';
  END IF;

  IF NEW.budget_division_id IS DISTINCT FROM v_division_id THEN
    RAISE EXCEPTION 'Operational allocation budget division does not match the approved budget line.';
  END IF;

  IF v_expected_department_id IS NULL
     OR NEW.department_id IS DISTINCT FROM v_expected_department_id THEN
    RAISE EXCEPTION 'Operational allocation Department does not match approved budget organisational unit.';
  END IF;

  IF v_expected_section_id IS NOT NULL
     AND NEW.section_id IS DISTINCT FROM v_expected_section_id THEN
    RAISE EXCEPTION 'Operational allocation Section does not match approved budget organisational unit.';
  END IF;

  IF NEW.cost_centre_id IS NOT NULL THEN
    SELECT cc.code, cc.name
    INTO v_mapped_cost_centre_code, v_mapped_cost_centre_name
    FROM cost_centres cc
    WHERE cc.id = NEW.cost_centre_id
      AND cc.is_active = true
      AND cc.department_id = NEW.department_id
      AND (
        NEW.section_id IS NULL
        OR cc.section_id IS NULL
        OR cc.section_id = NEW.section_id
      );
  END IF;

  IF NEW.cost_centre_id IS NULL OR v_mapped_cost_centre_code IS NULL THEN
    RAISE EXCEPTION 'Operational allocation Cost Centre does not match approved budget organisational unit.';
  END IF;

  IF v_expected_cost_centre_code IS NOT NULL THEN
    IF v_mapped_cost_centre_code IS DISTINCT FROM v_expected_cost_centre_code THEN
      RAISE EXCEPTION 'Operational allocation Cost Centre does not match approved budget organisational unit.';
    END IF;
  ELSIF v_expected_cost_centre_name IS NOT NULL THEN
    IF lower(trim(COALESCE(v_mapped_cost_centre_name, ''))) <> lower(v_expected_cost_centre_name) THEN
      RAISE EXCEPTION 'Operational allocation Cost Centre does not match approved budget organisational unit.';
    END IF;
  ELSIF v_submission_cost_centre IS NOT NULL THEN
    IF lower(trim(COALESCE(v_mapped_cost_centre_code, ''))) <> lower(v_submission_cost_centre)
       AND lower(trim(COALESCE(v_mapped_cost_centre_name, ''))) <> lower(v_submission_cost_centre) THEN
      RAISE EXCEPTION 'Operational allocation Cost Centre does not match approved budget organisational unit.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Operational allocation Cost Centre does not match approved budget organisational unit.';
  END IF;

  IF NEW.expense_code_registry_id IS DISTINCT FROM v_current_registry_id THEN
    RAISE EXCEPTION 'Operational allocation Posting Code does not match the approved line Finance Code.';
  END IF;

  IF NEW.account_id IS DISTINCT FROM v_current_chart_of_account_id THEN
    RAISE EXCEPTION 'Operational allocation Chart of Accounts does not match the current approved Finance mapping.';
  END IF;

  IF NEW.funding_source_id IS DISTINCT FROM v_line_funding_source_id THEN
    RAISE EXCEPTION 'Operational allocation funding source does not match the approved budget line.';
  END IF;

  IF ABS(COALESCE(NEW.original_budget,0) - COALESCE(v_line_annual_estimate,0)) > 0.009 THEN
    RAISE EXCEPTION 'Operational allocation original budget does not match the approved budget line amount.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM budget_activation_batches bab
    JOIN budget_activation_lines bal
      ON bal.activation_batch_id = bab.id
     AND bal.budget_line_id = NEW.source_budget_line_id
    WHERE bab.submission_id = v_submission_id
      AND bab.status IN ('READY_FOR_ACTIVATION','ACTIVATED')
      AND bal.mapping_status = 'READY'
      AND bal.expense_ledger_id = v_expense_ledger_id
      AND bal.expense_code_registry_id = NEW.expense_code_registry_id
      AND bal.chart_of_account_id = NEW.account_id
      AND bal.department_id = NEW.department_id
      AND bal.section_id IS NOT DISTINCT FROM NEW.section_id
      AND bal.cost_centre_id = NEW.cost_centre_id
      AND ABS(COALESCE(bal.approved_amount,0) - COALESCE(NEW.original_budget,0)) <= 0.009
  ) THEN
    RAISE EXCEPTION 'Operational allocation has no matching validated Task 9 activation line.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(SUM(bma.amount),0)
    INTO v_monthly_total
    FROM budget_monthly_allocations bma
    WHERE bma.budget_line_id = NEW.source_budget_line_id;

    IF ABS(COALESCE(v_monthly_total,0) - COALESCE(v_line_annual_estimate,0)) > 0.009 THEN
      RAISE EXCEPTION 'Operational allocation monthly cash flow no longer reconciles to the approved budget line.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operational_allocation_org_guard ON budget_allocations;
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
    is_active
  ON budget_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public.njss_guard_operational_allocation_org();

REVOKE ALL ON FUNCTION public.njss_guard_operational_allocation_org() FROM PUBLIC, anon, authenticated;

COMMIT;
