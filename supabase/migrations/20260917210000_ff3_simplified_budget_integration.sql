-- =============================================================================
-- NJSS PHASE 3 — FF3 SIMPLIFIED HEAD OFFICE BUDGET INTEGRATION
-- Additive migration. Existing legacy FF3/FF4/commitment data is preserved.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Separate FF3 workflow state from simplified budget-control state.
-- -----------------------------------------------------------------------------
ALTER TABLE public.ff3_headers
  ADD COLUMN IF NOT EXISTS expense_ledger_id uuid NULL REFERENCES public.expense_ledger(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS budget_control_status varchar(40) NOT NULL DEFAULT 'NOT_CHECKED',
  ADD COLUMN IF NOT EXISTS budget_current_approved_snapshot numeric(18,2) NULL,
  ADD COLUMN IF NOT EXISTS budget_available_snapshot numeric(18,2) NULL,
  ADD COLUMN IF NOT EXISTS budget_shortfall numeric(18,2) NULL,
  ADD COLUMN IF NOT EXISTS budget_checked_at timestamptz NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ff3_headers'::regclass
      AND conname = 'ff3_headers_budget_control_status_check'
  ) THEN
    ALTER TABLE public.ff3_headers
      ADD CONSTRAINT ff3_headers_budget_control_status_check
      CHECK (budget_control_status IN (
        'NOT_CHECKED',
        'SUFFICIENT',
        'INSUFFICIENT_BUDGET_BLOCKED',
        'NO_ACTIVE_BUDGET',
        'POSTING_MAPPING_REQUIRED'
      ));
  END IF;
END
$constraints$;

CREATE INDEX IF NOT EXISTS idx_ff3_headers_simplified_budget_key
  ON public.ff3_headers(financial_year, department_id, section_id, expense_ledger_id, status)
  WHERE expense_ledger_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Internal authoritative calculator for one FF3 Head Office budget key.
--    It deliberately does not use legacy quarterly releases as the ceiling.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_calculate_ff3_budget(
  p_financial_year integer,
  p_department_id uuid,
  p_section_id uuid,
  p_expense_ledger_id uuid,
  p_cost_centre_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cycle_id uuid;
  v_division_budget_id uuid;
  v_position_exists boolean := false;
  v_original numeric := 0;
  v_supplementary numeric := 0;
  v_realloc_in numeric := 0;
  v_realloc_out numeric := 0;
  v_current numeric := 0;
  v_commitments numeric := 0;
  v_actuals numeric := 0;
  v_available numeric := 0;
  v_shortfall numeric := 0;
  v_mapping_count integer := 0;
  v_specific_count integer := 0;
  v_status text := 'NOT_CHECKED';
BEGIN
  IF p_financial_year IS NULL OR p_department_id IS NULL OR p_section_id IS NULL OR p_expense_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Financial Year, Division, Section and Ledger are required for FF3 budget evaluation';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'FF3 amount must be greater than zero';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sections s
    WHERE s.id = p_section_id
      AND s.department_id = p_department_id
      AND COALESCE(s.is_active, true) = true
  ) THEN
    RAISE EXCEPTION 'Selected Section does not belong to the FF3 Division';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.expense_ledger el
    WHERE el.id = p_expense_ledger_id
      AND el.is_active = true
      AND el.is_posting = true
  ) THEN
    RAISE EXCEPTION 'Selected Ledger is not an active posting ledger';
  END IF;

  SELECT c.id, db.id
    INTO v_cycle_id, v_division_budget_id
  FROM public.annual_budget_cycles c
  JOIN public.division_budgets db ON db.annual_budget_cycle_id = c.id
  WHERE c.financial_year = p_financial_year
    AND c.status = 'ACTIVE'
    AND db.financial_year = p_financial_year
    AND db.division_id = p_department_id
    AND db.status = 'LOCKED'
  LIMIT 1;

  IF v_cycle_id IS NULL OR v_division_budget_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'NO_ACTIVE_BUDGET',
      'position_exists', false,
      'financial_year', p_financial_year,
      'department_id', p_department_id,
      'section_id', p_section_id,
      'expense_ledger_id', p_expense_ledger_id,
      'requested', p_amount,
      'original_budget', 0,
      'supplementary_adjustments', 0,
      'reallocations_in', 0,
      'reallocations_out', 0,
      'current_approved_budget', 0,
      'outstanding_commitments', 0,
      'actual_expenditure', 0,
      'available_budget', 0,
      'shortfall', p_amount,
      'posting_mapping_count', 0
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.division_budget_lines l
    WHERE l.division_budget_id = v_division_budget_id
      AND l.section_id = p_section_id
      AND l.expense_ledger_id = p_expense_ledger_id
    UNION ALL
    SELECT 1
    FROM public.budget_supplementary_adjustments sa
    WHERE sa.annual_budget_cycle_id = v_cycle_id
      AND sa.division_budget_id = v_division_budget_id
      AND sa.section_id = p_section_id
      AND sa.expense_ledger_id = p_expense_ledger_id
      AND sa.status = 'POSTED'
    UNION ALL
    SELECT 1
    FROM public.budget_reallocations br
    WHERE br.annual_budget_cycle_id = v_cycle_id
      AND br.status = 'EXECUTED'
      AND (
        (br.source_division_budget_id = v_division_budget_id
         AND br.source_section_id = p_section_id
         AND br.source_expense_ledger_id = p_expense_ledger_id)
        OR
        (br.destination_division_budget_id = v_division_budget_id
         AND br.destination_section_id = p_section_id
         AND br.destination_expense_ledger_id = p_expense_ledger_id)
      )
    LIMIT 1
  ) INTO v_position_exists;

  IF NOT v_position_exists THEN
    RETURN jsonb_build_object(
      'status', 'NO_ACTIVE_BUDGET',
      'position_exists', false,
      'annual_budget_cycle_id', v_cycle_id,
      'division_budget_id', v_division_budget_id,
      'financial_year', p_financial_year,
      'department_id', p_department_id,
      'section_id', p_section_id,
      'expense_ledger_id', p_expense_ledger_id,
      'requested', p_amount,
      'original_budget', 0,
      'supplementary_adjustments', 0,
      'reallocations_in', 0,
      'reallocations_out', 0,
      'current_approved_budget', 0,
      'outstanding_commitments', 0,
      'actual_expenditure', 0,
      'available_budget', 0,
      'shortfall', p_amount,
      'posting_mapping_count', 0
    );
  END IF;

  SELECT COALESCE(SUM(l.original_amount), 0)
    INTO v_original
  FROM public.division_budget_lines l
  WHERE l.division_budget_id = v_division_budget_id
    AND l.section_id = p_section_id
    AND l.expense_ledger_id = p_expense_ledger_id;

  SELECT COALESCE(SUM(sa.adjustment_amount), 0)
    INTO v_supplementary
  FROM public.budget_supplementary_adjustments sa
  WHERE sa.annual_budget_cycle_id = v_cycle_id
    AND sa.division_budget_id = v_division_budget_id
    AND sa.section_id = p_section_id
    AND sa.expense_ledger_id = p_expense_ledger_id
    AND sa.status = 'POSTED';

  SELECT COALESCE(SUM(br.transfer_amount), 0)
    INTO v_realloc_in
  FROM public.budget_reallocations br
  WHERE br.annual_budget_cycle_id = v_cycle_id
    AND br.destination_division_budget_id = v_division_budget_id
    AND br.destination_section_id = p_section_id
    AND br.destination_expense_ledger_id = p_expense_ledger_id
    AND br.status = 'EXECUTED';

  SELECT COALESCE(SUM(br.transfer_amount), 0)
    INTO v_realloc_out
  FROM public.budget_reallocations br
  WHERE br.annual_budget_cycle_id = v_cycle_id
    AND br.source_division_budget_id = v_division_budget_id
    AND br.source_section_id = p_section_id
    AND br.source_expense_ledger_id = p_expense_ledger_id
    AND br.status = 'EXECUTED';

  v_current := v_original + v_supplementary + v_realloc_in - v_realloc_out;

  SELECT COALESCE(SUM(COALESCE(fc.outstanding_amount, fc.remaining_balance, 0)), 0)
    INTO v_commitments
  FROM public.ff3_commitments fc
  JOIN public.budget_allocations ba ON ba.id = fc.budget_allocation_id
  WHERE fc.financial_year = p_financial_year
    AND COALESCE(fc.status, '') NOT IN ('CANCELLED', 'CLOSED', 'REVERSED')
    AND ba.financial_year = p_financial_year
    AND ba.department_id = p_department_id
    AND ba.section_id = p_section_id
    AND EXISTS (
      SELECT 1
      FROM public.finance_posting_mappings fpm
      WHERE fpm.expense_code_registry_id = ba.expense_code_registry_id
        AND fpm.expense_ledger_id = p_expense_ledger_id
        AND fpm.department_id = p_department_id
        AND fpm.section_id = p_section_id
        AND fpm.is_active = true
        AND (fpm.financial_year = p_financial_year OR fpm.financial_year IS NULL)
    );

  SELECT COALESCE(SUM(
      CASE WHEN upper(COALESCE(pt.transaction_type, '')) = 'REVERSAL'
           THEN -abs(pt.amount) ELSE pt.amount END
    ), 0)
    INTO v_actuals
  FROM public.payment_transactions pt
  JOIN public.budget_allocations ba ON ba.id = pt.budget_allocation_id
  WHERE pt.financial_year = p_financial_year
    AND pt.status IN ('POSTED', 'RECONCILED')
    AND ba.financial_year = p_financial_year
    AND ba.department_id = p_department_id
    AND ba.section_id = p_section_id
    AND EXISTS (
      SELECT 1
      FROM public.finance_posting_mappings fpm
      WHERE fpm.expense_code_registry_id = ba.expense_code_registry_id
        AND fpm.expense_ledger_id = p_expense_ledger_id
        AND fpm.department_id = p_department_id
        AND fpm.section_id = p_section_id
        AND fpm.is_active = true
        AND (fpm.financial_year = p_financial_year OR fpm.financial_year IS NULL)
    );

  v_available := v_current - v_commitments - v_actuals;
  v_shortfall := GREATEST(COALESCE(p_amount, 0) - v_available, 0);

  SELECT COUNT(*)
    INTO v_specific_count
  FROM public.finance_posting_mappings fpm
  WHERE fpm.financial_year = p_financial_year
    AND fpm.expense_ledger_id = p_expense_ledger_id
    AND fpm.department_id = p_department_id
    AND fpm.section_id = p_section_id
    AND fpm.is_active = true
    AND (p_cost_centre_id IS NULL OR fpm.cost_centre_id = p_cost_centre_id);

  IF v_specific_count > 0 THEN
    v_mapping_count := v_specific_count;
  ELSE
    SELECT COUNT(*)
      INTO v_mapping_count
    FROM public.finance_posting_mappings fpm
    WHERE fpm.financial_year IS NULL
      AND fpm.expense_ledger_id = p_expense_ledger_id
      AND fpm.department_id = p_department_id
      AND fpm.section_id = p_section_id
      AND fpm.is_active = true
      AND (p_cost_centre_id IS NULL OR fpm.cost_centre_id = p_cost_centre_id);
  END IF;

  IF COALESCE(p_amount, 0) > v_available + 0.001 THEN
    v_status := 'INSUFFICIENT_BUDGET_BLOCKED';
  ELSIF v_mapping_count <> 1 THEN
    v_status := 'POSTING_MAPPING_REQUIRED';
  ELSE
    v_status := 'SUFFICIENT';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'position_exists', true,
    'annual_budget_cycle_id', v_cycle_id,
    'division_budget_id', v_division_budget_id,
    'financial_year', p_financial_year,
    'department_id', p_department_id,
    'section_id', p_section_id,
    'expense_ledger_id', p_expense_ledger_id,
    'requested', p_amount,
    'original_budget', v_original,
    'supplementary_adjustments', v_supplementary,
    'reallocations_in', v_realloc_in,
    'reallocations_out', v_realloc_out,
    'current_approved_budget', v_current,
    'outstanding_commitments', v_commitments,
    'actual_expenditure', v_actuals,
    'available_budget', v_available,
    'shortfall', v_shortfall,
    'posting_mapping_count', v_mapping_count
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_calculate_ff3_budget(integer, uuid, uuid, uuid, uuid, numeric)
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Authenticated exact-key budget check for FF3 entry/review screens.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_head_office_ff3_budget(
  p_financial_year integer,
  p_department_id uuid,
  p_section_id uuid,
  p_expense_ledger_id uuid,
  p_cost_centre_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT (
    public.fn_current_user_has_permission('ff3.create')
    OR public.fn_current_user_has_permission('ff3.submit')
    OR public.fn_current_user_has_permission('ff3.endorse')
    OR public.fn_current_user_has_permission('ff3.approve')
    OR public.fn_current_user_has_permission('ff3.view')
    OR public.fn_current_user_has_permission('all')
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN public.njss_calculate_ff3_budget(
    p_financial_year,
    p_department_id,
    p_section_id,
    p_expense_ledger_id,
    p_cost_centre_id,
    p_amount
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.check_head_office_ff3_budget(integer, uuid, uuid, uuid, uuid, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_head_office_ff3_budget(integer, uuid, uuid, uuid, uuid, numeric)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Persist a common budget-control state on the FF3 and notify affected actors
--    only when a request newly enters a blocked state.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_notify_ff3_budget_block(
  p_ff3_id uuid,
  p_status text,
  p_available numeric,
  p_shortfall numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ff3 public.ff3_headers%ROWTYPE;
  v_title text;
  v_message text;
BEGIN
  SELECT * INTO v_ff3 FROM public.ff3_headers WHERE id = p_ff3_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_title := CASE p_status
    WHEN 'INSUFFICIENT_BUDGET_BLOCKED' THEN 'FF3 Budget Insufficient — Commitment Blocked'
    WHEN 'NO_ACTIVE_BUDGET' THEN 'FF3 Has No Active Approved Budget'
    WHEN 'POSTING_MAPPING_REQUIRED' THEN 'FF3 Posting Mapping Required'
    ELSE 'FF3 Budget Control Notice'
  END;

  v_message := CASE p_status
    WHEN 'INSUFFICIENT_BUDGET_BLOCKED' THEN
      format('%s requires K%s; available is K%s; shortfall is K%s. Managerial review may continue but commitment is blocked.',
        v_ff3.ff3_number,
        to_char(COALESCE(v_ff3.total_estimated_amount, 0), 'FM999G999G999G990D00'),
        to_char(COALESCE(p_available, 0), 'FM999G999G999G990D00'),
        to_char(COALESCE(p_shortfall, 0), 'FM999G999G999G990D00'))
    WHEN 'NO_ACTIVE_BUDGET' THEN
      format('%s has no active approved Head Office budget position for its Division / Section / Ledger. Managerial review may continue but commitment is blocked.', v_ff3.ff3_number)
    WHEN 'POSTING_MAPPING_REQUIRED' THEN
      format('%s is within approved budget but requires an unambiguous finance posting mapping before commitment can be created.', v_ff3.ff3_number)
    ELSE format('%s requires budget-control attention.', v_ff3.ff3_number)
  END;

  INSERT INTO public.notifications (
    user_id, notification_type, title, message,
    reference_type, reference_id, priority, is_read, is_email_sent
  )
  SELECT DISTINCT target_user_id, 'BUDGET_EXCEEDED', v_title, v_message,
         'FF3', v_ff3.ff3_number, 'HIGH', false, false
  FROM (
    SELECT v_ff3.requesting_officer_id AS target_user_id
    UNION
    SELECT u.id
    FROM public.users u
    JOIN public.user_roles ur ON ur.user_id = u.id
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    WHERE u.is_active = true
      AND rp.is_allowed = true
      AND rp.permission IN ('ff3.endorse', 'ff3.approve')
      AND (u.department_id = v_ff3.department_id OR rp.permission = 'ff3.approve')
  ) targets
  WHERE target_user_id IS NOT NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_notify_ff3_budget_block(uuid, text, numeric, numeric)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.njss_evaluate_ff3_budget(p_ff3_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ff3 public.ff3_headers%ROWTYPE;
  v_result jsonb;
  v_status text;
  v_old_status text;
  v_available numeric;
  v_current numeric;
  v_shortfall numeric;
  v_mapping_count integer;
BEGIN
  SELECT * INTO v_ff3
  FROM public.ff3_headers
  WHERE id = p_ff3_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;
  IF v_ff3.expense_ledger_id IS NULL THEN
    RETURN jsonb_build_object('status', 'NOT_CHECKED', 'legacy', true);
  END IF;

  v_result := public.njss_calculate_ff3_budget(
    v_ff3.financial_year,
    v_ff3.department_id,
    v_ff3.section_id,
    v_ff3.expense_ledger_id,
    v_ff3.cost_centre_id,
    v_ff3.total_estimated_amount
  );

  v_status := COALESCE(v_result->>'status', 'NOT_CHECKED');
  v_old_status := COALESCE(v_ff3.budget_control_status, 'NOT_CHECKED');
  v_current := COALESCE((v_result->>'current_approved_budget')::numeric, 0);
  v_available := COALESCE((v_result->>'available_budget')::numeric, 0);
  v_shortfall := COALESCE((v_result->>'shortfall')::numeric, 0);
  v_mapping_count := COALESCE((v_result->>'posting_mapping_count')::integer, 0);

  UPDATE public.ff3_headers
  SET budget_control_status = v_status,
      budget_current_approved_snapshot = v_current,
      budget_available_snapshot = v_available,
      budget_shortfall = v_shortfall,
      budget_checked_at = now(),
      is_within_budget = CASE
        WHEN v_status IN ('SUFFICIENT', 'POSTING_MAPPING_REQUIRED') THEN true
        ELSE false
      END,
      budget_mapping_status = CASE
        WHEN v_status = 'POSTING_MAPPING_REQUIRED' THEN 'BUDGET_MAPPING_REQUIRED'
        WHEN v_mapping_count = 1 THEN 'RESOLVED'
        ELSE COALESCE(budget_mapping_status, 'BUDGET_MAPPING_REQUIRED')
      END,
      updated_at = now()
  WHERE id = p_ff3_id;

  IF v_status IN ('INSUFFICIENT_BUDGET_BLOCKED', 'NO_ACTIVE_BUDGET', 'POSTING_MAPPING_REQUIRED')
     AND v_status IS DISTINCT FROM v_old_status THEN
    PERFORM public.njss_notify_ff3_budget_block(p_ff3_id, v_status, v_available, v_shortfall);
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_evaluate_ff3_budget(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.njss_refresh_ff3_budget_states(
  p_financial_year integer,
  p_department_id uuid,
  p_section_id uuid,
  p_expense_ledger_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT h.id
    FROM public.ff3_headers h
    WHERE h.financial_year = p_financial_year
      AND h.department_id = p_department_id
      AND h.section_id = p_section_id
      AND h.expense_ledger_id = p_expense_ledger_id
      AND h.status IN ('DRAFT', 'SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD', 'APPROVED')
    ORDER BY h.id
  LOOP
    PERFORM public.njss_evaluate_ff3_budget(v_row.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_refresh_ff3_budget_states(integer, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Resolve the simplified ledger to the legacy accounting bridge required by
--    existing commitment/FF4 foreign keys. The bridge is never the budget ceiling.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_resolve_simplified_ff3_allocation(p_ff3_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ff3 public.ff3_headers%ROWTYPE;
  v_mapping public.finance_posting_mappings%ROWTYPE;
  v_specific_count integer := 0;
  v_mapping_count integer := 0;
  v_allocation_id uuid;
  v_source_module text;
  v_actor uuid := public.fn_current_app_user_id();
BEGIN
  SELECT * INTO v_ff3 FROM public.ff3_headers WHERE id = p_ff3_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;
  IF v_ff3.expense_ledger_id IS NULL THEN RAISE EXCEPTION 'Simplified FF3 Ledger is required'; END IF;

  SELECT COUNT(*) INTO v_specific_count
  FROM public.finance_posting_mappings fpm
  WHERE fpm.financial_year = v_ff3.financial_year
    AND fpm.expense_ledger_id = v_ff3.expense_ledger_id
    AND fpm.department_id = v_ff3.department_id
    AND fpm.section_id = v_ff3.section_id
    AND fpm.is_active = true
    AND (v_ff3.cost_centre_id IS NULL OR fpm.cost_centre_id = v_ff3.cost_centre_id);

  IF v_specific_count > 0 THEN
    v_mapping_count := v_specific_count;
    IF v_mapping_count = 1 THEN
      SELECT * INTO v_mapping
      FROM public.finance_posting_mappings fpm
      WHERE fpm.financial_year = v_ff3.financial_year
        AND fpm.expense_ledger_id = v_ff3.expense_ledger_id
        AND fpm.department_id = v_ff3.department_id
        AND fpm.section_id = v_ff3.section_id
        AND fpm.is_active = true
        AND (v_ff3.cost_centre_id IS NULL OR fpm.cost_centre_id = v_ff3.cost_centre_id)
      LIMIT 1;
    END IF;
  ELSE
    SELECT COUNT(*) INTO v_mapping_count
    FROM public.finance_posting_mappings fpm
    WHERE fpm.financial_year IS NULL
      AND fpm.expense_ledger_id = v_ff3.expense_ledger_id
      AND fpm.department_id = v_ff3.department_id
      AND fpm.section_id = v_ff3.section_id
      AND fpm.is_active = true
      AND (v_ff3.cost_centre_id IS NULL OR fpm.cost_centre_id = v_ff3.cost_centre_id);

    IF v_mapping_count = 1 THEN
      SELECT * INTO v_mapping
      FROM public.finance_posting_mappings fpm
      WHERE fpm.financial_year IS NULL
        AND fpm.expense_ledger_id = v_ff3.expense_ledger_id
        AND fpm.department_id = v_ff3.department_id
        AND fpm.section_id = v_ff3.section_id
        AND fpm.is_active = true
        AND (v_ff3.cost_centre_id IS NULL OR fpm.cost_centre_id = v_ff3.cost_centre_id)
      LIMIT 1;
    END IF;
  END IF;

  IF v_mapping_count <> 1 OR v_mapping.id IS NULL THEN
    RAISE EXCEPTION 'A single active finance posting mapping is required before commitment';
  END IF;

  IF v_ff3.budget_allocation_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.budget_allocations ba
    WHERE ba.id = v_ff3.budget_allocation_id
      AND ba.is_active = true
      AND ba.financial_year = v_ff3.financial_year
      AND ba.department_id = v_ff3.department_id
      AND ba.section_id = v_ff3.section_id
      AND ba.expense_code_registry_id = v_mapping.expense_code_registry_id
      AND ba.account_id = v_mapping.chart_of_account_id
      AND ba.cost_centre_id = v_mapping.cost_centre_id
  ) THEN
    v_allocation_id := v_ff3.budget_allocation_id;
  ELSE
    SELECT ba.id, ba.source_module
      INTO v_allocation_id, v_source_module
    FROM public.budget_allocations ba
    WHERE ba.is_active = true
      AND ba.financial_year = v_ff3.financial_year
      AND ba.department_id = v_ff3.department_id
      AND ba.section_id = v_ff3.section_id
      AND ba.expense_code_registry_id = v_mapping.expense_code_registry_id
      AND ba.account_id = v_mapping.chart_of_account_id
      AND ba.cost_centre_id = v_mapping.cost_centre_id
    ORDER BY CASE WHEN ba.source_module = 'HEAD_OFFICE_SIMPLIFIED' THEN 0 ELSE 1 END, ba.created_at, ba.id
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_allocation_id IS NULL THEN
    INSERT INTO public.budget_allocations (
      financial_year, department_id, section_id, account_id,
      original_budget, supplemental_budget, revised_budget, is_active,
      cost_centre_id, expense_code_registry_id, source_module, created_by, updated_at
    ) VALUES (
      v_ff3.financial_year, v_ff3.department_id, v_ff3.section_id, v_mapping.chart_of_account_id,
      0, 0, GREATEST(COALESCE(v_ff3.budget_current_approved_snapshot, 0), 0), true,
      v_mapping.cost_centre_id, v_mapping.expense_code_registry_id, 'HEAD_OFFICE_SIMPLIFIED', v_actor, now()
    )
    RETURNING id INTO v_allocation_id;
  ELSE
    SELECT source_module INTO v_source_module FROM public.budget_allocations WHERE id = v_allocation_id;
    IF v_source_module = 'HEAD_OFFICE_SIMPLIFIED' THEN
      UPDATE public.budget_allocations
      SET revised_budget = GREATEST(COALESCE(v_ff3.budget_current_approved_snapshot, 0), 0),
          updated_at = now()
      WHERE id = v_allocation_id;
    END IF;
  END IF;

  UPDATE public.ff3_headers
  SET budget_allocation_id = v_allocation_id,
      expense_code_registry_id = v_mapping.expense_code_registry_id,
      cost_centre_id = v_mapping.cost_centre_id,
      budget_mapping_status = 'RESOLVED',
      updated_at = now()
  WHERE id = p_ff3_id;

  RETURN v_allocation_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_resolve_simplified_ff3_allocation(uuid)
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Atomic simplified commitment helper.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_commit_simplified_ff3(
  p_ff3_id uuid,
  p_comments text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ff3 public.ff3_headers%ROWTYPE;
  v_budget_result jsonb;
  v_budget_status text;
  v_actor uuid := public.fn_current_app_user_id();
  v_allocation_id uuid;
  v_commitment public.ff3_commitments%ROWTYPE;
  v_commitment_count integer;
  v_request numeric;
BEGIN
  SELECT * INTO v_ff3
  FROM public.ff3_headers
  WHERE id = p_ff3_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;
  IF v_ff3.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only an APPROVED simplified-budget FF3 may create a commitment. Current status: %', v_ff3.status;
  END IF;
  IF v_ff3.expense_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Simplified-budget commitment requires an Expense Ledger';
  END IF;

  -- Division-header lock serializes commitment attempts against the same
  -- authoritative Division budget and against supplementary/reallocation events.
  PERFORM 1
  FROM public.division_budgets db
  JOIN public.annual_budget_cycles c ON c.id = db.annual_budget_cycle_id
  WHERE c.financial_year = v_ff3.financial_year
    AND c.status = 'ACTIVE'
    AND db.division_id = v_ff3.department_id
    AND db.status = 'LOCKED'
  FOR UPDATE OF db;

  v_budget_result := public.njss_evaluate_ff3_budget(p_ff3_id);
  v_budget_status := COALESCE(v_budget_result->>'status', 'NOT_CHECKED');

  IF v_budget_status <> 'SUFFICIENT' THEN
    SELECT * INTO v_ff3 FROM public.ff3_headers WHERE id = p_ff3_id;
    RETURN jsonb_build_object(
      'header', to_jsonb(v_ff3),
      'commitment', NULL,
      'committed', false,
      'budget_control_status', v_budget_status,
      'budget_position', v_budget_result
    );
  END IF;

  SELECT COUNT(*) INTO v_commitment_count
  FROM public.ff3_commitments
  WHERE ff3_header_id = p_ff3_id
    AND status <> 'CANCELLED';
  IF v_commitment_count > 0 THEN
    RAISE EXCEPTION 'Duplicate original commitment blocked. A commitment already exists for this FF3.';
  END IF;

  v_allocation_id := public.njss_resolve_simplified_ff3_allocation(p_ff3_id);
  SELECT * INTO v_ff3 FROM public.ff3_headers WHERE id = p_ff3_id FOR UPDATE;
  v_request := COALESCE(v_ff3.total_estimated_amount, 0);

  -- Recheck once more after resolving the accounting bridge and before insert.
  v_budget_result := public.njss_evaluate_ff3_budget(p_ff3_id);
  v_budget_status := COALESCE(v_budget_result->>'status', 'NOT_CHECKED');
  IF v_budget_status <> 'SUFFICIENT' THEN
    RETURN jsonb_build_object(
      'header', to_jsonb(v_ff3),
      'commitment', NULL,
      'committed', false,
      'budget_control_status', v_budget_status,
      'budget_position', v_budget_result
    );
  END IF;

  INSERT INTO public.ff3_commitments (
    ff3_header_id, budget_allocation_id, financial_year, commitment_date,
    committed_amount, original_committed_amount, current_committed_amount,
    paid_amount, outstanding_amount, status, created_by, approved_by
  ) VALUES (
    v_ff3.id, v_allocation_id, v_ff3.financial_year, CURRENT_DATE,
    v_request, v_request, v_request,
    0, v_request, 'ACTIVE', COALESCE(v_ff3.created_by, v_ff3.requesting_officer_id), v_actor
  )
  RETURNING * INTO v_commitment;

  INSERT INTO public.commitment_transactions (
    commitment_id, ff3_header_id, budget_allocation_id, transaction_type, amount,
    transaction_date, reason_code, reason, reference, previous_balance, new_balance,
    approved_by, created_by
  ) VALUES (
    v_commitment.id, v_ff3.id, v_allocation_id, 'ORIGINAL_COMMITMENT', v_request,
    CURRENT_DATE, 'FF3_APPROVAL', COALESCE(p_comments, 'FF3 final approval and original commitment.'),
    v_ff3.ff3_number, 0, v_request, v_actor, v_actor
  );

  UPDATE public.ff3_headers
  SET status = 'COMMITTED',
      budget_allocation_id = v_allocation_id,
      budget_mapping_status = 'RESOLVED',
      budget_control_status = 'SUFFICIENT',
      budget_shortfall = 0,
      updated_at = now()
  WHERE id = p_ff3_id
  RETURNING * INTO v_ff3;

  v_commitment := public.njss_sync_commitment_balances(v_commitment.id);

  PERFORM public.log_audit_event(
    v_actor, NULL, 'System', 'COMMITMENT_CREATED', 'COMMITMENT',
    v_commitment.id, v_commitment.commitment_number, NULL, to_jsonb(v_commitment),
    jsonb_build_object(
      'transaction_type', 'ORIGINAL_COMMITMENT',
      'amount', v_request,
      'budget_control_status', 'SUFFICIENT',
      'budget_position_before', v_budget_result
    ),
    jsonb_build_object('phase', 'SIMPLIFIED_HEAD_OFFICE_BUDGET')
  );

  RETURN jsonb_build_object(
    'header', to_jsonb(v_ff3),
    'commitment', to_jsonb(v_commitment),
    'committed', true,
    'budget_control_status', 'SUFFICIENT',
    'budget_position_before', v_budget_result,
    'budget_position_after', public.njss_calculate_ff3_budget(
      v_ff3.financial_year,
      v_ff3.department_id,
      v_ff3.section_id,
      v_ff3.expense_ledger_id,
      v_ff3.cost_centre_id,
      v_request
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_commit_simplified_ff3(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Preserve the deployed legacy transition function verbatim by renaming it,
--    then route only ledger-based FF3s through the new workflow/budget split.
-- -----------------------------------------------------------------------------
DO $legacy$
BEGIN
  IF to_regprocedure('public.njss_transition_ff3_legacy(uuid,text,text,text)') IS NULL
     AND to_regprocedure('public.njss_transition_ff3(uuid,text,text,text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.njss_transition_ff3(uuid,text,text,text) RENAME TO njss_transition_ff3_legacy';
  END IF;
END
$legacy$;

REVOKE EXECUTE ON FUNCTION public.njss_transition_ff3_legacy(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.njss_transition_ff3(
  p_ff3_id uuid,
  p_action text,
  p_comments text DEFAULT NULL,
  p_user_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ff3 public.ff3_headers%ROWTYPE;
  v_old public.ff3_headers%ROWTYPE;
  v_actor uuid := public.fn_current_app_user_id();
  v_next_status text;
  v_budget_result jsonb;
  v_commit_result jsonb;
  v_commitment_count integer;
BEGIN
  p_action := upper(COALESCE(p_action, ''));

  SELECT * INTO v_ff3
  FROM public.ff3_headers
  WHERE id = p_ff3_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;

  -- Existing pre-Phase-3 FF3s keep the exact deployed legacy workflow.
  IF v_ff3.expense_ledger_id IS NULL THEN
    RETURN public.njss_transition_ff3_legacy(p_ff3_id, p_action, p_comments, p_user_email);
  END IF;

  -- Explicit simplified-budget branch: v_ff3.expense_ledger_id IS NOT NULL.
  IF p_action NOT IN ('SUBMIT','ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD','APPROVE','COMMIT','REJECT','CANCEL','RETURN') THEN
    RAISE EXCEPTION 'Invalid FF3 workflow action: %', p_action;
  END IF;

  PERFORM public.njss_require_permission(CASE
    WHEN p_action = 'SUBMIT' THEN 'ff3.submit'
    WHEN p_action IN ('ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD','RETURN') THEN 'ff3.endorse'
    WHEN p_action IN ('APPROVE','COMMIT') THEN 'ff3.approve'
    WHEN p_action = 'REJECT' THEN 'ff3.reject'
    WHEN p_action = 'CANCEL' THEN 'ff3.cancel'
  END);
  -- Equivalent explicit contract: WHEN p_action = 'COMMIT' THEN 'ff3.approve'.

  v_old := v_ff3;
  IF COALESCE(v_ff3.total_estimated_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'FF3 amount must be greater than zero.';
  END IF;

  IF p_action = 'SUBMIT' THEN
    IF v_ff3.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Only DRAFT FF3 can be submitted. Current status: %', v_ff3.status;
    END IF;
    v_next_status := 'SUBMITTED';

  ELSIF p_action = 'ENDORSE_SUPERVISOR' THEN
    IF v_ff3.status <> 'SUBMITTED' THEN
      RAISE EXCEPTION 'Only SUBMITTED FF3 can receive supervisor endorsement. Current status: %', v_ff3.status;
    END IF;
    v_next_status := 'ENDORSED_SUPERVISOR';

  ELSIF p_action = 'ENDORSE_SECTION_HEAD' THEN
    IF v_ff3.status <> 'ENDORSED_SUPERVISOR' THEN
      RAISE EXCEPTION 'Only supervisor-endorsed FF3 can receive section-head endorsement. Current status: %', v_ff3.status;
    END IF;
    v_next_status := 'ENDORSED_SECTION_HEAD';

  ELSIF p_action = 'REJECT' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN
      RAISE EXCEPTION 'Only pending FF3 can be rejected. Current status: %', v_ff3.status;
    END IF;
    IF COALESCE(trim(p_comments), '') = '' THEN RAISE EXCEPTION 'Rejection reason is required.'; END IF;
    v_next_status := 'REJECTED';

  ELSIF p_action = 'RETURN' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN
      RAISE EXCEPTION 'Only pending FF3 can be returned. Current status: %', v_ff3.status;
    END IF;
    IF COALESCE(trim(p_comments), '') = '' THEN RAISE EXCEPTION 'Return reason is required.'; END IF;
    v_next_status := 'RETURNED';

  ELSIF p_action = 'CANCEL' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD','APPROVED') THEN
      RAISE EXCEPTION 'Use commitment cancellation after commitment creation. Current FF3 status: %', v_ff3.status;
    END IF;
    IF COALESCE(trim(p_comments), '') = '' THEN RAISE EXCEPTION 'Cancellation reason is required.'; END IF;
    v_next_status := 'CANCELLED';

  ELSIF p_action = 'APPROVE' THEN
    IF v_ff3.status <> 'ENDORSED_SECTION_HEAD' THEN
      RAISE EXCEPTION 'Only section-head-endorsed FF3 can be finally approved. Current status: %', v_ff3.status;
    END IF;

    IF public.fn_check_segregation_of_duties(
      'FF3',
      COALESCE(v_ff3.created_by, v_ff3.requesting_officer_id),
      COALESCE(v_ff3.supervisor_endorsed_by, v_ff3.section_head_endorsed_by),
      NULL,
      v_actor
    ) IS FALSE THEN
      RAISE EXCEPTION 'Segregation of duties prevents the same user from creating/endorsing/approving this FF3.';
    END IF;

    SELECT COUNT(*) INTO v_commitment_count
    FROM public.ff3_commitments
    WHERE ff3_header_id = p_ff3_id
      AND status <> 'CANCELLED';
    IF v_commitment_count > 0 THEN
      RAISE EXCEPTION 'Duplicate original commitment blocked. A commitment already exists for this FF3.';
    END IF;

    UPDATE public.ff3_headers
    SET status = 'APPROVED',
        approved_date = now(),
        approved_by = v_actor,
        updated_at = now()
    WHERE id = p_ff3_id
    RETURNING * INTO v_ff3;

    INSERT INTO public.ff3_approvals (
      ff3_header_id, approver_id, approval_level, action_taken, comments, action_date
    ) VALUES (
      p_ff3_id, v_actor, 'APPROVE', 'APPROVED', p_comments, now()
    );

    PERFORM public.log_audit_event(
      v_actor, p_user_email, COALESCE(p_user_email, 'System'),
      'FF3_APPROVED_MANAGERIAL', 'FF3', p_ff3_id, v_ff3.ff3_number,
      to_jsonb(v_old), to_jsonb(v_ff3),
      jsonb_build_object('old_status', v_old.status, 'new_status', 'APPROVED', 'reason', p_comments),
      jsonb_build_object('phase', 'SIMPLIFIED_HEAD_OFFICE_BUDGET')
    );

    v_commit_result := public.njss_commit_simplified_ff3(p_ff3_id, p_comments);
    RETURN v_commit_result || jsonb_build_object('managerial_approval_recorded', true);

  ELSIF p_action = 'COMMIT' THEN
    IF v_ff3.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'Only an APPROVED budget-cleared FF3 may create a commitment. Current status: %', v_ff3.status;
    END IF;

    v_commit_result := public.njss_commit_simplified_ff3(p_ff3_id, p_comments);

    INSERT INTO public.ff3_approvals (
      ff3_header_id, approver_id, approval_level, action_taken, comments, action_date
    ) VALUES (
      p_ff3_id,
      v_actor,
      'COMMIT',
      CASE WHEN COALESCE((v_commit_result->>'committed')::boolean, false) THEN 'COMMITTED' ELSE 'BUDGET_BLOCKED' END,
      p_comments,
      now()
    );

    RETURN v_commit_result;
  END IF;

  UPDATE public.ff3_headers
  SET status = v_next_status,
      submitted_date = CASE WHEN p_action = 'SUBMIT' THEN now() ELSE submitted_date END,
      supervisor_endorsed_date = CASE WHEN p_action = 'ENDORSE_SUPERVISOR' THEN now() ELSE supervisor_endorsed_date END,
      supervisor_endorsed_by = CASE WHEN p_action = 'ENDORSE_SUPERVISOR' THEN v_actor ELSE supervisor_endorsed_by END,
      section_head_endorsed_date = CASE WHEN p_action = 'ENDORSE_SECTION_HEAD' THEN now() ELSE section_head_endorsed_date END,
      section_head_endorsed_by = CASE WHEN p_action = 'ENDORSE_SECTION_HEAD' THEN v_actor ELSE section_head_endorsed_by END,
      rejection_reason = CASE WHEN p_action = 'REJECT' THEN p_comments ELSE rejection_reason END,
      returned_reason = CASE WHEN p_action = 'RETURN' THEN p_comments ELSE returned_reason END,
      cancellation_reason = CASE WHEN p_action = 'CANCEL' THEN p_comments ELSE cancellation_reason END,
      cancelled_by = CASE WHEN p_action = 'CANCEL' THEN v_actor ELSE cancelled_by END,
      cancelled_at = CASE WHEN p_action = 'CANCEL' THEN now() ELSE cancelled_at END,
      updated_at = now()
  WHERE id = p_ff3_id
  RETURNING * INTO v_ff3;

  IF p_action IN ('SUBMIT', 'ENDORSE_SUPERVISOR', 'ENDORSE_SECTION_HEAD') THEN
    v_budget_result := public.njss_evaluate_ff3_budget(p_ff3_id);
    SELECT * INTO v_ff3 FROM public.ff3_headers WHERE id = p_ff3_id;
  ELSE
    v_budget_result := NULL;
  END IF;

  INSERT INTO public.ff3_approvals (
    ff3_header_id, approver_id, approval_level, action_taken, comments, action_date
  ) VALUES (
    p_ff3_id,
    v_actor,
    p_action,
    CASE WHEN p_action IN ('REJECT','CANCEL','RETURN') THEN v_next_status ELSE 'ENDORSED' END,
    p_comments,
    now()
  );

  PERFORM public.log_audit_event(
    v_actor, p_user_email, COALESCE(p_user_email, 'System'),
    'FF3_' || p_action, 'FF3', p_ff3_id, v_ff3.ff3_number,
    to_jsonb(v_old), to_jsonb(v_ff3),
    jsonb_build_object(
      'old_status', v_old.status,
      'new_status', v_next_status,
      'budget_control_status', v_ff3.budget_control_status,
      'reason', p_comments
    ),
    jsonb_build_object('phase', 'SIMPLIFIED_HEAD_OFFICE_BUDGET')
  );

  RETURN jsonb_build_object(
    'header', to_jsonb(v_ff3),
    'commitment', NULL,
    'budget_position', v_budget_result,
    'budget_control_status', v_ff3.budget_control_status
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_transition_ff3(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_transition_ff3(uuid, text, text, text)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Authorised budget events automatically refresh affected FF3 block states.
--    They never create a financial commitment by themselves.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_refresh_ff3_after_supplementary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_department_id uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'POSTED' THEN
    SELECT division_id INTO v_department_id
    FROM public.division_budgets
    WHERE id = NEW.division_budget_id;

    PERFORM public.njss_refresh_ff3_budget_states(
      NEW.financial_year,
      v_department_id,
      NEW.section_id,
      NEW.expense_ledger_id
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.njss_refresh_ff3_after_reallocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_source_department_id uuid;
  v_destination_department_id uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'EXECUTED' THEN
    SELECT division_id INTO v_source_department_id
    FROM public.division_budgets
    WHERE id = NEW.source_division_budget_id;

    SELECT division_id INTO v_destination_department_id
    FROM public.division_budgets
    WHERE id = NEW.destination_division_budget_id;

    PERFORM public.njss_refresh_ff3_budget_states(
      NEW.financial_year,
      v_source_department_id,
      NEW.source_section_id,
      NEW.source_expense_ledger_id
    );

    PERFORM public.njss_refresh_ff3_budget_states(
      NEW.financial_year,
      v_destination_department_id,
      NEW.destination_section_id,
      NEW.destination_expense_ledger_id
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ff3_refresh_after_supplementary ON public.budget_supplementary_adjustments;
CREATE TRIGGER trg_ff3_refresh_after_supplementary
AFTER UPDATE OF status ON public.budget_supplementary_adjustments
FOR EACH ROW EXECUTE FUNCTION public.njss_refresh_ff3_after_supplementary();

DROP TRIGGER IF EXISTS trg_ff3_refresh_after_reallocation ON public.budget_reallocations;
CREATE TRIGGER trg_ff3_refresh_after_reallocation
AFTER UPDATE OF status ON public.budget_reallocations
FOR EACH ROW EXECUTE FUNCTION public.njss_refresh_ff3_after_reallocation();

REVOKE EXECUTE ON FUNCTION public.njss_refresh_ff3_after_supplementary()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_refresh_ff3_after_reallocation()
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. Verification guards.
-- -----------------------------------------------------------------------------
DO $verify$
BEGIN
  IF has_function_privilege('anon', 'public.check_head_office_ff3_budget(integer,uuid,uuid,uuid,uuid,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous users must not execute the FF3 simplified budget checker';
  END IF;

  IF has_function_privilege('anon', 'public.njss_transition_ff3(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous users must not execute FF3 workflow transitions';
  END IF;

  IF has_function_privilege('authenticated', 'public.njss_evaluate_ff3_budget(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Internal FF3 budget evaluator must not be directly executable by authenticated clients';
  END IF;

  IF has_function_privilege('authenticated', 'public.njss_resolve_simplified_ff3_allocation(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Internal simplified allocation resolver must not be directly executable by authenticated clients';
  END IF;
END
$verify$;
