-- =====================================================
-- NJSS NAVIGATION HEADING REFINEMENT
-- Refines functional area names for the redesigned sidebar.
-- =====================================================

UPDATE modules
SET
  name = 'Budget Management',
  description = 'Budget control, preparation, submissions, ledger items and budget reporting',
  icon = 'Wallet',
  sort_order = 20,
  updated_at = NOW()
WHERE code = 'budget';

UPDATE modules
SET
  name = 'Transactions',
  description = 'FF3 requisitions, FF4 expenses and commitments',
  icon = 'FileText',
  sort_order = 30,
  updated_at = NOW()
WHERE code = 'transactions';

UPDATE modules
SET
  name = 'System Administration',
  description = 'Access control, access audit and system settings',
  icon = 'ShieldCheck',
  sort_order = 90,
  updated_at = NOW()
WHERE code = 'systems_administration';

UPDATE modules
SET
  name = 'Overview',
  description = 'Dashboard landing page and user guidance',
  icon = 'LayoutDashboard',
  sort_order = 10,
  updated_at = NOW()
WHERE code = 'overview';

-- Keep Budget Reports under Budget Management for now to avoid route duplication.
UPDATE menu_items
SET label = 'Budget Reports', module_code = 'budget', sort_order = 50, updated_at = NOW()
WHERE code = 'reports.library';
