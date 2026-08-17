-- NJSS Phase 6 — Navigation separation for administration vs system support
-- Additive metadata-only change. Does not alter financial workflows.

INSERT INTO modules (code, name, description, base_path, icon, sort_order, is_active)
VALUES
  ('njss_operations', 'NJSS Operations', 'Core NJSS planning, budget, funding, transaction and reporting functions', '/dashboard', 'LayoutDashboard', 10, true),
  ('administration', 'System Administration', 'Application users, access control, audit access and NJSS configuration', '/dashboard/users', 'ShieldCheck', 85, true),
  ('systems_administration', 'System Support & Operations', 'Infrastructure monitoring, technical support, capacity management, housekeeping and operating-cost controls', '/dashboard/admin/operations', 'Gauge', 95, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_path = EXCLUDED.base_path,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = NOW();

UPDATE modules
SET is_active = false, updated_at = NOW()
WHERE code IN ('overview', 'dashboard', 'finance', 'reports', 'system', 'transactions');

UPDATE menu_items SET module_code = 'njss_operations', parent_code = NULL, label = 'Dashboard', sort_order = 10, required_permissions = ARRAY['dashboard.view'], is_active = true, updated_at = NOW()
WHERE code = 'dashboard.home';

UPDATE menu_items SET module_code = 'njss_operations', parent_code = NULL, label = 'Planning', sort_order = 20, required_permissions = ARRAY['budget.template.view','budget.template.create','budget.template.edit','budget.template.submit','budget.template.review','budget.template.approve','budget.template'], is_active = true, updated_at = NOW()
WHERE code = 'budget.template';

UPDATE menu_items SET module_code = 'njss_operations', parent_code = NULL, label = 'Budget', sort_order = 30, required_permissions = ARRAY['budget.view','budget.module.view'], is_active = true, updated_at = NOW()
WHERE code = 'budget.control';

UPDATE menu_items SET module_code = 'njss_operations', parent_code = NULL, label = 'Funding', sort_order = 40, required_permissions = ARRAY['funding.view'], is_active = true, updated_at = NOW()
WHERE code = 'budget.funding';

UPDATE menu_items SET module_code = 'njss_operations', parent_code = NULL, label = 'FF3', sort_order = 50, required_permissions = ARRAY['ff3.view','ff3.create','ff3.endorse','ff3.approve','ff3.reject'], is_active = true, updated_at = NOW()
WHERE code = 'finance.ff3';

UPDATE menu_items SET module_code = 'njss_operations', parent_code = 'finance.ff3', label = 'New FF3', sort_order = 51, required_permissions = ARRAY['ff3.create'], is_active = true, updated_at = NOW()
WHERE code = 'finance.ff3.new';

UPDATE menu_items SET module_code = 'njss_operations', parent_code = NULL, label = 'Commitments', sort_order = 60, required_permissions = ARRAY['commitment.view','budget.control.view','budget.view'], is_active = true, updated_at = NOW()
WHERE code = 'budget.commitments';

UPDATE menu_items SET module_code = 'njss_operations', parent_code = NULL, label = 'FF4', sort_order = 70, required_permissions = ARRAY['ff4.view','ff4.create','ff4.verify','ff4.process'], is_active = true, updated_at = NOW()
WHERE code = 'finance.ff4';

UPDATE menu_items SET module_code = 'njss_operations', parent_code = 'finance.ff4', label = 'New FF4', sort_order = 71, required_permissions = ARRAY['ff4.create'], is_active = true, updated_at = NOW()
WHERE code = 'finance.ff4.new';

UPDATE menu_items SET module_code = 'njss_operations', parent_code = NULL, label = 'Management Reports', sort_order = 80, required_permissions = ARRAY['reports.view','reports.export'], is_active = true, updated_at = NOW()
WHERE code = 'reports.library';

UPDATE menu_items SET module_code = 'njss_operations', parent_code = NULL, label = 'Supplier Register', sort_order = 90, required_permissions = ARRAY['supplier.view','supplier.create'], is_active = true, updated_at = NOW()
WHERE code = 'finance.suppliers';

UPDATE menu_items SET module_code = 'njss_operations', parent_code = NULL, label = 'User Guide', sort_order = 110, required_permissions = ARRAY['dashboard.view'], is_active = true, updated_at = NOW()
WHERE code = 'system.help';

UPDATE menu_items SET module_code = 'administration', parent_code = NULL, label = 'Access Control', href = '/dashboard/users?tab=permissions', icon = 'ShieldCheck', sort_order = 10, required_permissions = ARRAY['users.manage','roles.manage','permissions.manage','modules.manage','data_scope.manage'], is_active = true, updated_at = NOW()
WHERE code = 'administration.users';

UPDATE menu_items SET module_code = 'administration', parent_code = NULL, label = 'Access Audit', href = '/dashboard/audit-log', icon = 'ClipboardList', sort_order = 20, required_permissions = ARRAY['audit.view'], is_active = true, updated_at = NOW()
WHERE code = 'administration.audit';

UPDATE menu_items SET module_code = 'administration', parent_code = NULL, label = 'System Settings', href = '/dashboard/settings', icon = 'Settings', sort_order = 30, required_permissions = ARRAY['settings.manage'], is_active = true, updated_at = NOW()
WHERE code = 'system.settings';

INSERT INTO menu_items (code, module_code, parent_code, label, href, icon, sort_order, required_permissions, is_active)
VALUES ('administration.users_access', 'administration', NULL, 'Users & Access', '/dashboard/users?tab=users', 'UserCog', 40, ARRAY['users.manage'], true)
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

UPDATE menu_items SET is_active = false, updated_at = NOW()
WHERE code IN ('administration.uat', 'systems_administration.users_access');

INSERT INTO menu_items (code, module_code, parent_code, label, href, icon, sort_order, required_permissions, is_active)
VALUES ('systems_administration.systems_operations_heading', 'systems_administration', NULL, 'Systems Operations', '#systems-operations', 'Gauge', 5, ARRAY['operations.view','operations.manage','settings.manage'], true)
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

UPDATE menu_items SET module_code = 'systems_administration', parent_code = NULL, label = 'Admin Dashboard', href = '/dashboard/admin/operations', icon = 'Gauge', sort_order = 10, required_permissions = ARRAY['operations.view','operations.manage','settings.manage'], is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.dashboard';

UPDATE menu_items SET module_code = 'systems_administration', parent_code = NULL, label = 'Systems Health', sort_order = 20, required_permissions = ARRAY['operations.view','operations.manage','settings.manage'], is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.health';

UPDATE menu_items SET module_code = 'systems_administration', parent_code = NULL, label = 'Transaction Monitor', sort_order = 30, required_permissions = ARRAY['operations.view','operations.manage','settings.manage'], is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.transactions';

UPDATE menu_items SET module_code = 'systems_administration', parent_code = NULL, label = 'Storage & Database', sort_order = 40, required_permissions = ARRAY['operations.view','operations.manage','settings.manage'], is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.storage_database';

UPDATE menu_items SET module_code = 'systems_administration', parent_code = NULL, label = 'Operating Costs', sort_order = 50, required_permissions = ARRAY['operations.view','operations.manage','settings.manage'], is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.costs';

UPDATE menu_items SET module_code = 'systems_administration', parent_code = NULL, label = 'Systems Alert', sort_order = 60, required_permissions = ARRAY['operations.view','operations.manage','settings.manage'], is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.alerts';

UPDATE menu_items SET module_code = 'systems_administration', parent_code = NULL, label = 'Housekeeping', sort_order = 70, required_permissions = ARRAY['operations.view','operations.manage','settings.manage'], is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.housekeeping';

UPDATE menu_items SET module_code = 'systems_administration', parent_code = NULL, label = 'Audit & System Activity', href = '/dashboard/audit-log', icon = 'ClipboardList', sort_order = 80, required_permissions = ARRAY['operations.view','operations.manage','settings.manage'], is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.audit';

INSERT INTO menu_items (code, module_code, parent_code, label, href, icon, sort_order, required_permissions, is_active)
VALUES ('systems_administration.uat', 'systems_administration', NULL, 'UAT Checklist', '/dashboard/uat-checklist', 'ClipboardList', 90, ARRAY['operations.view','operations.manage','settings.manage'], true)
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

UPDATE menu_items SET module_code = 'systems_administration', parent_code = NULL, label = 'System Information', sort_order = 100, required_permissions = ARRAY['operations.view','operations.manage','settings.manage'], is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.info';

UPDATE permissions SET module_code = 'njss_operations' WHERE module_code IN ('dashboard', 'budget', 'finance', 'reports', 'overview', 'transactions')
  OR code IN ('dashboard.view','reports.view','reports.export');
UPDATE permissions SET module_code = 'administration' WHERE code IN ('users.manage','roles.manage','permissions.manage','modules.manage','data_scope.manage','audit.view','audit.export','settings.manage','masterdata.manage','registry.manage','all');
UPDATE permissions SET module_code = 'systems_administration' WHERE code IN ('operations.view','operations.manage');

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.code, true
FROM roles r
CROSS JOIN (VALUES ('operations.view'), ('operations.manage')) AS p(code)
WHERE r.name IN ('System Administrator', 'Administrator')
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;
