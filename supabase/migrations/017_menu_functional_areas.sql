-- =====================================================
-- NJSS MENU FUNCTIONAL AREAS
-- Reorganizes permission-driven menus into clear main areas.
-- =====================================================

-- Main sidebar areas. These are headings only; access is still controlled by
-- menu_items.required_permissions and role_permissions.
INSERT INTO modules (code, name, description, base_path, icon, sort_order, is_active) VALUES
  ('overview', 'Overview', 'Dashboard landing and user guidance', '/dashboard', 'LayoutDashboard', 10, true),
  ('budget', 'Budget', 'Budget preparation, ledger control, submissions, releases and budget reporting', '/dashboard/budget', 'Wallet', 20, true),
  ('transactions', 'Transactions', 'Requisitions, payment requests, commitments and financial processing', '/dashboard/ff3', 'FileText', 30, true),
  ('systems_administration', 'Systems Administration', 'Users, roles, access control, master data, settings and audit', '/dashboard/users', 'ShieldCheck', 90, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_path = EXCLUDED.base_path,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Retire old heading modules so the sidebar does not split the same business
-- area across finance/reports/administration/system headings.
UPDATE modules
SET is_active = false, updated_at = NOW()
WHERE code IN ('dashboard', 'finance', 'reports', 'administration', 'system');

-- Overview.
UPDATE menu_items
SET module_code = 'overview', label = 'Dashboard', sort_order = 10, updated_at = NOW()
WHERE code = 'dashboard.home';

UPDATE menu_items
SET module_code = 'overview', label = 'User Guide', sort_order = 20, updated_at = NOW()
WHERE code = 'system.help';

-- Budget.
UPDATE menu_items
SET module_code = 'budget', label = 'Budget Control', sort_order = 10, updated_at = NOW()
WHERE code = 'budget.control';

UPDATE menu_items
SET module_code = 'budget', label = 'Budget Preparation', sort_order = 20, updated_at = NOW()
WHERE code = 'budget.template';

UPDATE menu_items
SET module_code = 'budget', label = 'Budget Submissions', sort_order = 30, updated_at = NOW()
WHERE code = 'budget.plans';

UPDATE menu_items
SET module_code = 'budget', label = 'Ledger Items', sort_order = 40, updated_at = NOW()
WHERE code = 'system.master';

UPDATE menu_items
SET module_code = 'budget', label = 'Budget Reports', sort_order = 50, updated_at = NOW()
WHERE code = 'reports.library';

-- Transactions.
UPDATE menu_items
SET module_code = 'transactions', label = 'FF3 Requisitions', sort_order = 10, updated_at = NOW()
WHERE code = 'finance.ff3';

UPDATE menu_items
SET module_code = 'transactions', label = 'New FF3', sort_order = 11, updated_at = NOW()
WHERE code = 'finance.ff3.new';

UPDATE menu_items
SET module_code = 'transactions', label = 'FF4 Expenses', sort_order = 20, updated_at = NOW()
WHERE code = 'finance.ff4';

UPDATE menu_items
SET module_code = 'transactions', label = 'New FF4', sort_order = 21, updated_at = NOW()
WHERE code = 'finance.ff4.new';

UPDATE menu_items
SET module_code = 'transactions', label = 'Commitments', sort_order = 30, updated_at = NOW()
WHERE code = 'budget.commitments';

-- Systems Administration.
UPDATE menu_items
SET module_code = 'systems_administration', label = 'Access Control', sort_order = 10, updated_at = NOW()
WHERE code = 'administration.users';

UPDATE menu_items
SET module_code = 'systems_administration', label = 'Access Audit', sort_order = 20, updated_at = NOW()
WHERE code = 'administration.audit';

UPDATE menu_items
SET module_code = 'systems_administration', label = 'System Settings', sort_order = 30, updated_at = NOW()
WHERE code = 'system.settings';

-- Re-point permission catalog module grouping for the admin matrix.
UPDATE permissions SET module_code = 'overview' WHERE module_code = 'dashboard';
UPDATE permissions SET module_code = 'transactions' WHERE module_code = 'finance';
UPDATE permissions SET module_code = 'budget' WHERE module_code = 'reports' AND code IN ('reports.view', 'reports.export');
UPDATE permissions SET module_code = 'systems_administration' WHERE module_code IN ('administration', 'system');

-- Ensure permissions still refer to current menu groups where appropriate.
UPDATE permissions SET menu_code = 'dashboard.home' WHERE code = 'dashboard.view';
UPDATE permissions SET menu_code = 'reports.library' WHERE code IN ('reports.view', 'reports.export');
UPDATE permissions SET menu_code = 'system.master' WHERE code IN ('masterdata.manage', 'registry.manage');
UPDATE permissions SET menu_code = 'system.settings' WHERE code = 'settings.manage';
UPDATE permissions SET menu_code = 'administration.users' WHERE code IN ('users.manage', 'roles.manage', 'permissions.manage', 'modules.manage', 'data_scope.manage');
UPDATE permissions SET menu_code = 'administration.audit' WHERE code IN ('audit.view', 'audit.export');
