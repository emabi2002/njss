-- =============================================================================
-- NJSS HARD-10C — BUDGET.VIEW WORKFLOW HISTORY COMPATIBILITY
-- Runs after 20260904013000_rls_and_legacy_policy_lockdown.sql.
-- DO NOT apply independently or to production without the HARD-10 deployment gate.
-- =============================================================================

-- The read-only budget-template detail path loads workflow history alongside the
-- submission and lines. The parent submission/line policies recognise budget.view,
-- so the history child read must preserve the same scoped read authority. This
-- migration does not create INSERT/UPDATE/DELETE policies; workflow history writes
-- remain restricted to guarded SECURITY DEFINER workflow functions.

DO $hard10c_preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_workflow_history'
      AND policyname = 'hard10_budget_history_read'
  ) THEN
    RAISE EXCEPTION 'HARD-10C must run after the primary HARD-10 RLS migration';
  END IF;
END
$hard10c_preflight$;

DROP POLICY IF EXISTS hard10_budget_history_read
ON public.budget_workflow_history;

CREATE POLICY hard10_budget_history_read
ON public.budget_workflow_history
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('budget.template.view')
    OR public.fn_current_user_has_permission('budget.template.review')
    OR public.fn_current_user_has_permission('budget.template.approve')
    OR public.fn_current_user_has_permission('budget.view')
    OR public.fn_current_user_has_permission('audit.view')
    OR public.fn_current_user_has_permission('all')
  )
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = public.budget_workflow_history.submission_id
      AND public.fn_current_user_data_scope_allows(
        s.department_id,
        bd.section_id,
        NULL,
        NULL,
        NULL
      )
  )
);

DO $hard10c_verify$
DECLARE
  v_qual text;
BEGIN
  SELECT qual
  INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'budget_workflow_history'
    AND policyname = 'hard10_budget_history_read';

  IF v_qual IS NULL OR v_qual NOT ILIKE '%budget.view%' THEN
    RAISE EXCEPTION 'HARD-10C failed: workflow history read does not preserve budget.view';
  END IF;

  IF v_qual ILIKE '%budget.report.view%' OR v_qual ILIKE '%reports.view%' THEN
    RAISE EXCEPTION 'HARD-10C failed: report-only permission leaked into raw workflow history access';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_workflow_history'
      AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'HARD-10C failed: direct workflow-history mutation policy exists';
  END IF;
END
$hard10c_verify$;
