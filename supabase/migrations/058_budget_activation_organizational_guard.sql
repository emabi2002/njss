-- =============================================================================
-- NJSS 058 — TASK 9 ACTIVATION ORGANISATIONAL OWNERSHIP GUARD
-- Ensures an internally valid Finance mapping cannot activate a budget against
-- the wrong Department, Section or Cost Centre.
-- =============================================================================

BEGIN;

-- The permission description from migration 019 still described budget approval
-- as creating operational allocations. Task 9 separates those authorities.
UPDATE permissions
SET description = 'Approve reviewed divisional budgets. Operational activation is a separate dual-control step requiring System Administrator preparation and Registrar authorisation.',
    is_active = true
WHERE code = 'budget.template.approve';

CREATE OR REPLACE FUNCTION public.njss_guard_budget_activation_line_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
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
  v_errors JSONB := COALESCE(NEW.validation_errors, '[]'::jsonb);
  v_invalid BOOLEAN := false;
BEGIN
  SELECT
    s.department_id,
    bd.department_id,
    code_department.id,
    bd.section_id,
    NULLIF(trim(bd.cost_centre_code), ''),
    NULLIF(trim(bd.cost_centre_name), ''),
    NULLIF(trim(s.cost_centre), '')
  INTO
    v_submission_department_id,
    v_division_department_id,
    v_division_code_department_id,
    v_expected_section_id,
    v_expected_cost_centre_code,
    v_expected_cost_centre_name,
    v_submission_cost_centre
  FROM budget_activation_batches bab
  JOIN divisional_budget_submissions s ON s.id = bab.submission_id
  JOIN budget_divisions bd ON bd.id = s.division_id
  LEFT JOIN departments code_department
    ON code_department.code = bd.code
   AND code_department.is_active = true
  WHERE bab.id = NEW.activation_batch_id;

  IF NOT FOUND THEN
    NEW.mapping_status := 'INVALID';
    NEW.mapped_amount := 0;
    NEW.validation_errors := v_errors || jsonb_build_array('Approved budget organisational unit could not be resolved.');
    RETURN NEW;
  END IF;

  v_expected_department_id := COALESCE(
    v_submission_department_id,
    v_division_department_id,
    v_division_code_department_id
  );

  IF NEW.cost_centre_id IS NOT NULL THEN
    SELECT cc.code, cc.name
    INTO v_mapped_cost_centre_code, v_mapped_cost_centre_name
    FROM cost_centres cc
    WHERE cc.id = NEW.cost_centre_id;
  END IF;

  IF v_expected_department_id IS NULL THEN
    v_invalid := true;
    v_errors := v_errors || jsonb_build_array('Approved budget Department could not be resolved.');
  ELSIF NEW.department_id IS DISTINCT FROM v_expected_department_id THEN
    v_invalid := true;
    v_errors := v_errors || jsonb_build_array('Mapped Department does not match the approved budget organisational unit.');
  END IF;

  IF v_expected_section_id IS NOT NULL
     AND NEW.section_id IS DISTINCT FROM v_expected_section_id THEN
    v_invalid := true;
    v_errors := v_errors || jsonb_build_array('Mapped Section does not match the approved budget organisational unit.');
  END IF;

  IF v_expected_cost_centre_code IS NOT NULL THEN
    IF NEW.cost_centre_id IS NULL
       OR v_mapped_cost_centre_code IS DISTINCT FROM v_expected_cost_centre_code THEN
      v_invalid := true;
      v_errors := v_errors || jsonb_build_array('Mapped Cost Centre does not match the approved budget organisational unit.');
    END IF;
  ELSIF v_expected_cost_centre_name IS NOT NULL THEN
    IF NEW.cost_centre_id IS NULL
       OR lower(trim(COALESCE(v_mapped_cost_centre_name, ''))) <> lower(v_expected_cost_centre_name) THEN
      v_invalid := true;
      v_errors := v_errors || jsonb_build_array('Mapped Cost Centre does not match the approved budget organisational unit.');
    END IF;
  ELSIF v_submission_cost_centre IS NOT NULL THEN
    IF NEW.cost_centre_id IS NULL
       OR (
         lower(trim(COALESCE(v_mapped_cost_centre_code, ''))) <> lower(v_submission_cost_centre)
         AND lower(trim(COALESCE(v_mapped_cost_centre_name, ''))) <> lower(v_submission_cost_centre)
       ) THEN
      v_invalid := true;
      v_errors := v_errors || jsonb_build_array('Mapped Cost Centre does not match the approved budget organisational unit.');
    END IF;
  ELSE
    v_invalid := true;
    v_errors := v_errors || jsonb_build_array('Approved budget Cost Centre could not be resolved.');
  END IF;

  NEW.validation_errors := v_errors;
  NEW.validation_snapshot := COALESCE(NEW.validation_snapshot, '{}'::jsonb) || jsonb_build_object(
    'organization_guard', true,
    'expected_department_id', v_expected_department_id,
    'expected_section_id', v_expected_section_id,
    'expected_cost_centre_code', v_expected_cost_centre_code,
    'expected_cost_centre_name', v_expected_cost_centre_name,
    'submission_cost_centre', v_submission_cost_centre
  );

  IF v_invalid THEN
    NEW.mapping_status := 'INVALID';
    NEW.mapped_amount := 0;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_budget_activation_line_org_guard ON budget_activation_lines;
CREATE TRIGGER trg_budget_activation_line_org_guard
  BEFORE INSERT OR UPDATE OF
    activation_batch_id,
    department_id,
    section_id,
    cost_centre_id,
    mapping_status,
    mapped_amount,
    validation_errors,
    validation_snapshot
  ON budget_activation_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.njss_guard_budget_activation_line_org();

REVOKE ALL ON FUNCTION public.njss_guard_budget_activation_line_org() FROM PUBLIC, anon, authenticated;

COMMIT;
