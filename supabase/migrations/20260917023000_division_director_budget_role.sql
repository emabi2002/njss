-- =============================================================================
-- NJSS DIVISION DIRECTOR — BUDGET REALLOCATION REQUEST ROLE
-- Creates the business role required by the approved budget process without
-- assigning it to any user automatically. User-role assignment remains an
-- explicit Access Control administration action.
-- =============================================================================

INSERT INTO public.roles (
  name,
  description,
  data_scope_type,
  is_active,
  is_business_role,
  is_protected,
  updated_at
)
VALUES (
  'Division Director',
  'Division Director business role. May request budget reallocations for Registrar decision within the NJSS Head Office budget process.',
  'OWN_DIVISION',
  true,
  true,
  true,
  now()
)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  data_scope_type = EXCLUDED.data_scope_type,
  is_active = true,
  is_business_role = true,
  is_protected = true,
  updated_at = now();

INSERT INTO public.role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.permission, true
FROM public.roles r
CROSS JOIN (
  VALUES
    ('budget.view'::varchar),
    ('budget.reallocation.request'::varchar),
    ('budget.report.view'::varchar)
) AS p(permission)
WHERE r.name = 'Division Director'
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
    WHERE r.name = 'Division Director'
      AND rp.permission = 'budget.reallocation.request'
      AND rp.is_allowed = true
  ) THEN
    RAISE EXCEPTION 'Division Director must hold budget.reallocation.request';
  END IF;
END
$verify$;
