-- =============================================================================
-- NJSS HARD-10/45 — SECURITY DEFINER RPC PRIVILEGE LOCKDOWN
-- Source-controlled only until separately approved for production migration.
--
-- Live review on 2026-09-04 found privileged SECURITY DEFINER functions that
-- inherited EXECUTE from PUBLIC. This made some mutation/audit/admin functions
-- callable through the anonymous API role and exposed internal helpers directly
-- to normal authenticated clients.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Internal-only privileged helpers.
-- These functions remain callable by database-owned SECURITY DEFINER routines
-- and by the trusted service_role, but not directly by browser/API clients.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.njss_set_role_permissions(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.njss_set_role_permissions(text, text[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.log_audit_event(
  uuid, character varying, character varying, character varying,
  character varying, uuid, character varying, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(
  uuid, character varying, character varying, character varying,
  character varying, uuid, character varying, jsonb, jsonb, jsonb, jsonb
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.njss_backup_full_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.njss_backup_full_snapshot() TO service_role;

-- Arbitrary-user permission probing is an internal primitive. The current-user
-- wrapper remains the public authenticated policy helper.
REVOKE EXECUTE ON FUNCTION public.fn_user_has_permission(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_user_has_permission(uuid, text) TO service_role;

-- Current-user helpers are required by authenticated RLS/policy evaluation but
-- have no anonymous business use. Remove inherited PUBLIC/anon execution and
-- grant only the roles that require them.
REVOKE EXECUTE ON FUNCTION public.fn_current_app_user_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_current_app_user_id() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_current_user_has_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_current_user_has_permission(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.njss_require_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_require_permission(text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Guard divisional-budget state transitions inside the database boundary.
--
-- The application already checks SUBMISSION_PERMISSION in the Next route, but
-- direct PostgREST RPC calls previously bypassed that route. Preserve the tested
-- implementation behind a non-client-executable internal name, then recreate the
-- public RPC as an authenticated permission-enforcing wrapper.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure(
    'public.transition_divisional_budget_submission_unchecked_20260904(uuid,text,text,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.transition_divisional_budget_submission(uuid, text, text, text)
      RENAME TO transition_divisional_budget_submission_unchecked_20260904;
  END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION public.transition_divisional_budget_submission_unchecked_20260904(
  uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_divisional_budget_submission_unchecked_20260904(
  uuid, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.transition_divisional_budget_submission(
  p_submission_id uuid,
  p_action text,
  p_comments text DEFAULT NULL::text,
  p_user_email text DEFAULT NULL::text
)
RETURNS public.divisional_budget_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action text := upper(trim(coalesce(p_action, '')));
  v_actor uuid := public.fn_current_app_user_id();
  v_actor_email text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required for budget workflow action.';
  END IF;

  SELECT u.email
  INTO v_actor_email
  FROM public.users u
  WHERE u.id = v_actor
    AND u.is_active = true;

  IF v_actor_email IS NULL THEN
    RAISE EXCEPTION 'Authentication required for an active NJSS user.';
  END IF;

  CASE v_action
    WHEN 'SUBMIT' THEN
      PERFORM public.njss_require_permission('budget.template.submit');
    WHEN 'RESUBMIT' THEN
      PERFORM public.njss_require_permission('budget.template.submit');
    WHEN 'RETURN' THEN
      PERFORM public.njss_require_permission('budget.template.review');
    WHEN 'REVIEW' THEN
      PERFORM public.njss_require_permission('budget.template.review');
    WHEN 'APPROVE' THEN
      PERFORM public.njss_require_permission('budget.template.approve');
    WHEN 'REJECT' THEN
      IF NOT (
        public.fn_current_user_has_permission('budget.template.review')
        OR public.fn_current_user_has_permission('budget.template.approve')
        OR public.fn_current_user_has_permission('all')
      ) THEN
        RAISE EXCEPTION 'Access denied. Budget rejection requires review or approval authority.';
      END IF;
    WHEN 'ARCHIVE' THEN
      PERFORM public.njss_require_permission('budget.module.admin');
    ELSE
      RAISE EXCEPTION 'Unsupported budget workflow action: %', v_action;
  END CASE;

  -- Never trust p_user_email supplied by a browser/API caller for actor identity.
  RETURN public.transition_divisional_budget_submission_unchecked_20260904(
    p_submission_id,
    v_action,
    p_comments,
    v_actor_email
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transition_divisional_budget_submission(
  uuid, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_divisional_budget_submission(
  uuid, text, text, text
) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Guard budget consolidation and prevent caller-supplied actor spoofing.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure(
    'public.consolidate_approved_excel_budgets_unchecked_20260904(integer,uuid,uuid)'
  ) IS NULL THEN
    ALTER FUNCTION public.consolidate_approved_excel_budgets(integer, uuid, uuid)
      RENAME TO consolidate_approved_excel_budgets_unchecked_20260904;
  END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION public.consolidate_approved_excel_budgets_unchecked_20260904(
  integer, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consolidate_approved_excel_budgets_unchecked_20260904(
  integer, uuid, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.consolidate_approved_excel_budgets(
  p_financial_year integer,
  p_department_id uuid DEFAULT NULL::uuid,
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS public.budget_consolidations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.fn_current_app_user_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required for budget consolidation.';
  END IF;

  PERFORM public.njss_require_permission('budget.consolidate');

  -- Ignore the caller-provided user id; actor identity comes only from auth.
  RETURN public.consolidate_approved_excel_budgets_unchecked_20260904(
    p_financial_year,
    p_department_id,
    v_actor
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consolidate_approved_excel_budgets(
  integer, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consolidate_approved_excel_budgets(
  integer, uuid, uuid
) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Explicitly remove anonymous access from high-value funding RPCs that
-- already enforce permissions internally. Authenticated execution is retained
-- because the server workflow route invokes these RPCs using the caller JWT.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.njss_create_funding_authority(
  integer, text, uuid, numeric, date, date, text, text, text, text, date,
  text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_create_funding_authority(
  integer, text, uuid, numeric, date, date, text, text, text, text, date,
  text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.njss_create_funding_receipt(
  uuid, date, numeric, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_create_funding_receipt(
  uuid, date, numeric, text, text, text, text, text, text, text, text
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.njss_approve_funding_allocation(
  uuid, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_approve_funding_allocation(
  uuid, text, text
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.njss_transition_funding_authority(
  uuid, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_transition_funding_authority(
  uuid, text, text, text
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.njss_transition_funding_receipt(
  uuid, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_transition_funding_receipt(
  uuid, text, text, text
) TO authenticated, service_role;

-- Migration postcondition assertions. These execute during a controlled
-- migration and fail atomically if the privilege boundary is not as expected.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.njss_set_role_permissions(text,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY HARDENING FAILED: anon can execute njss_set_role_permissions';
  END IF;
  IF has_function_privilege('anon', 'public.log_audit_event(uuid,character varying,character varying,character varying,character varying,uuid,character varying,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY HARDENING FAILED: anon can execute log_audit_event';
  END IF;
  IF has_function_privilege('authenticated', 'public.njss_backup_full_snapshot()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY HARDENING FAILED: authenticated client can execute full backup snapshot';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.transition_divisional_budget_submission(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY HARDENING FAILED: authenticated budget transition wrapper is unavailable';
  END IF;
END
$$;
