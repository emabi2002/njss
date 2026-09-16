-- =============================================================================
-- NJSS PHASE 3 — FF3 SIMPLIFIED BUDGET CONTROL
-- Separate managerial workflow from financial commitment control while keeping
-- the current legacy path as a compatibility fallback until a simplified annual
-- budget is ACTIVE for the financial year.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Additive FF3 / commitment dimensions and persisted budget-control state.
-- -----------------------------------------------------------------------------
ALTER TABLE public.ff3_headers
  ADD COLUMN IF NOT EXISTS expense_ledger_id uuid REFERENCES public.expense_ledger(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS budget_control_status varchar(40) NOT NULL DEFAULT 'UNCHECKED',
  ADD COLUMN IF NOT EXISTS budget_control_source varchar(32),
  ADD COLUMN IF NOT EXISTS budget_available_at_check numeric(18,2),
  ADD COLUMN IF NOT EXISTS budget_shortfall_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS budget_checked_at timestamptz;

ALTER TABLE public.ff3_commitments
  ADD COLUMN IF NOT EXISTS expense_ledger_id uuid REFERENCES public.expense_ledger(id) ON DELETE RESTRICT;

ALTER TABLE public.commitment_transactions
  ADD COLUMN IF NOT EXISTS expense_ledger_id uuid REFERENCES public.expense_ledger(id) ON DELETE RESTRICT;

ALTER TABLE public.commitment_transactions
  ALTER COLUMN budget_allocation_id DROP NOT NULL;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ff3_headers_budget_control_status_check'
      AND conrelid = 'public.ff3_headers'::regclass
  ) THEN
    ALTER TABLE public.ff3_headers
      ADD CONSTRAINT ff3_headers_budget_control_status_check
      CHECK (budget_control_status IN ('UNCHECKED','SUFFICIENT','INSUFFICIENT_BUDGET_BLOCKED','BUDGET_MAPPING_BLOCKED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ff3_headers_budget_control_source_check'
      AND conrelid = 'public.ff3_headers'::regclass
  ) THEN
    ALTER TABLE public.ff3_headers
      ADD CONSTRAINT ff3_headers_budget_control_source_check
      CHECK (budget_control_source IS NULL OR budget_control_source IN ('SIMPLIFIED_ACTIVE','LEGACY_FALLBACK'));
  END IF;
END;
$block$;

CREATE INDEX IF NOT EXISTS idx_ff3_pending_simplified_budget_key
  ON public.ff3_headers(financial_year, department_id, section_id, expense_ledger_id, status)
  WHERE status IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD');
CREATE INDEX IF NOT EXISTS idx_ff3_commitments_expense_ledger
  ON public.ff3_commitments(financial_year, expense_ledger_id, status);
CREATE INDEX IF NOT EXISTS idx_commitment_transactions_expense_ledger
  ON public.commitment_transactions(expense_ledger_id, transaction_type);

-- -----------------------------------------------------------------------------
-- 2. Internal authoritative position helper.
--    This is the one calculation engine used by the management/reporting wrapper
--    and the scoped FF3 preview. It includes direct simplified commitments.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_current_budget_position_internal(
  p_financial_year integer,
  p_division_id uuid DEFAULT NULL,
  p_section_id uuid DEFAULT NULL,
  p_expense_ledger_id uuid DEFAULT NULL
)
RETURNS TABLE (
  annual_budget_cycle_id uuid,
  financial_year integer,
  division_budget_id uuid,
  division_id uuid,
  section_id uuid,
  expense_ledger_id uuid,
  original_budget numeric,
  supplementary_adjustments numeric,
  reallocations_in numeric,
  reallocations_out numeric,
  current_approved_budget numeric,
  outstanding_commitments numeric,
  actual_expenditure numeric,
  available_budget numeric
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $function$
  WITH event_dimensions AS (
    SELECT
      c.id AS cycle_id,
      c.financial_year AS fy,
      db.id AS db_id,
      db.division_id AS dept_id,
      dbl.section_id AS sec_id,
      dbl.expense_ledger_id AS ledger_id
    FROM public.annual_budget_cycles c
    JOIN public.division_budgets db ON db.annual_budget_cycle_id = c.id
    JOIN public.division_budget_lines dbl ON dbl.division_budget_id = db.id
    WHERE c.financial_year = p_financial_year
      AND c.status = 'ACTIVE'
      AND db.status = 'LOCKED'

    UNION

    SELECT sa.annual_budget_cycle_id, sa.financial_year, sa.division_budget_id,
           db.division_id, sa.section_id, sa.expense_ledger_id
    FROM public.budget_supplementary_adjustments sa
    JOIN public.division_budgets db ON db.id = sa.division_budget_id
    JOIN public.annual_budget_cycles c ON c.id = sa.annual_budget_cycle_id
    WHERE sa.financial_year = p_financial_year
      AND sa.status = 'POSTED'
      AND c.status = 'ACTIVE'
      AND db.status = 'LOCKED'

    UNION

    SELECT br.annual_budget_cycle_id, br.financial_year, br.source_division_budget_id,
           db.division_id, br.source_section_id, br.source_expense_ledger_id
    FROM public.budget_reallocations br
    JOIN public.division_budgets db ON db.id = br.source_division_budget_id
    JOIN public.annual_budget_cycles c ON c.id = br.annual_budget_cycle_id
    WHERE br.financial_year = p_financial_year
      AND br.status = 'EXECUTED'
      AND c.status = 'ACTIVE'
      AND db.status = 'LOCKED'

    UNION

    SELECT br.annual_budget_cycle_id, br.financial_year, br.destination_division_budget_id,
           db.division_id, br.destination_section_id, br.destination_expense_ledger_id
    FROM public.budget_reallocations br
    JOIN public.division_budgets db ON db.id = br.destination_division_budget_id
    JOIN public.annual_budget_cycles c ON c.id = br.annual_budget_cycle_id
    WHERE br.financial_year = p_financial_year
      AND br.status = 'EXECUTED'
      AND c.status = 'ACTIVE'
      AND db.status = 'LOCKED'
  ), filtered_dimensions AS (
    SELECT d.*
    FROM event_dimensions d
    WHERE (p_division_id IS NULL OR d.dept_id = p_division_id)
      AND (p_section_id IS NULL OR d.sec_id = p_section_id)
      AND (p_expense_ledger_id IS NULL OR d.ledger_id = p_expense_ledger_id)
  ), position AS (
    SELECT
      d.*,
      COALESCE(o.original_amount, 0)::numeric AS original_amount,
      COALESCE((
        SELECT SUM(sa.adjustment_amount)
        FROM public.budget_supplementary_adjustments sa
        WHERE sa.annual_budget_cycle_id = d.cycle_id
          AND sa.division_budget_id = d.db_id
          AND sa.section_id = d.sec_id
          AND sa.expense_ledger_id = d.ledger_id
          AND sa.status = 'POSTED'
      ), 0)::numeric AS supplementary,
      COALESCE((
        SELECT SUM(br.transfer_amount)
        FROM public.budget_reallocations br
        WHERE br.annual_budget_cycle_id = d.cycle_id
          AND br.destination_division_budget_id = d.db_id
          AND br.destination_section_id = d.sec_id
          AND br.destination_expense_ledger_id = d.ledger_id
          AND br.status = 'EXECUTED'
      ), 0)::numeric AS realloc_in,
      COALESCE((
        SELECT SUM(br.transfer_amount)
        FROM public.budget_reallocations br
        WHERE br.annual_budget_cycle_id = d.cycle_id
          AND br.source_division_budget_id = d.db_id
          AND br.source_section_id = d.sec_id
          AND br.source_expense_ledger_id = d.ledger_id
          AND br.status = 'EXECUTED'
      ), 0)::numeric AS realloc_out,
      COALESCE((
        SELECT SUM(COALESCE(fc.outstanding_amount, fc.remaining_balance, 0))
        FROM public.ff3_commitments fc
        LEFT JOIN public.ff3_headers fh ON fh.id = fc.ff3_header_id
        LEFT JOIN public.budget_allocations ba ON ba.id = fc.budget_allocation_id
        WHERE fc.financial_year = d.fy
          AND COALESCE(fc.status, '') NOT IN ('CANCELLED','CLOSED')
          AND (
            (
              fc.expense_ledger_id IS NOT NULL
              AND fc.expense_ledger_id = d.ledger_id
              AND fh.department_id = d.dept_id
              AND fh.section_id = d.sec_id
            )
            OR
            (
              fc.expense_ledger_id IS NULL
              AND ba.financial_year = d.fy
              AND ba.department_id = d.dept_id
              AND ba.section_id = d.sec_id
              AND EXISTS (
                SELECT 1 FROM public.finance_posting_mappings fpm
                WHERE fpm.financial_year = d.fy
                  AND fpm.department_id = d.dept_id
                  AND fpm.section_id = d.sec_id
                  AND fpm.expense_ledger_id = d.ledger_id
                  AND fpm.expense_code_registry_id = ba.expense_code_registry_id
                  AND fpm.is_active = true
              )
            )
          )
      ), 0)::numeric AS commitments,
      COALESCE((
        SELECT SUM(
          CASE WHEN upper(COALESCE(pt.transaction_type,'')) = 'REVERSAL'
               THEN -abs(pt.amount) ELSE pt.amount END
        )
        FROM public.payment_transactions pt
        LEFT JOIN public.ff3_commitments fc ON fc.id = pt.commitment_id
        LEFT JOIN public.ff3_headers fh ON fh.id = fc.ff3_header_id
        LEFT JOIN public.budget_allocations ba ON ba.id = COALESCE(pt.budget_allocation_id, fc.budget_allocation_id)
        WHERE pt.financial_year = d.fy
          AND pt.status IN ('POSTED','RECONCILED')
          AND (
            (
              fc.expense_ledger_id IS NOT NULL
              AND fc.expense_ledger_id = d.ledger_id
              AND fh.department_id = d.dept_id
              AND fh.section_id = d.sec_id
            )
            OR
            (
              fc.expense_ledger_id IS NULL
              AND ba.financial_year = d.fy
              AND ba.department_id = d.dept_id
              AND ba.section_id = d.sec_id
              AND EXISTS (
                SELECT 1 FROM public.finance_posting_mappings fpm
                WHERE fpm.financial_year = d.fy
                  AND fpm.department_id = d.dept_id
                  AND fpm.section_id = d.sec_id
                  AND fpm.expense_ledger_id = d.ledger_id
                  AND fpm.expense_code_registry_id = ba.expense_code_registry_id
                  AND fpm.is_active = true
              )
            )
          )
      ), 0)::numeric AS actuals
    FROM filtered_dimensions d
    LEFT JOIN public.division_budget_lines o
      ON o.division_budget_id = d.db_id
     AND o.section_id = d.sec_id
     AND o.expense_ledger_id = d.ledger_id
  )
  SELECT
    p.cycle_id,
    p.fy,
    p.db_id,
    p.dept_id,
    p.sec_id,
    p.ledger_id,
    p.original_amount,
    p.supplementary,
    p.realloc_in,
    p.realloc_out,
    (p.original_amount + p.supplementary + p.realloc_in - p.realloc_out)::numeric,
    p.commitments,
    p.actuals,
    (p.original_amount + p.supplementary + p.realloc_in - p.realloc_out - p.commitments - p.actuals)::numeric
  FROM position p;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_current_budget_position_internal(integer, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Preserve the Phase 2 public contract while routing through the internal engine.
CREATE OR REPLACE FUNCTION public.get_current_budget_position(
  p_financial_year integer,
  p_division_id uuid DEFAULT NULL,
  p_section_id uuid DEFAULT NULL,
  p_expense_ledger_id uuid DEFAULT NULL
)
RETURNS TABLE (
  annual_budget_cycle_id uuid,
  financial_year integer,
  division_budget_id uuid,
  division_id uuid,
  section_id uuid,
  expense_ledger_id uuid,
  original_budget numeric,
  supplementary_adjustments numeric,
  reallocations_in numeric,
  reallocations_out numeric,
  current_approved_budget numeric,
  outstanding_commitments numeric,
  actual_expenditure numeric,
  available_budget numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT (
    public.fn_current_user_has_permission('budget.view')
    OR public.fn_current_user_has_permission('budget.supplementary.enter')
    OR public.fn_current_user_has_permission('budget.reallocation.request')
    OR public.fn_current_user_has_permission('budget.reallocation.approve')
    OR public.fn_current_user_has_permission('budget.reallocation.execute')
    OR public.fn_current_user_has_permission('all')
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
  SELECT * FROM public.njss_current_budget_position_internal(
    p_financial_year, p_division_id, p_section_id, p_expense_ledger_id
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 3. Scoped FF3 preview and persisted refresh.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_ff3_budget_control(
  p_financial_year integer,
  p_department_id uuid,
  p_section_id uuid,
  p_expense_ledger_id uuid,
  p_expense_code_registry_id uuid,
  p_cost_centre_id uuid,
  p_funding_source_id uuid,
  p_project_id uuid,
  p_requested_amount numeric
)
RETURNS TABLE (
  control_source text,
  budget_control_status text,
  budget_allocation_id uuid,
  expense_ledger_id uuid,
  mapping_status text,
  current_approved_budget numeric,
  outstanding_commitments numeric,
  actual_expenditure numeric,
  available_budget numeric,
  requested_amount numeric,
  shortfall_amount numeric,
  within_budget boolean,
  has_allocation boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $function$
DECLARE
  v_active_cycles integer;
  v_position record;
  v_matches integer := 0;
  v_budget_allocation_id uuid;
  v_legacy_position jsonb;
  v_current numeric := 0;
  v_commitments numeric := 0;
  v_actual numeric := 0;
  v_available numeric := 0;
  v_requested numeric := GREATEST(COALESCE(p_requested_amount, 0), 0);
  v_shortfall numeric := 0;
  v_ledger_id uuid := p_expense_ledger_id;
  v_ledger_matches integer := 0;
  v_app_user_id uuid;
  v_user_department_id uuid;
  v_user_section_id uuid;
  v_budget_admin boolean := false;
  v_ff3_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  v_ff3_allowed :=
    public.fn_current_user_has_permission('ff3.create')
    OR public.fn_current_user_has_permission('ff3.view')
    OR public.fn_current_user_has_permission('ff3.submit')
    OR public.fn_current_user_has_permission('ff3.endorse')
    OR public.fn_current_user_has_permission('ff3.approve')
    OR public.fn_current_user_has_permission('all');
  v_budget_admin :=
    public.fn_current_user_has_permission('budget.view')
    OR public.fn_current_user_has_permission('budget.supplementary.enter')
    OR public.fn_current_user_has_permission('budget.reallocation.execute')
    OR public.fn_current_user_has_permission('all');

  IF NOT (v_ff3_allowed OR v_budget_admin) THEN RAISE EXCEPTION 'Permission denied'; END IF;

  v_app_user_id := public.fn_current_app_user_id();
  IF NOT v_budget_admin
     AND NOT public.fn_current_user_data_scope_allows(p_department_id, p_section_id, NULL, NULL, NULL) THEN
    SELECT u.department_id, u.section_id
      INTO v_user_department_id, v_user_section_id
    FROM public.users u
    WHERE u.id = v_app_user_id AND u.is_active = true;

    IF v_user_department_id IS DISTINCT FROM p_department_id
       OR (v_user_section_id IS NOT NULL AND p_section_id IS DISTINCT FROM v_user_section_id
           AND NOT public.fn_current_user_has_permission('ff3.endorse')
           AND NOT public.fn_current_user_has_permission('ff3.approve')) THEN
      RAISE EXCEPTION 'FF3 budget position is outside the current user organisational scope';
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_active_cycles
  FROM public.annual_budget_cycles c
  WHERE c.financial_year = p_financial_year AND c.status = 'ACTIVE';

  IF v_active_cycles > 1 THEN
    RAISE EXCEPTION 'More than one ACTIVE simplified annual budget exists for financial year %', p_financial_year;
  END IF;

  IF v_active_cycles = 1 THEN
    IF p_department_id IS NULL OR p_section_id IS NULL OR p_expense_ledger_id IS NULL THEN
      RETURN QUERY SELECT
        'SIMPLIFIED_ACTIVE'::text, 'BUDGET_MAPPING_BLOCKED'::text, NULL::uuid,
        p_expense_ledger_id, 'SIMPLIFIED_LEDGER_REQUIRED'::text,
        0::numeric, 0::numeric, 0::numeric, 0::numeric, v_requested,
        v_requested, false, false;
      RETURN;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.sections s
      WHERE s.id = p_section_id
        AND s.department_id = p_department_id
        AND COALESCE(s.is_active, true)
    ) OR NOT EXISTS (
      SELECT 1 FROM public.expense_ledger el
      WHERE el.id = p_expense_ledger_id
        AND el.is_active = true
        AND el.is_posting = true
    ) THEN
      RETURN QUERY SELECT
        'SIMPLIFIED_ACTIVE'::text, 'BUDGET_MAPPING_BLOCKED'::text, NULL::uuid,
        p_expense_ledger_id, 'SIMPLIFIED_LEDGER_INVALID'::text,
        0::numeric, 0::numeric, 0::numeric, 0::numeric, v_requested,
        v_requested, false, false;
      RETURN;
    END IF;

    SELECT * INTO v_position
    FROM public.njss_current_budget_position_internal(
      p_financial_year, p_department_id, p_section_id, p_expense_ledger_id
    )
    LIMIT 1;

    IF FOUND THEN
      v_current := COALESCE(v_position.current_approved_budget, 0);
      v_commitments := COALESCE(v_position.outstanding_commitments, 0);
      v_actual := COALESCE(v_position.actual_expenditure, 0);
      v_available := COALESCE(v_position.available_budget, 0);
    ELSE
      v_current := 0;
      v_commitments := 0;
      v_actual := 0;
      v_available := 0;
    END IF;

    v_shortfall := GREATEST(v_requested - v_available, 0);
    RETURN QUERY SELECT
      'SIMPLIFIED_ACTIVE'::text,
      CASE WHEN v_requested <= v_available + 0.001 THEN 'SUFFICIENT' ELSE 'INSUFFICIENT_BUDGET_BLOCKED' END::text,
      NULL::uuid,
      p_expense_ledger_id,
      'SIMPLIFIED_LEDGER_RESOLVED'::text,
      v_current, v_commitments, v_actual, v_available, v_requested, v_shortfall,
      (v_requested <= v_available + 0.001), true;
    RETURN;
  END IF;

  -- Legacy compatibility fallback: preserve the current exact allocation key and
  -- release-based available-budget calculation while no simplified cycle is active.
  SELECT COUNT(*), MIN(ba.id)
    INTO v_matches, v_budget_allocation_id
  FROM public.budget_allocations ba
  WHERE ba.financial_year = p_financial_year
    AND ba.is_active = true
    AND p_expense_code_registry_id IS NOT NULL
    AND ba.expense_code_registry_id = p_expense_code_registry_id
    AND (p_department_id IS NULL OR ba.department_id IS NOT DISTINCT FROM p_department_id)
    AND (p_section_id IS NULL OR ba.section_id IS NOT DISTINCT FROM p_section_id)
    AND (p_cost_centre_id IS NULL OR ba.cost_centre_id IS NOT DISTINCT FROM p_cost_centre_id)
    AND (p_funding_source_id IS NULL OR ba.funding_source_id IS NOT DISTINCT FROM p_funding_source_id)
    AND (p_project_id IS NULL OR ba.project_id IS NOT DISTINCT FROM p_project_id);

  IF v_matches <> 1 THEN
    RETURN QUERY SELECT
      'LEGACY_FALLBACK'::text, 'BUDGET_MAPPING_BLOCKED'::text, NULL::uuid,
      NULL::uuid,
      CASE WHEN v_matches = 0 THEN 'BUDGET_MAPPING_REQUIRED' ELSE 'BUDGET_MAPPING_REQUIRED_AMBIGUOUS' END::text,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, v_requested, v_requested, false, false;
    RETURN;
  END IF;

  SELECT public.njss_budget_position_for_allocation(v_budget_allocation_id)
    INTO v_legacy_position;
  v_current := COALESCE((v_legacy_position->>'approved_budget')::numeric, 0);
  v_commitments := COALESCE((v_legacy_position->>'outstanding_commitment')::numeric, 0);
  v_actual := COALESCE((v_legacy_position->>'actual_expenditure')::numeric, 0);
  v_available := COALESCE((v_legacy_position->>'available_amount')::numeric, 0);
  v_shortfall := GREATEST(v_requested - v_available, 0);

  SELECT COUNT(DISTINCT fpm.expense_ledger_id), MIN(fpm.expense_ledger_id)
    INTO v_ledger_matches, v_ledger_id
  FROM public.finance_posting_mappings fpm
  WHERE fpm.financial_year = p_financial_year
    AND fpm.department_id = p_department_id
    AND fpm.section_id IS NOT DISTINCT FROM p_section_id
    AND fpm.expense_code_registry_id = p_expense_code_registry_id
    AND fpm.is_active = true;
  IF v_ledger_matches <> 1 THEN v_ledger_id := NULL; END IF;

  RETURN QUERY SELECT
    'LEGACY_FALLBACK'::text,
    CASE WHEN v_requested <= v_available + 0.001 THEN 'SUFFICIENT' ELSE 'INSUFFICIENT_BUDGET_BLOCKED' END::text,
    v_budget_allocation_id, v_ledger_id, 'RESOLVED'::text,
    v_current, v_commitments, v_actual, v_available, v_requested, v_shortfall,
    (v_requested <= v_available + 0.001), true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_ff3_budget_control(p_ff3_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_ff3 public.ff3_headers%ROWTYPE;
  v_position record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_ff3 FROM public.ff3_headers WHERE id = p_ff3_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;

  SELECT * INTO v_position
  FROM public.preview_ff3_budget_control(
    v_ff3.financial_year,
    v_ff3.department_id,
    v_ff3.section_id,
    v_ff3.expense_ledger_id,
    v_ff3.expense_code_registry_id,
    v_ff3.cost_centre_id,
    v_ff3.funding_source_id,
    v_ff3.project_id,
    COALESCE(v_ff3.total_estimated_amount, 0)
  )
  LIMIT 1;

  UPDATE public.ff3_headers
  SET budget_control_status = v_position.budget_control_status,
      budget_control_source = v_position.control_source,
      budget_available_at_check = v_position.available_budget,
      budget_shortfall_amount = v_position.shortfall_amount,
      budget_checked_at = now(),
      is_within_budget = v_position.within_budget,
      expense_ledger_id = COALESCE(v_position.expense_ledger_id, expense_ledger_id),
      budget_allocation_id = CASE
        WHEN v_position.control_source = 'LEGACY_FALLBACK' THEN v_position.budget_allocation_id
        ELSE NULL
      END,
      budget_mapping_status = v_position.mapping_status,
      updated_at = now()
  WHERE id = p_ff3_id;

  RETURN to_jsonb(v_position);
END;
$function$;

-- -----------------------------------------------------------------------------
-- 4. FF3 transition: managerial review can progress while simplified budget is
--    blocked, but final commitment is guarded by an atomic recheck.
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
  v_ff3 public.ff3_headers;
  v_old public.ff3_headers;
  v_budget public.budget_allocations;
  v_actor uuid := public.fn_current_app_user_id();
  v_next_status text;
  v_commitment public.ff3_commitments;
  v_position_before jsonb;
  v_position_after jsonb;
  v_released numeric;
  v_outstanding numeric;
  v_actual numeric;
  v_available numeric;
  v_shortfall numeric;
  v_request numeric;
  v_commitment_count integer;
  v_control jsonb;
  v_control_source text;
  v_control_status text;
  v_expense_ledger_id uuid;
BEGIN
  IF p_action NOT IN ('SUBMIT','ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD','APPROVE','REJECT','CANCEL','RETURN') THEN
    RAISE EXCEPTION 'Invalid FF3 workflow action: %', p_action;
  END IF;

  PERFORM public.njss_require_permission(CASE
    WHEN p_action = 'SUBMIT' THEN 'ff3.submit'
    WHEN p_action IN ('ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD','RETURN') THEN 'ff3.endorse'
    WHEN p_action = 'APPROVE' THEN 'ff3.approve'
    WHEN p_action = 'REJECT' THEN 'ff3.reject'
    WHEN p_action = 'CANCEL' THEN 'ff3.cancel'
  END);

  SELECT * INTO v_ff3 FROM public.ff3_headers WHERE id = p_ff3_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;
  v_old := v_ff3;
  v_request := COALESCE(v_ff3.total_estimated_amount, 0);
  IF v_request <= 0 THEN RAISE EXCEPTION 'FF3 amount must be greater than zero.'; END IF;

  IF p_action = 'SUBMIT' THEN
    IF v_ff3.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Only DRAFT FF3 can be submitted. Current status: %', v_ff3.status;
    END IF;

    v_control := public.refresh_ff3_budget_control(p_ff3_id);
    v_control_source := v_control->>'control_source';
    v_control_status := v_control->>'budget_control_status';
    v_available := COALESCE((v_control->>'available_budget')::numeric, 0);
    v_shortfall := COALESCE((v_control->>'shortfall_amount')::numeric, 0);

    IF v_control_status = 'BUDGET_MAPPING_BLOCKED' THEN
      RAISE EXCEPTION 'BUDGET_MAPPING_REQUIRED: A valid budget control key could not be resolved for this FF3.';
    END IF;
    IF v_control_source = 'LEGACY_FALLBACK' AND v_control_status = 'INSUFFICIENT_BUDGET_BLOCKED' THEN
      RAISE EXCEPTION 'Insufficient Available Budget. Available: K%, Requested: K%, Shortfall: K%.', v_available, v_request, v_shortfall;
    END IF;
    v_next_status := 'SUBMITTED';

  ELSIF p_action = 'ENDORSE_SUPERVISOR' THEN
    IF v_ff3.status <> 'SUBMITTED' THEN
      RAISE EXCEPTION 'Only SUBMITTED FF3 can receive supervisor endorsement. Current status: %', v_ff3.status;
    END IF;
    v_control := public.refresh_ff3_budget_control(p_ff3_id);
    v_control_status := v_control->>'budget_control_status';
    IF v_control_status = 'BUDGET_MAPPING_BLOCKED' THEN RAISE EXCEPTION 'FF3 budget control key is unresolved'; END IF;
    v_next_status := 'ENDORSED_SUPERVISOR';

  ELSIF p_action = 'ENDORSE_SECTION_HEAD' THEN
    IF v_ff3.status <> 'ENDORSED_SUPERVISOR' THEN
      RAISE EXCEPTION 'Only supervisor-endorsed FF3 can receive section-head endorsement. Current status: %', v_ff3.status;
    END IF;
    v_control := public.refresh_ff3_budget_control(p_ff3_id);
    v_control_status := v_control->>'budget_control_status';
    IF v_control_status = 'BUDGET_MAPPING_BLOCKED' THEN RAISE EXCEPTION 'FF3 budget control key is unresolved'; END IF;
    v_next_status := 'ENDORSED_SECTION_HEAD';

  ELSIF p_action = 'REJECT' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN
      RAISE EXCEPTION 'Only pending FF3 can be rejected. Current status: %', v_ff3.status;
    END IF;
    IF COALESCE(TRIM(p_comments), '') = '' THEN RAISE EXCEPTION 'Rejection reason is required.'; END IF;
    v_next_status := 'REJECTED';

  ELSIF p_action = 'RETURN' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN
      RAISE EXCEPTION 'Only pending FF3 can be returned. Current status: %', v_ff3.status;
    END IF;
    IF COALESCE(TRIM(p_comments), '') = '' THEN RAISE EXCEPTION 'Return reason is required.'; END IF;
    v_next_status := 'RETURNED';

  ELSIF p_action = 'CANCEL' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN
      RAISE EXCEPTION 'Use commitment cancellation after approval. Current FF3 status: %', v_ff3.status;
    END IF;
    IF COALESCE(TRIM(p_comments), '') = '' THEN RAISE EXCEPTION 'Cancellation reason is required.'; END IF;
    v_next_status := 'CANCELLED';

  ELSIF p_action = 'APPROVE' THEN
    IF v_ff3.status <> 'ENDORSED_SECTION_HEAD' THEN
      RAISE EXCEPTION 'Only section-head-endorsed FF3 can be finally approved. Current status: %', v_ff3.status;
    END IF;
    IF public.fn_check_segregation_of_duties(
      'FF3', COALESCE(v_ff3.created_by, v_ff3.requesting_officer_id),
      COALESCE(v_ff3.supervisor_endorsed_by, v_ff3.section_head_endorsed_by), NULL, v_actor
    ) IS FALSE THEN
      RAISE EXCEPTION 'Segregation of duties prevents the same user from creating/endorsing/approving this FF3.';
    END IF;

    SELECT COUNT(*) INTO v_commitment_count
    FROM public.ff3_commitments
    WHERE ff3_header_id = p_ff3_id AND status <> 'CANCELLED';
    IF v_commitment_count > 0 THEN
      RAISE EXCEPTION 'Duplicate original commitment blocked. A commitment already exists for this FF3.';
    END IF;

    v_control := public.refresh_ff3_budget_control(p_ff3_id);
    v_control_source := v_control->>'control_source';
    v_control_status := v_control->>'budget_control_status';

    SELECT * INTO v_ff3 FROM public.ff3_headers WHERE id = p_ff3_id;

    IF v_control_source = 'SIMPLIFIED_ACTIVE' THEN
      IF v_ff3.expense_ledger_id IS NULL THEN
        RAISE EXCEPTION 'FF3 simplified budget Ledger is required';
      END IF;

      PERFORM pg_advisory_xact_lock(hashtextextended(
        concat_ws(':', 'njss', 'ff3-budget', v_ff3.financial_year::text,
                  v_ff3.department_id::text, v_ff3.section_id::text, v_ff3.expense_ledger_id::text), 0
      ));

      -- Recheck under the budget-key lock. Concurrent approvals on the same key
      -- now serialize, so the second transaction sees the first commitment.
      v_control := public.refresh_ff3_budget_control(p_ff3_id);
      v_control_status := v_control->>'budget_control_status';
      v_available := COALESCE((v_control->>'available_budget')::numeric, 0);
      v_shortfall := COALESCE((v_control->>'shortfall_amount')::numeric, 0);
      v_expense_ledger_id := (v_control->>'expense_ledger_id')::uuid;
      SELECT * INTO v_ff3 FROM public.ff3_headers WHERE id = p_ff3_id;

      IF v_control_status = 'BUDGET_MAPPING_BLOCKED' THEN
        RAISE EXCEPTION 'FF3 simplified budget control key is unresolved';
      END IF;
      IF v_control_status = 'INSUFFICIENT_BUDGET_BLOCKED' THEN
        PERFORM public.log_audit_event(
          v_actor, p_user_email, COALESCE(p_user_email, 'System'),
          'FF3_COMMITMENT_BLOCKED_BUDGET', 'FF3', p_ff3_id, v_ff3.ff3_number,
          to_jsonb(v_old), to_jsonb(v_ff3),
          jsonb_build_object('budget_control', v_control, 'requested_amount', v_request, 'reason', p_comments), NULL
        );
        RETURN jsonb_build_object(
          'header', to_jsonb(v_ff3),
          'commitment', NULL,
          'budget_blocked', true,
          'message', format('INSUFFICIENT BUDGET - COMMITMENT BLOCKED. Available: K%s, Requested: K%s, Shortfall: K%s.', v_available, v_request, v_shortfall),
          'budget_control', v_control
        );
      END IF;

      v_position_before := v_control;

    ELSIF v_control_source = 'LEGACY_FALLBACK' THEN
      IF v_control_status = 'BUDGET_MAPPING_BLOCKED' THEN
        RAISE EXCEPTION 'BUDGET_MAPPING_REQUIRED: Approved budget allocation could not be resolved';
      END IF;

      v_ff3.budget_allocation_id := public.njss_resolve_ff3_budget_allocation(p_ff3_id);
      SELECT * INTO v_budget
      FROM public.budget_allocations
      WHERE id = v_ff3.budget_allocation_id AND is_active = true
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Approved budget allocation not found'; END IF;
      IF v_budget.financial_year <> v_ff3.financial_year THEN
        RAISE EXCEPTION 'FF3 financial year does not match the linked budget allocation.';
      END IF;

      v_position_before := public.njss_budget_position_for_allocation(v_budget.id);
      v_released := (v_position_before->>'released_amount')::numeric;
      v_outstanding := (v_position_before->>'outstanding_commitment')::numeric;
      v_actual := (v_position_before->>'actual_expenditure')::numeric;
      v_available := v_released - v_outstanding - v_actual;
      IF v_request > v_available + 0.001 THEN
        v_shortfall := v_request - v_available;
        RAISE EXCEPTION 'Insufficient available budget at approval. Available: K%, Requested: K%, Shortfall: K%.', v_available, v_request, v_shortfall;
      END IF;
      v_expense_ledger_id := v_ff3.expense_ledger_id;
    ELSE
      RAISE EXCEPTION 'FF3 budget-control source is unavailable';
    END IF;

    UPDATE public.ff3_headers
    SET status = 'APPROVED',
        approved_date = now(),
        approved_by = v_actor,
        budget_allocation_id = CASE WHEN v_control_source = 'LEGACY_FALLBACK' THEN v_budget.id ELSE NULL END,
        budget_mapping_status = CASE WHEN v_control_source = 'LEGACY_FALLBACK' THEN 'RESOLVED' ELSE 'SIMPLIFIED_LEDGER_RESOLVED' END,
        updated_at = now()
    WHERE id = p_ff3_id
    RETURNING * INTO v_ff3;

    INSERT INTO public.ff3_commitments (
      ff3_header_id, budget_allocation_id, expense_ledger_id, financial_year, commitment_date,
      committed_amount, original_committed_amount, current_committed_amount,
      paid_amount, outstanding_amount, status, created_by, approved_by
    ) VALUES (
      v_ff3.id,
      CASE WHEN v_control_source = 'LEGACY_FALLBACK' THEN v_budget.id ELSE NULL END,
      v_expense_ledger_id,
      v_ff3.financial_year, CURRENT_DATE,
      v_request, v_request, v_request,
      0, v_request, 'ACTIVE', COALESCE(v_ff3.created_by, v_ff3.requesting_officer_id), v_actor
    ) RETURNING * INTO v_commitment;

    INSERT INTO public.commitment_transactions (
      commitment_id, ff3_header_id, budget_allocation_id, expense_ledger_id,
      transaction_type, amount, transaction_date, reason_code, reason, reference,
      previous_balance, new_balance, approved_by, created_by
    ) VALUES (
      v_commitment.id, v_ff3.id,
      CASE WHEN v_control_source = 'LEGACY_FALLBACK' THEN v_budget.id ELSE NULL END,
      v_expense_ledger_id,
      'ORIGINAL_COMMITMENT', v_request, CURRENT_DATE, 'FF3_APPROVAL',
      COALESCE(p_comments, 'FF3 final approval and original commitment.'),
      v_ff3.ff3_number, 0, v_request, v_actor, v_actor
    );

    UPDATE public.ff3_headers SET status = 'COMMITTED', updated_at = now()
    WHERE id = p_ff3_id RETURNING * INTO v_ff3;
    v_commitment := public.njss_sync_commitment_balances(v_commitment.id);

    IF v_control_source = 'SIMPLIFIED_ACTIVE' THEN
      SELECT to_jsonb(p) INTO v_position_after
      FROM public.njss_current_budget_position_internal(
        v_ff3.financial_year, v_ff3.department_id, v_ff3.section_id, v_ff3.expense_ledger_id
      ) p LIMIT 1;
    ELSE
      v_position_after := public.njss_budget_position_for_allocation(v_budget.id);
    END IF;

    INSERT INTO public.ff3_approvals (
      ff3_header_id, approver_id, approval_level, action_taken, comments, action_date
    ) VALUES (p_ff3_id, v_actor, p_action, 'APPROVED', p_comments, now());

    PERFORM public.log_audit_event(
      v_actor, p_user_email, COALESCE(p_user_email, 'System'),
      'FF3_APPROVED_COMMITMENT_CREATED', 'FF3', p_ff3_id, v_ff3.ff3_number,
      to_jsonb(v_old), to_jsonb(v_ff3),
      jsonb_build_object(
        'old_status', v_old.status, 'new_status', v_ff3.status,
        'old_amount', v_old.total_estimated_amount, 'new_amount', v_ff3.total_estimated_amount,
        'commitment_id', v_commitment.id,
        'budget_control_source', v_control_source,
        'financial_position_before', v_position_before,
        'financial_position_after', v_position_after,
        'reason', p_comments
      ), NULL
    );
    PERFORM public.log_audit_event(
      v_actor, p_user_email, COALESCE(p_user_email, 'System'),
      'COMMITMENT_CREATED', 'COMMITMENT', v_commitment.id, v_commitment.commitment_number,
      NULL, to_jsonb(v_commitment),
      jsonb_build_object(
        'transaction_type', 'ORIGINAL_COMMITMENT', 'amount', v_request,
        'budget_control_source', v_control_source,
        'financial_position_before', v_position_before,
        'financial_position_after', v_position_after
      ), NULL
    );

    RETURN jsonb_build_object(
      'header', to_jsonb(v_ff3),
      'commitment', to_jsonb(v_commitment),
      'budget_blocked', false,
      'financial_position_before', v_position_before,
      'financial_position_after', v_position_after
    );
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

  INSERT INTO public.ff3_approvals (
    ff3_header_id, approver_id, approval_level, action_taken, comments, action_date
  ) VALUES (
    p_ff3_id, v_actor, p_action,
    CASE WHEN p_action IN ('REJECT','CANCEL','RETURN') THEN v_next_status ELSE 'ENDORSED' END,
    p_comments, now()
  );

  PERFORM public.log_audit_event(
    v_actor, p_user_email, COALESCE(p_user_email, 'System'),
    'FF3_' || p_action, 'FF3', p_ff3_id, v_ff3.ff3_number,
    to_jsonb(v_old), to_jsonb(v_ff3),
    jsonb_build_object(
      'old_status', v_old.status, 'new_status', v_next_status,
      'budget_control_status', v_ff3.budget_control_status,
      'budget_control_source', v_ff3.budget_control_source,
      'reason', p_comments
    ), NULL
  );

  RETURN jsonb_build_object(
    'header', to_jsonb(v_ff3),
    'commitment', NULL,
    'budget_blocked', (v_ff3.budget_control_status = 'INSUFFICIENT_BUDGET_BLOCKED'),
    'budget_control', CASE WHEN v_control IS NULL THEN NULL ELSE v_control END
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 5. Automatic budget-state refresh after authorised budget events.
--    This changes only the separate budget-control state, never workflow status.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_pending_ff3_budget_control_for_key(
  p_financial_year integer,
  p_department_id uuid,
  p_section_id uuid,
  p_expense_ledger_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_id IN
    SELECT h.id
    FROM public.ff3_headers h
    WHERE h.financial_year = p_financial_year
      AND h.department_id = p_department_id
      AND h.section_id = p_section_id
      AND h.expense_ledger_id = p_expense_ledger_id
      AND h.status IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD')
      AND h.budget_control_source = 'SIMPLIFIED_ACTIVE'
    ORDER BY h.id
  LOOP
    PERFORM public.refresh_ff3_budget_control(v_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.njss_refresh_ff3_after_supplementary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_department_id uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'POSTED' THEN
    SELECT db.division_id INTO v_department_id
    FROM public.division_budgets db WHERE db.id = NEW.division_budget_id;
    PERFORM public.refresh_pending_ff3_budget_control_for_key(
      NEW.financial_year, v_department_id, NEW.section_id, NEW.expense_ledger_id
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.njss_refresh_ff3_after_reallocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_source_department uuid;
  v_destination_department uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'EXECUTED' THEN
    SELECT db.division_id INTO v_source_department
    FROM public.division_budgets db WHERE db.id = NEW.source_division_budget_id;
    SELECT db.division_id INTO v_destination_department
    FROM public.division_budgets db WHERE db.id = NEW.destination_division_budget_id;

    PERFORM public.refresh_pending_ff3_budget_control_for_key(
      NEW.financial_year, v_source_department, NEW.source_section_id, NEW.source_expense_ledger_id
    );
    PERFORM public.refresh_pending_ff3_budget_control_for_key(
      NEW.financial_year, v_destination_department, NEW.destination_section_id, NEW.destination_expense_ledger_id
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_refresh_ff3_after_supplementary ON public.budget_supplementary_adjustments;
CREATE TRIGGER trg_refresh_ff3_after_supplementary
AFTER UPDATE OF status ON public.budget_supplementary_adjustments
FOR EACH ROW EXECUTE FUNCTION public.njss_refresh_ff3_after_supplementary();

DROP TRIGGER IF EXISTS trg_refresh_ff3_after_reallocation ON public.budget_reallocations;
CREATE TRIGGER trg_refresh_ff3_after_reallocation
AFTER UPDATE OF status ON public.budget_reallocations
FOR EACH ROW EXECUTE FUNCTION public.njss_refresh_ff3_after_reallocation();

-- -----------------------------------------------------------------------------
-- 6. Function exposure.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.preview_ff3_budget_control(integer, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_ff3_budget_control(integer, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.refresh_ff3_budget_control(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_pending_ff3_budget_control_for_key(integer, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_refresh_ff3_after_supplementary() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_refresh_ff3_after_reallocation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_current_budget_position_internal(integer, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_current_budget_position(integer, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_budget_position(integer, uuid, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.njss_transition_ff3(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_transition_ff3(uuid, text, text, text) TO authenticated;
