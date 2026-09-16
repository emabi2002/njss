-- =============================================================================
-- NJSS BUDGET REALLOCATION REQUEST AUTHORITY
-- Division Directors may request only from their own Division. The Registrar
-- may initiate a reallocation under the Registrar's cross-Division prerogative.
-- Approval remains Registrar-only; execution remains Budget Officer-only.
-- =============================================================================

INSERT INTO public.role_permissions (role_id, permission, is_allowed)
SELECT r.id, 'budget.reallocation.request', true
FROM public.roles r
WHERE r.name = 'Registrar'
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

CREATE OR REPLACE FUNCTION public.request_budget_reallocation(
  p_financial_year integer,
  p_source_division_budget_id uuid,
  p_source_section_id uuid,
  p_source_expense_ledger_id uuid,
  p_destination_division_budget_id uuid,
  p_destination_section_id uuid,
  p_destination_expense_ledger_id uuid,
  p_amount numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_source_cycle_id uuid;
  v_destination_cycle_id uuid;
  v_source_division_id uuid;
  v_reallocation_id uuid;
  v_source_available_budget numeric(18,2);
  v_is_registrar boolean;
  v_is_division_director boolean;
  v_requester_division_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.reallocation.request');

  v_is_registrar := public.njss_current_user_has_role('Registrar');
  v_is_division_director := public.njss_current_user_has_role('Division Director');

  IF NOT (v_is_registrar OR v_is_division_director) THEN
    RAISE EXCEPTION 'Only a Division Director or the Registrar may request a budget reallocation';
  END IF;

  IF p_amount IS NULL OR round(p_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'Reallocation amount must be greater than zero';
  END IF;
  IF nullif(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Reallocation reason is required';
  END IF;
  IF p_source_division_budget_id = p_destination_division_budget_id
     AND p_source_section_id = p_destination_section_id
     AND p_source_expense_ledger_id = p_destination_expense_ledger_id THEN
    RAISE EXCEPTION 'Source and destination budget positions must be different';
  END IF;

  SELECT cycle_id, division_id INTO v_source_cycle_id, v_source_division_id
  FROM public.njss_validate_active_budget_position(
    p_financial_year,
    p_source_division_budget_id,
    p_source_section_id,
    p_source_expense_ledger_id
  );

  SELECT cycle_id INTO v_destination_cycle_id
  FROM public.njss_validate_active_budget_position(
    p_financial_year,
    p_destination_division_budget_id,
    p_destination_section_id,
    p_destination_expense_ledger_id
  );

  IF v_source_cycle_id <> v_destination_cycle_id THEN
    RAISE EXCEPTION 'Source and destination must belong to the same active annual budget';
  END IF;

  IF v_is_division_director AND NOT v_is_registrar THEN
    SELECT u.department_id INTO v_requester_division_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.is_active = true
      AND u.archived_at IS NULL;

    IF v_requester_division_id IS NULL OR v_requester_division_id <> v_source_division_id THEN
      RAISE EXCEPTION 'Division Directors may request reallocations only from their own Division';
    END IF;
  END IF;

  SELECT bp.available_budget INTO v_source_available_budget
  FROM public.v_current_budget_position bp
  WHERE bp.financial_year = p_financial_year
    AND bp.division_id = v_source_division_id
    AND bp.section_id = p_source_section_id
    AND bp.expense_ledger_id = p_source_expense_ledger_id
    AND bp.annual_cycle_status = 'ACTIVE';

  v_source_available_budget := coalesce(v_source_available_budget, 0);
  IF round(p_amount, 2) > v_source_available_budget THEN
    RAISE EXCEPTION 'Requested reallocation exceeds source available budget';
  END IF;

  INSERT INTO public.budget_reallocations (
    reallocation_number,
    annual_budget_cycle_id,
    financial_year,
    reason,
    requesting_division_id,
    requested_by,
    source_division_budget_id,
    source_section_id,
    source_expense_ledger_id,
    destination_division_budget_id,
    destination_section_id,
    destination_expense_ledger_id,
    amount
  ) VALUES (
    format('REL-%s-%s', p_financial_year, lpad(nextval('public.budget_reallocation_transaction_seq')::text, 6, '0')),
    v_source_cycle_id,
    p_financial_year,
    trim(p_reason),
    CASE WHEN v_is_registrar THEN NULL ELSE v_source_division_id END,
    auth.uid(),
    p_source_division_budget_id,
    p_source_section_id,
    p_source_expense_ledger_id,
    p_destination_division_budget_id,
    p_destination_section_id,
    p_destination_expense_ledger_id,
    round(p_amount, 2)
  )
  RETURNING id INTO v_reallocation_id;

  RETURN v_reallocation_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.request_budget_reallocation(integer, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_budget_reallocation(integer, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) TO authenticated;
