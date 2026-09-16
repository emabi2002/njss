-- =============================================================================
-- NJSS BUDGET ADJUSTMENTS NAVIGATION
-- Makes the new supplementary/reallocation workspace discoverable without
-- altering or removing the legacy revision screens during the transition.
-- =============================================================================

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
  'budget.adjustments',
  'budget',
  NULL,
  'Budget Adjustments',
  '/dashboard/budget-template/adjustments',
  'Shuffle',
  22,
  ARRAY[
    'budget.view',
    'budget.supplementary.enter',
    'budget.reallocation.request',
    'budget.reallocation.approve',
    'budget.reallocation.execute'
  ]::text[],
  true,
  now()
)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  parent_code = EXCLUDED.parent_code,
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  required_permissions = EXCLUDED.required_permissions,
  is_active = true,
  updated_at = now();
