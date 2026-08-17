-- NJSS Phase 6 — Cleanup duplicate Systems Operations navigation links
-- Navigation metadata only. Does not alter financial workflows.

UPDATE modules
SET
  name = 'Systems Operations',
  description = 'Technical support dashboard and supporting operations controls',
  base_path = '/dashboard/admin/operations',
  icon = 'Gauge',
  sort_order = 95,
  is_active = true,
  updated_at = NOW()
WHERE code = 'systems_administration';

UPDATE menu_items
SET is_active = false, updated_at = NOW()
WHERE code IN (
  'systems_administration.health',
  'systems_administration.transactions',
  'systems_administration.storage_database',
  'systems_administration.costs',
  'systems_administration.alerts'
);

UPDATE menu_items
SET label = 'Systems Operations', sort_order = 5, is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.systems_operations_heading';

UPDATE menu_items
SET label = 'Admin Dashboard', sort_order = 10, is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.dashboard';

UPDATE menu_items
SET sort_order = 20, is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.housekeeping';

UPDATE menu_items
SET sort_order = 30, is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.audit';

UPDATE menu_items
SET sort_order = 40, is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.uat';

UPDATE menu_items
SET sort_order = 50, is_active = true, updated_at = NOW()
WHERE code = 'systems_administration.info';
