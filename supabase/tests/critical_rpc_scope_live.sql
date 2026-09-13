-- Run only against a reviewed NJSS environment with existing section fixtures.
-- Does not create users or commit workflow changes; successful denial rolls back.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $test$
DECLARE
  v_auth uuid;
  v_app uuid;
  v_section uuid;
  v_target uuid;
  v_in_scope uuid;
BEGIN
  SELECT u.auth_user_id, u.id, u.section_id INTO v_auth, v_app, v_section
  FROM public.users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  JOIN public.roles r ON r.id = ur.role_id
  WHERE r.name = 'Line Supervisor' AND r.is_active AND u.is_active
    AND u.auth_user_id IS NOT NULL AND u.section_id IS NOT NULL
  ORDER BY u.id LIMIT 1;
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'TEST BLOCKED: no active section supervisor fixture';
  END IF;

  SELECT s.id INTO v_target
  FROM public.divisional_budget_submissions s
  JOIN public.budget_divisions d ON d.id = s.division_id
  WHERE d.section_id IS NOT NULL AND d.section_id IS DISTINCT FROM v_section
    AND s.prepared_by IS NOT NULL
    AND s.submitted_by IS DISTINCT FROM v_app
    AND s.prepared_by::text IS DISTINCT FROM v_app::text
  ORDER BY s.id LIMIT 1;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'TEST BLOCKED: no cross-section submission fixture';
  END IF;

  SELECT s.id INTO v_in_scope
  FROM public.divisional_budget_submissions s
  JOIN public.budget_divisions d ON d.id = s.division_id
  WHERE (d.section_id = v_section OR s.submitted_by = v_app)
    AND s.status <> 'DRAFT'
  ORDER BY s.id LIMIT 1;
  IF v_in_scope IS NULL THEN
    RAISE EXCEPTION 'TEST BLOCKED: no in-scope non-draft submission fixture';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.transition_divisional_budget_submission(v_target, 'SUBMIT', NULL, NULL);
    RAISE EXCEPTION 'FAIL: cross-section transition was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Budget submission is outside the current user organisational scope' THEN
      RAISE;
    END IF;
  END;
  -- Valid in-scope authorization must reach the existing state-machine guard.
  -- The non-draft fixture cannot be submitted again, so no mutation is possible.
  BEGIN
    PERFORM public.transition_divisional_budget_submission(v_in_scope, 'SUBMIT', NULL, NULL);
    RAISE EXCEPTION 'FAIL: non-draft submission was submitted again';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Only DRAFT budgets can be submitted' THEN
      RAISE;
    END IF;
  END;
  EXECUTE 'RESET ROLE';
END
$test$;
ROLLBACK;
SELECT 'PASS: cross-section non-owner denied; in-scope request reached state guard; no mutation committed' AS test_result;
