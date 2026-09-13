-- Management reporting and drill-down workspace navigation.
-- Keeps the existing Reports library while adding a dedicated scoped management workspace.

INSERT INTO public.menu_items (
  code,
  module_code,
  parent_code,
  label,
  href,
  icon,
  sort_order,
  required_permissions,
  is_active
)
VALUES (
  'reports.management_drilldown',
  'reports',
  NULL,
  'Management Drill-Down',
  '/dashboard/reports/management',
  'BarChart3',
  81,
  ARRAY['reports.view']::text[],
  true
)
ON CONFLICT (code) DO UPDATE
SET
  module_code = EXCLUDED.module_code,
  parent_code = EXCLUDED.parent_code,
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  required_permissions = EXCLUDED.required_permissions,
  is_active = EXCLUDED.is_active,
  updated_at = now();