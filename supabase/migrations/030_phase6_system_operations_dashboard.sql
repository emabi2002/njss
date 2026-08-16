-- NJSS PHASE 6 — System Administration & Operations Dashboard
-- Additive production-support readiness layer only.
-- Does not alter Phase 1-5 financial transaction workflows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Operations support cost register and alert configuration
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS system_operating_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_provider TEXT NOT NULL,
  cost_category TEXT NOT NULL CHECK (cost_category IN ('Database', 'File storage', 'Hosting', 'Domain/DNS', 'Email', 'SMS', 'Backup', 'Monitoring', 'Support', 'Other')),
  billing_month DATE NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'PGK',
  monthly_fixed_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  usage_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  other_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(15,2) GENERATED ALWAYS AS (COALESCE(monthly_fixed_cost, 0) + COALESCE(usage_cost, 0) + COALESCE(other_cost, 0)) STORED,
  invoice_reference TEXT,
  payment_status VARCHAR(40) NOT NULL DEFAULT 'Pending' CHECK (payment_status IN ('Pending', 'Approved', 'Paid', 'Disputed', 'Not Applicable')),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_provider, cost_category, billing_month, invoice_reference)
);

CREATE TABLE IF NOT EXISTS system_alert_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(120) UNIQUE NOT NULL,
  label TEXT NOT NULL,
  threshold_value NUMERIC(15,2),
  enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_alert_settings (code, label, threshold_value, enabled, notes)
VALUES
  ('storage_warning_70', 'Storage usage exceeds 70%', 70, true, 'Warn support team when manually or automatically measured storage usage exceeds 70%.'),
  ('storage_critical_85', 'Storage usage exceeds 85%', 85, true, 'Critical warning when storage approaches capacity.'),
  ('database_growth_threshold', 'Database growth exceeds monthly percentage threshold', 20, true, 'Uses administrator-maintained prior size when direct metrics are unavailable.'),
  ('backup_not_confirmed', 'Backup not confirmed', NULL, true, 'Raised when backup status is not confirmed in the support settings.'),
  ('abnormal_error_activity', 'Abnormal error activity', 10, true, 'Raised when recent failed/error/access-denied activity exceeds the configured count.'),
  ('high_monthly_cost', 'Unusually high monthly operating cost', NULL, true, 'Uses configured threshold when set, otherwise compares current month to average monthly cost.'),
  ('inactive_privileged_account', 'Inactive privileged account', 1, true, 'Raised when administrator/system accounts appear inactive for 30+ days.')
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  threshold_value = COALESCE(system_alert_settings.threshold_value, EXCLUDED.threshold_value),
  enabled = system_alert_settings.enabled,
  notes = EXCLUDED.notes,
  updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_system_operating_costs_month ON system_operating_costs(billing_month DESC);
CREATE INDEX IF NOT EXISTS idx_system_operating_costs_category ON system_operating_costs(cost_category);
CREATE INDEX IF NOT EXISTS idx_system_operating_costs_status ON system_operating_costs(payment_status);

-- -----------------------------------------------------------------------------
-- 2. Safe database statistics RPC
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_system_admin_database_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_latest_migration TEXT;
  v_table_stats JSONB;
BEGIN
  IF NOT (
    COALESCE(fn_current_user_has_permission('operations.view'), false)
    OR COALESCE(fn_current_user_has_permission('operations.manage'), false)
    OR COALESCE(fn_current_user_has_permission('settings.manage'), false)
    OR COALESCE(fn_current_user_has_permission('all'), false)
  ) THEN
    RAISE EXCEPTION 'Access denied. Required permission: operations.view';
  END IF;

  SELECT MAX(version::TEXT)
  INTO v_latest_migration
  FROM supabase_migrations.schema_migrations;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.total_bytes DESC), '[]'::JSONB)
  INTO v_table_stats
  FROM (
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      c.reltuples::BIGINT AS estimated_rows,
      pg_total_relation_size(c.oid) AS total_bytes,
      pg_relation_size(c.oid) AS table_bytes,
      pg_indexes_size(c.oid) AS index_bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 30
  ) t;

  RETURN jsonb_build_object(
    'database_size_bytes', pg_database_size(current_database()),
    'latest_migration', v_latest_migration,
    'table_stats', v_table_stats
  );
EXCEPTION
  WHEN undefined_table OR insufficient_privilege THEN
    RETURN jsonb_build_object(
      'database_size_bytes', pg_database_size(current_database()),
      'latest_migration', NULL,
      'table_stats', COALESCE(v_table_stats, '[]'::JSONB)
    );
END;
$$;

REVOKE ALL ON FUNCTION fn_system_admin_database_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_system_admin_database_stats() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. RBAC metadata: restricted System Administration operations area
-- -----------------------------------------------------------------------------

INSERT INTO modules (code, name, description, base_path, icon, sort_order, is_active)
VALUES (
  'systems_administration',
  'System Administration',
  'Production support, operations monitoring, security readiness and capacity planning',
  '/dashboard/admin/operations',
  'Gauge',
  85,
  true
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_path = EXCLUDED.base_path,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = NOW();

INSERT INTO permissions (code, module_code, menu_code, action, label, description, is_active)
VALUES
  ('operations.view', 'systems_administration', NULL, 'view', 'View operations dashboards', 'View system health, usage, monitoring, cost and housekeeping dashboards without secrets.', true),
  ('operations.manage', 'systems_administration', NULL, 'manage', 'Manage operations support data', 'Maintain operating costs, support metrics, alert settings and backup confirmations.', true)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = true;

INSERT INTO menu_items (code, module_code, parent_code, label, href, icon, sort_order, required_permissions, is_active)
VALUES
  ('systems_administration.dashboard', 'systems_administration', NULL, 'Admin Dashboard', '/dashboard/admin/operations', 'Gauge', 10, ARRAY['operations.view','operations.manage','settings.manage'], true),
  ('systems_administration.health', 'systems_administration', NULL, 'System Health', '/dashboard/admin/operations/health', 'HeartPulse', 20, ARRAY['operations.view','operations.manage','settings.manage'], true),
  ('systems_administration.users_access', 'systems_administration', NULL, 'Users & Access', '/dashboard/users', 'UserCog', 30, ARRAY['users.manage'], true),
  ('systems_administration.transactions', 'systems_administration', NULL, 'Transaction Monitor', '/dashboard/admin/operations/transactions', 'Activity', 40, ARRAY['operations.view','operations.manage','audit.view'], true),
  ('systems_administration.storage_database', 'systems_administration', NULL, 'Storage & Database', '/dashboard/admin/operations/storage-database', 'Database', 50, ARRAY['operations.view','operations.manage','settings.manage'], true),
  ('systems_administration.costs', 'systems_administration', NULL, 'Operating Costs', '/dashboard/admin/operations/costs', 'ReceiptText', 60, ARRAY['operations.view','operations.manage','settings.manage'], true),
  ('systems_administration.alerts', 'systems_administration', NULL, 'System Alerts', '/dashboard/admin/operations/alerts', 'Bell', 70, ARRAY['operations.view','operations.manage','settings.manage'], true),
  ('systems_administration.housekeeping', 'systems_administration', NULL, 'Housekeeping', '/dashboard/admin/operations/housekeeping', 'Wrench', 80, ARRAY['operations.view','operations.manage','settings.manage'], true),
  ('systems_administration.audit', 'systems_administration', NULL, 'Audit & System Activity', '/dashboard/audit-log', 'ClipboardList', 90, ARRAY['audit.view'], true),
  ('systems_administration.info', 'systems_administration', NULL, 'System Information', '/dashboard/system-info', 'Info', 100, ARRAY['operations.view','operations.manage','settings.manage'], true)
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

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.code, true
FROM roles r
CROSS JOIN (VALUES ('operations.view'), ('operations.manage')) AS p(code)
WHERE r.name IN ('System Administrator', 'Administrator')
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

-- -----------------------------------------------------------------------------
-- 4. RLS, grants and audit-protective restrictions
-- -----------------------------------------------------------------------------

ALTER TABLE system_operating_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_alert_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_operating_costs_select_admin ON system_operating_costs;
CREATE POLICY system_operating_costs_select_admin ON system_operating_costs
  FOR SELECT USING (
    (SELECT fn_current_user_has_permission('operations.view'))
    OR (SELECT fn_current_user_has_permission('operations.manage'))
    OR (SELECT fn_current_user_has_permission('settings.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

DROP POLICY IF EXISTS system_operating_costs_manage_admin ON system_operating_costs;
CREATE POLICY system_operating_costs_manage_admin ON system_operating_costs
  FOR ALL USING (
    (SELECT fn_current_user_has_permission('operations.manage'))
    OR (SELECT fn_current_user_has_permission('settings.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  )
  WITH CHECK (
    (SELECT fn_current_user_has_permission('operations.manage'))
    OR (SELECT fn_current_user_has_permission('settings.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

DROP POLICY IF EXISTS system_alert_settings_select_admin ON system_alert_settings;
CREATE POLICY system_alert_settings_select_admin ON system_alert_settings
  FOR SELECT USING (
    (SELECT fn_current_user_has_permission('operations.view'))
    OR (SELECT fn_current_user_has_permission('operations.manage'))
    OR (SELECT fn_current_user_has_permission('settings.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

DROP POLICY IF EXISTS system_alert_settings_manage_admin ON system_alert_settings;
CREATE POLICY system_alert_settings_manage_admin ON system_alert_settings
  FOR ALL USING (
    (SELECT fn_current_user_has_permission('operations.manage'))
    OR (SELECT fn_current_user_has_permission('settings.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  )
  WITH CHECK (
    (SELECT fn_current_user_has_permission('operations.manage'))
    OR (SELECT fn_current_user_has_permission('settings.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

REVOKE ALL ON system_operating_costs, system_alert_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON system_operating_costs, system_alert_settings FROM authenticated;
GRANT SELECT ON system_operating_costs, system_alert_settings TO authenticated;

-- Ensure the navigation/permission metadata is visible only after authenticated RBAC loading.
GRANT SELECT ON modules, menu_items, permissions, role_permissions TO authenticated;

-- No client-side write/delete grants are added. Cost and alert maintenance must go
-- through controlled server APIs, and financial documents, payments, commitments and
-- audit records remain outside arbitrary housekeeping deletion from this operations layer.
