-- =============================================================================
-- NJSS SIMPLIFIED HEAD OFFICE BUDGET — ADJUSTMENTS NAVIGATION
-- Makes the Phase 2 operational workspace reachable through database-backed RBAC.
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
  is_active
)
VALUES (
  'budget.adjustments',
  'budget',
  'budget.control',
  'Budget Adjustments',
  '/dashboard/budget/adjustments',
  'Wallet',
  22,
  ARRAY[
    'budget.supplementary.enter',
    'budget.reallocation.request',
    'budget.reallocation.approve',
    'budget.reallocation.execute'
  ]::varchar[],
  true
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
