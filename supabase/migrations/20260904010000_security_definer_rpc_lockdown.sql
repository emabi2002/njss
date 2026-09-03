-- =============================================================================
-- NJSS HARD-45 — CRITICAL SECURITY DEFINER RPC LOCKDOWN
-- Additive migration. DO NOT apply to production without explicit approval.
--
-- Live HARD-45 evidence showed SECURITY DEFINER functions inherited PostgreSQL's
-- default PUBLIC EXECUTE grant. Revoking only from `anon` is insufficient when
-- PUBLIC still grants execution. This migration removes direct API execution
-- from privileged/internal helpers and puts authenticated permission gates in
-- front of the two legacy budget mutations that must remain callable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Internal-only privileged helpers: no direct PostgREST/RPC execution.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.njss_set_role_permissions(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_audit_event(uuid, character varying, character varying, character varying, character varying, uuid, character varying, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_divisional_budget_submission(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_refresh_supplier_compliance_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_resolve_ff3_budget_allocation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_sync_commitment_balances(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_user_has_permission(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_check_segregation_of_duties(text, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_require_permission(text) FROM PUBLIC, anon, authenticated;

-- Read-only helpers that are used by privileged routines are not anonymous APIs.
REVOKE EXECUTE ON FUNCTION public.njss_budget_position_for_allocation(uuid) FROM PUBLIC, anon, authenticated;

-- Trigger functions never need direct REST/RPC exposure. Existing triggers keep
-- invoking them under PostgreSQL trigger semantics.
DO $lockdown$
DECLARE
  v_signature regprocedure;
BEGIN
  FOR v_signature IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_signature
    );
  END LOOP;
END
$lockdown$;

-- -----------------------------------------------------------------------------
-- 2. Block anonymous execution of security-sensitive helper predicates.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.fn_current_app_user_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_current_app_user_id() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_current_user_has_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_current_user_has_permission(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.njss_is_budget_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_is_budget_admin() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Existing funding RPCs already enforce njss_require_permission internally.
-- Remove inherited PUBLIC/anon execution while preserving authenticated use.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.njss_approve_funding_allocation(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_approve_funding_allocation(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.njss_create_funding_authority(integer, text, uuid, numeric, date, date, text, text, text, text, date, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_create_funding_authority(integer, text, uuid, numeric, date, date, text, text, text, text, date, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.njss_create_funding_receipt(uuid, date, numeric, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_create_funding_receipt(uuid, date, numeric, text, text, text, text, text, text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.njss_transition_funding_authority(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_transition_funding_authority(uuid, text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.njss_transition_funding_receipt(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_transition_funding_receipt(uuid, text, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Legacy divisional-budget workflow: preserve implementation, but hide it
-- behind a wrapper that authenticates the actor and enforces action permission.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.transition_divisional_budget_submission(uuid, text, text, text)
  RENAME TO transition_divisional_budget_submission_internal;

REVOKE EXECUTE ON FUNCTION public.transition_divisional_budget_submission_internal(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.transition_divisional_budget_submission(
  p_submission_id uuid,
  p_action text,
  p_comments text DEFAULT NULL,
  p_user_email text DEFAULT NULL
)
RETURNS public.divisional_budget_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $wrapper$
DECLARE
  v_actor uuid;
  v_actor_email text;
  v_action text := upper(coalesce(p_action, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_actor := public.fn_current_app_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required: active NJSS user profile not found';
  END IF;

  SELECT email INTO v_actor_email
  FROM public.users
  WHERE id = v_actor AND is_active = true;

  IF v_actor_email IS NULL THEN
    RAISE EXCEPTION 'Authentication required: active NJSS user profile not found';
  END IF;

  CASE
    WHEN v_action IN ('SUBMIT', 'RESUBMIT') THEN
      PERFORM public.njss_require_permission('budget.template.submit');
    WHEN v_action IN ('RETURN', 'REVIEW', 'REJECT') THEN
      PERFORM public.njss_require_permission('budget.template.review');
    WHEN v_action = 'APPROVE' THEN
      PERFORM public.njss_require_permission('budget.template.approve');
    WHEN v_action = 'ARCHIVE' THEN
      PERFORM public.njss_require_permission('budget.module.admin');
    ELSE
      RAISE EXCEPTION 'Unsupported budget workflow action: %', p_action;
  END CASE;

  -- Ignore caller-supplied identity. The internal implementation receives the
  -- authenticated NJSS user's email so audit/history actor data cannot be spoofed.
  RETURN public.transition_divisional_budget_submission_internal(
    p_submission_id,
    v_action,
    p_comments,
    v_actor_email
  );
END;
$wrapper$;

REVOKE EXECUTE ON FUNCTION public.transition_divisional_budget_submission(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_divisional_budget_submission(uuid, text, text, text)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Legacy consolidation RPC: force authenticated actor and permission.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.consolidate_approved_excel_budgets(integer, uuid, uuid)
  RENAME TO consolidate_approved_excel_budgets_internal;

REVOKE EXECUTE ON FUNCTION public.consolidate_approved_excel_budgets_internal(integer, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consolidate_approved_excel_budgets(
  p_financial_year integer,
  p_department_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS public.budget_consolidations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $wrapper$
DECLARE
  v_actor uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_actor := public.fn_current_app_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required: active NJSS user profile not found';
  END IF;

  PERFORM public.njss_require_permission('budget.consolidate');

  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Actor identity mismatch';
  END IF;

  RETURN public.consolidate_approved_excel_budgets_internal(
    p_financial_year,
    p_department_id,
    v_actor
  );
END;
$wrapper$;

REVOKE EXECUTE ON FUNCTION public.consolidate_approved_excel_budgets(integer, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consolidate_approved_excel_budgets(integer, uuid, uuid)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Post-migration invariants. Fail the migration rather than leave a partial
-- privilege model if critical RPC grants are still exposed.
-- -----------------------------------------------------------------------------
DO $verify$
BEGIN
  IF has_function_privilege('anon', 'public.njss_set_role_permissions(text,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'HARD-45 failed: anon can still execute njss_set_role_permissions';
  END IF;

  IF has_function_privilege('authenticated', 'public.njss_set_role_permissions(text,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'HARD-45 failed: authenticated can still directly execute njss_set_role_permissions';
  END IF;

  IF has_function_privilege('anon', 'public.log_audit_event(uuid,character varying,character varying,character varying,character varying,uuid,character varying,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'HARD-45 failed: anon can still execute log_audit_event';
  END IF;

  IF has_function_privilege('authenticated', 'public.log_audit_event(uuid,character varying,character varying,character varying,character varying,uuid,character varying,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'HARD-45 failed: authenticated can still directly execute log_audit_event';
  END IF;

  IF has_function_privilege('anon', 'public.transition_divisional_budget_submission(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'HARD-45 failed: anon can still execute budget workflow transition';
  END IF;

  IF has_function_privilege('anon', 'public.consolidate_approved_excel_budgets(integer,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'HARD-45 failed: anon can still execute budget consolidation';
  END IF;
END
$verify$;
