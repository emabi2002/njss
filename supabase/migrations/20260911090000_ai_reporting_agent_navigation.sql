-- Register the NJSS AI Report Assistant under the existing Reports module.
-- Access is intentionally selective: users must hold reports.ai.use through
-- the dedicated AI Reporting User role (or the system-wide `all` permission).
-- Report-domain permissions and RLS remain authoritative after entry.
-- The AI Reporting User role is intentionally not a protected/business role,
-- so it does not interfere with the four fixed NJSS workflow groups.

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
  ARRAY['reports.ai.use']::text[],
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

INSERT INTO public.permissions (
  code,
  module_code,
  menu_code,
  action,
  label,
  description,
  is_active
)
VALUES (
  'reports.ai.use',
  'reports',
  'reports.ai_assistant',
  'view',
  'Use AI Report Assistant',
  'Access the NJSS natural-language AI reporting assistant. Report-domain permissions and RLS continue to restrict the data that can be queried.',
  true
)
ON CONFLICT (code) DO UPDATE
SET
  module_code = EXCLUDED.module_code,
  menu_code = EXCLUDED.menu_code,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

INSERT INTO public.roles (
  name,
  description,
  data_scope_type,
  is_system_role,
  is_business_role,
  is_protected,
  is_active
)
VALUES (
  'AI Reporting User',
  'Allows selected users to open and use the NJSS AI Report Assistant. Existing functional permissions and RLS determine which report domains and records they can query.',
  'OWN_RECORDS',
  false,
  false,
  false,
  true
)
ON CONFLICT (name) DO UPDATE
SET
  description = EXCLUDED.description,
  is_system_role = EXCLUDED.is_system_role,
  is_business_role = EXCLUDED.is_business_role,
  is_protected = EXCLUDED.is_protected,
  is_active = EXCLUDED.is_active,
  updated_at = now();

INSERT INTO public.role_permissions (role_id, permission, is_allowed)
SELECT r.id, 'reports.ai.use', true
FROM public.roles r
WHERE r.name = 'AI Reporting User'
ON CONFLICT (role_id, permission) DO UPDATE
SET is_allowed = EXCLUDED.is_allowed;
