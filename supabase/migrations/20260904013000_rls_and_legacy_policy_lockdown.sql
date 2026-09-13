-- =============================================================================
-- NJSS HARD-10 — RLS AND LEGACY POLICY LOCKDOWN
-- Additive migration. DO NOT apply to production without explicit approval.
-- =============================================================================

-- 1. Enable RLS on every table confirmed disabled by the live HARD-10 baseline.
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

-- The parent budget submission table already had RLS enabled, but unsafe legacy
-- policies on it can OR with newer RBAC policies. Keep it explicitly enabled.
ALTER TABLE public.divisional_budget_submissions ENABLE ROW LEVEL SECURITY;

-- No anonymous operational/master-data API is required.
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
  public.workflow_statuses
FROM anon;

-- The RLS scope predicate is needed by authenticated policies, never anonymous.
REVOKE EXECUTE ON FUNCTION public.fn_current_user_data_scope_allows(uuid, uuid, uuid, uuid, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_current_user_data_scope_allows(uuid, uuid, uuid, uuid, uuid)
TO authenticated;

-- 2. Remove the confirmed permissive legacy policies.
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

-- 3. Ordinary master/reference data: authenticated read; admin-only mutation.
DO $reference_policy$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'activity_templates','chart_of_accounts','cost_centres','expense_categories',
    'expense_items','financial_years','funding_sources','payee_types','payment_methods',
    'priority_levels','procurement_methods','projects','provinces','units_of_measure',
    'urgency_levels','workflow_statuses'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'hard10_' || v_table || '_read', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'hard10_' || v_table || '_write', v_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)',
      'hard10_' || v_table || '_read', v_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission(''masterdata.manage'') OR public.fn_current_user_has_permission(''registry.manage'') OR public.fn_current_user_has_permission(''settings.manage'') OR public.fn_current_user_has_permission(''all''))) WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission(''masterdata.manage'') OR public.fn_current_user_has_permission(''registry.manage'') OR public.fn_current_user_has_permission(''settings.manage'') OR public.fn_current_user_has_permission(''all'')))',
      'hard10_' || v_table || '_write', v_table
    );
  END LOOP;
END
$reference_policy$;

-- 4. Security/control metadata is administration-only.
DROP POLICY IF EXISTS hard10_approval_limits_admin ON public.approval_limits;
CREATE POLICY hard10_approval_limits_admin ON public.approval_limits
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('permissions.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('permissions.manage') OR public.fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS hard10_scope_types_admin ON public.rbac_data_scope_types;
CREATE POLICY hard10_scope_types_admin ON public.rbac_data_scope_types
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('data_scope.manage') OR public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('data_scope.manage') OR public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS hard10_segregation_rules_admin ON public.segregation_rules;
CREATE POLICY hard10_segregation_rules_admin ON public.segregation_rules
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('permissions.manage') OR public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('permissions.manage') OR public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('all')));

-- Migration maps are historical evidence: readable by access/audit admins only,
-- with no direct mutation policy for authenticated callers.
DROP POLICY IF EXISTS hard10_role_map_041_read ON public.role_migration_map_041;
DROP POLICY IF EXISTS hard10_role_map_045_read ON public.role_migration_map_045;
CREATE POLICY hard10_role_map_041_read ON public.role_migration_map_041
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('audit.view') OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_role_map_045_read ON public.role_migration_map_045
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('roles.manage') OR public.fn_current_user_has_permission('audit.view') OR public.fn_current_user_has_permission('all')));

-- 5. Budget cycle/division/period structure.
DROP POLICY IF EXISTS hard10_budget_cycles_read ON public.budget_cycles;
DROP POLICY IF EXISTS hard10_budget_cycles_write ON public.budget_cycles;
CREATE POLICY hard10_budget_cycles_read ON public.budget_cycles
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('budget.module.view') OR public.fn_current_user_has_permission('budget.view') OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_budget_cycles_write ON public.budget_cycles
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS hard10_budget_divisions_read ON public.budget_divisions;
DROP POLICY IF EXISTS hard10_budget_divisions_write ON public.budget_divisions;
CREATE POLICY hard10_budget_divisions_read ON public.budget_divisions
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.template.create') OR public.fn_current_user_has_permission('budget.template.edit') OR public.fn_current_user_has_permission('budget.module.view') OR public.fn_current_user_has_permission('budget.view') OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_budget_divisions_write ON public.budget_divisions
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('masterdata.manage') OR public.fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS hard10_budget_periods_read ON public.budget_periods;
DROP POLICY IF EXISTS hard10_budget_periods_write ON public.budget_periods;
CREATE POLICY hard10_budget_periods_read ON public.budget_periods
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.template.view') OR public.fn_current_user_has_permission('budget.module.view') OR public.fn_current_user_has_permission('budget.view') OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_budget_periods_write ON public.budget_periods
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (public.fn_current_user_has_permission('budget.module.admin') OR public.fn_current_user_has_permission('all')));

-- 6. Divisional budget submissions: organisational scope is authoritative for
-- direct table access. submitted_by is historical/workflow actor data and is
-- deliberately NOT passed to fn_current_user_data_scope_allows(), because its
-- generic ownership shortcut would otherwise permit cross-section access.
DROP POLICY IF EXISTS hard10_budget_submission_read ON public.divisional_budget_submissions;
DROP POLICY IF EXISTS hard10_budget_submission_write ON public.divisional_budget_submissions;
DROP POLICY IF EXISTS hard10_budget_submission_insert ON public.divisional_budget_submissions;
DROP POLICY IF EXISTS hard10_budget_submission_update ON public.divisional_budget_submissions;
DROP POLICY IF EXISTS hard10_budget_submission_delete ON public.divisional_budget_submissions;

CREATE POLICY hard10_budget_submission_read ON public.divisional_budget_submissions
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
    NULL,
    NULL,
    NULL
  )
);

-- Creation is a preparation function, not a workflow-decision function.
CREATE POLICY hard10_budget_submission_insert ON public.divisional_budget_submissions
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND status = 'DRAFT'
  AND (
    public.fn_current_user_has_permission('budget.template.create')
    OR public.fn_current_user_has_permission('all')
  )
  AND public.fn_current_user_data_scope_allows(
    department_id,
    (SELECT bd.section_id FROM public.budget_divisions bd WHERE bd.id = division_id),
    NULL,
    NULL,
    NULL
  )
);

-- Direct editing is limited to editable preparation states. Submit/resubmit,
-- return, review and approval remain guarded SECURITY DEFINER RPC actions.
CREATE POLICY hard10_budget_submission_update ON public.divisional_budget_submissions
FOR UPDATE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND status IN ('DRAFT','RETURNED')
  AND (
    public.fn_current_user_has_permission('budget.template.edit')
    OR public.fn_current_user_has_permission('all')
  )
  AND public.fn_current_user_data_scope_allows(
    department_id,
    (SELECT bd.section_id FROM public.budget_divisions bd WHERE bd.id = division_id),
    NULL,
    NULL,
    NULL
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND status IN ('DRAFT','RETURNED')
  AND (
    public.fn_current_user_has_permission('budget.template.edit')
    OR public.fn_current_user_has_permission('all')
  )
  AND public.fn_current_user_data_scope_allows(
    department_id,
    (SELECT bd.section_id FROM public.budget_divisions bd WHERE bd.id = division_id),
    NULL,
    NULL,
    NULL
  )
);

CREATE POLICY hard10_budget_submission_delete ON public.divisional_budget_submissions
FOR DELETE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND status IN ('DRAFT','RETURNED')
  AND (
    public.fn_current_user_has_permission('budget.template.edit')
    OR public.fn_current_user_has_permission('all')
  )
  AND public.fn_current_user_data_scope_allows(
    department_id,
    (SELECT bd.section_id FROM public.budget_divisions bd WHERE bd.id = division_id),
    NULL,
    NULL,
    NULL
  )
);

-- Direct callers may never re-parent or rewrite workflow/organisational identity.
-- Controlled workflow/revision routines set transaction-local context before
-- performing their legitimate system-owned changes.
CREATE OR REPLACE FUNCTION public.njss_hard10_guard_budget_submission_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(current_setting('njss.budget_workflow', true), '') = 'on'
     OR COALESCE(current_setting('njss.budget_revision_create', true), '') = 'on'
     OR COALESCE(current_setting('njss.budget_recalc', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.division_id IS DISTINCT FROM OLD.division_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.cycle_id IS DISTINCT FROM OLD.cycle_id
     OR NEW.budget_year IS DISTINCT FROM OLD.budget_year
     OR NEW.parent_submission_id IS DISTINCT FROM OLD.parent_submission_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.superseded_by_id IS DISTINCT FROM OLD.superseded_by_id
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by THEN
    RAISE EXCEPTION 'Budget submission organisational/workflow identity cannot be changed directly; use the controlled workflow or revision process.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_hard10_budget_submission_identity ON public.divisional_budget_submissions;
CREATE TRIGGER trg_hard10_budget_submission_identity
BEFORE UPDATE ON public.divisional_budget_submissions
FOR EACH ROW EXECUTE FUNCTION public.njss_hard10_guard_budget_submission_identity();

-- 7. Divisional budget lines inherit parent permission, state and organisational
-- scope. Review/approval authority does not imply direct line mutation authority.
DROP POLICY IF EXISTS hard10_budget_line_read ON public.divisional_budget_lines;
DROP POLICY IF EXISTS hard10_budget_line_write ON public.divisional_budget_lines;
DROP POLICY IF EXISTS hard10_budget_line_insert ON public.divisional_budget_lines;
DROP POLICY IF EXISTS hard10_budget_line_update ON public.divisional_budget_lines;
DROP POLICY IF EXISTS hard10_budget_line_delete ON public.divisional_budget_lines;

CREATE POLICY hard10_budget_line_read ON public.divisional_budget_lines
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
    WHERE s.id = public.divisional_budget_lines.submission_id
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, NULL, NULL, NULL)
  )
);

CREATE POLICY hard10_budget_line_insert ON public.divisional_budget_lines
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
    WHERE s.id = public.divisional_budget_lines.submission_id
      AND s.status IN ('DRAFT','RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, NULL, NULL, NULL)
  )
);

CREATE POLICY hard10_budget_line_update ON public.divisional_budget_lines
FOR UPDATE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('budget.template.edit')
    OR public.fn_current_user_has_permission('all')
  )
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = public.divisional_budget_lines.submission_id
      AND s.status IN ('DRAFT','RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, NULL, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('budget.template.edit')
    OR public.fn_current_user_has_permission('all')
  )
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = public.divisional_budget_lines.submission_id
      AND s.status IN ('DRAFT','RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, NULL, NULL, NULL)
  )
);

CREATE POLICY hard10_budget_line_delete ON public.divisional_budget_lines
FOR DELETE TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('budget.template.edit')
    OR public.fn_current_user_has_permission('all')
  )
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = public.divisional_budget_lines.submission_id
      AND s.status IN ('DRAFT','RETURNED')
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, NULL, NULL, NULL)
  )
);

CREATE OR REPLACE FUNCTION public.njss_hard10_guard_budget_line_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(current_setting('njss.budget_workflow', true), '') = 'on'
     OR COALESCE(current_setting('njss.budget_revision_create', true), '') = 'on'
     OR COALESCE(current_setting('njss.budget_recalc', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.submission_id IS DISTINCT FROM OLD.submission_id THEN
    RAISE EXCEPTION 'Budget lines cannot be moved between submissions directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_hard10_budget_line_parent ON public.divisional_budget_lines;
CREATE TRIGGER trg_hard10_budget_line_parent
BEFORE UPDATE ON public.divisional_budget_lines
FOR EACH ROW EXECUTE FUNCTION public.njss_hard10_guard_budget_line_parent();

-- Monthly allocation identity is also immutable through direct update. The
-- ancillary HARD-10 migration applies its scoped read/write policies.
CREATE OR REPLACE FUNCTION public.njss_hard10_guard_monthly_allocation_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(current_setting('njss.budget_workflow', true), '') = 'on'
     OR COALESCE(current_setting('njss.budget_revision_create', true), '') = 'on'
     OR COALESCE(current_setting('njss.budget_recalc', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.budget_line_id IS DISTINCT FROM OLD.budget_line_id THEN
    RAISE EXCEPTION 'Monthly allocations cannot be moved between budget lines directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_hard10_monthly_allocation_parent ON public.budget_monthly_allocations;
CREATE TRIGGER trg_hard10_monthly_allocation_parent
BEFORE UPDATE ON public.budget_monthly_allocations
FOR EACH ROW EXECUTE FUNCTION public.njss_hard10_guard_monthly_allocation_parent();

-- Workflow history is read-only to direct callers; SECURITY DEFINER workflow
-- functions remain responsible for inserts.
DROP POLICY IF EXISTS hard10_budget_history_read ON public.budget_workflow_history;
CREATE POLICY hard10_budget_history_read ON public.budget_workflow_history
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    public.fn_current_user_has_permission('budget.template.view')
    OR public.fn_current_user_has_permission('budget.template.review')
    OR public.fn_current_user_has_permission('budget.template.approve')
    OR public.fn_current_user_has_permission('audit.view')
    OR public.fn_current_user_has_permission('all')
  )
  AND EXISTS (
    SELECT 1
    FROM public.divisional_budget_submissions s
    LEFT JOIN public.budget_divisions bd ON bd.id = s.division_id
    WHERE s.id = public.budget_workflow_history.submission_id
      AND public.fn_current_user_data_scope_allows(s.department_id, bd.section_id, NULL, NULL, NULL)
  )
);

-- 8. Historical annual-plan lines retain scoped access even though the UI module
-- is inactive.
DROP POLICY IF EXISTS hard10_annual_plan_line_read ON public.annual_plan_lines;
DROP POLICY IF EXISTS hard10_annual_plan_line_write ON public.annual_plan_lines;
CREATE POLICY hard10_annual_plan_line_read ON public.annual_plan_lines
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('plans.create') OR public.fn_current_user_has_permission('plans.submit') OR public.fn_current_user_has_permission('plans.review') OR public.fn_current_user_has_permission('plans.approve') OR public.fn_current_user_has_permission('plans.authorize') OR public.fn_current_user_has_permission('plans.confirm') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.annual_plan_headers h
    WHERE h.id = public.annual_plan_lines.plan_header_id
      AND public.fn_current_user_data_scope_allows(h.department_id, h.section_id, h.created_by, NULL, NULL)
  )
);
CREATE POLICY hard10_annual_plan_line_write ON public.annual_plan_lines
FOR ALL TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('plans.create') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.annual_plan_headers h
    WHERE h.id = public.annual_plan_lines.plan_header_id
      AND public.fn_current_user_data_scope_allows(h.department_id, h.section_id, h.created_by, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('plans.create') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1 FROM public.annual_plan_headers h
    WHERE h.id = public.annual_plan_lines.plan_header_id
      AND public.fn_current_user_data_scope_allows(h.department_id, h.section_id, h.created_by, NULL, NULL)
  )
);

-- 9. Financial consolidation/release bridge rows.
DROP POLICY IF EXISTS hard10_budget_consolidation_read ON public.budget_consolidations;
CREATE POLICY hard10_budget_consolidation_read ON public.budget_consolidations
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('budget.consolidate') OR public.fn_current_user_has_permission('budget.report.view') OR public.fn_current_user_has_permission('budget.module.view') OR public.fn_current_user_has_permission('all'))
  AND public.fn_current_user_data_scope_allows(department_id, NULL, consolidated_by, NULL, NULL)
);
-- Direct writes are denied; the guarded consolidation RPC performs controlled writes.

DROP POLICY IF EXISTS hard10_release_funding_read ON public.budget_release_funding_lines;
DROP POLICY IF EXISTS hard10_release_funding_write ON public.budget_release_funding_lines;
CREATE POLICY hard10_release_funding_read ON public.budget_release_funding_lines
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('funding.view') OR public.fn_current_user_has_permission('budget.view') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.quarterly_releases qr
    JOIN public.budget_allocations ba ON ba.id = qr.budget_allocation_id
    WHERE qr.id = public.budget_release_funding_lines.quarterly_release_id
      AND public.fn_current_user_data_scope_allows(ba.department_id, ba.section_id, public.budget_release_funding_lines.created_by, NULL, NULL)
  )
);
CREATE POLICY hard10_release_funding_write ON public.budget_release_funding_lines
FOR ALL TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('funding.allocate') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.quarterly_releases qr
    JOIN public.budget_allocations ba ON ba.id = qr.budget_allocation_id
    WHERE qr.id = public.budget_release_funding_lines.quarterly_release_id
      AND public.fn_current_user_data_scope_allows(ba.department_id, ba.section_id, public.budget_release_funding_lines.created_by, NULL, NULL)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (public.fn_current_user_has_permission('funding.allocate') OR public.fn_current_user_has_permission('all'))
  AND EXISTS (
    SELECT 1
    FROM public.quarterly_releases qr
    JOIN public.budget_allocations ba ON ba.id = qr.budget_allocation_id
    WHERE qr.id = public.budget_release_funding_lines.quarterly_release_id
      AND public.fn_current_user_data_scope_allows(ba.department_id, ba.section_id, public.budget_release_funding_lines.created_by, NULL, NULL)
  )
);

-- 10. Generic documents fail closed until HARD-37 adds module-specific sharing.
-- Live HARD-10 baseline: zero document rows.
DROP POLICY IF EXISTS hard10_documents_read ON public.documents;
DROP POLICY IF EXISTS hard10_documents_write ON public.documents;
CREATE POLICY hard10_documents_read ON public.documents
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND (uploaded_by = public.fn_current_app_user_id() OR public.fn_current_user_has_permission('all')));
CREATE POLICY hard10_documents_write ON public.documents
FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND (uploaded_by = public.fn_current_app_user_id() OR public.fn_current_user_has_permission('all')))
WITH CHECK (auth.uid() IS NOT NULL AND (uploaded_by = public.fn_current_app_user_id() OR public.fn_current_user_has_permission('all')));

-- 11. Migration invariants.
DO $verify$
DECLARE
  v_table text;
  v_enabled boolean;
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
    SELECT c.relrowsecurity INTO v_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_table AND c.relkind = 'r';
    IF COALESCE(v_enabled, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'HARD-10 failed: RLS not enabled for public.%', v_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname IN (
        'divisional_budget_submissions_read','divisional_budget_submissions_insert','divisional_budget_submissions_update','divisional_budget_submissions_delete',
        'divisional_budget_lines_read','divisional_budget_lines_insert','divisional_budget_lines_update','divisional_budget_lines_delete',
        'budget_workflow_history_read','budget_workflow_history_insert',
        'hard10_budget_submission_write','hard10_budget_line_write'
      )
  ) THEN
    RAISE EXCEPTION 'HARD-10 failed: unsafe or superseded broad budget policy still exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='divisional_budget_submissions'
      AND policyname IN ('hard10_budget_submission_read','hard10_budget_submission_insert','hard10_budget_submission_update','hard10_budget_submission_delete')
    GROUP BY tablename
    HAVING count(*) = 4
  ) THEN
    RAISE EXCEPTION 'HARD-10 failed: command-specific budget submission policies are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='divisional_budget_lines'
      AND policyname IN ('hard10_budget_line_read','hard10_budget_line_insert','hard10_budget_line_update','hard10_budget_line_delete')
    GROUP BY tablename
    HAVING count(*) = 4
  ) THEN
    RAISE EXCEPTION 'HARD-10 failed: command-specific budget line policies are incomplete';
  END IF;
END
$verify$;
