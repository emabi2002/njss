-- =============================================================================
-- NJSS HARD-10 — ANCILLARY BUDGET LEGACY POLICY CLEANUP
-- Runs after 20260904013000_rls_and_legacy_policy_lockdown.sql.
-- DO NOT apply to production without explicit approval.
-- =============================================================================

ALTER TABLE public.budget_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_import_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_line_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_monthly_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_division_ceilings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_reference_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.budget_import_batches,
  public.budget_import_staging,
  public.budget_line_attachments,
  public.budget_monthly_allocations,
  public.budget_division_ceilings,
  public.budget_reference_values,
  public.expense_ledger
FROM anon;

-- Remove the legacy `true`/any-authenticated contributor policies.
DROP POLICY IF EXISTS budget_import_batches_read ON public.budget_import_batches;
DROP POLICY IF EXISTS budget_import_batches_insert ON public.budget_import_batches;
DROP POLICY IF EXISTS budget_import_batches_update ON public.budget_import_batches;
DROP POLICY IF EXISTS budget_import_batches_delete ON public.budget_import_batches;

DROP POLICY IF EXISTS budget_import_staging_read ON public.budget_import_staging;
DROP POLICY IF EXISTS budget_import_staging_insert ON public.budget_import_staging;
DROP POLICY IF EXISTS budget_import_staging_update ON public.budget_import_staging;
DROP POLICY IF EXISTS budget_import_staging_delete ON public.budget_import_staging;

DROP POLICY IF EXISTS budget_line_attachments_read ON public.budget_line_attachments;
DROP POLICY IF EXISTS budget_line_attachments_insert ON public.budget_line_attachments;
DROP POLICY IF EXISTS budget_line_attachments_update ON public.budget_line_attachments;
DROP POLICY IF EXISTS budget_line_attachments_delete ON public.budget_line_attachments;

DROP POLICY IF EXISTS budget_monthly_allocations_read ON public.budget_monthly_allocations;
DROP POLICY IF EXISTS budget_monthly_allocations_insert ON public.budget_monthly_allocations;
DROP POLICY IF EXISTS budget_monthly_allocations_update ON public.budget_monthly_allocations;
DROP POLICY IF EXISTS budget_monthly_allocations_delete ON public.budget_monthly_allocations;

DROP POLICY IF EXISTS budget_division_ceilings_read ON public.budget_division_ceilings;
DROP POLICY IF EXISTS budget_reference_values_read ON public.budget_reference_values;
DROP POLICY IF EXISTS expense_ledger_read ON public.expense_ledger;

-- Import batches: permission + division scope.
DROP POLICY IF EXISTS hard10_import_batch_read ON public.budget_import_batches;
DROP POLICY IF EXISTS hard10_import_batch_write ON public.budget_import_batches;
CREATE POLICY hard10_import_batch_read ON public.budget_import_batches
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.budget_divisions bd
    WHERE bd.id = public.budget_import_batches.division_id
      AND public.fn_current_user_data_scope_allows(bd.department_id, bd.section_id, NULL, NULL, NULL)
  )
);
CREATE POLICY hard10_import_batch_write ON public.budget_import_batches
FOR ALL TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.budget_divisions bd
    WHERE bd.id = public.budget_import_batches.division_id
      AND public.fn_current_user_data_scope_allows(bd.department_id, bd.section_id, NULL, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.budget_divisions bd
    WHERE bd.id = public.budget_import_batches.division_id
      AND public.fn_current_user_data_scope_allows(bd.department_id, bd.section_id, NULL, NULL, NULL)
  )
);

-- Import staging inherits batch scope.
DROP POLICY IF EXISTS hard10_import_staging_read ON public.budget_import_staging;
DROP POLICY IF EXISTS hard10_import_staging_write ON public.budget_import_staging;
CREATE POLICY hard10_import_staging_read ON public.budget_import_staging
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.budget_import_batches b
    JOIN public.budget_divisions bd ON bd.id = b.division_id
    WHERE b.id = public.budget_import_staging.batch_id
      AND public.fn_current_user_data_scope_allows(bd.department_id, bd.section_id, NULL, NULL, NULL)
  )
);
CREATE POLICY hard10_import_staging_write ON public.budget_import_staging
FOR ALL TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.budget_import_batches b
    JOIN public.budget_divisions bd ON bd.id = b.division_id
    WHERE b.id = public.budget_import_staging.batch_id
      AND public.fn_current_user_data_scope_allows(bd.department_id, bd.section_id, NULL, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.budget_import_batches b
    JOIN public.budget_divisions bd ON bd.id = b.division_id
    WHERE b.id = public.budget_import_staging.batch_id
      AND public.fn_current_user_data_scope_allows(bd.department_id, bd.section_id, NULL, NULL, NULL)
  )
);

-- Monthly allocations inherit budget-line/submission scope.
DROP POLICY IF EXISTS hard10_monthly_allocation_read ON public.budget_monthly_allocations;
DROP POLICY IF EXISTS hard10_monthly_allocation_write ON public.budget_monthly_allocations;
CREATE POLICY hard10_monthly_allocation_read ON public.budget_monthly_allocations
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.template') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_lines l
    JOIN public.divisional_budget_submissions s ON s.id = l.submission_id
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE l.id = public.budget_monthly_allocations.budget_line_id
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);
CREATE POLICY hard10_monthly_allocation_write ON public.budget_monthly_allocations
FOR ALL TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_lines l
    JOIN public.divisional_budget_submissions s ON s.id = l.submission_id
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE l.id = public.budget_monthly_allocations.budget_line_id
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_lines l
    JOIN public.divisional_budget_submissions s ON s.id = l.submission_id
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE l.id = public.budget_monthly_allocations.budget_line_id
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);

-- Budget-line attachments inherit submission scope.
DROP POLICY IF EXISTS hard10_budget_attachment_read ON public.budget_line_attachments;
DROP POLICY IF EXISTS hard10_budget_attachment_write ON public.budget_line_attachments;
CREATE POLICY hard10_budget_attachment_read ON public.budget_line_attachments
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.template') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = public.budget_line_attachments.submission_id
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);
CREATE POLICY hard10_budget_attachment_write ON public.budget_line_attachments
FOR ALL TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = public.budget_line_attachments.submission_id
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = public.budget_line_attachments.submission_id
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);

-- Division ceilings inherit division scope; mutation is budget-admin only.
DROP POLICY IF EXISTS hard10_division_ceiling_read ON public.budget_division_ceilings;
DROP POLICY IF EXISTS hard10_division_ceiling_write ON public.budget_division_ceilings;
CREATE POLICY hard10_division_ceiling_read ON public.budget_division_ceilings
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.module.view') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.budget_divisions bd
    WHERE bd.id = public.budget_division_ceilings.division_id
      AND public.fn_current_user_data_scope_allows(bd.department_id, bd.section_id, NULL, NULL, NULL)
  )
);
CREATE POLICY hard10_division_ceiling_write ON public.budget_division_ceilings
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('all')));

-- Budget reference values and expense ledger remain readable to authorised budget
-- users; only administrators may mutate them.
DROP POLICY IF EXISTS hard10_budget_reference_read ON public.budget_reference_values;
DROP POLICY IF EXISTS hard10_budget_reference_write ON public.budget_reference_values;
CREATE POLICY hard10_budget_reference_read ON public.budget_reference_values
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.module.view') OR public.fn_current_user_has_permission('budget.view') OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_budget_reference_write ON public.budget_reference_values
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS hard10_expense_ledger_read ON public.expense_ledger;
DROP POLICY IF EXISTS hard10_expense_ledger_write ON public.expense_ledger;
CREATE POLICY hard10_expense_ledger_read ON public.expense_ledger
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);
CREATE POLICY hard10_expense_ledger_write ON public.expense_ledger
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('registry.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('registry.manage') OR public.fn_current_user_has_permission('all')));

-- The legacy helper is now obsolete. Do not allow it to remain as an API or as a
-- hidden permissive policy dependency.
DO $retire_budget_contributor$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND (COALESCE(qual, '') ILIKE '%njss_is_budget_contributor%'
           OR COALESCE(with_check, '') ILIKE '%njss_is_budget_contributor%')
  ) THEN
    RAISE EXCEPTION 'HARD-10 failed: a policy still depends on njss_is_budget_contributor()';
  END IF;
END
$retire_budget_contributor$;

REVOKE EXECUTE ON FUNCTION public.njss_is_budget_contributor() FROM PUBLIC, anon, authenticated;
