-- =============================================================================
-- NJSS SIMPLIFIED HEAD OFFICE BUDGET — EVENT-DIMENSION HARDENING
-- Allows valid Section/Ledger positions introduced by supplementary/reallocation
-- events without requiring a zero-value original budget line.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Authoritative position now includes original and event-only dimensions.
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
SET search_path = public, auth
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

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
-- 2. Supplementary drafts may introduce a valid event-only Section/Ledger key.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_budget_supplementary_draft(
  p_financial_year integer,
  p_division_budget_id uuid,
  p_section_id uuid,
  p_expense_ledger_id uuid,
  p_adjustment_amount numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_id uuid;
  v_cycle_id uuid;
  v_division_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.supplementary.enter');
  IF NOT public.njss_current_user_has_role('Budget Officer') THEN
    RAISE EXCEPTION 'Only the Budget Officer may enter supplementary budgets';
  END IF;
  IF p_adjustment_amount IS NULL OR p_adjustment_amount = 0 THEN
    RAISE EXCEPTION 'Supplementary adjustment amount must be non-zero';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;

  SELECT db.annual_budget_cycle_id, db.division_id
    INTO v_cycle_id, v_division_id
  FROM public.division_budgets db
  JOIN public.annual_budget_cycles c ON c.id = db.annual_budget_cycle_id
  WHERE db.id = p_division_budget_id
    AND db.financial_year = p_financial_year
    AND db.status = 'LOCKED'
    AND c.status = 'ACTIVE'
  FOR UPDATE OF db;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplementary adjustment requires an active locked Division budget'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sections s
    WHERE s.id = p_section_id
      AND s.department_id = v_division_id
      AND COALESCE(s.is_active, true)
  ) THEN RAISE EXCEPTION 'Selected Section does not belong to the Division'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.expense_ledger el
    WHERE el.id = p_expense_ledger_id
      AND el.is_active = true
      AND el.is_posting = true
  ) THEN RAISE EXCEPTION 'Selected ledger is not an active posting ledger'; END IF;

  INSERT INTO public.budget_supplementary_adjustments(
    transaction_number, annual_budget_cycle_id, financial_year, division_budget_id,
    section_id, expense_ledger_id, adjustment_amount, reason, status, entered_by
  ) VALUES (
    public.njss_next_supplementary_number(p_financial_year), v_cycle_id, p_financial_year,
    p_division_budget_id, p_section_id, p_expense_ledger_id, p_adjustment_amount,
    trim(p_reason), 'DRAFT', auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Preserve the existing draft editor with the same controlled behavior.
CREATE OR REPLACE FUNCTION public.update_budget_supplementary_draft(
  p_adjustment_id uuid,
  p_adjustment_amount numeric,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.supplementary.enter');
  IF NOT public.njss_current_user_has_role('Budget Officer') THEN
    RAISE EXCEPTION 'Only the Budget Officer may enter supplementary budgets';
  END IF;
  IF p_adjustment_amount IS NULL OR p_adjustment_amount = 0 THEN RAISE EXCEPTION 'Supplementary adjustment amount must be non-zero'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;

  UPDATE public.budget_supplementary_adjustments
  SET adjustment_amount = p_adjustment_amount, reason = trim(p_reason), updated_at = now()
  WHERE id = p_adjustment_id AND status = 'DRAFT';
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplementary draft not found or already posted'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_budget_supplementary_adjustment(
  p_adjustment_id uuid,
  p_authority_document_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_row public.budget_supplementary_adjustments%ROWTYPE;
  v_available numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.supplementary.enter');
  IF NOT public.njss_current_user_has_role('Budget Officer') THEN
    RAISE EXCEPTION 'Only the Budget Officer may post supplementary budgets';
  END IF;

  SELECT * INTO v_row
  FROM public.budget_supplementary_adjustments
  WHERE id = p_adjustment_id
  FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Supplementary adjustment is not an editable draft';
  END IF;

  -- Division-header locking also covers event-only keys with no original line.
  PERFORM 1
  FROM public.division_budgets db
  WHERE db.id = v_row.division_budget_id
  FOR UPDATE OF db;

  IF NOT EXISTS (
    SELECT 1 FROM public.annual_budget_cycles c
    WHERE c.id = v_row.annual_budget_cycle_id AND c.status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'Supplementary adjustments may only be posted to an active annual budget'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.budget_documents d
    WHERE d.id = p_authority_document_id
      AND d.related_entity_type = 'SUPPLEMENTARY'
      AND d.related_entity_id = p_adjustment_id
      AND d.document_type = 'SUPPLEMENTARY_AUTHORITY'
      AND d.financial_year = v_row.financial_year
  ) THEN RAISE EXCEPTION 'A valid supplementary authority document is required'; END IF;

  IF v_row.adjustment_amount < 0 THEN
    SELECT p.available_budget INTO v_available
    FROM public.get_current_budget_position(
      v_row.financial_year, NULL, v_row.section_id, v_row.expense_ledger_id
    ) p
    WHERE p.division_budget_id = v_row.division_budget_id;

    IF v_available IS NULL OR v_available + v_row.adjustment_amount < 0 THEN
      RAISE EXCEPTION 'Approved reduction would reduce the budget below protected commitments or actual expenditure';
    END IF;
  END IF;

  UPDATE public.budget_supplementary_adjustments
  SET status = 'POSTED',
      authority_document_id = p_authority_document_id,
      posted_by = auth.uid(),
      posted_at = now(),
      updated_at = now()
  WHERE id = p_adjustment_id;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 3. Reallocation destination may be any valid Section / active posting ledger.
--    Source must already have an authoritative current position.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_budget_reallocation(
  p_financial_year integer,
  p_requesting_division_id uuid,
  p_source_division_budget_id uuid,
  p_source_section_id uuid,
  p_source_expense_ledger_id uuid,
  p_destination_division_budget_id uuid,
  p_destination_section_id uuid,
  p_destination_expense_ledger_id uuid,
  p_transfer_amount numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_id uuid;
  v_source_cycle uuid;
  v_destination_cycle uuid;
  v_source_division uuid;
  v_destination_division uuid;
  v_source_current numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.reallocation.request');
  IF p_transfer_amount IS NULL OR p_transfer_amount <= 0 THEN RAISE EXCEPTION 'Transfer amount must be greater than zero'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;
  IF p_source_division_budget_id = p_destination_division_budget_id
     AND p_source_section_id = p_destination_section_id
     AND p_source_expense_ledger_id = p_destination_expense_ledger_id THEN
    RAISE EXCEPTION 'Source and destination budget keys must be different';
  END IF;

  SELECT db.annual_budget_cycle_id, db.division_id
    INTO v_source_cycle, v_source_division
  FROM public.division_budgets db
  JOIN public.annual_budget_cycles c ON c.id = db.annual_budget_cycle_id
  WHERE db.id = p_source_division_budget_id
    AND db.financial_year = p_financial_year
    AND db.status = 'LOCKED'
    AND c.status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Source must belong to the active locked annual budget'; END IF;

  SELECT db.annual_budget_cycle_id, db.division_id
    INTO v_destination_cycle, v_destination_division
  FROM public.division_budgets db
  JOIN public.annual_budget_cycles c ON c.id = db.annual_budget_cycle_id
  WHERE db.id = p_destination_division_budget_id
    AND db.financial_year = p_financial_year
    AND db.status = 'LOCKED'
    AND c.status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Destination must belong to the active locked annual budget'; END IF;
  IF v_source_cycle <> v_destination_cycle THEN RAISE EXCEPTION 'Reallocation source and destination must be in the same annual budget cycle'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sections s
    WHERE s.id = p_source_section_id
      AND s.department_id = v_source_division
      AND COALESCE(s.is_active, true)
  ) THEN RAISE EXCEPTION 'Invalid source Section'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.expense_ledger el
    WHERE el.id = p_source_expense_ledger_id
      AND el.is_active = true
      AND el.is_posting = true
  ) THEN RAISE EXCEPTION 'Invalid source ledger'; END IF;

  SELECT p.current_approved_budget INTO v_source_current
  FROM public.get_current_budget_position(
    p_financial_year, v_source_division, p_source_section_id, p_source_expense_ledger_id
  ) p
  WHERE p.division_budget_id = p_source_division_budget_id;
  IF v_source_current IS NULL OR v_source_current <= 0 THEN
    RAISE EXCEPTION 'Source budget key has no approved budget position';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sections s
    WHERE s.id = p_destination_section_id
      AND s.department_id = v_destination_division
      AND COALESCE(s.is_active, true)
  ) THEN RAISE EXCEPTION 'Invalid destination Section'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.expense_ledger el
    WHERE el.id = p_destination_expense_ledger_id
      AND el.is_active = true
      AND el.is_posting = true
  ) THEN RAISE EXCEPTION 'Invalid destination ledger'; END IF;

  INSERT INTO public.budget_reallocations(
    reallocation_number, annual_budget_cycle_id, financial_year, status, requesting_division_id,
    source_division_budget_id, source_section_id, source_expense_ledger_id,
    destination_division_budget_id, destination_section_id, destination_expense_ledger_id,
    transfer_amount, reason, requested_by
  ) VALUES (
    public.njss_next_reallocation_number(p_financial_year), v_source_cycle, p_financial_year,
    'REQUESTED', p_requesting_division_id,
    p_source_division_budget_id, p_source_section_id, p_source_expense_ledger_id,
    p_destination_division_budget_id, p_destination_section_id, p_destination_expense_ledger_id,
    p_transfer_amount, trim(p_reason), auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Keep the Registrar-only decision functions explicit in this hardening migration.
CREATE OR REPLACE FUNCTION public.approve_budget_reallocation(p_reallocation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.reallocation.approve');
  IF NOT public.njss_current_user_has_role('Registrar') THEN
    RAISE EXCEPTION 'Only the Registrar may approve budget reallocations';
  END IF;
  UPDATE public.budget_reallocations
  SET status = 'REGISTRAR_APPROVED', registrar_approved_by = auth.uid(), registrar_approved_at = now(), updated_at = now()
  WHERE id = p_reallocation_id AND status = 'REQUESTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Reallocation is not pending Registrar approval'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_budget_reallocation(p_reallocation_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.reallocation.approve');
  IF NOT public.njss_current_user_has_role('Registrar') THEN
    RAISE EXCEPTION 'Only the Registrar may reject budget reallocations';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
  UPDATE public.budget_reallocations
  SET status = 'REJECTED', rejected_by = auth.uid(), rejected_at = now(), rejection_reason = trim(p_reason), updated_at = now()
  WHERE id = p_reallocation_id AND status = 'REQUESTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Reallocation is not pending Registrar decision'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.execute_budget_reallocation(
  p_reallocation_id uuid,
  p_authority_document_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_row public.budget_reallocations%ROWTYPE;
  v_available numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.reallocation.execute');
  IF NOT public.njss_current_user_has_role('Budget Officer') THEN
    RAISE EXCEPTION 'Only the Budget Officer may execute budget reallocations';
  END IF;

  SELECT * INTO v_row
  FROM public.budget_reallocations
  WHERE id = p_reallocation_id
  FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'REGISTRAR_APPROVED' THEN
    RAISE EXCEPTION 'Only Registrar-approved reallocations may be executed';
  END IF;

  -- Coarse but safe Division-header locks serialize both original and event-only keys.
  PERFORM 1
  FROM public.division_budgets db
  WHERE db.id IN (v_row.source_division_budget_id, v_row.destination_division_budget_id)
  ORDER BY db.id
  FOR UPDATE OF db;

  IF NOT EXISTS (
    SELECT 1 FROM public.annual_budget_cycles c
    WHERE c.id = v_row.annual_budget_cycle_id AND c.status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'Reallocation requires an active annual budget'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.budget_documents d
    WHERE d.id = p_authority_document_id
      AND d.related_entity_type = 'REALLOCATION'
      AND d.related_entity_id = p_reallocation_id
      AND d.document_type = 'REGISTRAR_REALLOCATION_AUTHORITY'
      AND d.financial_year = v_row.financial_year
  ) THEN RAISE EXCEPTION 'Registrar reallocation authority correspondence is required'; END IF;

  SELECT p.available_budget INTO v_available
  FROM public.get_current_budget_position(
    v_row.financial_year, NULL, v_row.source_section_id, v_row.source_expense_ledger_id
  ) p
  WHERE p.division_budget_id = v_row.source_division_budget_id;

  IF v_available IS NULL THEN RAISE EXCEPTION 'Source budget position is unavailable'; END IF;
  IF v_row.transfer_amount > v_available THEN
    RAISE EXCEPTION 'Reallocation amount exceeds source available budget';
  END IF;

  UPDATE public.budget_reallocations
  SET status = 'EXECUTED',
      registrar_authority_document_id = p_authority_document_id,
      executed_by = auth.uid(),
      executed_at = now(),
      updated_at = now()
  WHERE id = p_reallocation_id;
END;
$function$;

-- Re-assert exposure after function replacement.
REVOKE EXECUTE ON FUNCTION public.get_current_budget_position(integer, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_budget_supplementary_draft(integer, uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_budget_supplementary_draft(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.post_budget_supplementary_adjustment(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_budget_reallocation(integer, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_budget_reallocation(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_budget_reallocation(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.execute_budget_reallocation(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_current_budget_position(integer, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_budget_supplementary_draft(integer, uuid, uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_budget_supplementary_draft(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_budget_supplementary_adjustment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_budget_reallocation(integer, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_budget_reallocation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_budget_reallocation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_budget_reallocation(uuid, uuid) TO authenticated;
