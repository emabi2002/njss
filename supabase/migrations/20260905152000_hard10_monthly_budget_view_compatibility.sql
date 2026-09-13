-- =============================================================================
-- NJSS HARD-10B — MONTHLY BUDGET DETAIL READ COMPATIBILITY
-- Runs after 20260904013100_budget_legacy_policy_cleanup.sql.
-- DO NOT apply independently or to production without the HARD-10 deployment gate.
-- =============================================================================

-- The application loads budget_monthly_allocations as nested child detail of
-- divisional_budget_lines in getSubmissionDetail(). The parent submission/line
-- policies recognise budget.view, so the child read policy must preserve that
-- same canonical budget-detail permission. Report-only permissions remain
-- intentionally excluded to avoid recreating the retired Phase-6 cross-scope
-- access path.

DO $hard10b_preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_monthly_allocations'
      AND policyname = 'hard10_monthly_allocation_insert'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_monthly_allocations'
      AND policyname = 'hard10_monthly_allocation_update'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_monthly_allocations'
      AND policyname = 'hard10_monthly_allocation_delete'
  ) THEN
    RAISE EXCEPTION 'HARD-10B must run after the HARD-10 ancillary budget policy cleanup';
  END IF;
END
$hard10b_preflight$;

DROP POLICY IF EXISTS hard10_monthly_allocation_read
ON public.budget_monthly_allocations;

CREATE POLICY hard10_monthly_allocation_read
ON public.budget_monthly_allocations
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('budget.template.view')
    OR public.fn_current_user_has_permission('budget.template')
    OR public.fn_current_user_has_permission('budget.view')
    OR public.fn_current_user_has_permission('all')
  )
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_lines l
    JOIN public.divisional_budget_submissions s ON s.id = l.submission_id
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE l.id = public.budget_monthly_allocations.budget_line_id
      AND public.fn_current_user_data_scope_allows(
        s.department_id,
        bd.section_id,
        NULL,
        NULL,
        NULL
      )
  )
);

DO $hard10b_verify$
DECLARE
  v_qual text;
BEGIN
  SELECT qual
  INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'budget_monthly_allocations'
    AND policyname = 'hard10_monthly_allocation_read';

  IF v_qual IS NULL OR v_qual NOT ILIKE '%budget.view%' THEN
    RAISE EXCEPTION 'HARD-10B failed: monthly allocation read does not preserve budget.view';
  END IF;

  IF v_qual ILIKE '%budget.report.view%' OR v_qual ILIKE '%reports.view%' THEN
    RAISE EXCEPTION 'HARD-10B failed: report-only permission leaked into raw monthly allocation access';
  END IF;
END
$hard10b_verify$;
