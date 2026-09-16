-- =============================================================================
-- NJSS SIMPLIFIED BUDGET — AUDIT AND CONCURRENCY HARDENING
-- Serializes human-readable numbering and binds reallocation request audit
-- identity to the authenticated user's Division.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.njss_next_supplementary_number(p_financial_year integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_next bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('njss:supplementary:' || p_financial_year::text));
  SELECT COALESCE(MAX(NULLIF(regexp_replace(transaction_number, '^SUP-[0-9]{4}-', ''), '')::bigint), 0) + 1
    INTO v_next
  FROM public.budget_supplementary_adjustments
  WHERE financial_year = p_financial_year;
  RETURN format('SUP-%s-%s', p_financial_year, lpad(v_next::text, 6, '0'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.njss_next_reallocation_number(p_financial_year integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_next bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('njss:reallocation:' || p_financial_year::text));
  SELECT COALESCE(MAX(NULLIF(regexp_replace(reallocation_number, '^REL-[0-9]{4}-', ''), '')::bigint), 0) + 1
    INTO v_next
  FROM public.budget_reallocations
  WHERE financial_year = p_financial_year;
  RETURN format('REL-%s-%s', p_financial_year, lpad(v_next::text, 6, '0'));
END;
$function$;

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
  v_authenticated_division uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.reallocation.request');

  SELECT u.department_id INTO v_authenticated_division
  FROM public.users u
  WHERE u.id = public.fn_current_app_user_id()
    AND u.is_active = true;

  IF v_authenticated_division IS NULL OR p_requesting_division_id IS DISTINCT FROM v_authenticated_division THEN
    RAISE EXCEPTION 'Requester Division does not match the authenticated user';
  END IF;

  IF p_transfer_amount IS NULL OR p_transfer_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;
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
  IF v_source_cycle <> v_destination_cycle THEN
    RAISE EXCEPTION 'Reallocation source and destination must be in the same annual budget cycle';
  END IF;

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
    'REQUESTED', v_authenticated_division,
    p_source_division_budget_id, p_source_section_id, p_source_expense_ledger_id,
    p_destination_division_budget_id, p_destination_section_id, p_destination_expense_ledger_id,
    p_transfer_amount, trim(p_reason), auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_next_supplementary_number(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_next_reallocation_number(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_budget_reallocation(integer, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_budget_reallocation(integer, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) TO authenticated;
