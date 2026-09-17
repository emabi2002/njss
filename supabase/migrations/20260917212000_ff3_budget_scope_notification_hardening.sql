-- =============================================================================
-- NJSS PHASE 3 HARDENING — BUDGET CHECK SCOPE + TARGETED NOTIFICATIONS
-- Prevents cross-scope budget probing and keeps budget-block notifications
-- within the requester's Division workflow audience.
-- =============================================================================

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

  IF NOT public.fn_current_user_data_scope_allows(
    p_department_id,
    p_section_id,
    NULL,
    NULL,
    public.fn_current_app_user_id()
  ) THEN
    RAISE EXCEPTION 'Selected Division / Section is outside the current user organisational scope';
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
      AND u.department_id = v_ff3.department_id
      AND rp.is_allowed = true
      AND rp.permission IN ('ff3.endorse', 'ff3.approve')
  ) targets
  WHERE target_user_id IS NOT NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_notify_ff3_budget_block(uuid, text, numeric, numeric)
  FROM PUBLIC, anon, authenticated;
