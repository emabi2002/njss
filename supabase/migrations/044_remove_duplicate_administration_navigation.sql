-- =============================================================================
-- NJSS 044 — Remove duplicate administration navigation links
--
-- The consolidated Users & Access screen supersedes the separate Access Control
-- link, and Housekeeping is the retained entry point for Systems Operations.
-- This changes navigation metadata only; no route, permission, user or audit
-- record is deleted.
-- =============================================================================

UPDATE menu_items
SET is_active = false,
    updated_at = NOW()
WHERE code IN (
  'administration.users',
  'systems_administration.dashboard'
)
AND is_active IS DISTINCT FROM false;

-- Remove an unused alternate code if an earlier environment created it.
UPDATE menu_items
SET is_active = false,
    updated_at = NOW()
WHERE code = 'administration.users_access'
AND is_active IS DISTINCT FROM false;

-- Keep the selected navigation entries available and consistently ordered.
UPDATE menu_items
SET module_code = 'systems_administration',
    label = 'Users & Access',
    href = '/dashboard/users',
    sort_order = 15,
    is_active = true,
    updated_at = NOW()
WHERE code = 'systems_administration.users_access';

UPDATE menu_items
SET label = 'Housekeeping',
    href = '/dashboard/admin/operations/housekeeping',
    sort_order = 20,
    is_active = true,
    updated_at = NOW()
WHERE code = 'systems_administration.housekeeping';
