-- NJSS applied-state compatibility hotfix, applied version 20260903204909.
-- The live prepared_by column is varchar; fresh schema definitions use uuid.
-- Only canonical UUID values can supply an ownership identity. Legacy display
-- names become NULL, never a lookup by name. Department/section/submitted_by
-- remain database-derived and the rejecting scope gate remains unchanged.
-- Apply AFTER 20260904010000_security_definer_rpc_lockdown.sql, not before.
CREATE OR REPLACE FUNCTION public.transition_divisional_budget_submission(
  p_submission_id uuid,
  p_action text,
  p_comments text DEFAULT NULL,
  p_user_email text DEFAULT NULL
)
RETURNS public.divisional_budget_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $wrapper$
DECLARE
  v_actor uuid;
  v_actor_email text;
  v_action text := upper(coalesce(p_action, ''));
  v_submission_department_id uuid;
  v_submission_section_id uuid;
  v_submission_prepared_by uuid;
  v_submission_submitted_by uuid;
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

  SELECT s.department_id, d.section_id,
         CASE
           WHEN s.prepared_by::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN s.prepared_by::text::uuid
           ELSE NULL::uuid
         END,
         s.submitted_by
  INTO v_submission_department_id, v_submission_section_id,
       v_submission_prepared_by, v_submission_submitted_by
  FROM public.divisional_budget_submissions s
  LEFT JOIN public.budget_divisions d ON d.id = s.division_id
  WHERE s.id = p_submission_id
  FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget submission not found';
  END IF;

  IF NOT coalesce(public.fn_current_user_data_scope_allows(
    v_submission_department_id,
    v_submission_section_id,
    v_submission_prepared_by,
    v_submission_submitted_by,
    NULL
  ), false) THEN
    RAISE EXCEPTION 'Budget submission is outside the current user organisational scope';
  END IF;

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
