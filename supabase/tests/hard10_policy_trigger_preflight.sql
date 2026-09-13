-- =============================================================================
-- NJSS HARD-10 — LIVE POLICY/TRIGGER ACTOR PREFLIGHT
-- READ ONLY. This script performs no DDL and no business-data mutation.
-- Run against the target NJSS database before any HARD-10 RLS migration.
-- =============================================================================

-- 1. Current budget/revision population by state. This establishes which
-- workflow states must continue to work after RLS is enabled.
SELECT 'budget_submission_state' AS check_name,
       s.status,
       s.is_locked,
       count(*) AS row_count
FROM public.divisional_budget_submissions s
GROUP BY s.status, s.is_locked
ORDER BY s.status, s.is_locked;

SELECT 'budget_revision_state' AS check_name,
       br.status,
       count(*) AS row_count
FROM public.budget_revisions br
GROUP BY br.status
ORDER BY br.status;

-- 2. Every assigned budget revision must point to an active Line Supervisor
-- whose organisational unit actually matches the revision division. An
-- assignment mismatch is UAT/master-data drift and must not be hidden by a
-- permissive RLS exception.
SELECT 'revision_assignment_scope_mismatch' AS check_name,
       br.id AS revision_id,
       br.revision_submission_id,
       br.status AS revision_status,
       br.assigned_line_supervisor_id,
       bd.department_id,
       bd.section_id
FROM public.budget_revisions br
JOIN public.budget_divisions bd ON bd.id = br.division_id
WHERE br.assigned_line_supervisor_id IS NOT NULL
  AND NOT public.njss_budget_revision_supervisor_matches(
    br.division_id,
    br.assigned_line_supervisor_id
  )
ORDER BY br.id;

-- 3. Quantify ownership that crosses organisational scope. HARD-10 budget-table
-- policies deliberately do NOT pass submitted_by as p_created_by to
-- fn_current_user_data_scope_allows(), because the generic ownership shortcut
-- would otherwise turn historical/seeded actor values into a section bypass.
SELECT 'cross_scope_submission_ownership' AS check_name,
       count(*) AS row_count
FROM public.divisional_budget_submissions s
JOIN public.budget_divisions bd ON bd.id = s.division_id
JOIN public.users u ON u.id = s.submitted_by
WHERE s.submitted_by IS NOT NULL
  AND NOT (
    u.section_id IS NOT NULL
    AND bd.section_id IS NOT NULL
    AND u.section_id = bd.section_id
  );

-- 4. Show the effective organisational-scope result for assigned supervisors.
-- The session actor is not impersonated here; the canonical helper is exercised
-- by the rollback-only actor probes documented with the release evidence.
SELECT 'scope_helper_present' AS check_name,
       to_regprocedure('public.fn_current_user_data_scope_allows(uuid,uuid,uuid,uuid,uuid)') IS NOT NULL AS passed,
       to_regprocedure('public.njss_budget_revision_supervisor_matches(uuid,uuid)') IS NOT NULL AS supervisor_match_helper_present;

-- 5. The controlled budget transition path must remain SECURITY DEFINER. Its
-- internal implementation must be the only path that sets njss.budget_workflow
-- before status/actor fields are changed.
SELECT 'workflow_rpc_security' AS check_name,
       p.proname,
       p.prosecdef AS security_definer,
       pg_get_userbyid(p.proowner) AS owner,
       position('njss.budget_workflow' in pg_get_functiondef(p.oid)) > 0 AS sets_workflow_context
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'transition_divisional_budget_submission',
    'transition_divisional_budget_submission_internal'
  )
ORDER BY p.proname;

-- 6. Gate condition. Current environments with invalid revision assignments
-- intentionally fail here. Reconcile the user/section assignment through
-- controlled UAT/master-data remediation; do not weaken HARD-10 RLS to pass it.
DO $hard10_preflight$
DECLARE
  v_mismatch_count integer;
BEGIN
  SELECT count(*)
  INTO v_mismatch_count
  FROM public.budget_revisions br
  WHERE br.assigned_line_supervisor_id IS NOT NULL
    AND NOT public.njss_budget_revision_supervisor_matches(
      br.division_id,
      br.assigned_line_supervisor_id
    );

  IF v_mismatch_count > 0 THEN
    RAISE EXCEPTION
      'HARD-10 preflight failed: % budget revision assignment(s) do not match the assigned Line Supervisor organisational unit.',
      v_mismatch_count
      USING HINT = 'Correct the UAT/user organisational assignments. Do not add an RLS ownership or cross-section bypass.';
  END IF;
END
$hard10_preflight$;
