-- =====================================================
-- NJSS RBAC FRAMEWORK
-- User -> Role -> Permissions -> Module -> Menu -> Function -> Data Scope
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS data_scope_type VARCHAR(40) DEFAULT 'OWN_RECORDS';
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system_role BOOLEAN DEFAULT false;
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'roles table missing; apply base schema first';
END $$;

CREATE TABLE IF NOT EXISTS modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(80) UNIQUE NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  base_path TEXT NOT NULL,
  icon VARCHAR(80),
  sort_order INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(120) UNIQUE NOT NULL,
  module_code VARCHAR(80) NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
  parent_code VARCHAR(120) REFERENCES menu_items(code) ON DELETE SET NULL,
  label VARCHAR(160) NOT NULL,
  href TEXT NOT NULL,
  icon VARCHAR(80),
  sort_order INTEGER DEFAULT 100,
  required_permissions TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  code VARCHAR(120) PRIMARY KEY,
  module_code VARCHAR(80) NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
  menu_code VARCHAR(120) REFERENCES menu_items(code) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL,
  label VARCHAR(200) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission VARCHAR(120) NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  effect VARCHAR(10) NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, permission)
);

CREATE TABLE IF NOT EXISTS role_data_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  scope_type VARCHAR(40) NOT NULL CHECK (scope_type IN ('OWN_RECORDS', 'OWN_DIVISION', 'OWN_BRANCH', 'OWN_PROVINCE', 'DEPARTMENT_WIDE', 'SYSTEM_WIDE')),
  department_ids UUID[] DEFAULT '{}',
  division_ids UUID[] DEFAULT '{}',
  branch_ids UUID[] DEFAULT '{}',
  province_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role_id, scope_type)
);

CREATE TABLE IF NOT EXISTS user_data_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type VARCHAR(40) NOT NULL CHECK (scope_type IN ('OWN_RECORDS', 'OWN_DIVISION', 'OWN_BRANCH', 'OWN_PROVINCE', 'DEPARTMENT_WIDE', 'SYSTEM_WIDE')),
  department_ids UUID[] DEFAULT '{}',
  division_ids UUID[] DEFAULT '{}',
  branch_ids UUID[] DEFAULT '{}',
  province_ids UUID[] DEFAULT '{}',
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, scope_type)
);

CREATE TABLE IF NOT EXISTS segregation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(80) NOT NULL,
  create_action VARCHAR(80) DEFAULT 'CREATE',
  verify_action VARCHAR(80) DEFAULT 'VERIFY',
  approve_action VARCHAR(80) DEFAULT 'APPROVE',
  allow_same_user BOOLEAN DEFAULT false,
  bypass_permission VARCHAR(120) REFERENCES permissions(code) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entity_type, create_action, verify_action, approve_action)
);

CREATE TABLE IF NOT EXISTS approval_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  entity_type VARCHAR(80) NOT NULL,
  max_amount NUMERIC(15,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role_id, entity_type)
);

INSERT INTO modules (code, name, description, base_path, icon, sort_order, is_active) VALUES
  ('dashboard', 'Dashboard', 'NJSS executive and operational overview', '/dashboard', 'LayoutDashboard', 10, true),
  ('budget', 'Budget', 'Budget preparation, ledgers, submissions, releases and consolidation', '/dashboard/budget', 'Wallet', 20, true),
  ('finance', 'Finance', 'FF3, FF4, commitments and payment workflows', '/dashboard/ff3', 'FileText', 30, true),
  ('reports', 'Reports', 'Management, finance and audit reporting', '/dashboard/reports', 'BarChart3', 40, true),
  ('administration', 'Administration', 'Users, roles, permissions, data scope and access audit', '/dashboard/users', 'ShieldCheck', 90, true),
  ('system', 'System Configuration', 'Master data, registry and settings', '/dashboard/master', 'Settings', 100, true),
  ('human_resources', 'Human Resources', 'HR employee and establishment management', '/dashboard/hr', 'Users', 200, false),
  ('payroll', 'Payroll', 'Payroll controls and reports', '/dashboard/payroll', 'Wallet', 210, false),
  ('procurement', 'Procurement', 'Procurement and supplier workflows', '/dashboard/procurement', 'FileCheck', 220, false),
  ('assets', 'Assets', 'Asset register and custody controls', '/dashboard/assets', 'FolderOpen', 230, false),
  ('fleet', 'Fleet', 'Fleet and transport controls', '/dashboard/fleet', 'FolderOpen', 240, false)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_path = EXCLUDED.base_path,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

INSERT INTO menu_items (code, module_code, parent_code, label, href, icon, sort_order, required_permissions, is_active) VALUES
  ('dashboard.home', 'dashboard', NULL, 'Dashboard', '/dashboard', 'LayoutDashboard', 10, ARRAY['dashboard.view'], true),
  ('budget.control', 'budget', NULL, 'Budget', '/dashboard/budget', 'Wallet', 20, ARRAY['budget.view','budget.module.view'], true),
  ('budget.template', 'budget', NULL, 'Budget Preparation', '/dashboard/budget-template', 'Calculator', 30, ARRAY['budget.template','budget.template.submit','budget.template.review','budget.template.approve'], true),
  ('budget.plans', 'budget', NULL, 'Budget Submissions', '/dashboard/plans', 'BookOpen', 40, ARRAY['plans.create','plans.submit','plans.review','plans.approve','plans.authorize','plans.confirm','budget.view'], true),
  ('budget.commitments', 'budget', NULL, 'Commitments', '/dashboard/commitments', 'FileCheck', 50, ARRAY['budget.view','ff4.verify','ff4.process'], true),
  ('finance.ff3', 'finance', NULL, 'FF3 Requisitions', '/dashboard/ff3', 'FileText', 60, ARRAY['ff3.view','ff3.create','ff3.endorse','ff3.approve','ff3.reject'], true),
  ('finance.ff3.new', 'finance', 'finance.ff3', 'New FF3', '/dashboard/ff3/new', 'FileText', 61, ARRAY['ff3.create'], true),
  ('finance.ff4', 'finance', NULL, 'FF4 Expenses', '/dashboard/ff4', 'FileText', 70, ARRAY['ff4.view','ff4.create','ff4.verify','ff4.process'], true),
  ('finance.ff4.new', 'finance', 'finance.ff4', 'New FF4', '/dashboard/ff4/new', 'FileText', 71, ARRAY['ff4.create'], true),
  ('reports.library', 'reports', NULL, 'Relevant Reports', '/dashboard/reports', 'BarChart3', 80, ARRAY['reports.view','reports.export'], true),
  ('administration.users', 'administration', NULL, 'Access Control', '/dashboard/users', 'Users', 90, ARRAY['users.manage'], true),
  ('administration.audit', 'administration', NULL, 'Access Audit', '/dashboard/audit-log', 'ClipboardList', 95, ARRAY['audit.view'], true),
  ('system.master', 'system', NULL, 'Master Data', '/dashboard/master', 'FolderOpen', 100, ARRAY['masterdata.manage','registry.manage'], true),
  ('system.settings', 'system', NULL, 'System Settings', '/dashboard/settings', 'Settings', 110, ARRAY['settings.manage'], true),
  ('system.help', 'system', NULL, 'User Guide', '/dashboard/help', 'BookOpen', 120, ARRAY['dashboard.view'], true)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  parent_code = EXCLUDED.parent_code,
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  required_permissions = EXCLUDED.required_permissions,
  updated_at = NOW();

INSERT INTO permissions (code, module_code, menu_code, action, label, description, is_active) VALUES
  ('all','administration',NULL,'manage','Full system access','Bypasses all application RBAC checks',true),
  ('dashboard.view','dashboard','dashboard.home','view','View dashboard',NULL,true),
  ('budget.module.view','budget','budget.control','view','Access Budget module',NULL,true),
  ('budget.module.submit','budget','budget.plans','submit','Submit Budget module records',NULL,true),
  ('budget.module.review','budget','budget.plans','verify','Review Budget module records',NULL,true),
  ('budget.module.approve','budget','budget.plans','approve','Approve Budget module records',NULL,true),
  ('budget.module.admin','budget','budget.control','manage','Administer Budget module',NULL,true),
  ('budget.view','budget','budget.control','view','View budget control',NULL,true),
  ('budget.confirm','budget','budget.control','approve','Confirm budget',NULL,true),
  ('budget.release','budget','budget.control','approve','Release budget',NULL,true),
  ('budget.template','budget','budget.template','view','View budget template',NULL,true),
  ('budget.template.submit','budget','budget.template','submit','Submit budget template',NULL,true),
  ('budget.template.review','budget','budget.template','verify','Review budget template',NULL,true),
  ('budget.template.approve','budget','budget.template','approve','Approve budget template',NULL,true),
  ('budget.export','budget','budget.control','export','Export budget reports',NULL,true),
  ('plans.create','budget','budget.plans','create','Create annual plans',NULL,true),
  ('plans.submit','budget','budget.plans','submit','Submit annual plans',NULL,true),
  ('plans.review','budget','budget.plans','verify','Review annual plans',NULL,true),
  ('plans.approve','budget','budget.plans','approve','Approve annual plans',NULL,true),
  ('plans.authorize','budget','budget.plans','approve','Authorize annual plans',NULL,true),
  ('plans.confirm','budget','budget.plans','approve','Confirm plans to budget',NULL,true),
  ('consolidation.run','budget','budget.control','manage','Run budget consolidation',NULL,true),
  ('ff3.view','finance','finance.ff3','view','View FF3 requisitions',NULL,true),
  ('ff3.create','finance','finance.ff3','create','Create FF3 requisitions',NULL,true),
  ('ff3.edit','finance','finance.ff3','edit','Edit FF3 drafts',NULL,true),
  ('ff3.delete','finance','finance.ff3','delete','Delete FF3 drafts',NULL,true),
  ('ff3.submit','finance','finance.ff3','submit','Submit FF3 requisitions',NULL,true),
  ('ff3.endorse','finance','finance.ff3','verify','Endorse FF3 requisitions',NULL,true),
  ('ff3.approve','finance','finance.ff3','approve','Approve FF3 requisitions',NULL,true),
  ('ff3.reject','finance','finance.ff3','reject','Reject FF3 requisitions',NULL,true),
  ('ff3.print','finance','finance.ff3','print','Print FF3 requisitions',NULL,true),
  ('ff3.export','finance','finance.ff3','export','Export FF3 requisitions',NULL,true),
  ('ff4.view','finance','finance.ff4','view','View FF4 payment requests',NULL,true),
  ('ff4.create','finance','finance.ff4','create','Create FF4 payment requests',NULL,true),
  ('ff4.edit','finance','finance.ff4','edit','Edit FF4 drafts',NULL,true),
  ('ff4.delete','finance','finance.ff4','delete','Delete FF4 drafts',NULL,true),
  ('ff4.submit','finance','finance.ff4','submit','Submit FF4 payment requests',NULL,true),
  ('ff4.verify','finance','finance.ff4','verify','Verify FF4 payment requests',NULL,true),
  ('ff4.approve','finance','finance.ff4','approve','Approve FF4 payment requests',NULL,true),
  ('ff4.process','finance','finance.ff4','manage','Process FF4 payments',NULL,true),
  ('ff4.reject','finance','finance.ff4','reject','Reject FF4 payment requests',NULL,true),
  ('ff4.print','finance','finance.ff4','print','Print FF4 payment requests',NULL,true),
  ('ff4.export','finance','finance.ff4','export','Export FF4 payment requests',NULL,true),
  ('reports.view','reports','reports.library','view','View reports',NULL,true),
  ('reports.export','reports','reports.library','export','Export reports',NULL,true),
  ('users.manage','administration','administration.users','manage','Manage users',NULL,true),
  ('roles.manage','administration','administration.users','manage','Manage roles',NULL,true),
  ('permissions.manage','administration','administration.users','manage','Manage permission matrix',NULL,true),
  ('modules.manage','administration','administration.users','manage','Manage modules and menus',NULL,true),
  ('data_scope.manage','administration','administration.users','manage','Manage data scope rules',NULL,true),
  ('audit.view','administration','administration.audit','view','View audit logs',NULL,true),
  ('audit.export','administration','administration.audit','export','Export audit logs',NULL,true),
  ('masterdata.manage','system','system.master','manage','Manage master data',NULL,true),
  ('registry.manage','system','system.master','manage','Manage registries',NULL,true),
  ('settings.manage','system','system.settings','manage','Manage system settings',NULL,true)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  menu_code = EXCLUDED.menu_code,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

INSERT INTO roles (name, description, data_scope_type, is_system_role, is_active) VALUES
  ('Budget Officer', 'Prepare and submit budget records', 'OWN_DIVISION', false, true),
  ('Budget Manager', 'Review and approve budget records across assigned budget areas', 'DEPARTMENT_WIDE', false, true),
  ('HR Officer', 'Manage HR records for assigned scope', 'OWN_BRANCH', false, true),
  ('HR Manager', 'Review and manage HR records department-wide', 'DEPARTMENT_WIDE', false, true),
  ('Payroll Officer', 'Prepare payroll records for assigned scope', 'OWN_BRANCH', false, true),
  ('Payroll Manager', 'Review and approve payroll records', 'DEPARTMENT_WIDE', false, true),
  ('Procurement Officer', 'Prepare procurement records', 'OWN_DIVISION', false, true),
  ('Asset Officer', 'Manage asset records for assigned scope', 'OWN_BRANCH', false, true),
  ('Finance Officer', 'Create finance payment records', 'OWN_RECORDS', false, true),
  ('Divisional Manager', 'Review divisional budget records', 'OWN_DIVISION', false, true),
  ('Executive Management', 'Dashboard and executive reports', 'SYSTEM_WIDE', false, true),
  ('Auditor', 'Read-only audit and report access', 'SYSTEM_WIDE', false, true),
  ('System Administrator', 'Full system access', 'SYSTEM_WIDE', true, true)
ON CONFLICT (name) DO UPDATE SET
  description = COALESCE(roles.description, EXCLUDED.description),
  data_scope_type = COALESCE(roles.data_scope_type, EXCLUDED.data_scope_type),
  updated_at = NOW();

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.code, true
FROM roles r
JOIN permissions p ON p.code = 'all'
WHERE r.name = 'System Administrator'
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, permission, true
FROM roles r
CROSS JOIN LATERAL unnest(ARRAY['dashboard.view','budget.module.view','budget.view','budget.template','budget.template.submit','plans.create','plans.submit','reports.view']) permission
WHERE r.name = 'Budget Officer'
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = EXCLUDED.is_allowed;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, permission, true
FROM roles r
CROSS JOIN LATERAL unnest(ARRAY['dashboard.view','budget.module.view','budget.module.review','budget.module.approve','budget.view','budget.template','budget.template.review','budget.template.approve','budget.release','consolidation.run','reports.view','reports.export']) permission
WHERE r.name = 'Budget Manager'
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = EXCLUDED.is_allowed;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, permission, true
FROM roles r
CROSS JOIN LATERAL unnest(ARRAY['dashboard.view','ff4.view','ff4.create','ff4.submit','budget.view','reports.view']) permission
WHERE r.name = 'Finance Officer'
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = EXCLUDED.is_allowed;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, permission, true
FROM roles r
CROSS JOIN LATERAL unnest(ARRAY['dashboard.view','audit.view','audit.export','reports.view','reports.export']) permission
WHERE r.name = 'Auditor'
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = EXCLUDED.is_allowed;

INSERT INTO role_data_scopes (role_id, scope_type)
SELECT id, COALESCE(data_scope_type, 'OWN_RECORDS') FROM roles
ON CONFLICT (role_id, scope_type) DO NOTHING;

CREATE OR REPLACE VIEW v_user_effective_permissions AS
SELECT DISTINCT
  u.id AS user_id,
  u.auth_user_id,
  u.email,
  rp.permission
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.is_allowed = true
JOIN permissions p ON p.code = rp.permission AND p.is_active = true
WHERE u.is_active = true
UNION
SELECT DISTINCT
  u.id AS user_id,
  u.auth_user_id,
  u.email,
  up.permission
FROM users u
JOIN user_permissions up ON up.user_id = u.id AND up.effect = 'ALLOW'
JOIN permissions p ON p.code = up.permission AND p.is_active = true
WHERE u.is_active = true
  AND (up.valid_from IS NULL OR up.valid_from <= NOW())
  AND (up.valid_until IS NULL OR up.valid_until >= NOW())
EXCEPT
SELECT DISTINCT
  u.id AS user_id,
  u.auth_user_id,
  u.email,
  up.permission
FROM users u
JOIN user_permissions up ON up.user_id = u.id AND up.effect = 'DENY'
WHERE u.is_active = true
  AND (up.valid_from IS NULL OR up.valid_from <= NOW())
  AND (up.valid_until IS NULL OR up.valid_until >= NOW());

CREATE OR REPLACE FUNCTION fn_current_app_user_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT id
  FROM users
  WHERE auth_user_id = auth.uid() OR email = auth.email()
  ORDER BY CASE WHEN auth_user_id = auth.uid() THEN 0 ELSE 1 END
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_user_has_permission(p_auth_uid UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM v_user_effective_permissions v
    WHERE v.auth_user_id = p_auth_uid
      AND (v.permission = p_permission OR v.permission = 'all')
  );
$$;

CREATE OR REPLACE FUNCTION fn_current_user_has_permission(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT fn_user_has_permission(auth.uid(), p_permission);
$$;

CREATE OR REPLACE FUNCTION fn_check_segregation_of_duties(
  p_entity_type TEXT,
  p_created_by UUID,
  p_verified_by UUID,
  p_approved_by UUID,
  p_actor UUID DEFAULT fn_current_app_user_id()
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN sr.allow_same_user THEN true
      WHEN sr.bypass_permission IS NOT NULL AND fn_current_user_has_permission(sr.bypass_permission) THEN true
      ELSE NOT (
        p_actor IS NOT NULL AND (
          p_actor = COALESCE(p_created_by, '00000000-0000-0000-0000-000000000000'::uuid)
          OR p_actor = COALESCE(p_verified_by, '00000000-0000-0000-0000-000000000000'::uuid)
          OR p_actor = COALESCE(p_approved_by, '00000000-0000-0000-0000-000000000000'::uuid)
        )
      )
    END
    FROM segregation_rules sr
    WHERE sr.entity_type = p_entity_type AND sr.is_active = true
    LIMIT 1
  ), true);
$$;

INSERT INTO segregation_rules (entity_type, create_action, verify_action, approve_action, allow_same_user, bypass_permission) VALUES
  ('FF3', 'CREATE', 'ENDORSE', 'APPROVE', false, 'all'),
  ('FF4', 'CREATE', 'VERIFY', 'APPROVE', false, 'all'),
  ('BUDGET_SUBMISSION', 'CREATE', 'REVIEW', 'APPROVE', false, 'all')
ON CONFLICT (entity_type, create_action, verify_action, approve_action) DO NOTHING;

-- Normal users must not be able to tamper with audit logs. Inserts are allowed
-- for audit events; updates/deletes are intentionally denied by policy.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_select_authorized ON audit_logs;
DROP POLICY IF EXISTS audit_logs_insert_authenticated ON audit_logs;
DROP POLICY IF EXISTS audit_logs_no_update ON audit_logs;
DROP POLICY IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE POLICY audit_logs_select_authorized ON audit_logs
  FOR SELECT USING (fn_current_user_has_permission('audit.view') OR fn_current_user_has_permission('all'));
CREATE POLICY audit_logs_insert_authenticated ON audit_logs
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY audit_logs_no_update ON audit_logs
  FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY audit_logs_no_delete ON audit_logs
  FOR DELETE USING (false);

-- Foundational RLS examples. Existing legacy migrations granted broad anon
-- access; keep this additive and explicit so future module tables can copy the
-- same pattern without rewriting authorization logic.
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_data_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_data_scopes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS modules_read_authenticated ON modules;
CREATE POLICY modules_read_authenticated ON modules FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
DROP POLICY IF EXISTS modules_manage_authorized ON modules;
CREATE POLICY modules_manage_authorized ON modules FOR ALL USING (fn_current_user_has_permission('modules.manage') OR fn_current_user_has_permission('all')) WITH CHECK (fn_current_user_has_permission('modules.manage') OR fn_current_user_has_permission('all'));

DROP POLICY IF EXISTS menu_items_read_authenticated ON menu_items;
CREATE POLICY menu_items_read_authenticated ON menu_items FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
DROP POLICY IF EXISTS menu_items_manage_authorized ON menu_items;
CREATE POLICY menu_items_manage_authorized ON menu_items FOR ALL USING (fn_current_user_has_permission('modules.manage') OR fn_current_user_has_permission('all')) WITH CHECK (fn_current_user_has_permission('modules.manage') OR fn_current_user_has_permission('all'));

DROP POLICY IF EXISTS permissions_read_authenticated ON permissions;
CREATE POLICY permissions_read_authenticated ON permissions FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
DROP POLICY IF EXISTS permissions_manage_authorized ON permissions;
CREATE POLICY permissions_manage_authorized ON permissions FOR ALL USING (fn_current_user_has_permission('permissions.manage') OR fn_current_user_has_permission('all')) WITH CHECK (fn_current_user_has_permission('permissions.manage') OR fn_current_user_has_permission('all'));

DROP POLICY IF EXISTS role_permissions_read_authorized ON role_permissions;
CREATE POLICY role_permissions_read_authorized ON role_permissions FOR SELECT USING (fn_current_user_has_permission('permissions.manage') OR fn_current_user_has_permission('users.manage') OR fn_current_user_has_permission('all'));
DROP POLICY IF EXISTS role_permissions_manage_authorized ON role_permissions;
CREATE POLICY role_permissions_manage_authorized ON role_permissions FOR ALL USING (fn_current_user_has_permission('permissions.manage') OR fn_current_user_has_permission('all')) WITH CHECK (fn_current_user_has_permission('permissions.manage') OR fn_current_user_has_permission('all'));

DROP POLICY IF EXISTS user_permissions_manage_authorized ON user_permissions;
CREATE POLICY user_permissions_manage_authorized ON user_permissions FOR ALL USING (fn_current_user_has_permission('permissions.manage') OR fn_current_user_has_permission('all')) WITH CHECK (fn_current_user_has_permission('permissions.manage') OR fn_current_user_has_permission('all'));

DROP POLICY IF EXISTS role_data_scopes_manage_authorized ON role_data_scopes;
CREATE POLICY role_data_scopes_manage_authorized ON role_data_scopes FOR ALL USING (fn_current_user_has_permission('data_scope.manage') OR fn_current_user_has_permission('all')) WITH CHECK (fn_current_user_has_permission('data_scope.manage') OR fn_current_user_has_permission('all'));

DROP POLICY IF EXISTS user_data_scopes_manage_authorized ON user_data_scopes;
CREATE POLICY user_data_scopes_manage_authorized ON user_data_scopes FOR ALL USING (fn_current_user_has_permission('data_scope.manage') OR fn_current_user_has_permission('all')) WITH CHECK (fn_current_user_has_permission('data_scope.manage') OR fn_current_user_has_permission('all'));

GRANT SELECT ON modules, menu_items, permissions TO anon, authenticated;
GRANT SELECT ON v_user_effective_permissions TO authenticated;
GRANT EXECUTE ON FUNCTION fn_current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION fn_user_has_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_current_user_has_permission(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_check_segregation_of_duties(TEXT, UUID, UUID, UUID, UUID) TO authenticated;
