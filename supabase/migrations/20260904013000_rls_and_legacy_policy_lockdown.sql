-- =============================================================================
-- NJSS HARD-10 — RLS AND LEGACY POLICY LOCKDOWN
-- Additive migration. DO NOT apply to production without explicit approval.
--
-- Live inspection found 30 public tables with RLS disabled while `authenticated`
-- held direct CRUD grants. It also found legacy budget policies that granted broad
-- access using `true` or `njss_is_budget_contributor()`, where that helper merely
-- checks that a session is signed in. PostgreSQL permissive policies are ORed, so
-- those legacy rules can defeat newer RBAC policies. This migration enables RLS,
-- removes the unsafe legacy rules, and installs explicit permission/scope policies.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enable RLS on every table confirmed disabled by the HARD-10 live baseline.
-- Do not FORCE RLS: controlled SECURITY DEFINER routines/service role must remain
-- able to perform internal writes after their own authorization gates.
-- -----------------------------------------------------------------------------
ALTER TABLE public.activity_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annual_plan_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_consolidations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_release_funding_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_workflow_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divisional_budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payee_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.priority_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provinces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rbac_data_scope_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_migration_map_041 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_migration_map_045 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.segregation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.urgency_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_statuses ENABLE ROW LEVEL SECURITY;

-- These budget tables already had RLS enabled in the live baseline but contained
-- permissive legacy policies. Keep RLS explicitly enabled while replacing them.
ALTER TABLE public.divisional_budget_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_import_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_line_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_monthly_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_division_ceilings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_reference_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_ledger ENABLE ROW LEVEL SECURITY;

-- No public anonymous table API is required for NJSS operational/master data.
REVOKE ALL ON TABLE
  public.activity_templates,
  public.annual_plan_lines,
  public.approval_limits,
  public.budget_consolidations,
  public.budget_cycles,
  public.budget_divisions,
  public.budget_periods,
  public.budget_release_funding_lines,
  public.budget_workflow_history,
  public.chart_of_accounts,
  public.cost_centres,
  public.divisional_budget_lines,
  public.divisional_budget_submissions,
  public.documents,
  public.expense_categories,
  public.expense_items,
  public.financial_years,
  public.funding_sources,
  public.payee_types,
  public.payment_methods,
  public.priority_levels,
  public.procurement_methods,
  public.projects,
  public.provinces,
  public.rbac_data_scope_types,
  public.role_migration_map_041,
  public.role_migration_map_045,
  public.segregation_rules,
  public.units_of_measure,
  public.urgency_levels,
  public.workflow_statuses,
  public.budget_import_batches,
  public.budget_import_staging,
  public.budget_line_attachments,
  public.budget_monthly_allocations,
  public.budget_division_ceilings,
  public.budget_reference_values,
  public.expense_ledger
FROM anon;

-- -----------------------------------------------------------------------------
-- 2. Remove legacy budget policies that are broad by construction.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS divisional_budget_submissions_read ON public.divisional_budget_submissions;
DROP POLICY IF EXISTS divisional_budget_submissions_insert ON public.divisional_budget_submissions;
DROP POLICY IF EXISTS divisional_budget_submissions_update ON public.divisional_budget_submissions;
DROP POLICY IF EXISTS divisional_budget_submissions_delete ON public.divisional_budget_submissions;
DROP POLICY IF EXISTS divisional_budget_submissions_select_rbac ON public.divisional_budget_submissions;
DROP POLICY IF EXISTS divisional_budget_submissions_insert_rbac ON public.divisional_budget_submissions;
DROP POLICY IF EXISTS divisional_budget_submissions_update_rbac ON public.divisional_budget_submissions;

DROP POLICY IF EXISTS divisional_budget_lines_read ON public.divisional_budget_lines;
DROP POLICY IF EXISTS divisional_budget_lines_insert ON public.divisional_budget_lines;
DROP POLICY IF EXISTS divisional_budget_lines_update ON public.divisional_budget_lines;
DROP POLICY IF EXISTS divisional_budget_lines_delete ON public.divisional_budget_lines;

DROP POLICY IF EXISTS budget_workflow_history_read ON public.budget_workflow_history;
DROP POLICY IF EXISTS budget_workflow_history_insert ON public.budget_workflow_history;

DROP POLICY IF EXISTS budget_cycles_read ON public.budget_cycles;
DROP POLICY IF EXISTS budget_cycles_insert ON public.budget_cycles;
DROP POLICY IF EXISTS budget_cycles_update ON public.budget_cycles;
DROP POLICY IF EXISTS budget_cycles_delete ON public.budget_cycles;

DROP POLICY IF EXISTS budget_divisions_read ON public.budget_divisions;
DROP POLICY IF EXISTS budget_divisions_insert ON public.budget_divisions;
DROP POLICY IF EXISTS budget_divisions_update ON public.budget_divisions;
DROP POLICY IF EXISTS budget_divisions_delete ON public.budget_divisions;

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

-- -----------------------------------------------------------------------------
-- 3. Shared reference/master-data policy pattern.
-- All signed-in staff may read active/reference data needed by dropdowns and
-- reporting. Mutations require explicit administration permissions.
-- -----------------------------------------------------------------------------
DO $reference_policies$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'activity_templates',
    'chart_of_accounts',
    'cost_centres',
    'expense_categories',
    'expense_items',
    'financial_years',
    'funding_sources',
    'payee_types',
    'payment_methods',
    'priority_levels',
    'procurement_methods',
    'projects',
    'provinces',
    'units_of_measure',
    'urgency_levels',
    'workflow_statuses'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'hard10_' || v_table || '_select', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'hard10_' || v_table || '_insert', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'hard10_' || v_table || '_update', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'hard10_' || v_table || '_delete', v_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)',
      'hard10_' || v_table || '_select', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission(''masterdata.manage'') OR public.fn_current_user_has_permission(''registry.manage'') OR public.fn_current_user_has_permission(''settings.manage'') OR public.fn_current_user_has_permission(''all'')))',
      'hard10_' || v_table || '_insert', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission(''masterdata.manage'') OR public.fn_current_user_has_permission(''registry.manage'') OR public.fn_current_user_has_permission(''settings.manage'') OR public.fn_current_user_has_permission(''all''))) WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission(''masterdata.manage'') OR public.fn_current_user_has_permission(''registry.manage'') OR public.fn_current_user_has_permission(''settings.manage'') OR public.fn_current_user_has_permission(''all'')))',
      'hard10_' || v_table || '_update', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission(''masterdata.manage'') OR public.fn_current_user_has_permission(''registry.manage'') OR public.fn_current_user_has_permission(''settings.manage'') OR public.fn_current_user_has_permission(''all'')))',
      'hard10_' || v_table || '_delete', v_table
    );
  END LOOP;
END
$reference_policies$;

-- Expense ledger is reference data but is financially sensitive: readable to
-- signed-in staff, writable only to master-data/registry administrators.
DROP POLICY IF EXISTS hard10_expense_ledger_select ON public.expense_ledger;
DROP POLICY IF EXISTS hard10_expense_ledger_insert ON public.expense_ledger;
DROP POLICY IF EXISTS hard10_expense_ledger_update ON public.expense_ledger;
DROP POLICY IF EXISTS hard10_expense_ledger_delete ON public.expense_ledger;
CREATE POLICY hard10_expense_ledger_select ON public.expense_ledger
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);
CREATE POLICY hard10_expense_ledger_insert ON public.expense_ledger
FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('registry.manage') OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_expense_ledger_update ON public.expense_ledger
FOR UPDATE TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('registry.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('registry.manage') OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_expense_ledger_delete ON public.expense_ledger
FOR DELETE TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('registry.manage') OR public.fn_current_user_has_permission('all')));

-- -----------------------------------------------------------------------------
-- 4. Security/control tables are not ordinary dropdown data.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS hard10_approval_limits_admin ON public.approval_limits;
CREATE POLICY hard10_approval_limits_admin ON public.approval_limits
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('permissions.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('permissions.manage') OR public.fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS hard10_rbac_scope_types_admin ON public.rbac_data_scope_types;
CREATE POLICY hard10_rbac_scope_types_admin ON public.rbac_data_scope_types
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('data_scope.manage') OR public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('data_scope.manage') OR public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS hard10_segregation_rules_admin ON public.segregation_rules;
CREATE POLICY hard10_segregation_rules_admin ON public.segregation_rules
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('permissions.manage') OR public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('permissions.manage') OR public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('all')));

-- Historical migration maps are evidence, not live editable master data.
DROP POLICY IF EXISTS hard10_role_migration_041_read ON public.role_migration_map_041;
DROP POLICY IF EXISTS hard10_role_migration_045_read ON public.role_migration_map_045;
CREATE POLICY hard10_role_migration_041_read ON public.role_migration_map_041
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('audit.view') OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_role_migration_045_read ON public.role_migration_map_045
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('audit.view') OR public.fn_current_user_has_permission('all')));

-- -----------------------------------------------------------------------------
-- 5. Budget-cycle structure/reference data.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS hard10_budget_cycles_select ON public.budget_cycles;
DROP POLICY IF EXISTS hard10_budget_cycles_manage ON public.budget_cycles;
CREATE POLICY hard10_budget_cycles_select ON public.budget_cycles
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.module.view') OR public.fn_current_user_has_permission('budget.view') OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_budget_cycles_manage ON public.budget_cycles
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS hard10_budget_divisions_select ON public.budget_divisions;
DROP POLICY IF EXISTS hard10_budget_divisions_manage ON public.budget_divisions;
CREATE POLICY hard10_budget_divisions_select ON public.budget_divisions
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.module.view') OR public.fn_current_user_has_permission('budget.view') OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_budget_divisions_manage ON public.budget_divisions
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS hard10_budget_periods_select ON public.budget_periods;
DROP POLICY IF EXISTS hard10_budget_periods_manage ON public.budget_periods;
CREATE POLICY hard10_budget_periods_select ON public.budget_periods
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.module.view') OR public.fn_current_user_has_permission('budget.view') OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_budget_periods_manage ON public.budget_periods
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS hard10_budget_division_ceilings_select ON public.budget_division_ceilings;
DROP POLICY IF EXISTS hard10_budget_division_ceilings_manage ON public.budget_division_ceilings;
CREATE POLICY hard10_budget_division_ceilings_select ON public.budget_division_ceilings
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.module.view') OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_budget_division_ceilings_manage ON public.budget_division_ceilings
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS hard10_budget_reference_values_select ON public.budget_reference_values;
DROP POLICY IF EXISTS hard10_budget_reference_values_manage ON public.budget_reference_values;
CREATE POLICY hard10_budget_reference_values_select ON public.budget_reference_values
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.module.view') OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_budget_reference_values_manage ON public.budget_reference_values
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('all')));

-- -----------------------------------------------------------------------------
-- 6. Divisional budget submissions — permission + organisational scope.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS hard10_budget_submissions_select ON public.divisional_budget_submissions;
DROP POLICY IF EXISTS hard10_budget_submissions_insert ON public.divisional_budget_submissions;
DROP POLICY IF EXISTS hard10_budget_submissions_update ON public.divisional_budget_submissions;
DROP POLICY IF EXISTS hard10_budget_submissions_delete ON public.divisional_budget_submissions;

CREATE POLICY hard10_budget_submissions_select ON public.divisional_budget_submissions
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('budget.template.view')
    OR public.fn_current_user_has_permission('budget.template')
    OR public.fn_current_user_has_permission('budget.module.view')
    OR public.fn_current_user_has_permission('budget.view')
    OR public.fn_current_user_has_permission('all')
  )
  AND public.fn_current_user_data_scope_allows(
    department_id,
    (SELECT bd.section_id FROM public.budget_divisions bd WHERE bd.id = division_id),
    submitted_by,
    NULL,
    NULL
  )
);

CREATE POLICY hard10_budget_submissions_insert ON public.divisional_budget_submissions
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('budget.template.create')
    OR public.fn_current_user_has_permission('budget.template.submit')
    OR public.fn_current_user_has_permission('budget.module.submit')
    OR public.fn_current_user_has_permission('all')
  )
  AND public.fn_current_user_data_scope_allows(
    department_id,
    (SELECT bd.section_id FROM public.budget_divisions bd WHERE bd.id = division_id),
    submitted_by,
    NULL,
    NULL
  )
);

CREATE POLICY hard10_budget_submissions_update ON public.divisional_budget_submissions
FOR UPDATE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('budget.template.edit')
    OR public.fn_current_user_has_permission('budget.template.submit')
    OR public.fn_current_user_has_permission('budget.template.review')
    OR public.fn_current_user_has_permission('budget.template.approve')
    OR public.fn_current_user_has_permission('budget.module.review')
    OR public.fn_current_user_has_permission('budget.module.approve')
    OR public.fn_current_user_has_permission('all')
  )
  AND public.fn_current_user_data_scope_allows(
    department_id,
    (SELECT bd.section_id FROM public.budget_divisions bd WHERE bd.id = division_id),
    submitted_by,
    NULL,
    NULL
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('budget.template.edit')
    OR public.fn_current_user_has_permission('budget.template.submit')
    OR public.fn_current_user_has_permission('budget.template.review')
    OR public.fn_current_user_has_permission('budget.template.approve')
    OR public.fn_current_user_has_permission('budget.module.review')
    OR public.fn_current_user_has_permission('budget.module.approve')
    OR public.fn_current_user_has_permission('all')
  )
  AND public.fn_current_user_data_scope_allows(
    department_id,
    (SELECT bd.section_id FROM public.budget_divisions bd WHERE bd.id = division_id),
    submitted_by,
    NULL,
    NULL
  )
);

CREATE POLICY hard10_budget_submissions_delete ON public.divisional_budget_submissions
FOR DELETE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND status IN ('DRAFT', 'RETURNED')
  AND (
    public.fn_current_user_has_permission('budget.template.edit')
    OR public.fn_current_user_has_permission('budget.module.admin')
    OR public.fn_current_user_has_permission('all')
  )
  AND public.fn_current_user_data_scope_allows(
    department_id,
    (SELECT bd.section_id FROM public.budget_divisions bd WHERE bd.id = division_id),
    submitted_by,
    NULL,
    NULL
  )
);

-- -----------------------------------------------------------------------------
-- 7. Divisional budget lines and child records inherit parent scope.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS hard10_budget_lines_select ON public.divisional_budget_lines;
DROP POLICY IF EXISTS hard10_budget_lines_insert ON public.divisional_budget_lines;
DROP POLICY IF EXISTS hard10_budget_lines_update ON public.divisional_budget_lines;
DROP POLICY IF EXISTS hard10_budget_lines_delete ON public.divisional_budget_lines;

CREATE POLICY hard10_budget_lines_select ON public.divisional_budget_lines
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('budget.template.view')
    OR public.fn_current_user_has_permission('budget.template')
    OR public.fn_current_user_has_permission('budget.module.view')
    OR public.fn_current_user_has_permission('budget.view')
    OR public.fn_current_user_has_permission('all')
  )
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = submission_id
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);

CREATE POLICY hard10_budget_lines_insert ON public.divisional_budget_lines
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('budget.template.create')
    OR public.fn_current_user_has_permission('budget.template.edit')
    OR public.fn_current_user_has_permission('all')
  )
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = submission_id
      AND s.status IN ('DRAFT', 'RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);

CREATE POLICY hard10_budget_lines_update ON public.divisional_budget_lines
FOR UPDATE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = submission_id
      AND s.status IN ('DRAFT', 'RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = submission_id
      AND s.status IN ('DRAFT', 'RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);

CREATE POLICY hard10_budget_lines_delete ON public.divisional_budget_lines
FOR DELETE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = submission_id
      AND s.status IN ('DRAFT', 'RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);

-- Monthly profile rows follow their line/submission scope.
DROP POLICY IF EXISTS hard10_budget_monthly_select ON public.budget_monthly_allocations;
DROP POLICY IF EXISTS hard10_budget_monthly_insert ON public.budget_monthly_allocations;
DROP POLICY IF EXISTS hard10_budget_monthly_update ON public.budget_monthly_allocations;
DROP POLICY IF EXISTS hard10_budget_monthly_delete ON public.budget_monthly_allocations;
CREATE POLICY hard10_budget_monthly_select ON public.budget_monthly_allocations
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.template') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.divisional_budget_lines l
    JOIN public.divisional_budget_submissions s ON s.id = l.submission_id
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE l.id = budget_line_id
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);
CREATE POLICY hard10_budget_monthly_insert ON public.budget_monthly_allocations
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.divisional_budget_lines l
    JOIN public.divisional_budget_submissions s ON s.id = l.submission_id
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE l.id = budget_line_id
      AND s.status IN ('DRAFT', 'RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);
CREATE POLICY hard10_budget_monthly_update ON public.budget_monthly_allocations
FOR UPDATE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.divisional_budget_lines l
    JOIN public.divisional_budget_submissions s ON s.id = l.submission_id
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE l.id = budget_line_id
      AND s.status IN ('DRAFT', 'RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.divisional_budget_lines l
    JOIN public.divisional_budget_submissions s ON s.id = l.submission_id
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE l.id = budget_line_id
      AND s.status IN ('DRAFT', 'RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);
CREATE POLICY hard10_budget_monthly_delete ON public.budget_monthly_allocations
FOR DELETE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.divisional_budget_lines l
    JOIN public.divisional_budget_submissions s ON s.id = l.submission_id
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE l.id = budget_line_id
      AND s.status IN ('DRAFT', 'RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);

-- Budget-line attachments follow submission scope and draft edit permissions.
DROP POLICY IF EXISTS hard10_budget_attachments_select ON public.budget_line_attachments;
DROP POLICY IF EXISTS hard10_budget_attachments_insert ON public.budget_line_attachments;
DROP POLICY IF EXISTS hard10_budget_attachments_update ON public.budget_line_attachments;
DROP POLICY IF EXISTS hard10_budget_attachments_delete ON public.budget_line_attachments;
CREATE POLICY hard10_budget_attachments_select ON public.budget_line_attachments
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.template') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = submission_id
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);
CREATE POLICY hard10_budget_attachments_insert ON public.budget_line_attachments
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = submission_id
      AND s.status IN ('DRAFT', 'RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);
CREATE POLICY hard10_budget_attachments_update ON public.budget_line_attachments
FOR UPDATE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = submission_id
      AND s.status IN ('DRAFT', 'RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = submission_id
      AND s.status IN ('DRAFT', 'RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);
CREATE POLICY hard10_budget_attachments_delete ON public.budget_line_attachments
FOR DELETE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = submission_id
      AND s.status IN ('DRAFT', 'RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);

-- Import batches/staging are preparation tooling, never anonymous and never
-- globally writable merely because a user is signed in.
DROP POLICY IF EXISTS hard10_import_batches_select ON public.budget_import_batches;
DROP POLICY IF EXISTS hard10_import_batches_mutate ON public.budget_import_batches;
CREATE POLICY hard10_import_batches_select ON public.budget_import_batches
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.budget_divisions bd
    WHERE bd.id = division_id
      AND public.fn_current_user_data_scope_allows(bd.department_id, bd.section_id, NULL, NULL, NULL)
  )
);
CREATE POLICY hard10_import_batches_mutate ON public.budget_import_batches
FOR ALL TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.budget_divisions bd
    WHERE bd.id = division_id
      AND public.fn_current_user_data_scope_allows(bd.department_id, bd.section_id, NULL, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.budget_divisions bd
    WHERE bd.id = division_id
      AND public.fn_current_user_data_scope_allows(bd.department_id, bd.section_id, NULL, NULL, NULL)
  )
);

DROP POLICY IF EXISTS hard10_import_staging_select ON public.budget_import_staging;
DROP POLICY IF EXISTS hard10_import_staging_mutate ON public.budget_import_staging;
CREATE POLICY hard10_import_staging_select ON public.budget_import_staging
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.budget_import_batches b
    JOIN public.budget_divisions bd ON bd.id = b.division_id
    WHERE b.id = batch_id
      AND public.fn_current_user_data_scope_allows(bd.department_id, bd.section_id, NULL, NULL, NULL)
  )
);
CREATE POLICY hard10_import_staging_mutate ON public.budget_import_staging
FOR ALL TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.budget_import_batches b
    JOIN public.budget_divisions bd ON bd.id = b.division_id
    WHERE b.id = batch_id
      AND public.fn_current_user_data_scope_allows(bd.department_id, bd.section_id, NULL, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.budget_import_batches b
    JOIN public.budget_divisions bd ON bd.id = b.division_id
    WHERE b.id = batch_id
      AND public.fn_current_user_data_scope_allows(bd.department_id, bd.section_id, NULL, NULL, NULL)
  )
);

-- Workflow history is immutable to direct clients; controlled SECURITY DEFINER
-- workflow functions write it. Authenticated readers must have permission/scope.
DROP POLICY IF EXISTS hard10_budget_history_select ON public.budget_workflow_history;
CREATE POLICY hard10_budget_history_select ON public.budget_workflow_history
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.template.review') OR public.fn_current_user_has_permission('budget.template.approve') OR public.fn_current_user_has_permission('audit.view') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = submission_id
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, s.submitted_by, NULL, NULL)
  )
);

-- -----------------------------------------------------------------------------
-- 8. Historical annual-plan lines — module is inactive but data remains protected.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS hard10_annual_plan_lines_select ON public.annual_plan_lines;
DROP POLICY IF EXISTS hard10_annual_plan_lines_insert ON public.annual_plan_lines;
DROP POLICY IF EXISTS hard10_annual_plan_lines_update ON public.annual_plan_lines;
DROP POLICY IF EXISTS hard10_annual_plan_lines_delete ON public.annual_plan_lines;
CREATE POLICY hard10_annual_plan_lines_select ON public.annual_plan_lines
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('plans.create') OR public.fn_current_user_has_permission('plans.submit')
    OR public.fn_current_user_has_permission('plans.review') OR public.fn_current_user_has_permission('plans.approve')
    OR public.fn_current_user_has_permission('plans.authorize') OR public.fn_current_user_has_permission('plans.confirm')
    OR public.fn_current_user_has_permission('all')
  )
  AND EXISTS (
    SELECT 1 FROM public.annual_plan_headers h
    WHERE h.id = plan_header_id
      AND public.fn_current_user_data_scope_allows(h.department_id, h.section_id, h.created_by, NULL, NULL)
  )
);
CREATE POLICY hard10_annual_plan_lines_insert ON public.annual_plan_lines
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('plans.create') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.annual_plan_headers h
    WHERE h.id = plan_header_id
      AND public.fn_current_user_data_scope_allows(h.department_id, h.section_id, h.created_by, NULL, NULL)
  )
);
CREATE POLICY hard10_annual_plan_lines_update ON public.annual_plan_lines
FOR UPDATE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('plans.create') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.annual_plan_headers h
    WHERE h.id = plan_header_id
      AND public.fn_current_user_data_scope_allows(h.department_id, h.section_id, h.created_by, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('plans.create') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.annual_plan_headers h
    WHERE h.id = plan_header_id
      AND public.fn_current_user_data_scope_allows(h.department_id, h.section_id, h.created_by, NULL, NULL)
  )
);
CREATE POLICY hard10_annual_plan_lines_delete ON public.annual_plan_lines
FOR DELETE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('plans.create') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.annual_plan_headers h
    WHERE h.id = plan_header_id
      AND public.fn_current_user_data_scope_allows(h.department_id, h.section_id, h.created_by, NULL, NULL)
  )
);

-- -----------------------------------------------------------------------------
-- 9. Consolidation/release financial rows.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS hard10_budget_consolidations_select ON public.budget_consolidations;
CREATE POLICY hard10_budget_consolidations_select ON public.budget_consolidations
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('budget.consolidate')
    OR public.fn_current_user_has_permission('budget.report.view')
    OR public.fn_current_user_has_permission('budget.module.view')
    OR public.fn_current_user_has_permission('all')
  )
  AND public.fn_current_user_data_scope_allows(department_id, NULL, consolidated_by, NULL, NULL)
);
-- No direct INSERT/UPDATE/DELETE policy: consolidation is through the guarded RPC.

DROP POLICY IF EXISTS hard10_release_funding_select ON public.budget_release_funding_lines;
DROP POLICY IF EXISTS hard10_release_funding_insert ON public.budget_release_funding_lines;
DROP POLICY IF EXISTS hard10_release_funding_update ON public.budget_release_funding_lines;
DROP POLICY IF EXISTS hard10_release_funding_delete ON public.budget_release_funding_lines;
CREATE POLICY hard10_release_funding_select ON public.budget_release_funding_lines
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('funding.view') OR public.fn_current_user_has_permission('budget.view') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.quarterly_releases qr
    JOIN public.budget_allocations ba ON ba.id = qr.budget_allocation_id
    WHERE qr.id = quarterly_release_id
      AND public.fn_current_user_data_scope_allows(ba.department_id, ba.section_id, created_by, NULL, NULL)
  )
);
CREATE POLICY hard10_release_funding_insert ON public.budget_release_funding_lines
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('funding.allocate') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.quarterly_releases qr
    JOIN public.budget_allocations ba ON ba.id = qr.budget_allocation_id
    WHERE qr.id = quarterly_release_id
      AND public.fn_current_user_data_scope_allows(ba.department_id, ba.section_id, created_by, NULL, NULL)
  )
);
CREATE POLICY hard10_release_funding_update ON public.budget_release_funding_lines
FOR UPDATE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('funding.allocate') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.quarterly_releases qr
    JOIN public.budget_allocations ba ON ba.id = qr.budget_allocation_id
    WHERE qr.id = quarterly_release_id
      AND public.fn_current_user_data_scope_allows(ba.department_id, ba.section_id, created_by, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('funding.allocate') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.quarterly_releases qr
    JOIN public.budget_allocations ba ON ba.id = qr.budget_allocation_id
    WHERE qr.id = quarterly_release_id
      AND public.fn_current_user_data_scope_allows(ba.department_id, ba.section_id, created_by, NULL, NULL)
  )
);
CREATE POLICY hard10_release_funding_delete ON public.budget_release_funding_lines
FOR DELETE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('funding.allocate') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.quarterly_releases qr
    JOIN public.budget_allocations ba ON ba.id = qr.budget_allocation_id
    WHERE qr.id = quarterly_release_id
      AND public.fn_current_user_data_scope_allows(ba.department_id, ba.section_id, created_by, NULL, NULL)
  )
);

-- -----------------------------------------------------------------------------
-- 10. Generic documents: fail closed until HARD-37 adds module-specific sharing.
-- The live HARD-10 baseline contained zero document rows. Owners may manage their
-- own future rows; System Administrator retains full visibility.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS hard10_documents_select ON public.documents;
DROP POLICY IF EXISTS hard10_documents_insert ON public.documents;
DROP POLICY IF EXISTS hard10_documents_update ON public.documents;
DROP POLICY IF EXISTS hard10_documents_delete ON public.documents;
CREATE POLICY hard10_documents_select ON public.documents
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (uploaded_by = public.fn_current_app_user_id() OR public.fn_current_user_has_permission('all'))
);
CREATE POLICY hard10_documents_insert ON public.documents
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (uploaded_by = public.fn_current_app_user_id() OR public.fn_current_user_has_permission('all'))
);
CREATE POLICY hard10_documents_update ON public.documents
FOR UPDATE TO authenticated
USING (auth.uid() IS NOT NULL AND (uploaded_by = public.fn_current_app_user_id() OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (uploaded_by = public.fn_current_app_user_id() OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_documents_delete ON public.documents
FOR DELETE TO authenticated
USING (auth.uid() IS NOT NULL AND (uploaded_by = public.fn_current_app_user_id() OR public.fn_current_user_has_permission('all')));

-- -----------------------------------------------------------------------------
-- 11. Post-migration invariants: fail the migration if any confirmed table is
-- still outside RLS or if the principal unsafe legacy policies survived.
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE
  v_table text;
  v_rls boolean;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'activity_templates','annual_plan_lines','approval_limits','budget_consolidations','budget_cycles',
    'budget_divisions','budget_periods','budget_release_funding_lines','budget_workflow_history',
    'chart_of_accounts','cost_centres','divisional_budget_lines','documents','expense_categories',
    'expense_items','financial_years','funding_sources','payee_types','payment_methods','priority_levels',
    'procurement_methods','projects','provinces','rbac_data_scope_types','role_migration_map_041',
    'role_migration_map_045','segregation_rules','units_of_measure','urgency_levels','workflow_statuses'
  ]
  LOOP
    SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_table AND c.relkind = 'r';

    IF COALESCE(v_rls, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'HARD-10 failed: RLS not enabled for public.%', v_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname IN (
        'divisional_budget_submissions_read','divisional_budget_submissions_insert','divisional_budget_submissions_update','divisional_budget_submissions_delete',
        'divisional_budget_lines_read','divisional_budget_lines_insert','divisional_budget_lines_update','divisional_budget_lines_delete',
        'budget_workflow_history_read','budget_workflow_history_insert'
      )
  ) THEN
    RAISE EXCEPTION 'HARD-10 failed: unsafe legacy budget policy still exists';
  END IF;
END
$verify$;
