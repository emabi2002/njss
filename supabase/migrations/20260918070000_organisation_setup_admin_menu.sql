-- NJSS Organisation Setup navigation and System Administrator full-access guard.

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
  'system.organisation_setup',
  'systems_administration',
  NULL,
  'Organisation Setup',
  '/dashboard/admin/organisation',
  'Settings',
  35,
  ARRAY['masterdata.manage', 'users.manage']::varchar[],
  true
)
ON CONFLICT (code) DO UPDATE
SET module_code = EXCLUDED.module_code,
    parent_code = EXCLUDED.parent_code,
    label = EXCLUDED.label,
    href = EXCLUDED.href,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    required_permissions = EXCLUDED.required_permissions,
    is_active = true,
    updated_at = now();

-- System Administrator is intentionally system-wide. Keep the wildcard permission
-- explicit so all active menu items and all permission-guarded system functions
-- remain reachable to this protected role.
UPDATE public.roles
SET data_scope_type = 'SYSTEM_WIDE',
    is_system_role = true,
    is_protected = true,
    updated_at = now()
WHERE name = 'System Administrator';

INSERT INTO public.role_permissions (role_id, permission, is_allowed)
SELECT id, 'all', true
FROM public.roles
WHERE name = 'System Administrator'
ON CONFLICT (role_id, permission) DO UPDATE
SET is_allowed = true;
