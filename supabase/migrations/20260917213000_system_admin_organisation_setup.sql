-- =============================================================================
-- NJSS — SYSTEM ADMINISTRATOR ORGANISATION SETUP
-- Ensures the System Administrator retains explicit full-system access and
-- exposes a dedicated Organisation Setup menu for Divisions and Sections.
-- =============================================================================

DO $system_admin$
DECLARE
  v_role_id uuid;
BEGIN
  SELECT id
  INTO v_role_id
  FROM public.roles
  WHERE lower(name) = lower('System Administrator')
    AND COALESCE(is_active, true) = true
  LIMIT 1;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Active System Administrator role was not found';
  END IF;

  UPDATE public.roles
  SET data_scope_type = 'SYSTEM_WIDE',
      is_system_role = true,
      updated_at = now()
  WHERE id = v_role_id;

  INSERT INTO public.role_permissions (role_id, permission, is_allowed)
  VALUES (v_role_id, 'all', true)
  ON CONFLICT (role_id, permission)
  DO UPDATE SET is_allowed = EXCLUDED.is_allowed;
END
$system_admin$;

INSERT INTO public.menu_items (
  code,
  module_code,
  parent_code,
  label,
  href,
  icon,
  sort_order,
  required_permissions,
  is_active,
  updated_at
)
VALUES (
  'systems_administration.organisation_setup',
  'systems_administration',
  NULL,
  'Organisation Setup',
  '/dashboard/master/organisation',
  'Building2',
  16,
  ARRAY['all']::text[],
  true,
  now()
)
ON CONFLICT (code)
DO UPDATE SET
  module_code = EXCLUDED.module_code,
  parent_code = EXCLUDED.parent_code,
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  required_permissions = EXCLUDED.required_permissions,
  is_active = EXCLUDED.is_active,
  updated_at = now();

DO $verify$
DECLARE
  v_role_id uuid;
BEGIN
  SELECT id INTO v_role_id
  FROM public.roles
  WHERE lower(name) = lower('System Administrator')
    AND COALESCE(is_active, true) = true
  LIMIT 1;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_id = v_role_id
      AND permission = 'all'
      AND is_allowed = true
  ) THEN
    RAISE EXCEPTION 'System Administrator full-system permission was not established';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.roles
    WHERE id = v_role_id
      AND data_scope_type = 'SYSTEM_WIDE'
  ) THEN
    RAISE EXCEPTION 'System Administrator must have SYSTEM_WIDE data scope';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.menu_items
    WHERE code = 'systems_administration.organisation_setup'
      AND href = '/dashboard/master/organisation'
      AND is_active = true
      AND required_permissions = ARRAY['all']::text[]
  ) THEN
    RAISE EXCEPTION 'Organisation Setup menu item was not established';
  END IF;
END
$verify$;
