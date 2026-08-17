-- NJSS Phase 6 — Remove extra Systems Operations menu links
-- Navigation metadata only. Does not alter financial workflows.

UPDATE menu_items
SET is_active = false, updated_at = NOW()
WHERE code IN (
  'administration.uat',
  'systems_administration.uat',
  'systems_administration.info'
);

UPDATE modules
SET
  name = 'Systems Operations',
  description = 'Technical support dashboard, housekeeping, audit and controlled administrative utilities',
  updated_at = NOW()
WHERE code = 'systems_administration';
