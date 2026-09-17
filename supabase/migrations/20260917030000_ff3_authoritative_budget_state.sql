-- =============================================================================
-- NJSS PHASE 3 — FF3 AUTHORITATIVE BUDGET STATE
-- Separates FF3 workflow state from budget-control state while preserving the
-- legacy financial-control engine until a simplified annual budget is ACTIVE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Persisted FF3 budget-control state
-- -----------------------------------------------------------------------------
ALTER TABLE public.ff3_headers
  ADD COLUMN IF NOT EXISTS budget_control_status varchar(40) NOT NULL DEFAULT 'UNASSESSED',
  ADD COLUMN IF NOT EXISTS budget_control_source varchar(20) NULL,
  ADD COLUMN IF NOT EXISTS budget_available_snapshot numeric(18,2) NULL,
  ADD COLUMN IF NOT EXISTS budget_current_approved_snapshot numeric(18,2) NULL,
  ADD COLUMN IF NOT EXISTS budget_shortfall_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_checked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS expense_ledger_id uuid NULL REFERENCES public.expense_ledger(id) ON DELETE RESTRICT;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ff3_headers'::regclass
      AND conname = 'chk_ff3_budget_control_status'
  ) THEN
    ALTER TABLE public.ff3_headers
      ADD CONSTRAINT chk_ff3_budget_control_status
      CHECK (budget_control_status IN (
        'UNASSESSED','SUFFICIENT','INSUFFICIENT_BUDGET_BLOCKED','MAPPING_REQUIRED'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ff3_headers'::regclass
      AND conname = 'chk_ff3_budget_control_source'
  ) THEN
    ALTER TABLE public.ff3_headers
      ADD CONSTRAINT chk_ff3_budget_control_source
      CHECK (budget_control_source IS NULL OR budget_control_source IN ('LEGACY','SIMPLIFIED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ff3_headers'::regclass
      AND conname = 'chk_ff3_budget_shortfall_nonnegative'
  ) THEN
    ALTER TABLE public.ff3_headers
      ADD CONSTRAINT chk_ff3_budget_shortfall_nonnegative
      CHECK (budget_shortfall_amount >= 0);
  END IF;
END;
$do$;

CREATE INDEX IF NOT EXISTS idx_ff3_budget_control_pending
  ON public.ff3_headers(financial_year, department_id, section_id, expense_ledger_id, budget_control_status, status)
  WHERE status IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD');

-- -----------------------------------------------------------------------------
-- 2. Keep one authoritative simplified-budget calculation, but allow exact,
--    organisationally-scoped FF3 reads for requisition workflow users.
-- -----------------------------------------------------------------------------
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
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_budget_permission boolean;
  v_exact_ff3_scope boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_budget_permission := (
    public.fn_current_user_has_permission('budget.view')
    OR public.fn_current_user_has_permission('budget.supplementary.enter')
    OR public.fn_current_user_has_permission('budget.reallocation.request')
    OR public.fn_current_user_has_permission('budget.reallocation.approve')
    OR public.fn_current_user_has_permission('budget.reallocation.execute')
    OR public.fn_current_user_has_permission('all')
  );

  v_exact_ff3_scope := (
    p_division_id IS NOT NULL
    AND p_section_id IS NOT NULL
    AND p_expense_ledger_id IS NOT NULL
    AND (
      public.fn_current_user_has_permission('ff3.create')
      OR public.fn_current_user_has_permission('ff3.submit')
      OR public.fn_current_user_has_permission('ff3.view')
      OR public.fn_current_user_has_permission('ff3.endorse')
      OR public.fn_current_user_has_permission('ff3.approve')
    )
    AND public.fn_current_user_data_scope_allows(p_division_id, p_section_id, NULL, NULL, NULL)
  );

  IF NOT (v_budget_permission OR v_exact_ff3_scope) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
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

    SELECT
      sa.annual_budget_cycle_id,
      sa.financial_year,
      sa.division_budget_id,
      db.division_id,
      sa.section_id,
      sa.expense_ledger_id
    FROM public.budget_supplementary_adjustments sa
    JOIN public.division_budgets db ON db.id = sa.division_budget_id
    JOIN public.annual_budget_cycles c ON c.id = sa.annual_budget_cycle_id
    WHERE sa.financial_year = p_financial_year
      AND sa.status = 'POSTED'
      AND c.status = 'ACTIVE'
      AND db.status = 'LOCKED'

    UNION

    SELECT
      br.annual_budget_cycle_id,
      br.financial_year,
      br.source_division_budget_id,
      db.division_id,
      br.source_section_id,
      br.source_expense_ledger_id
    FROM public.budget_reallocations br
    JOIN public.division_budgets db ON db.id = br.source_division_budget_id
    JOIN public.annual_budget_cycles c ON c.id = br.annual_budget_cycle_id
    WHERE br.financial_year = p_financial_year
      AND br.status = 'EXECUTED'
      AND c.status = 'ACTIVE'
      AND db.status = 'LOCKED'

    UNION

    SELECT
      br.annual_budget_cycle_id,
      br.financial_year,
      br.destination_division_budget_id,
      db.division_id,
      br.destination_section_id,
      br.destination_expense_ledger_id
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
        JOIN public.budget_allocations ba ON ba.id = fc.budget_allocation_id
        WHERE fc.financial_year = d.fy
          AND COALESCE(fc.status, '') NOT IN ('CANCELLED','CLOSED')
          AND ba.financial_year = d.fy
          AND ba.department_id = d.dept_id
          AND ba.section_id = d.sec_id
          AND EXISTS (
            SELECT 1
            FROM public.finance_posting_mappings fpm
            WHERE fpm.financial_year = d.fy
              AND fpm.department_id = d.dept_id
              AND fpm.section_id = d.sec_id
              AND fpm.expense_ledger_id = d.ledger_id
              AND fpm.expense_code_registry_id = ba.expense_code_registry_id
              AND fpm.is_active = true
          )
      ), 0)::numeric AS commitments,
      COALESCE((
        SELECT SUM(
          CASE WHEN upper(COALESCE(pt.transaction_type,'')) = 'REVERSAL'
               THEN -abs(pt.amount) ELSE pt.amount END
        )
        FROM public.payment_transactions pt
        JOIN public.budget_allocations ba ON ba.id = pt.budget_allocation_id
        WHERE pt.financial_year = d.fy
          AND pt.status IN ('POSTED','RECONCILED')
          AND ba.financial_year = d.fy
          AND ba.department_id = d.dept_id
          AND ba.section_id = d.sec_id
          AND EXISTS (
            SELECT 1
            FROM public.finance_posting_mappings fpm
            WHERE fpm.financial_year = d.fy
              AND fpm.department_id = d.dept_id
              AND fpm.section_id = d.sec_id
              AND fpm.expense_ledger_id = d.ledger_id
              AND fpm.expense_code_registry_id = ba.expense_code_registry_id
              AND fpm.is_active = true
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
END;
$function$;

-- -----------------------------------------------------------------------------
-- 3. Narrow FF3 budget check adapter. The simplified budget becomes authoritative
--    only after activation; otherwise the current legacy release control remains.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_ff3_budget_availability(
  p_financial_year integer,
  p_expense_code_registry_id uuid DEFAULT NULL,
  p_section_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_cost_centre_id uuid DEFAULT NULL,
  p_funding_source_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_budget_allocation_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_has_simplified_cycle boolean := false;
  v_source text;
  v_ledger_id uuid;
  v_ledger_matches integer := 0;
  v_position record;
  v_budget_allocation_id uuid;
  v_allocation_count integer := 0;
  v_mapping_status text;
  v_commitment_mapping_status text;
  v_current_approved numeric := 0;
  v_released numeric := 0;
  v_pending numeric := 0;
  v_commitments numeric := 0;
  v_actuals numeric := 0;
  v_available numeric := 0;
  v_shortfall numeric := 0;
  v_status text := 'UNASSESSED';
  v_position_resolved boolean := false;
  v_legacy_position jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'Requested amount cannot be negative'; END IF;
  IF p_financial_year IS NULL THEN RAISE EXCEPTION 'Financial year is required'; END IF;

  IF NOT (
    public.fn_current_user_has_permission('ff3.create')
    OR public.fn_current_user_has_permission('ff3.submit')
    OR public.fn_current_user_has_permission('ff3.view')
    OR public.fn_current_user_has_permission('ff3.endorse')
    OR public.fn_current_user_has_permission('ff3.approve')
    OR public.fn_current_user_has_permission('budget.view')
    OR public.fn_current_user_has_permission('budget.supplementary.enter')
    OR public.fn_current_user_has_permission('budget.reallocation.execute')
    OR public.fn_current_user_has_permission('all')
  ) THEN RAISE EXCEPTION 'Permission denied'; END IF;

  IF p_department_id IS NOT NULL AND p_section_id IS NOT NULL
     AND NOT public.fn_current_user_data_scope_allows(p_department_id, p_section_id, NULL, NULL, NULL)
     AND NOT public.fn_current_user_has_permission('budget.view')
     AND NOT public.fn_current_user_has_permission('all') THEN
    RAISE EXCEPTION 'FF3 budget check is outside the current user organisational scope';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.annual_budget_cycles c
    WHERE c.financial_year = p_financial_year
      AND c.status = 'ACTIVE'
  ) INTO v_has_simplified_cycle;

  v_source := CASE WHEN v_has_simplified_cycle THEN 'SIMPLIFIED' ELSE 'LEGACY' END;

  -- Resolve downstream commitment routing independently of the budget ceiling.
  IF p_budget_allocation_id IS NOT NULL THEN
    SELECT COUNT(*), MIN(ba.id)
      INTO v_allocation_count, v_budget_allocation_id
    FROM public.budget_allocations ba
    WHERE ba.id = p_budget_allocation_id
      AND ba.financial_year = p_financial_year
      AND ba.is_active = true
      AND (p_expense_code_registry_id IS NULL OR ba.expense_code_registry_id = p_expense_code_registry_id)
      AND (p_department_id IS NULL OR ba.department_id IS NOT DISTINCT FROM p_department_id)
      AND (p_section_id IS NULL OR ba.section_id IS NOT DISTINCT FROM p_section_id)
      AND (p_cost_centre_id IS NULL OR ba.cost_centre_id IS NOT DISTINCT FROM p_cost_centre_id)
      AND (p_funding_source_id IS NULL OR ba.funding_source_id IS NOT DISTINCT FROM p_funding_source_id)
      AND (p_project_id IS NULL OR ba.project_id IS NOT DISTINCT FROM p_project_id);
  ELSE
    SELECT COUNT(*), MIN(ba.id)
      INTO v_allocation_count, v_budget_allocation_id
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
  END IF;

  v_commitment_mapping_status := CASE
    WHEN v_allocation_count = 1 THEN 'RESOLVED'
    WHEN v_allocation_count = 0 THEN 'BUDGET_MAPPING_REQUIRED'
    ELSE 'BUDGET_MAPPING_REQUIRED_AMBIGUOUS'
  END;

  IF v_has_simplified_cycle THEN
    IF p_department_id IS NULL OR p_section_id IS NULL OR p_expense_code_registry_id IS NULL THEN
      v_status := 'MAPPING_REQUIRED';
      v_mapping_status := 'BUDGET_KEY_REQUIRED';
    ELSE
      SELECT COUNT(*), MIN(el.id)
        INTO v_ledger_matches, v_ledger_id
      FROM public.expense_ledger el
      WHERE el.expense_code_registry_id = p_expense_code_registry_id
        AND el.is_active = true
        AND el.is_posting = true;

      IF v_ledger_matches <> 1 THEN
        v_status := 'MAPPING_REQUIRED';
        v_mapping_status := CASE WHEN v_ledger_matches = 0
          THEN 'LEDGER_MAPPING_REQUIRED'
          ELSE 'LEDGER_MAPPING_AMBIGUOUS' END;
      ELSE
        SELECT p.* INTO v_position
        FROM public.get_current_budget_position(
          p_financial_year, p_department_id, p_section_id, v_ledger_id
        ) p
        LIMIT 1;

        IF NOT FOUND THEN
          v_status := 'MAPPING_REQUIRED';
          v_mapping_status := 'NO_ACTIVE_APPROVED_BUDGET_POSITION';
        ELSE
          v_position_resolved := true;
          v_mapping_status := 'RESOLVED';
          v_current_approved := COALESCE(v_position.current_approved_budget, 0);
          v_commitments := COALESCE(v_position.outstanding_commitments, 0);
          v_actuals := COALESCE(v_position.actual_expenditure, 0);
          v_available := COALESCE(v_position.available_budget, 0);
          v_shortfall := GREATEST(COALESCE(p_amount, 0) - v_available, 0);
          v_status := CASE WHEN COALESCE(p_amount, 0) <= v_available + 0.001
            THEN 'SUFFICIENT' ELSE 'INSUFFICIENT_BUDGET_BLOCKED' END;
        END IF;
      END IF;
    END IF;
  ELSE
    v_mapping_status := v_commitment_mapping_status;
    IF v_allocation_count <> 1 OR v_budget_allocation_id IS NULL THEN
      v_status := 'MAPPING_REQUIRED';
    ELSE
      v_position_resolved := true;
      v_legacy_position := public.njss_budget_position_for_allocation(v_budget_allocation_id);
      SELECT COALESCE(ba.revised_budget,
                      COALESCE(ba.original_budget,0) + COALESCE(ba.supplemental_budget,0) + COALESCE(ba.revision_adjustment,0))
        INTO v_current_approved
      FROM public.budget_allocations ba
      WHERE ba.id = v_budget_allocation_id;
      v_released := COALESCE((v_legacy_position->>'released_amount')::numeric, 0);
      v_pending := COALESCE((v_legacy_position->>'pending_amount')::numeric, 0);
      v_commitments := COALESCE((v_legacy_position->>'outstanding_commitment')::numeric, 0);
      v_actuals := COALESCE((v_legacy_position->>'actual_expenditure')::numeric, 0);
      v_available := v_released - v_commitments - v_actuals;
      v_shortfall := GREATEST(COALESCE(p_amount, 0) - v_available, 0);
      v_status := CASE WHEN COALESCE(p_amount, 0) <= v_available + 0.001
        THEN 'SUFFICIENT' ELSE 'INSUFFICIENT_BUDGET_BLOCKED' END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'budget_control_source', v_source,
    'budget_control_status', v_status,
    'budget_allocation_id', v_budget_allocation_id,
    'expense_ledger_id', v_ledger_id,
    'mapping_status', v_mapping_status,
    'commitment_mapping_status', v_commitment_mapping_status,
    'allocation_count', v_allocation_count,
    'position_resolved', v_position_resolved,
    'current_approved_budget', v_current_approved,
    'released_amount', v_released,
    'pending_amount', v_pending,
    'outstanding_commitments', v_commitments,
    'actual_expenditure', v_actuals,
    'available_budget', v_available,
    'requested_amount', COALESCE(p_amount, 0),
    'shortfall', v_shortfall,
    'within_budget', v_status = 'SUFFICIENT',
    'has_allocation', v_allocation_count = 1
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 4. Persist a fresh budget state for one FF3 without changing workflow status.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_refresh_ff3_budget_state(p_ff3_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_ff3 public.ff3_headers%ROWTYPE;
  v_result jsonb;
  v_budget_allocation_id uuid;
  v_expense_ledger_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_ff3
  FROM public.ff3_headers
  WHERE id = p_ff3_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;

  IF NOT (
    public.fn_current_user_has_permission('ff3.submit')
    OR public.fn_current_user_has_permission('ff3.view')
    OR public.fn_current_user_has_permission('ff3.endorse')
    OR public.fn_current_user_has_permission('ff3.approve')
    OR public.fn_current_user_has_permission('budget.supplementary.enter')
    OR public.fn_current_user_has_permission('budget.reallocation.execute')
    OR public.fn_current_user_has_permission('all')
  ) THEN RAISE EXCEPTION 'Permission denied'; END IF;

  v_result := public.check_ff3_budget_availability(
    v_ff3.financial_year,
    v_ff3.expense_code_registry_id,
    v_ff3.section_id,
    v_ff3.department_id,
    v_ff3.cost_centre_id,
    v_ff3.funding_source_id,
    v_ff3.project_id,
    v_ff3.budget_allocation_id,
    COALESCE(v_ff3.total_estimated_amount, 0)
  );

  v_budget_allocation_id := NULLIF(v_result->>'budget_allocation_id','')::uuid;
  v_expense_ledger_id := NULLIF(v_result->>'expense_ledger_id','')::uuid;

  UPDATE public.ff3_headers
  SET budget_control_status = COALESCE(v_result->>'budget_control_status', 'UNASSESSED'),
      budget_control_source = NULLIF(v_result->>'budget_control_source',''),
      budget_available_snapshot = COALESCE((v_result->>'available_budget')::numeric, 0),
      budget_current_approved_snapshot = COALESCE((v_result->>'current_approved_budget')::numeric, 0),
      budget_shortfall_amount = COALESCE((v_result->>'shortfall')::numeric, 0),
      budget_checked_at = now(),
      expense_ledger_id = COALESCE(v_expense_ledger_id, expense_ledger_id),
      budget_allocation_id = COALESCE(v_budget_allocation_id, budget_allocation_id),
      budget_mapping_status = COALESCE(v_result->>'commitment_mapping_status', v_result->>'mapping_status', budget_mapping_status),
      is_within_budget = COALESCE((v_result->>'within_budget')::boolean, false),
      updated_at = now()
  WHERE id = p_ff3_id;

  RETURN v_result || jsonb_build_object('ff3_id', p_ff3_id);
END;
$function$;

-- -----------------------------------------------------------------------------
-- 5. Exposure. Availability is client-callable; refresh is internal-only and is
--    invoked by controlled workflow/adjustment RPCs.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.check_ff3_budget_availability(integer, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_ff3_budget_availability(integer, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.njss_refresh_ff3_budget_state(uuid)
  FROM PUBLIC, anon, authenticated;
