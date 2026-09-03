-- =============================================================================
-- NJSS HARD-10 — PUBLIC TABLE RLS LOCKDOWN
-- Source-controlled only until separately approved for production migration.
--
-- Live Supabase review on 2026-09-04 confirmed these 30 public tables had RLS
-- disabled while authenticated retained direct CRUD table privileges. This
-- migration enables RLS everywhere and replaces legacy broad-write behaviour
-- with explicit authenticated-read, permission, scope, ownership, or RPC-only
-- policies according to table purpose.
-- =============================================================================

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

-- -----------------------------------------------------------------------------
-- A. Reference/master data: signed-in staff may read; only master/registry/
-- settings administrators may mutate directly.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
  v_manage_expr text := $expr$(
    public.fn_current_user_has_permission('masterdata.manage')
    OR public.fn_current_user_has_permission('registry.manage')
    OR public.fn_current_user_has_permission('settings.manage')
    OR public.fn_current_user_has_permission('all')
  )$expr$;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'activity_templates',
    'budget_periods',
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
    'rbac_data_scope_types',
    'units_of_measure',
    'urgency_levels',
    'workflow_statuses'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_read_authenticated_hard10', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_manage_hard10', v_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      v_table || '_read_authenticated_hard10', v_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      v_table || '_manage_hard10', v_table, v_manage_expr, v_manage_expr
    );
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- B. Security/access configuration: visible only to access/settings admins and
-- immutable to ordinary clients. service_role/database-owner paths bypass RLS.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS approval_limits_admin_read_hard10 ON public.approval_limits;
DROP POLICY IF EXISTS approval_limits_no_insert_hard10 ON public.approval_limits;
DROP POLICY IF EXISTS approval_limits_no_update_hard10 ON public.approval_limits;
DROP POLICY IF EXISTS approval_limits_no_delete_hard10 ON public.approval_limits;
CREATE POLICY approval_limits_admin_read_hard10 ON public.approval_limits
  FOR SELECT TO authenticated
  USING (
    public.fn_current_user_has_permission('settings.manage')
    OR public.fn_current_user_has_permission('roles.manage')
    OR public.fn_current_user_has_permission('permissions.manage')
    OR public.fn_current_user_has_permission('all')
  );
CREATE POLICY approval_limits_no_insert_hard10 ON public.approval_limits FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY approval_limits_no_update_hard10 ON public.approval_limits FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY approval_limits_no_delete_hard10 ON public.approval_limits FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS segregation_rules_admin_read_hard10 ON public.segregation_rules;
DROP POLICY IF EXISTS segregation_rules_no_insert_hard10 ON public.segregation_rules;
DROP POLICY IF EXISTS segregation_rules_no_update_hard10 ON public.segregation_rules;
DROP POLICY IF EXISTS segregation_rules_no_delete_hard10 ON public.segregation_rules;
CREATE POLICY segregation_rules_admin_read_hard10 ON public.segregation_rules
  FOR SELECT TO authenticated
  USING (
    public.fn_current_user_has_permission('settings.manage')
    OR public.fn_current_user_has_permission('roles.manage')
    OR public.fn_current_user_has_permission('permissions.manage')
    OR public.fn_current_user_has_permission('all')
  );
CREATE POLICY segregation_rules_no_insert_hard10 ON public.segregation_rules FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY segregation_rules_no_update_hard10 ON public.segregation_rules FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY segregation_rules_no_delete_hard10 ON public.segregation_rules FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS role_migration_map_041_admin_read_hard10 ON public.role_migration_map_041;
DROP POLICY IF EXISTS role_migration_map_041_no_insert_hard10 ON public.role_migration_map_041;
DROP POLICY IF EXISTS role_migration_map_041_no_update_hard10 ON public.role_migration_map_041;
DROP POLICY IF EXISTS role_migration_map_041_no_delete_hard10 ON public.role_migration_map_041;
CREATE POLICY role_migration_map_041_admin_read_hard10 ON public.role_migration_map_041
  FOR SELECT TO authenticated
  USING (
    public.fn_current_user_has_permission('roles.manage')
    OR public.fn_current_user_has_permission('users.manage')
    OR public.fn_current_user_has_permission('all')
  );
CREATE POLICY role_migration_map_041_no_insert_hard10 ON public.role_migration_map_041 FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY role_migration_map_041_no_update_hard10 ON public.role_migration_map_041 FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY role_migration_map_041_no_delete_hard10 ON public.role_migration_map_041 FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS role_migration_map_045_admin_read_hard10 ON public.role_migration_map_045;
DROP POLICY IF EXISTS role_migration_map_045_no_insert_hard10 ON public.role_migration_map_045;
DROP POLICY IF EXISTS role_migration_map_045_no_update_hard10 ON public.role_migration_map_045;
DROP POLICY IF EXISTS role_migration_map_045_no_delete_hard10 ON public.role_migration_map_045;
CREATE POLICY role_migration_map_045_admin_read_hard10 ON public.role_migration_map_045
  FOR SELECT TO authenticated
  USING (
    public.fn_current_user_has_permission('roles.manage')
    OR public.fn_current_user_has_permission('users.manage')
    OR public.fn_current_user_has_permission('all')
  );
CREATE POLICY role_migration_map_045_no_insert_hard10 ON public.role_migration_map_045 FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY role_migration_map_045_no_update_hard10 ON public.role_migration_map_045 FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY role_migration_map_045_no_delete_hard10 ON public.role_migration_map_045 FOR DELETE TO authenticated USING (false);

-- -----------------------------------------------------------------------------
-- C. Budget cycle/division setup: broadly readable as workflow lookups; mutation
-- requires master/registry administration or Registrar-level budget approval.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS budget_cycles_read ON public.budget_cycles;
DROP POLICY IF EXISTS budget_cycles_insert ON public.budget_cycles;
DROP POLICY IF EXISTS budget_cycles_update ON public.budget_cycles;
DROP POLICY IF EXISTS budget_cycles_delete ON public.budget_cycles;
DROP POLICY IF EXISTS budget_cycles_read_hard10 ON public.budget_cycles;
DROP POLICY IF EXISTS budget_cycles_manage_hard10 ON public.budget_cycles;
CREATE POLICY budget_cycles_read_hard10 ON public.budget_cycles FOR SELECT TO authenticated USING (true);
CREATE POLICY budget_cycles_manage_hard10 ON public.budget_cycles
  FOR ALL TO authenticated
  USING (
    public.fn_current_user_has_permission('masterdata.manage')
    OR public.fn_current_user_has_permission('registry.manage')
    OR public.fn_current_user_has_permission('budget.template.approve')
    OR public.fn_current_user_has_permission('all')
  )
  WITH CHECK (
    public.fn_current_user_has_permission('masterdata.manage')
    OR public.fn_current_user_has_permission('registry.manage')
    OR public.fn_current_user_has_permission('budget.template.approve')
    OR public.fn_current_user_has_permission('all')
  );

DROP POLICY IF EXISTS budget_divisions_read ON public.budget_divisions;
DROP POLICY IF EXISTS budget_divisions_insert ON public.budget_divisions;
DROP POLICY IF EXISTS budget_divisions_update ON public.budget_divisions;
DROP POLICY IF EXISTS budget_divisions_delete ON public.budget_divisions;
DROP POLICY IF EXISTS budget_divisions_read_hard10 ON public.budget_divisions;
DROP POLICY IF EXISTS budget_divisions_manage_hard10 ON public.budget_divisions;
CREATE POLICY budget_divisions_read_hard10 ON public.budget_divisions FOR SELECT TO authenticated USING (true);
CREATE POLICY budget_divisions_manage_hard10 ON public.budget_divisions
  FOR ALL TO authenticated
  USING (
    public.fn_current_user_has_permission('masterdata.manage')
    OR public.fn_current_user_has_permission('registry.manage')
    OR public.fn_current_user_has_permission('budget.template.approve')
    OR public.fn_current_user_has_permission('all')
  )
  WITH CHECK (
    public.fn_current_user_has_permission('masterdata.manage')
    OR public.fn_current_user_has_permission('registry.manage')
    OR public.fn_current_user_has_permission('budget.template.approve')
    OR public.fn_current_user_has_permission('all')
  );

-- -----------------------------------------------------------------------------
-- D. Divisional budget lines: permission + organisational scope + editable
-- parent state. This replaces the previous broad signed-in-user mutation model.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS divisional_budget_lines_read ON public.divisional_budget_lines;
DROP POLICY IF EXISTS divisional_budget_lines_insert ON public.divisional_budget_lines;
DROP POLICY IF EXISTS divisional_budget_lines_update ON public.divisional_budget_lines;
DROP POLICY IF EXISTS divisional_budget_lines_delete ON public.divisional_budget_lines;
DROP POLICY IF EXISTS divisional_budget_lines_select_hard10 ON public.divisional_budget_lines;
DROP POLICY IF EXISTS divisional_budget_lines_insert_hard10 ON public.divisional_budget_lines;
DROP POLICY IF EXISTS divisional_budget_lines_update_hard10 ON public.divisional_budget_lines;
DROP POLICY IF EXISTS divisional_budget_lines_delete_hard10 ON public.divisional_budget_lines;

CREATE POLICY divisional_budget_lines_select_hard10 ON public.divisional_budget_lines
  FOR SELECT TO authenticated
  USING (
    (
      public.fn_current_user_has_permission('budget.template')
      OR public.fn_current_user_has_permission('budget.template.view')
      OR public.fn_current_user_has_permission('budget.template.create')
      OR public.fn_current_user_has_permission('budget.template.edit')
      OR public.fn_current_user_has_permission('budget.template.submit')
      OR public.fn_current_user_has_permission('budget.template.review')
      OR public.fn_current_user_has_permission('budget.template.approve')
      OR public.fn_current_user_has_permission('budget.report.view')
      OR public.fn_current_user_has_permission('reports.view')
      OR public.fn_current_user_has_permission('all')
    )
    AND EXISTS (
      SELECT 1
      FROM public.divisional_budget_submissions s
      LEFT JOIN public.budget_divisions d ON d.id = s.division_id
      WHERE s.id = divisional_budget_lines.submission_id
        AND public.fn_current_user_data_scope_allows(
          s.department_id,
          d.section_id,
          s.submitted_by,
          NULL::uuid,
          NULL::uuid
        )
    )
  );

CREATE POLICY divisional_budget_lines_insert_hard10 ON public.divisional_budget_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.fn_current_user_has_permission('budget.template.create')
      OR public.fn_current_user_has_permission('budget.template.edit')
      OR public.fn_current_user_has_permission('all')
    )
    AND EXISTS (
      SELECT 1
      FROM public.divisional_budget_submissions s
      LEFT JOIN public.budget_divisions d ON d.id = s.division_id
      WHERE s.id = divisional_budget_lines.submission_id
        AND s.status IN ('DRAFT', 'RETURNED')
        AND s.is_locked = false
        AND public.fn_current_user_data_scope_allows(
          s.department_id,
          d.section_id,
          s.submitted_by,
          NULL::uuid,
          NULL::uuid
        )
    )
  );

CREATE POLICY divisional_budget_lines_update_hard10 ON public.divisional_budget_lines
  FOR UPDATE TO authenticated
  USING (
    (
      public.fn_current_user_has_permission('budget.template.edit')
      OR public.fn_current_user_has_permission('all')
    )
    AND EXISTS (
      SELECT 1
      FROM public.divisional_budget_submissions s
      LEFT JOIN public.budget_divisions d ON d.id = s.division_id
      WHERE s.id = divisional_budget_lines.submission_id
        AND s.status IN ('DRAFT', 'RETURNED')
        AND s.is_locked = false
        AND public.fn_current_user_data_scope_allows(s.department_id, d.section_id, s.submitted_by, NULL::uuid, NULL::uuid)
    )
  )
  WITH CHECK (
    (
      public.fn_current_user_has_permission('budget.template.edit')
      OR public.fn_current_user_has_permission('all')
    )
    AND EXISTS (
      SELECT 1
      FROM public.divisional_budget_submissions s
      LEFT JOIN public.budget_divisions d ON d.id = s.division_id
      WHERE s.id = divisional_budget_lines.submission_id
        AND s.status IN ('DRAFT', 'RETURNED')
        AND s.is_locked = false
        AND public.fn_current_user_data_scope_allows(s.department_id, d.section_id, s.submitted_by, NULL::uuid, NULL::uuid)
    )
  );

CREATE POLICY divisional_budget_lines_delete_hard10 ON public.divisional_budget_lines
  FOR DELETE TO authenticated
  USING (
    (
      public.fn_current_user_has_permission('budget.template.edit')
      OR public.fn_current_user_has_permission('all')
    )
    AND EXISTS (
      SELECT 1
      FROM public.divisional_budget_submissions s
      LEFT JOIN public.budget_divisions d ON d.id = s.division_id
      WHERE s.id = divisional_budget_lines.submission_id
        AND s.status IN ('DRAFT', 'RETURNED')
        AND s.is_locked = false
        AND public.fn_current_user_data_scope_allows(s.department_id, d.section_id, s.submitted_by, NULL::uuid, NULL::uuid)
    )
  );

-- -----------------------------------------------------------------------------
-- E. Workflow history: readable only within authorised budget scope; writes are
-- made by guarded SECURITY DEFINER workflow RPCs, never direct browser clients.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS budget_workflow_history_read ON public.budget_workflow_history;
DROP POLICY IF EXISTS budget_workflow_history_insert ON public.budget_workflow_history;
DROP POLICY IF EXISTS budget_workflow_history_select_hard10 ON public.budget_workflow_history;
DROP POLICY IF EXISTS budget_workflow_history_no_insert_hard10 ON public.budget_workflow_history;
DROP POLICY IF EXISTS budget_workflow_history_no_update_hard10 ON public.budget_workflow_history;
DROP POLICY IF EXISTS budget_workflow_history_no_delete_hard10 ON public.budget_workflow_history;
CREATE POLICY budget_workflow_history_select_hard10 ON public.budget_workflow_history
  FOR SELECT TO authenticated
  USING (
    (
      public.fn_current_user_has_permission('budget.template')
      OR public.fn_current_user_has_permission('budget.template.view')
      OR public.fn_current_user_has_permission('budget.template.review')
      OR public.fn_current_user_has_permission('budget.template.approve')
      OR public.fn_current_user_has_permission('budget.report.view')
      OR public.fn_current_user_has_permission('reports.view')
      OR public.fn_current_user_has_permission('all')
    )
    AND EXISTS (
      SELECT 1
      FROM public.divisional_budget_submissions s
      LEFT JOIN public.budget_divisions d ON d.id = s.division_id
      WHERE s.id = budget_workflow_history.submission_id
        AND public.fn_current_user_data_scope_allows(s.department_id, d.section_id, s.submitted_by, NULL::uuid, NULL::uuid)
    )
  );
CREATE POLICY budget_workflow_history_no_insert_hard10 ON public.budget_workflow_history FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY budget_workflow_history_no_update_hard10 ON public.budget_workflow_history FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY budget_workflow_history_no_delete_hard10 ON public.budget_workflow_history FOR DELETE TO authenticated USING (false);

-- -----------------------------------------------------------------------------
-- F. Consolidation: scoped read; mutation only through the guarded consolidation
-- RPC. This table has no legitimate direct client write path.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS budget_consolidations_select_hard10 ON public.budget_consolidations;
DROP POLICY IF EXISTS budget_consolidations_no_insert_hard10 ON public.budget_consolidations;
DROP POLICY IF EXISTS budget_consolidations_no_update_hard10 ON public.budget_consolidations;
DROP POLICY IF EXISTS budget_consolidations_no_delete_hard10 ON public.budget_consolidations;
CREATE POLICY budget_consolidations_select_hard10 ON public.budget_consolidations
  FOR SELECT TO authenticated
  USING (
    (
      public.fn_current_user_has_permission('budget.consolidate')
      OR public.fn_current_user_has_permission('budget.report.view')
      OR public.fn_current_user_has_permission('reports.view')
      OR public.fn_current_user_has_permission('all')
    )
    AND (
      department_id IS NULL
      OR public.fn_current_user_data_scope_allows(department_id, NULL::uuid, consolidated_by, NULL::uuid, NULL::uuid)
    )
  );
CREATE POLICY budget_consolidations_no_insert_hard10 ON public.budget_consolidations FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY budget_consolidations_no_update_hard10 ON public.budget_consolidations FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY budget_consolidations_no_delete_hard10 ON public.budget_consolidations FOR DELETE TO authenticated USING (false);

-- -----------------------------------------------------------------------------
-- G. Budget release funding attribution: scoped read; write only through the
-- guarded budget-release RPC to preserve total/reconciliation invariants.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS budget_release_funding_lines_select_hard10 ON public.budget_release_funding_lines;
DROP POLICY IF EXISTS budget_release_funding_lines_no_insert_hard10 ON public.budget_release_funding_lines;
DROP POLICY IF EXISTS budget_release_funding_lines_no_update_hard10 ON public.budget_release_funding_lines;
DROP POLICY IF EXISTS budget_release_funding_lines_no_delete_hard10 ON public.budget_release_funding_lines;
CREATE POLICY budget_release_funding_lines_select_hard10 ON public.budget_release_funding_lines
  FOR SELECT TO authenticated
  USING (
    (
      public.fn_current_user_has_permission('budget.release')
      OR public.fn_current_user_has_permission('funding.view')
      OR public.fn_current_user_has_permission('budget.view')
      OR public.fn_current_user_has_permission('budget.report.view')
      OR public.fn_current_user_has_permission('reports.view')
      OR public.fn_current_user_has_permission('all')
    )
    AND EXISTS (
      SELECT 1
      FROM public.quarterly_releases qr
      JOIN public.budget_allocations ba ON ba.id = qr.budget_allocation_id
      WHERE qr.id = budget_release_funding_lines.quarterly_release_id
        AND public.fn_current_user_data_scope_allows(
          ba.department_id,
          ba.section_id,
          qr.created_by,
          NULL::uuid,
          NULL::uuid
        )
    )
  );
CREATE POLICY budget_release_funding_lines_no_insert_hard10 ON public.budget_release_funding_lines FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY budget_release_funding_lines_no_update_hard10 ON public.budget_release_funding_lines FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY budget_release_funding_lines_no_delete_hard10 ON public.budget_release_funding_lines FOR DELETE TO authenticated USING (false);

-- -----------------------------------------------------------------------------
-- H. Retired annual-plan lines: history remains readable according to the parent
-- plan's existing permissions/scope; direct client mutation is blocked because
-- the application now directs users to Budget Preparation instead.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS annual_plan_lines_select_hard10 ON public.annual_plan_lines;
DROP POLICY IF EXISTS annual_plan_lines_no_insert_hard10 ON public.annual_plan_lines;
DROP POLICY IF EXISTS annual_plan_lines_no_update_hard10 ON public.annual_plan_lines;
DROP POLICY IF EXISTS annual_plan_lines_no_delete_hard10 ON public.annual_plan_lines;
CREATE POLICY annual_plan_lines_select_hard10 ON public.annual_plan_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.annual_plan_headers h
      WHERE h.id = annual_plan_lines.plan_header_id
        AND (
          public.fn_current_user_has_permission('plans.create')
          OR public.fn_current_user_has_permission('plans.review')
          OR public.fn_current_user_has_permission('budget.view')
          OR public.fn_current_user_has_permission('reports.view')
          OR public.fn_current_user_has_permission('all')
        )
        AND public.fn_current_user_data_scope_allows(h.department_id, h.section_id, h.created_by, NULL::uuid, NULL::uuid)
    )
  );
CREATE POLICY annual_plan_lines_no_insert_hard10 ON public.annual_plan_lines FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY annual_plan_lines_no_update_hard10 ON public.annual_plan_lines FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY annual_plan_lines_no_delete_hard10 ON public.annual_plan_lines FOR DELETE TO authenticated USING (false);

-- -----------------------------------------------------------------------------
-- I. Document register: module-aware read and authenticated owner-bound writes.
-- The table is currently empty, so this establishes a secure default before
-- document storage is used in UAT/production.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS documents_select_hard10 ON public.documents;
DROP POLICY IF EXISTS documents_insert_hard10 ON public.documents;
DROP POLICY IF EXISTS documents_update_hard10 ON public.documents;
DROP POLICY IF EXISTS documents_delete_hard10 ON public.documents;
CREATE POLICY documents_select_hard10 ON public.documents
  FOR SELECT TO authenticated
  USING (
    uploaded_by = public.fn_current_app_user_id()
    OR public.fn_current_user_has_permission('all')
    OR (
      upper(module) = 'FF3'
      AND (
        public.fn_current_user_has_permission('ff3.view')
        OR public.fn_current_user_has_permission('ff3.create')
        OR public.fn_current_user_has_permission('ff3.endorse')
        OR public.fn_current_user_has_permission('ff3.approve')
      )
    )
    OR (
      upper(module) = 'FF4'
      AND (
        public.fn_current_user_has_permission('ff4.view')
        OR public.fn_current_user_has_permission('ff4.create')
        OR public.fn_current_user_has_permission('ff4.verify')
        OR public.fn_current_user_has_permission('ff4.approve')
        OR public.fn_current_user_has_permission('ff4.process')
      )
    )
    OR (
      upper(module) IN ('BUDGET', 'BUDGET_TEMPLATE', 'BUDGET_REVISION')
      AND (
        public.fn_current_user_has_permission('budget.view')
        OR public.fn_current_user_has_permission('budget.template.view')
        OR public.fn_current_user_has_permission('budget.report.view')
      )
    )
  );
CREATE POLICY documents_insert_hard10 ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.fn_current_app_user_id() IS NOT NULL
    AND uploaded_by = public.fn_current_app_user_id()
  );
CREATE POLICY documents_update_hard10 ON public.documents
  FOR UPDATE TO authenticated
  USING (
    uploaded_by = public.fn_current_app_user_id()
    OR public.fn_current_user_has_permission('all')
  )
  WITH CHECK (
    uploaded_by = public.fn_current_app_user_id()
    OR public.fn_current_user_has_permission('all')
  );
CREATE POLICY documents_delete_hard10 ON public.documents
  FOR DELETE TO authenticated
  USING (
    uploaded_by = public.fn_current_app_user_id()
    OR public.fn_current_user_has_permission('all')
  );

-- -----------------------------------------------------------------------------
-- J. Migration postconditions: fail atomically if any targeted public table is
-- still outside RLS after this migration.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
  INTO v_missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname = ANY (ARRAY[
      'activity_templates','annual_plan_lines','approval_limits','budget_consolidations',
      'budget_cycles','budget_divisions','budget_periods','budget_release_funding_lines',
      'budget_workflow_history','chart_of_accounts','cost_centres','divisional_budget_lines',
      'documents','expense_categories','expense_items','financial_years','funding_sources',
      'payee_types','payment_methods','priority_levels','procurement_methods','projects',
      'provinces','rbac_data_scope_types','role_migration_map_041','role_migration_map_045',
      'segregation_rules','units_of_measure','urgency_levels','workflow_statuses'
    ])
    AND c.relrowsecurity = false;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS hardening failed; RLS remains disabled on: %', v_missing;
  END IF;
END
$$;
