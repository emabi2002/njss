-- Register the NJSS AI Report Assistant under the existing Reports module.
-- Access is limited to users who already hold reports.view; category-specific
-- permissions are checked again by report_agent_can before any query executes.

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
  'reports.ai_assistant',
  'reports',
  NULL,
  'AI Report Assistant',
  '/dashboard/reports/ai',
  'BarChart3',
  82,
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
