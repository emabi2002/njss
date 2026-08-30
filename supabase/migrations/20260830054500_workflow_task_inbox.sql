-- Role-aware workflow inbox and approvals navigation.
-- The queue itself is derived from live FF3/FF4 workflow state; this migration
-- only registers the access permission and navigation entry.

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
  'workflow.tasks.view',
  'transactions',
  NULL,
  'view',
  'View My Tasks / Approvals',
  'View the role-aware workflow inbox and pending approval/task counts.',
  TRUE
)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = TRUE;

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
  'workflow.tasks',
  'transactions',
  NULL,
  'My Tasks & Approvals',
  '/dashboard/tasks',
  'ClipboardList',
  5,
  ARRAY['workflow.tasks.view']::TEXT[],
  TRUE
)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  parent_code = EXCLUDED.parent_code,
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  required_permissions = EXCLUDED.required_permissions,
  is_active = TRUE;

INSERT INTO public.role_permissions (role_id, permission, is_allowed)
SELECT r.id, 'workflow.tasks.view', TRUE
FROM public.roles r
WHERE r.name IN (
  'Requisition Officer',
  'Line Supervisor',
  'Registrar',
  'Payment/Reconciliation Officer'
)
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = TRUE;
