-- NJSS PHASE 6 — Security and UAT readiness hardening
-- Additive correction layer only. Does not change Phase 1–5 transaction workflows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Shared data-scope helper for RLS and invoker-security reports
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_current_user_data_scope_allows(
  p_department_id UUID DEFAULT NULL,
  p_section_id UUID DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_requesting_officer_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_app_user_id UUID := fn_current_app_user_id();
  v_department_id UUID;
  v_section_id UUID;
  v_allowed BOOLEAN := false;
BEGIN
  IF COALESCE(fn_current_user_has_permission('all'), false) THEN
    RETURN true;
  END IF;

  IF v_app_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT u.department_id, u.section_id
  INTO v_department_id, v_section_id
  FROM users u
  WHERE u.id = v_app_user_id;

  IF p_created_by IS NOT NULL AND p_created_by = v_app_user_id THEN
    RETURN true;
  END IF;
  IF p_requesting_officer_id IS NOT NULL AND p_requesting_officer_id = v_app_user_id THEN
    RETURN true;
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id = v_app_user_id THEN
    RETURN true;
  END IF;

  WITH effective_scopes AS (
    SELECT uds.scope_type, uds.department_ids, uds.division_ids, uds.branch_ids, uds.province_ids
    FROM user_data_scopes uds
    WHERE uds.user_id = v_app_user_id
    UNION ALL
    SELECT rds.scope_type, rds.department_ids, rds.division_ids, rds.branch_ids, rds.province_ids
    FROM user_roles ur
    JOIN role_data_scopes rds ON rds.role_id = ur.role_id
    WHERE ur.user_id = v_app_user_id
    UNION ALL
    SELECT COALESCE(r.data_scope_type, 'OWN_RECORDS') AS scope_type, '{}'::UUID[], '{}'::UUID[], '{}'::UUID[], '{}'::UUID[]
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_app_user_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM effective_scopes s
    WHERE s.scope_type = 'SYSTEM_WIDE'
       OR (s.scope_type = 'DEPARTMENT_WIDE' AND p_department_id IS NOT NULL AND (p_department_id = v_department_id OR p_department_id = ANY(COALESCE(s.department_ids, '{}'::UUID[]))))
       OR (s.scope_type = 'OWN_DIVISION' AND p_department_id IS NOT NULL AND (p_department_id = v_department_id OR p_department_id = ANY(COALESCE(s.department_ids, '{}'::UUID[]))))
       OR (s.scope_type = 'OWN_BRANCH' AND p_department_id IS NOT NULL AND (p_department_id = v_department_id OR p_department_id = ANY(COALESCE(s.department_ids, '{}'::UUID[]))))
       OR (s.scope_type = 'OWN_PROVINCE' AND p_department_id IS NOT NULL AND (p_department_id = v_department_id OR p_department_id = ANY(COALESCE(s.department_ids, '{}'::UUID[]))))
       OR (s.scope_type = 'OWN_RECORDS' AND (
            (p_created_by IS NOT NULL AND p_created_by = v_app_user_id)
         OR (p_requesting_officer_id IS NOT NULL AND p_requesting_officer_id = v_app_user_id)
         OR (p_user_id IS NOT NULL AND p_user_id = v_app_user_id)
       ))
  ) INTO v_allowed;

  RETURN COALESCE(v_allowed, false);
END;
$$;

REVOKE ALL ON FUNCTION fn_current_user_data_scope_allows(UUID, UUID, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_current_user_data_scope_allows(UUID, UUID, UUID, UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Remove legacy anonymous exposure and stop future anonymous grants
-- -----------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
GRANT USAGE ON SCHEMA public TO anon;
GRANT EXECUTE ON FUNCTION fn_current_app_user_id() TO anon;
GRANT EXECUTE ON FUNCTION fn_user_has_permission(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION fn_current_user_has_permission(TEXT) TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;

GRANT USAGE ON SCHEMA public TO authenticated;

INSERT INTO menu_items (code, module_code, parent_code, label, href, icon, sort_order, required_permissions, is_active)
SELECT 'administration.uat', 'administration', NULL, 'UAT Checklist', '/dashboard/uat-checklist', 'ClipboardList', 96, ARRAY['users.manage'], true
WHERE EXISTS (SELECT 1 FROM modules WHERE code = 'administration')
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  parent_code = EXCLUDED.parent_code,
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  required_permissions = EXCLUDED.required_permissions,
  is_active = true,
  updated_at = NOW();

INSERT INTO menu_items (code, module_code, parent_code, label, href, icon, sort_order, required_permissions, is_active)
SELECT 'systems_administration.uat', 'systems_administration', NULL, 'UAT Checklist', '/dashboard/uat-checklist', 'ClipboardList', 96, ARRAY['users.manage'], true
WHERE EXISTS (SELECT 1 FROM modules WHERE code = 'systems_administration')
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  parent_code = EXCLUDED.parent_code,
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  required_permissions = EXCLUDED.required_permissions,
  is_active = true,
  updated_at = NOW();

DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'v_authoritative_budget_position',
    'v_budget_by_code',
    'v_budget_control',
    'v_department_consolidated_budget',
    'v_department_consolidated_budget_monthly',
    'v_budget_dashboard',
    'v_ledger_utilisation',
    'v_commitment_ledger',
    'v_releases_by_code',
    'v_funding_authority_register',
    'v_funding_receipt_register',
    'v_funding_allocation_register',
    'v_funding_source_report',
    'v_ff4_payable_commitments',
    'v_ff4_payment_register',
    'v_supplier_register',
    'v_supplier_commitment_position',
    'v_suppliers_directory',
    'v_report_catalogue',
    'v_management_financial_summary',
    'v_department_financial_position',
    'v_section_financial_position',
    'v_cost_centre_financial_position',
    'v_expense_code_financial_position',
    'v_funding_source_financial_position',
    'v_supplier_spend_summary',
    'v_ff3_ff4_transaction_trace',
    'v_monthly_expenditure_summary',
    'v_quarterly_expenditure_summary',
    'v_ff4_reconciliation_summary'
  ] LOOP
    IF to_regclass('public.' || v_name) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_name);
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_name);
      IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = v_name AND c.relkind = 'v'
          AND v_name <> 'v_user_effective_permissions'
      ) THEN
        EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v_name);
      END IF;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Authenticated RBAC bootstrap policies
-- -----------------------------------------------------------------------------

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_self_or_admin_phase6 ON users;
CREATE POLICY users_select_self_or_admin_phase6 ON users
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND (
      id = fn_current_app_user_id()
      OR auth_user_id = auth.uid()
      OR email = auth.email()
      OR (SELECT fn_current_user_has_permission('users.manage'))
      OR (SELECT fn_current_user_has_permission('all'))
    )
  );
DROP POLICY IF EXISTS users_manage_admin_phase6 ON users;
CREATE POLICY users_manage_admin_phase6 ON users
  FOR ALL USING ((SELECT fn_current_user_has_permission('users.manage')) OR (SELECT fn_current_user_has_permission('all')))
  WITH CHECK ((SELECT fn_current_user_has_permission('users.manage')) OR (SELECT fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS user_roles_select_self_phase6 ON user_roles;
CREATE POLICY user_roles_select_self_phase6 ON user_roles
  FOR SELECT USING (
    user_id = fn_current_app_user_id()
    OR (SELECT fn_current_user_has_permission('users.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

DROP POLICY IF EXISTS roles_select_assigned_or_admin_phase6 ON roles;
CREATE POLICY roles_select_assigned_or_admin_phase6 ON roles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.role_id = roles.id AND ur.user_id = fn_current_app_user_id())
    OR (SELECT fn_current_user_has_permission('users.manage'))
    OR (SELECT fn_current_user_has_permission('roles.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

DROP POLICY IF EXISTS role_permissions_select_assigned_phase6 ON role_permissions;
CREATE POLICY role_permissions_select_assigned_phase6 ON role_permissions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.role_id = role_permissions.role_id AND ur.user_id = fn_current_app_user_id())
    OR (SELECT fn_current_user_has_permission('permissions.manage'))
    OR (SELECT fn_current_user_has_permission('users.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

DROP POLICY IF EXISTS role_data_scopes_select_assigned_phase6 ON role_data_scopes;
CREATE POLICY role_data_scopes_select_assigned_phase6 ON role_data_scopes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.role_id = role_data_scopes.role_id AND ur.user_id = fn_current_app_user_id())
    OR (SELECT fn_current_user_has_permission('data_scope.manage'))
    OR (SELECT fn_current_user_has_permission('users.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

DROP POLICY IF EXISTS user_data_scopes_select_self_phase6 ON user_data_scopes;
CREATE POLICY user_data_scopes_select_self_phase6 ON user_data_scopes
  FOR SELECT USING (
    user_id = fn_current_app_user_id()
    OR (SELECT fn_current_user_has_permission('data_scope.manage'))
    OR (SELECT fn_current_user_has_permission('users.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

DROP POLICY IF EXISTS user_permissions_select_self_phase6 ON user_permissions;
CREATE POLICY user_permissions_select_self_phase6 ON user_permissions
  FOR SELECT USING (
    user_id = fn_current_app_user_id()
    OR (SELECT fn_current_user_has_permission('permissions.manage'))
    OR (SELECT fn_current_user_has_permission('users.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

-- Keep authenticated users able to load navigation metadata; anonymous users are blocked by grants above.
DROP POLICY IF EXISTS modules_read_authenticated ON modules;
CREATE POLICY modules_read_authenticated ON modules FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS menu_items_read_authenticated ON menu_items;
CREATE POLICY menu_items_read_authenticated ON menu_items FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS permissions_read_authenticated ON permissions;
CREATE POLICY permissions_read_authenticated ON permissions FOR SELECT USING (auth.role() = 'authenticated');

GRANT SELECT ON users, roles, user_roles, role_permissions, user_permissions, role_data_scopes, user_data_scopes, modules, menu_items, permissions TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Report and financial table SELECT policies with data-scope predicates
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS budget_allocations_select_rbac ON budget_allocations;
CREATE POLICY budget_allocations_select_rbac ON budget_allocations
  FOR SELECT USING (
    ((SELECT fn_current_user_has_permission('budget.view'))
      OR (SELECT fn_current_user_has_permission('budget.module.view'))
      OR (SELECT fn_current_user_has_permission('budget.control.view'))
      OR (SELECT fn_current_user_has_permission('budget.report.view'))
      OR (SELECT fn_current_user_has_permission('reports.view'))
      OR (SELECT fn_current_user_has_permission('all')))
    AND fn_current_user_data_scope_allows(department_id, section_id, created_by, NULL, NULL)
  );

DROP POLICY IF EXISTS quarterly_releases_select_rbac ON quarterly_releases;
CREATE POLICY quarterly_releases_select_rbac ON quarterly_releases
  FOR SELECT USING (
    ((SELECT fn_current_user_has_permission('budget.view'))
      OR (SELECT fn_current_user_has_permission('budget.release'))
      OR (SELECT fn_current_user_has_permission('budget.control.view'))
      OR (SELECT fn_current_user_has_permission('budget.report.view'))
      OR (SELECT fn_current_user_has_permission('reports.view'))
      OR (SELECT fn_current_user_has_permission('all')))
    AND EXISTS (
      SELECT 1 FROM budget_allocations ba
      WHERE ba.id = quarterly_releases.budget_allocation_id
        AND fn_current_user_data_scope_allows(ba.department_id, ba.section_id, ba.created_by, NULL, NULL)
    )
  );

DROP POLICY IF EXISTS ff3_headers_select_rbac ON ff3_headers;
CREATE POLICY ff3_headers_select_rbac ON ff3_headers
  FOR SELECT USING (
    ((SELECT fn_current_user_has_permission('ff3.view'))
      OR (SELECT fn_current_user_has_permission('ff3.create'))
      OR (SELECT fn_current_user_has_permission('ff3.approve'))
      OR (SELECT fn_current_user_has_permission('commitment.view'))
      OR (SELECT fn_current_user_has_permission('budget.report.view'))
      OR (SELECT fn_current_user_has_permission('reports.view'))
      OR (SELECT fn_current_user_has_permission('all')))
    AND fn_current_user_data_scope_allows(department_id, section_id, created_by, requesting_officer_id, NULL)
  );

DROP POLICY IF EXISTS ff3_commitments_select_authorized_phase2 ON ff3_commitments;
DROP POLICY IF EXISTS ff3_commitments_select_phase4_ff4 ON ff3_commitments;
DROP POLICY IF EXISTS ff3_commitments_select_phase6 ON ff3_commitments;
CREATE POLICY ff3_commitments_select_phase6 ON ff3_commitments
  FOR SELECT USING (
    ((SELECT fn_current_user_has_permission('commitment.view'))
      OR (SELECT fn_current_user_has_permission('budget.control.view'))
      OR (SELECT fn_current_user_has_permission('ff4.create'))
      OR (SELECT fn_current_user_has_permission('ff4.view'))
      OR (SELECT fn_current_user_has_permission('ff4.process'))
      OR (SELECT fn_current_user_has_permission('budget.report.view'))
      OR (SELECT fn_current_user_has_permission('reports.view'))
      OR (SELECT fn_current_user_has_permission('all')))
    AND (
      EXISTS (
        SELECT 1 FROM ff3_headers h
        WHERE h.id = ff3_commitments.ff3_header_id
          AND fn_current_user_data_scope_allows(h.department_id, h.section_id, h.created_by, h.requesting_officer_id, NULL)
      )
      OR EXISTS (
        SELECT 1 FROM budget_allocations ba
        WHERE ba.id = ff3_commitments.budget_allocation_id
          AND fn_current_user_data_scope_allows(ba.department_id, ba.section_id, ba.created_by, NULL, NULL)
      )
    )
  );

DROP POLICY IF EXISTS ff4_headers_select_phase4_hardening ON ff4_headers;
DROP POLICY IF EXISTS ff4_headers_select_phase6 ON ff4_headers;
CREATE POLICY ff4_headers_select_phase6 ON ff4_headers
  FOR SELECT USING (
    ((SELECT fn_current_user_has_permission('ff4.view'))
      OR (SELECT fn_current_user_has_permission('ff4.create'))
      OR (SELECT fn_current_user_has_permission('ff4.verify'))
      OR (SELECT fn_current_user_has_permission('ff4.approve'))
      OR (SELECT fn_current_user_has_permission('ff4.process'))
      OR (SELECT fn_current_user_has_permission('ff4.reject'))
      OR (SELECT fn_current_user_has_permission('budget.report.view'))
      OR (SELECT fn_current_user_has_permission('reports.view'))
      OR (SELECT fn_current_user_has_permission('all')))
    AND fn_current_user_data_scope_allows(department_id, section_id, created_by, NULL, NULL)
  );

DROP POLICY IF EXISTS payment_transactions_select_phase4 ON payment_transactions;
DROP POLICY IF EXISTS payment_transactions_select_phase6 ON payment_transactions;
CREATE POLICY payment_transactions_select_phase6 ON payment_transactions
  FOR SELECT USING (
    ((SELECT fn_current_user_has_permission('ff4.view'))
      OR (SELECT fn_current_user_has_permission('ff4.process'))
      OR (SELECT fn_current_user_has_permission('commitment.view'))
      OR (SELECT fn_current_user_has_permission('budget.report.view'))
      OR (SELECT fn_current_user_has_permission('reports.view'))
      OR (SELECT fn_current_user_has_permission('all')))
    AND EXISTS (
      SELECT 1 FROM ff4_headers f
      WHERE f.id = payment_transactions.ff4_header_id
        AND fn_current_user_data_scope_allows(f.department_id, f.section_id, f.created_by, NULL, NULL)
    )
  );

DROP POLICY IF EXISTS funding_authorities_select_rbac ON funding_authorities;
DROP POLICY IF EXISTS funding_authorities_select_phase6 ON funding_authorities;
CREATE POLICY funding_authorities_select_phase6 ON funding_authorities
  FOR SELECT USING ((SELECT fn_current_user_has_permission('funding.view')) OR (SELECT fn_current_user_has_permission('budget.control.view')) OR (SELECT fn_current_user_has_permission('budget.report.view')) OR (SELECT fn_current_user_has_permission('reports.view')) OR (SELECT fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS funding_receipts_select_rbac ON funding_receipts;
DROP POLICY IF EXISTS funding_receipts_select_phase6 ON funding_receipts;
CREATE POLICY funding_receipts_select_phase6 ON funding_receipts
  FOR SELECT USING ((SELECT fn_current_user_has_permission('funding.view')) OR (SELECT fn_current_user_has_permission('budget.control.view')) OR (SELECT fn_current_user_has_permission('budget.report.view')) OR (SELECT fn_current_user_has_permission('reports.view')) OR (SELECT fn_current_user_has_permission('all')));

DROP POLICY IF EXISTS funding_allocations_select_rbac ON funding_allocations;
DROP POLICY IF EXISTS funding_allocations_select_phase6 ON funding_allocations;
CREATE POLICY funding_allocations_select_phase6 ON funding_allocations
  FOR SELECT USING ((SELECT fn_current_user_has_permission('funding.view')) OR (SELECT fn_current_user_has_permission('budget.control.view')) OR (SELECT fn_current_user_has_permission('budget.report.view')) OR (SELECT fn_current_user_has_permission('reports.view')) OR (SELECT fn_current_user_has_permission('all')));

GRANT SELECT ON funding_authorities, funding_receipts, funding_allocations TO authenticated;

DROP POLICY IF EXISTS audit_logs_select_authorized ON audit_logs;
CREATE POLICY audit_logs_select_authorized ON audit_logs
  FOR SELECT USING (
    (user_id = fn_current_app_user_id())
    OR (SELECT fn_current_user_has_permission('audit.view'))
    OR (SELECT fn_current_user_has_permission('audit.export'))
    OR (SELECT fn_current_user_has_permission('reports.view'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

-- Report catalogue tables are metadata only, but still authenticated and permission-gated.
ALTER TABLE report_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_categories_select_phase6 ON report_categories;
CREATE POLICY report_categories_select_phase6 ON report_categories
  FOR SELECT USING (auth.role() = 'authenticated' AND ((SELECT fn_current_user_has_permission('reports.view')) OR (SELECT fn_current_user_has_permission('budget.report.view')) OR (SELECT fn_current_user_has_permission('all'))));
DROP POLICY IF EXISTS report_definitions_select_phase6 ON report_definitions;
CREATE POLICY report_definitions_select_phase6 ON report_definitions
  FOR SELECT USING (auth.role() = 'authenticated' AND ((SELECT fn_current_user_has_permission('reports.view')) OR (SELECT fn_current_user_has_permission('budget.report.view')) OR (SELECT fn_current_user_has_permission('all'))));

-- Organization settings are visible to authenticated users; other settings remain admin-only.
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS suppliers_select_phase3 ON suppliers;
CREATE POLICY suppliers_select_phase6 ON suppliers FOR SELECT
USING ((SELECT fn_current_user_has_permission('supplier.view')) OR (SELECT fn_current_user_has_permission('ff3.create')) OR (SELECT fn_current_user_has_permission('ff4.create')) OR (SELECT fn_current_user_has_permission('budget.report.view')) OR (SELECT fn_current_user_has_permission('reports.view')) OR (SELECT fn_current_user_has_permission('all')));
DROP POLICY IF EXISTS suppliers_no_insert_phase3 ON suppliers;
DROP POLICY IF EXISTS suppliers_no_update_phase3 ON suppliers;
DROP POLICY IF EXISTS suppliers_no_delete_phase3 ON suppliers;
CREATE POLICY suppliers_no_insert_phase6 ON suppliers FOR INSERT WITH CHECK (FALSE);
CREATE POLICY suppliers_no_update_phase6 ON suppliers FOR UPDATE USING (FALSE) WITH CHECK (FALSE);
CREATE POLICY suppliers_no_delete_phase6 ON suppliers FOR DELETE USING (FALSE);
GRANT SELECT ON suppliers TO authenticated;

ALTER TABLE expense_code_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_code_registry_select_phase6 ON expense_code_registry;
CREATE POLICY expense_code_registry_select_phase6 ON expense_code_registry FOR SELECT
USING ((SELECT fn_current_user_has_permission('registry.manage')) OR (SELECT fn_current_user_has_permission('budget.view')) OR (SELECT fn_current_user_has_permission('budget.report.view')) OR (SELECT fn_current_user_has_permission('reports.view')) OR (SELECT fn_current_user_has_permission('all')));
GRANT SELECT ON expense_code_registry TO authenticated;

ALTER TABLE expense_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_ledger_select_phase6 ON expense_ledger;
CREATE POLICY expense_ledger_select_phase6 ON expense_ledger FOR SELECT
USING ((SELECT fn_current_user_has_permission('budget.template')) OR (SELECT fn_current_user_has_permission('budget.template.view')) OR (SELECT fn_current_user_has_permission('budget.report.view')) OR (SELECT fn_current_user_has_permission('reports.view')) OR (SELECT fn_current_user_has_permission('all')));
GRANT SELECT ON expense_ledger TO authenticated;

ALTER TABLE budget_monthly_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_monthly_allocations_select_phase6 ON budget_monthly_allocations;
CREATE POLICY budget_monthly_allocations_select_phase6 ON budget_monthly_allocations FOR SELECT
USING ((SELECT fn_current_user_has_permission('budget.template')) OR (SELECT fn_current_user_has_permission('budget.template.view')) OR (SELECT fn_current_user_has_permission('budget.report.view')) OR (SELECT fn_current_user_has_permission('reports.view')) OR (SELECT fn_current_user_has_permission('all')));
GRANT SELECT ON budget_monthly_allocations TO authenticated;

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS system_settings_select_phase6 ON system_settings;
CREATE POLICY system_settings_select_phase6 ON system_settings
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND (setting_key = 'organization' OR (SELECT fn_current_user_has_permission('settings.manage')) OR (SELECT fn_current_user_has_permission('all')))
  );
DROP POLICY IF EXISTS system_settings_manage_phase6 ON system_settings;
CREATE POLICY system_settings_manage_phase6 ON system_settings
  FOR ALL USING ((SELECT fn_current_user_has_permission('settings.manage')) OR (SELECT fn_current_user_has_permission('all')))
  WITH CHECK ((SELECT fn_current_user_has_permission('settings.manage')) OR (SELECT fn_current_user_has_permission('all')));

GRANT SELECT ON report_categories, report_definitions, system_settings TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Defensive search_path pinning for security-definer functions
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::REGPROCEDURE AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.prokind = 'f'
      AND p.oid::REGPROCEDURE::TEXT NOT LIKE 'pg_%'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) cfg
        WHERE cfg LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.signature);
  END LOOP;
END $$;

-- Keep high-use reporting indexes explicit for audit/report performance.
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_phase6 ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_phase6 ON audit_logs(entity_type, entity_reference);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_phase6_reconciled ON payment_transactions(financial_year, reconciled, transaction_date);

-- Final authenticated grants for objects used during login/session enrichment and reporting.
GRANT SELECT ON financial_years, workflow_statuses TO authenticated;
GRANT EXECUTE ON FUNCTION fn_current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION fn_user_has_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_current_user_has_permission(TEXT) TO authenticated;
