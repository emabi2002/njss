-- =============================================================================
-- NJSS PHASE 3 — FF3 BUDGET-BLOCKED WORKFLOW
-- Separates managerial workflow from financial commitment while preferring the
-- active simplified Head Office budget and preserving the legacy control path.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FF3 budget-control snapshot fields
-- -----------------------------------------------------------------------------
ALTER TABLE public.ff3_headers
  ADD COLUMN IF NOT EXISTS budget_control_status varchar(40) NOT NULL DEFAULT 'UNASSESSED',
  ADD COLUMN IF NOT EXISTS budget_control_source varchar(32) NULL,
  ADD COLUMN IF NOT EXISTS budget_expense_ledger_id uuid NULL REFERENCES public.expense_ledger(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS budget_current_approved_amount numeric(18,2) NULL,
  ADD COLUMN IF NOT EXISTS budget_available_amount numeric(18,2) NULL,
  ADD COLUMN IF NOT EXISTS budget_shortfall_amount numeric(18,2) NULL,
  ADD COLUMN IF NOT EXISTS budget_checked_at timestamptz NULL;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ff3_headers_budget_control_status_check'
      AND conrelid = 'public.ff3_headers'::regclass
  ) THEN
    ALTER TABLE public.ff3_headers
      ADD CONSTRAINT ff3_headers_budget_control_status_check
      CHECK (budget_control_status IN (
        'UNASSESSED',
        'SUFFICIENT',
        'INSUFFICIENT_BUDGET_BLOCKED',
        'MAPPING_REQUIRED'
      ));
  END IF;
END;
$block$;

CREATE INDEX IF NOT EXISTS idx_ff3_budget_control_status
  ON public.ff3_headers(financial_year, budget_control_status, status);

-- -----------------------------------------------------------------------------
-- 2. Server-authoritative budget position used by FF3 preview and workflow.
--    If an active simplified annual budget exists, it is authoritative.
--    Otherwise the existing legacy allocation/release engine remains the
--    compatibility path until cutover.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_ff3_budget_position(
  p_financial_year integer,
  p_department_id uuid,
  p_section_id uuid,
  p_expense_code_registry_id uuid,
  p_cost_centre_id uuid DEFAULT NULL,
  p_funding_source_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_cycle_id uuid;
  v_division_budget_id uuid;
  v_mapping_count integer := 0;
  v_expense_ledger_id uuid;
  v_original numeric := 0;
  v_supplementary numeric := 0;
  v_realloc_in numeric := 0;
  v_realloc_out numeric := 0;
  v_current_approved numeric := 0;
  v_committed numeric := 0;
  v_spent numeric := 0;
  v_available numeric := 0;
  v_shortfall numeric := 0;
  v_existing_allocation uuid;
  v_legacy_count integer := 0;
  v_legacy_revised numeric := 0;
  v_legacy_funded numeric := 0;
  v_legacy_released numeric := 0;
  v_legacy_pending numeric := 0;
  v_legacy_committed numeric := 0;
  v_legacy_spent numeric := 0;
  v_legacy_available numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT (
    public.fn_current_user_has_permission('ff3.view')
    OR public.fn_current_user_has_permission('ff3.create')
    OR public.fn_current_user_has_permission('ff3.submit')
    OR public.fn_current_user_has_permission('ff3.endorse')
    OR public.fn_current_user_has_permission('ff3.approve')
    OR public.fn_current_user_has_permission('all')
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT c.id INTO v_cycle_id
  FROM public.annual_budget_cycles c
  WHERE c.financial_year = p_financial_year
    AND c.status = 'ACTIVE'
  ORDER BY c.activated_at DESC NULLS LAST, c.created_at DESC
  LIMIT 1;

  IF v_cycle_id IS NOT NULL THEN
    SELECT db.id INTO v_division_budget_id
    FROM public.division_budgets db
    WHERE db.annual_budget_cycle_id = v_cycle_id
      AND db.division_id = p_department_id
      AND db.status = 'LOCKED'
    LIMIT 1;

    IF v_division_budget_id IS NULL OR p_section_id IS NULL OR p_expense_code_registry_id IS NULL THEN
      RETURN jsonb_build_object(
        'budgetAllocationId', NULL,
        'mappingStatus', 'BUDGET_MAPPING_REQUIRED',
        'allocationCount', 0,
        'revised', 0,
        'funded', 0,
        'released', 0,
        'pending', 0,
        'committed', 0,
        'spent', 0,
        'available', 0,
        'approvedAvailable', 0,
        'projectedAvailableAfterPending', 0,
        'unreleased', 0,
        'unfunded', 0,
        'requested', COALESCE(p_amount,0),
        'withinBudget', false,
        'hasAllocation', false,
        'budgetControlStatus', 'MAPPING_REQUIRED',
        'budgetControlSource', 'SIMPLIFIED_ACTIVE',
        'expenseLedgerId', NULL,
        'currentApproved', 0,
        'originalBudget', 0,
        'supplementaryAdjustments', 0,
        'reallocationsIn', 0,
        'reallocationsOut', 0,
        'shortfall', GREATEST(COALESCE(p_amount,0),0)
      );
    END IF;

    SELECT COUNT(DISTINCT fpm.expense_ledger_id)::integer
      INTO v_mapping_count
    FROM public.finance_posting_mappings fpm
    WHERE fpm.is_active = true
      AND (fpm.financial_year = p_financial_year OR fpm.financial_year IS NULL)
      AND fpm.department_id = p_department_id
      AND fpm.section_id = p_section_id
      AND fpm.expense_code_registry_id = p_expense_code_registry_id
      AND (p_cost_centre_id IS NULL OR fpm.cost_centre_id = p_cost_centre_id);

    IF v_mapping_count <> 1 THEN
      RETURN jsonb_build_object(
        'budgetAllocationId', NULL,
        'mappingStatus', CASE WHEN v_mapping_count > 1 THEN 'BUDGET_MAPPING_REQUIRED_AMBIGUOUS' ELSE 'BUDGET_MAPPING_REQUIRED' END,
        'allocationCount', v_mapping_count,
        'revised', 0,
        'funded', 0,
        'released', 0,
        'pending', 0,
        'committed', 0,
        'spent', 0,
        'available', 0,
        'approvedAvailable', 0,
        'projectedAvailableAfterPending', 0,
        'unreleased', 0,
        'unfunded', 0,
        'requested', COALESCE(p_amount,0),
        'withinBudget', false,
        'hasAllocation', false,
        'budgetControlStatus', 'MAPPING_REQUIRED',
        'budgetControlSource', 'SIMPLIFIED_ACTIVE',
        'expenseLedgerId', NULL,
        'currentApproved', 0,
        'originalBudget', 0,
        'supplementaryAdjustments', 0,
        'reallocationsIn', 0,
        'reallocationsOut', 0,
        'shortfall', GREATEST(COALESCE(p_amount,0),0)
      );
    END IF;

    SELECT fpm.expense_ledger_id
      INTO v_expense_ledger_id
    FROM public.finance_posting_mappings fpm
    WHERE fpm.is_active = true
      AND (fpm.financial_year = p_financial_year OR fpm.financial_year IS NULL)
      AND fpm.department_id = p_department_id
      AND fpm.section_id = p_section_id
      AND fpm.expense_code_registry_id = p_expense_code_registry_id
      AND (p_cost_centre_id IS NULL OR fpm.cost_centre_id = p_cost_centre_id)
    ORDER BY CASE WHEN fpm.financial_year = p_financial_year THEN 0 ELSE 1 END, fpm.created_at DESC
    LIMIT 1;

    SELECT COALESCE(l.original_amount, 0)
      INTO v_original
    FROM public.division_budget_lines l
    WHERE l.division_budget_id = v_division_budget_id
      AND l.section_id = p_section_id
      AND l.expense_ledger_id = v_expense_ledger_id;
    v_original := COALESCE(v_original,0);

    SELECT COALESCE(SUM(sa.adjustment_amount),0)
      INTO v_supplementary
    FROM public.budget_supplementary_adjustments sa
    WHERE sa.annual_budget_cycle_id = v_cycle_id
      AND sa.division_budget_id = v_division_budget_id
      AND sa.section_id = p_section_id
      AND sa.expense_ledger_id = v_expense_ledger_id
      AND sa.status = 'POSTED';

    SELECT COALESCE(SUM(br.transfer_amount),0)
      INTO v_realloc_in
    FROM public.budget_reallocations br
    WHERE br.annual_budget_cycle_id = v_cycle_id
      AND br.destination_division_budget_id = v_division_budget_id
      AND br.destination_section_id = p_section_id
      AND br.destination_expense_ledger_id = v_expense_ledger_id
      AND br.status = 'EXECUTED';

    SELECT COALESCE(SUM(br.transfer_amount),0)
      INTO v_realloc_out
    FROM public.budget_reallocations br
    WHERE br.annual_budget_cycle_id = v_cycle_id
      AND br.source_division_budget_id = v_division_budget_id
      AND br.source_section_id = p_section_id
      AND br.source_expense_ledger_id = v_expense_ledger_id
      AND br.status = 'EXECUTED';

    v_current_approved := v_original + v_supplementary + v_realloc_in - v_realloc_out;

    SELECT COALESCE(SUM(COALESCE(fc.outstanding_amount, fc.remaining_balance, 0)),0)
      INTO v_committed
    FROM public.ff3_commitments fc
    JOIN public.budget_allocations ba ON ba.id = fc.budget_allocation_id
    WHERE fc.financial_year = p_financial_year
      AND COALESCE(fc.status,'') NOT IN ('CANCELLED','CLOSED')
      AND ba.financial_year = p_financial_year
      AND ba.department_id = p_department_id
      AND ba.section_id = p_section_id
      AND ba.expense_code_registry_id = p_expense_code_registry_id
      AND (p_cost_centre_id IS NULL OR ba.cost_centre_id = p_cost_centre_id);

    SELECT COALESCE(SUM(CASE WHEN upper(COALESCE(pt.transaction_type,'')) = 'REVERSAL' THEN -abs(pt.amount) ELSE pt.amount END),0)
      INTO v_spent
    FROM public.payment_transactions pt
    JOIN public.budget_allocations ba ON ba.id = pt.budget_allocation_id
    WHERE pt.financial_year = p_financial_year
      AND pt.status IN ('POSTED','RECONCILED')
      AND ba.financial_year = p_financial_year
      AND ba.department_id = p_department_id
      AND ba.section_id = p_section_id
      AND ba.expense_code_registry_id = p_expense_code_registry_id
      AND (p_cost_centre_id IS NULL OR ba.cost_centre_id = p_cost_centre_id);

    SELECT ba.id INTO v_existing_allocation
    FROM public.budget_allocations ba
    WHERE ba.financial_year = p_financial_year
      AND ba.department_id = p_department_id
      AND ba.section_id = p_section_id
      AND ba.expense_code_registry_id = p_expense_code_registry_id
      AND (p_cost_centre_id IS NULL OR ba.cost_centre_id = p_cost_centre_id)
      AND ba.is_active = true
    ORDER BY CASE WHEN ba.source_module = 'SIMPLIFIED_HEAD_OFFICE_BUDGET' THEN 0 ELSE 1 END, ba.created_at DESC
    LIMIT 1;

    v_available := v_current_approved - v_committed - v_spent;
    v_shortfall := GREATEST(COALESCE(p_amount,0) - v_available, 0);

    RETURN jsonb_build_object(
      'budgetAllocationId', v_existing_allocation,
      'mappingStatus', 'RESOLVED',
      'allocationCount', 1,
      'revised', v_current_approved,
      'funded', v_current_approved,
      'released', v_current_approved,
      'pending', 0,
      'committed', v_committed,
      'spent', v_spent,
      'available', v_available,
      'approvedAvailable', v_available,
      'projectedAvailableAfterPending', v_available,
      'unreleased', 0,
      'unfunded', 0,
      'requested', COALESCE(p_amount,0),
      'withinBudget', COALESCE(p_amount,0) <= v_available + 0.001,
      'hasAllocation', true,
      'budgetControlStatus', CASE WHEN COALESCE(p_amount,0) <= v_available + 0.001 THEN 'SUFFICIENT' ELSE 'INSUFFICIENT_BUDGET_BLOCKED' END,
      'budgetControlSource', 'SIMPLIFIED_ACTIVE',
      'expenseLedgerId', v_expense_ledger_id,
      'currentApproved', v_current_approved,
      'originalBudget', v_original,
      'supplementaryAdjustments', v_supplementary,
      'reallocationsIn', v_realloc_in,
      'reallocationsOut', v_realloc_out,
      'shortfall', v_shortfall
    );
  END IF;

  -- Legacy compatibility path when no simplified annual budget is ACTIVE.
  SELECT COUNT(*)::integer,
         COALESCE(SUM(a.approved_budget),0),
         COALESCE(SUM(a.funded_amount),0),
         COALESCE(SUM(a.released_amount),0),
         COALESCE(SUM(a.pending_amount),0),
         COALESCE(SUM(a.outstanding_commitment),0),
         COALESCE(SUM(a.actual_expenditure),0)
    INTO v_legacy_count, v_legacy_revised, v_legacy_funded, v_legacy_released,
         v_legacy_pending, v_legacy_committed, v_legacy_spent
  FROM public.v_authoritative_budget_position a
  WHERE a.financial_year = p_financial_year
    AND (p_department_id IS NULL OR a.department_id = p_department_id)
    AND (p_section_id IS NULL OR a.section_id = p_section_id)
    AND (p_expense_code_registry_id IS NULL OR a.expense_code_registry_id = p_expense_code_registry_id)
    AND (p_cost_centre_id IS NULL OR a.cost_centre_id = p_cost_centre_id)
    AND (p_funding_source_id IS NULL OR a.funding_source_id = p_funding_source_id)
    AND (p_project_id IS NULL OR a.project_id = p_project_id);

  IF v_legacy_count = 1 THEN
    SELECT a.budget_allocation_id INTO v_existing_allocation
    FROM public.v_authoritative_budget_position a
    WHERE a.financial_year = p_financial_year
      AND (p_department_id IS NULL OR a.department_id = p_department_id)
      AND (p_section_id IS NULL OR a.section_id = p_section_id)
      AND (p_expense_code_registry_id IS NULL OR a.expense_code_registry_id = p_expense_code_registry_id)
      AND (p_cost_centre_id IS NULL OR a.cost_centre_id = p_cost_centre_id)
      AND (p_funding_source_id IS NULL OR a.funding_source_id = p_funding_source_id)
      AND (p_project_id IS NULL OR a.project_id = p_project_id)
    LIMIT 1;
  END IF;

  v_legacy_available := v_legacy_released - v_legacy_committed - v_legacy_spent;
  v_shortfall := GREATEST(COALESCE(p_amount,0) - v_legacy_available, 0);

  RETURN jsonb_build_object(
    'budgetAllocationId', CASE WHEN v_legacy_count = 1 THEN v_existing_allocation ELSE NULL END,
    'mappingStatus', CASE WHEN v_legacy_count = 1 THEN 'RESOLVED' WHEN v_legacy_count = 0 THEN 'BUDGET_MAPPING_REQUIRED' ELSE 'BUDGET_MAPPING_REQUIRED_AMBIGUOUS' END,
    'allocationCount', v_legacy_count,
    'revised', v_legacy_revised,
    'funded', v_legacy_funded,
    'released', v_legacy_released,
    'pending', v_legacy_pending,
    'committed', v_legacy_committed,
    'spent', v_legacy_spent,
    'available', v_legacy_available,
    'approvedAvailable', v_legacy_revised - v_legacy_committed - v_legacy_spent,
    'projectedAvailableAfterPending', v_legacy_available - v_legacy_pending,
    'unreleased', v_legacy_funded - v_legacy_released,
    'unfunded', v_legacy_revised - v_legacy_funded,
    'requested', COALESCE(p_amount,0),
    'withinBudget', v_legacy_count = 1 AND COALESCE(p_amount,0) <= v_legacy_available + 0.001,
    'hasAllocation', v_legacy_count = 1,
    'budgetControlStatus', CASE
      WHEN v_legacy_count <> 1 THEN 'MAPPING_REQUIRED'
      WHEN COALESCE(p_amount,0) <= v_legacy_available + 0.001 THEN 'SUFFICIENT'
      ELSE 'INSUFFICIENT_BUDGET_BLOCKED'
    END,
    'budgetControlSource', 'LEGACY_ALLOCATION',
    'expenseLedgerId', NULL,
    'currentApproved', v_legacy_revised,
    'originalBudget', v_legacy_revised,
    'supplementaryAdjustments', 0,
    'reallocationsIn', 0,
    'reallocationsOut', 0,
    'shortfall', v_shortfall
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.check_ff3_budget_position(integer,uuid,uuid,uuid,uuid,uuid,uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_ff3_budget_position(integer,uuid,uuid,uuid,uuid,uuid,uuid,numeric) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Internal adapter: create/update a backing operational allocation only when
--    a simplified-budget FF3 reaches final approval. This preserves existing
--    FF3 commitment and FF4 foreign-key/reporting infrastructure.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_ensure_ff3_operational_allocation(
  p_ff3_id uuid,
  p_expense_ledger_id uuid,
  p_current_approved numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_ff3 public.ff3_headers%ROWTYPE;
  v_mapping_count integer;
  v_chart_of_account_id uuid;
  v_cost_centre_id uuid;
  v_allocation_id uuid;
  v_existing_count integer;
  v_original numeric := 0;
  v_cycle_id uuid;
  v_division_budget_id uuid;
BEGIN
  SELECT * INTO v_ff3 FROM public.ff3_headers WHERE id = p_ff3_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;

  SELECT COUNT(*)::integer INTO v_mapping_count
  FROM public.finance_posting_mappings fpm
  WHERE fpm.is_active = true
    AND (fpm.financial_year = v_ff3.financial_year OR fpm.financial_year IS NULL)
    AND fpm.department_id = v_ff3.department_id
    AND fpm.section_id = v_ff3.section_id
    AND fpm.expense_code_registry_id = v_ff3.expense_code_registry_id
    AND fpm.expense_ledger_id = p_expense_ledger_id
    AND (v_ff3.cost_centre_id IS NULL OR fpm.cost_centre_id = v_ff3.cost_centre_id);
  IF v_mapping_count <> 1 THEN
    RAISE EXCEPTION 'A unique Finance Posting Mapping is required before FF3 commitment';
  END IF;

  SELECT fpm.chart_of_account_id, fpm.cost_centre_id
    INTO v_chart_of_account_id, v_cost_centre_id
  FROM public.finance_posting_mappings fpm
  WHERE fpm.is_active = true
    AND (fpm.financial_year = v_ff3.financial_year OR fpm.financial_year IS NULL)
    AND fpm.department_id = v_ff3.department_id
    AND fpm.section_id = v_ff3.section_id
    AND fpm.expense_code_registry_id = v_ff3.expense_code_registry_id
    AND fpm.expense_ledger_id = p_expense_ledger_id
    AND (v_ff3.cost_centre_id IS NULL OR fpm.cost_centre_id = v_ff3.cost_centre_id)
  ORDER BY CASE WHEN fpm.financial_year = v_ff3.financial_year THEN 0 ELSE 1 END, fpm.created_at DESC
  LIMIT 1;

  SELECT c.id, db.id INTO v_cycle_id, v_division_budget_id
  FROM public.annual_budget_cycles c
  JOIN public.division_budgets db ON db.annual_budget_cycle_id = c.id
  WHERE c.financial_year = v_ff3.financial_year
    AND c.status = 'ACTIVE'
    AND db.division_id = v_ff3.department_id
    AND db.status = 'LOCKED'
  ORDER BY c.activated_at DESC NULLS LAST
  LIMIT 1;

  SELECT COALESCE(l.original_amount,0) INTO v_original
  FROM public.division_budget_lines l
  WHERE l.division_budget_id = v_division_budget_id
    AND l.section_id = v_ff3.section_id
    AND l.expense_ledger_id = p_expense_ledger_id;
  v_original := COALESCE(v_original,0);

  SELECT COUNT(*)::integer INTO v_existing_count
  FROM public.budget_allocations ba
  WHERE ba.financial_year = v_ff3.financial_year
    AND ba.department_id = v_ff3.department_id
    AND ba.section_id = v_ff3.section_id
    AND ba.cost_centre_id = v_cost_centre_id
    AND ba.expense_code_registry_id = v_ff3.expense_code_registry_id
    AND ba.project_id IS NOT DISTINCT FROM v_ff3.project_id
    AND ba.funding_source_id IS NOT DISTINCT FROM v_ff3.funding_source_id
    AND ba.is_active = true;

  IF v_existing_count > 1 THEN
    RAISE EXCEPTION 'Multiple operational budget allocations match this FF3';
  ELSIF v_existing_count = 1 THEN
    SELECT ba.id INTO v_allocation_id
    FROM public.budget_allocations ba
    WHERE ba.financial_year = v_ff3.financial_year
      AND ba.department_id = v_ff3.department_id
      AND ba.section_id = v_ff3.section_id
      AND ba.cost_centre_id = v_cost_centre_id
      AND ba.expense_code_registry_id = v_ff3.expense_code_registry_id
      AND ba.project_id IS NOT DISTINCT FROM v_ff3.project_id
      AND ba.funding_source_id IS NOT DISTINCT FROM v_ff3.funding_source_id
      AND ba.is_active = true
    LIMIT 1
    FOR UPDATE;

    UPDATE public.budget_allocations
    SET account_id = v_chart_of_account_id,
        original_budget = v_original,
        supplemental_budget = p_current_approved - v_original,
        revised_budget = p_current_approved,
        source_module = CASE WHEN source_module = 'SIMPLIFIED_HEAD_OFFICE_BUDGET' THEN source_module ELSE source_module END,
        updated_at = now()
    WHERE id = v_allocation_id;
  ELSE
    INSERT INTO public.budget_allocations(
      financial_year, department_id, section_id, project_id, funding_source_id,
      account_id, original_budget, supplemental_budget, revised_budget, is_active,
      cost_centre_id, expense_code_registry_id, source_module, created_by
    ) VALUES (
      v_ff3.financial_year, v_ff3.department_id, v_ff3.section_id, v_ff3.project_id, v_ff3.funding_source_id,
      v_chart_of_account_id, v_original, p_current_approved - v_original, p_current_approved, true,
      v_cost_centre_id, v_ff3.expense_code_registry_id, 'SIMPLIFIED_HEAD_OFFICE_BUDGET', public.fn_current_app_user_id()
    ) RETURNING id INTO v_allocation_id;
  END IF;

  RETURN v_allocation_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_ensure_ff3_operational_allocation(uuid,uuid,numeric) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. FF3 workflow: insufficient budget is a separate control state.
--    Managerial endorsements can continue, but final APPROVE is blocked until
--    a fresh server-side check is sufficient. No commitment exists while blocked.
-- -----------------------------------------------------------------------------
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
  v_ff3 ff3_headers;
  v_old ff3_headers;
  v_budget budget_allocations;
  v_actor UUID := fn_current_app_user_id();
  v_next_status TEXT;
  v_commitment ff3_commitments;
  v_position_before JSONB;
  v_position_after JSONB;
  v_budget_state JSONB;
  v_budget_control_status text;
  v_budget_control_source text;
  v_mapping_status text;
  v_expense_ledger_id uuid;
  v_current_approved numeric;
  v_available numeric;
  v_shortfall numeric;
  v_request NUMERIC;
  v_commitment_count INTEGER;
BEGIN
  IF p_action NOT IN ('SUBMIT','ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD','APPROVE','REJECT','CANCEL','RETURN') THEN
    RAISE EXCEPTION 'Invalid FF3 workflow action: %', p_action;
  END IF;

  PERFORM njss_require_permission(CASE
    WHEN p_action = 'SUBMIT' THEN 'ff3.submit'
    WHEN p_action IN ('ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD','RETURN') THEN 'ff3.endorse'
    WHEN p_action = 'APPROVE' THEN 'ff3.approve'
    WHEN p_action = 'REJECT' THEN 'ff3.reject'
    WHEN p_action = 'CANCEL' THEN 'ff3.cancel'
  END);

  SELECT * INTO v_ff3 FROM ff3_headers WHERE id = p_ff3_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;
  v_old := v_ff3;
  v_request := COALESCE(v_ff3.total_estimated_amount, 0);
  IF v_request <= 0 THEN RAISE EXCEPTION 'FF3 amount must be greater than zero.'; END IF;

  IF p_action IN ('SUBMIT','ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD','APPROVE') THEN
    v_budget_state := public.check_ff3_budget_position(
      v_ff3.financial_year,
      v_ff3.department_id,
      v_ff3.section_id,
      v_ff3.expense_code_registry_id,
      v_ff3.cost_centre_id,
      v_ff3.funding_source_id,
      v_ff3.project_id,
      v_request
    );
    v_mapping_status := v_budget_state->>'mappingStatus';
    v_budget_control_status := v_budget_state->>'budgetControlStatus';
    v_budget_control_source := v_budget_state->>'budgetControlSource';
    v_expense_ledger_id := NULLIF(v_budget_state->>'expenseLedgerId','')::uuid;
    v_current_approved := COALESCE((v_budget_state->>'currentApproved')::numeric,0);
    v_available := COALESCE((v_budget_state->>'available')::numeric,0);
    v_shortfall := COALESCE((v_budget_state->>'shortfall')::numeric,0);

    IF v_mapping_status <> 'RESOLVED' THEN
      RAISE EXCEPTION 'No unique authoritative budget mapping exists for this FF3.';
    END IF;
  END IF;

  IF p_action = 'SUBMIT' THEN
    IF v_ff3.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only DRAFT FF3 can be submitted. Current status: %', v_ff3.status; END IF;
    v_next_status := 'SUBMITTED';

  ELSIF p_action = 'ENDORSE_SUPERVISOR' THEN
    IF v_ff3.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'Only SUBMITTED FF3 can receive supervisor endorsement. Current status: %', v_ff3.status; END IF;
    v_next_status := 'ENDORSED_SUPERVISOR';

  ELSIF p_action = 'ENDORSE_SECTION_HEAD' THEN
    IF v_ff3.status <> 'ENDORSED_SUPERVISOR' THEN RAISE EXCEPTION 'Only supervisor-endorsed FF3 can receive section-head endorsement. Current status: %', v_ff3.status; END IF;
    v_next_status := 'ENDORSED_SECTION_HEAD';

  ELSIF p_action = 'REJECT' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN RAISE EXCEPTION 'Only pending FF3 can be rejected. Current status: %', v_ff3.status; END IF;
    IF COALESCE(TRIM(p_comments), '') = '' THEN RAISE EXCEPTION 'Rejection reason is required.'; END IF;
    v_next_status := 'REJECTED';

  ELSIF p_action = 'RETURN' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN RAISE EXCEPTION 'Only pending FF3 can be returned. Current status: %', v_ff3.status; END IF;
    IF COALESCE(TRIM(p_comments), '') = '' THEN RAISE EXCEPTION 'Return reason is required.'; END IF;
    v_next_status := 'RETURNED';

  ELSIF p_action = 'CANCEL' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN RAISE EXCEPTION 'Use commitment cancellation after approval. Current FF3 status: %', v_ff3.status; END IF;
    IF COALESCE(TRIM(p_comments), '') = '' THEN RAISE EXCEPTION 'Cancellation reason is required.'; END IF;
    v_next_status := 'CANCELLED';

  ELSIF p_action = 'APPROVE' THEN
    IF v_ff3.status <> 'ENDORSED_SECTION_HEAD' THEN RAISE EXCEPTION 'Only section-head-endorsed FF3 can be finally approved. Current status: %', v_ff3.status; END IF;

    IF v_budget_control_status = 'INSUFFICIENT_BUDGET_BLOCKED' THEN
      RAISE EXCEPTION 'Reallocation or supplementary budget is required before final approval. Available: K%, Requested: K%, Shortfall: K%.', v_available, v_request, v_shortfall;
    END IF;
    IF v_budget_control_status <> 'SUFFICIENT' THEN
      RAISE EXCEPTION 'FF3 cannot be finally approved until the budget control state is sufficient.';
    END IF;

    IF v_budget_control_source = 'SIMPLIFIED_ACTIVE' THEN
      v_ff3.budget_allocation_id := public.njss_ensure_ff3_operational_allocation(
        p_ff3_id, v_expense_ledger_id, v_current_approved
      );
    ELSE
      v_ff3.budget_allocation_id := NULLIF(v_budget_state->>'budgetAllocationId','')::uuid;
    END IF;

    SELECT * INTO v_budget
    FROM budget_allocations
    WHERE id = v_ff3.budget_allocation_id AND is_active = true
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Approved operational budget allocation not found'; END IF;
    IF v_budget.financial_year <> v_ff3.financial_year THEN RAISE EXCEPTION 'FF3 financial year does not match the linked budget allocation.'; END IF;

    IF fn_check_segregation_of_duties(
      'FF3', COALESCE(v_ff3.created_by, v_ff3.requesting_officer_id),
      COALESCE(v_ff3.supervisor_endorsed_by, v_ff3.section_head_endorsed_by),
      NULL, v_actor
    ) IS FALSE THEN
      RAISE EXCEPTION 'Segregation of duties prevents the same user from creating/endorsing/approving this FF3.';
    END IF;

    SELECT COUNT(*) INTO v_commitment_count
    FROM ff3_commitments
    WHERE ff3_header_id = p_ff3_id AND status <> 'CANCELLED';
    IF v_commitment_count > 0 THEN RAISE EXCEPTION 'Duplicate original commitment blocked. A commitment already exists for this FF3.'; END IF;

    -- Fresh check above is the atomic commitment gate while the FF3 row and
    -- operational allocation are locked.
    v_position_before := v_budget_state;

    UPDATE ff3_headers
    SET status = 'APPROVED',
        approved_date = NOW(),
        approved_by = v_actor,
        budget_allocation_id = v_budget.id,
        budget_mapping_status = 'RESOLVED',
        budget_control_status = 'SUFFICIENT',
        budget_control_source = v_budget_control_source,
        budget_expense_ledger_id = v_expense_ledger_id,
        budget_current_approved_amount = v_current_approved,
        budget_available_amount = v_available,
        budget_shortfall_amount = 0,
        budget_checked_at = now(),
        is_within_budget = true,
        updated_at = NOW()
    WHERE id = p_ff3_id
    RETURNING * INTO v_ff3;

    INSERT INTO ff3_commitments (
      ff3_header_id, budget_allocation_id, financial_year, commitment_date,
      committed_amount, original_committed_amount, current_committed_amount,
      paid_amount, outstanding_amount, status, created_by, approved_by
    ) VALUES (
      v_ff3.id, v_budget.id, v_ff3.financial_year, CURRENT_DATE,
      v_request, v_request, v_request,
      0, v_request, 'ACTIVE', COALESCE(v_ff3.created_by, v_ff3.requesting_officer_id), v_actor
    ) RETURNING * INTO v_commitment;

    INSERT INTO commitment_transactions (
      commitment_id, ff3_header_id, budget_allocation_id, transaction_type, amount,
      transaction_date, reason_code, reason, reference, previous_balance, new_balance,
      approved_by, created_by
    ) VALUES (
      v_commitment.id, v_ff3.id, v_budget.id, 'ORIGINAL_COMMITMENT', v_request,
      CURRENT_DATE, 'FF3_APPROVAL', COALESCE(p_comments, 'FF3 final approval and original commitment.'),
      v_ff3.ff3_number, 0, v_request, v_actor, v_actor
    );

    UPDATE ff3_headers
    SET status = 'COMMITTED', updated_at = NOW()
    WHERE id = p_ff3_id
    RETURNING * INTO v_ff3;

    v_commitment := njss_sync_commitment_balances(v_commitment.id);
    v_position_after := public.check_ff3_budget_position(
      v_ff3.financial_year, v_ff3.department_id, v_ff3.section_id,
      v_ff3.expense_code_registry_id, v_ff3.cost_centre_id,
      v_ff3.funding_source_id, v_ff3.project_id, 0
    );

    INSERT INTO ff3_approvals (ff3_header_id, approver_id, approval_level, action_taken, comments, action_date)
    VALUES (p_ff3_id, v_actor, p_action, 'APPROVED', p_comments, NOW());

    PERFORM log_audit_event(
      v_actor, p_user_email, COALESCE(p_user_email, 'System'),
      'FF3_APPROVED_COMMITMENT_CREATED', 'FF3', p_ff3_id, v_ff3.ff3_number,
      to_jsonb(v_old), to_jsonb(v_ff3),
      jsonb_build_object(
        'old_status', v_old.status,
        'new_status', v_ff3.status,
        'commitment_id', v_commitment.id,
        'budget_control_source', v_budget_control_source,
        'financial_position_before', v_position_before,
        'financial_position_after', v_position_after,
        'reason', p_comments
      ), NULL
    );

    PERFORM log_audit_event(
      v_actor, p_user_email, COALESCE(p_user_email, 'System'),
      'COMMITMENT_CREATED', 'COMMITMENT', v_commitment.id, v_commitment.commitment_number,
      NULL, to_jsonb(v_commitment),
      jsonb_build_object(
        'transaction_type', 'ORIGINAL_COMMITMENT',
        'amount', v_request,
        'financial_position_before', v_position_before,
        'financial_position_after', v_position_after
      ), NULL
    );

    RETURN jsonb_build_object(
      'header', to_jsonb(v_ff3),
      'commitment', to_jsonb(v_commitment),
      'financial_position_before', v_position_before,
      'financial_position_after', v_position_after
    );
  END IF;

  UPDATE ff3_headers
  SET status = v_next_status,
      budget_allocation_id = CASE
        WHEN v_budget_state IS NOT NULL AND NULLIF(v_budget_state->>'budgetAllocationId','') IS NOT NULL
          THEN (v_budget_state->>'budgetAllocationId')::uuid
        ELSE budget_allocation_id
      END,
      budget_mapping_status = CASE WHEN v_budget_state IS NOT NULL THEN v_mapping_status ELSE budget_mapping_status END,
      budget_control_status = CASE WHEN v_budget_state IS NOT NULL THEN v_budget_control_status ELSE budget_control_status END,
      budget_control_source = CASE WHEN v_budget_state IS NOT NULL THEN v_budget_control_source ELSE budget_control_source END,
      budget_expense_ledger_id = CASE WHEN v_budget_state IS NOT NULL THEN v_expense_ledger_id ELSE budget_expense_ledger_id END,
      budget_current_approved_amount = CASE WHEN v_budget_state IS NOT NULL THEN v_current_approved ELSE budget_current_approved_amount END,
      budget_available_amount = CASE WHEN v_budget_state IS NOT NULL THEN v_available ELSE budget_available_amount END,
      budget_shortfall_amount = CASE WHEN v_budget_state IS NOT NULL THEN v_shortfall ELSE budget_shortfall_amount END,
      budget_checked_at = CASE WHEN v_budget_state IS NOT NULL THEN now() ELSE budget_checked_at END,
      is_within_budget = CASE WHEN v_budget_state IS NOT NULL THEN v_budget_control_status = 'SUFFICIENT' ELSE is_within_budget END,
      submitted_date = CASE WHEN p_action = 'SUBMIT' THEN NOW() ELSE submitted_date END,
      supervisor_endorsed_date = CASE WHEN p_action = 'ENDORSE_SUPERVISOR' THEN NOW() ELSE supervisor_endorsed_date END,
      supervisor_endorsed_by = CASE WHEN p_action = 'ENDORSE_SUPERVISOR' THEN v_actor ELSE supervisor_endorsed_by END,
      section_head_endorsed_date = CASE WHEN p_action = 'ENDORSE_SECTION_HEAD' THEN NOW() ELSE section_head_endorsed_date END,
      section_head_endorsed_by = CASE WHEN p_action = 'ENDORSE_SECTION_HEAD' THEN v_actor ELSE section_head_endorsed_by END,
      rejection_reason = CASE WHEN p_action = 'REJECT' THEN p_comments ELSE rejection_reason END,
      returned_reason = CASE WHEN p_action = 'RETURN' THEN p_comments ELSE returned_reason END,
      cancellation_reason = CASE WHEN p_action = 'CANCEL' THEN p_comments ELSE cancellation_reason END,
      cancelled_by = CASE WHEN p_action = 'CANCEL' THEN v_actor ELSE cancelled_by END,
      cancelled_at = CASE WHEN p_action = 'CANCEL' THEN NOW() ELSE cancelled_at END,
      updated_at = NOW()
  WHERE id = p_ff3_id
  RETURNING * INTO v_ff3;

  INSERT INTO ff3_approvals (ff3_header_id, approver_id, approval_level, action_taken, comments, action_date)
  VALUES (
    p_ff3_id, v_actor, p_action,
    CASE WHEN p_action IN ('REJECT','CANCEL','RETURN') THEN v_next_status ELSE 'ENDORSED' END,
    p_comments, NOW()
  );

  PERFORM log_audit_event(
    v_actor, p_user_email, COALESCE(p_user_email, 'System'),
    'FF3_' || p_action, 'FF3', p_ff3_id, v_ff3.ff3_number,
    to_jsonb(v_old), to_jsonb(v_ff3),
    jsonb_build_object(
      'old_status', v_old.status,
      'new_status', v_next_status,
      'budget_control_status', v_ff3.budget_control_status,
      'budget_shortfall', v_ff3.budget_shortfall_amount,
      'reason', p_comments
    ), NULL
  );

  RETURN jsonb_build_object(
    'header', to_jsonb(v_ff3),
    'commitment', NULL,
    'budget_control_status', v_ff3.budget_control_status,
    'financial_position_after', v_budget_state
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_transition_ff3(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_transition_ff3(uuid,text,text,text) TO authenticated;
