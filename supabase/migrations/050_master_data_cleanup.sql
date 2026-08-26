-- =============================================================================
-- NJSS 050 — MASTER DATA CLEANUP
-- Clarifies organisational sections, financial cost centres and posting codes.
-- Non-destructive: legacy seed rows are deactivated, not deleted.
-- =============================================================================

-- 1. Detach budget-division links that point to artificial cost centres cloned
--    directly from organisational sections. Real Finance cost-centre codes can
--    be assigned later by the Administrator.
UPDATE budget_divisions bd
SET cost_centre_id = NULL,
    cost_centre_code = NULL,
    cost_centre_name = NULL,
    updated_at = NOW()
FROM cost_centres cc
JOIN sections s ON s.id = cc.section_id
WHERE bd.cost_centre_id = cc.id
  AND cc.department_id = s.department_id
  AND UPPER(cc.code) = UPPER(s.code)
  AND LOWER(cc.name) = LOWER(s.name || ' Cost Centre');

-- 2. Deactivate the artificial one-for-one Section -> Cost Centre seed rows.
--    They remain available under Inactive for audit/reference and can never
--    break historical references because they are not physically deleted.
UPDATE cost_centres cc
SET is_active = false
FROM sections s
WHERE cc.section_id = s.id
  AND cc.department_id = s.department_id
  AND UPPER(cc.code) = UPPER(s.code)
  AND LOWER(cc.name) = LOWER(s.name || ' Cost Centre')
  AND COALESCE(cc.is_active, true) = true;

-- 3. Deactivate incomplete legacy posting-code seed rows. A valid active
--    Expense / Posting Code must identify the organisational/financial path
--    rather than simply duplicate an Expense Ledger / Chart-of-Accounts code.
--    Existing ledger back-references are deliberately preserved.
UPDATE expense_code_registry
SET is_active = false,
    updated_at = NOW()
WHERE COALESCE(is_active, true) = true
  AND (
    department_id IS NULL
    OR section_id IS NULL
    OR cost_centre_id IS NULL
    OR expense_category_id IS NULL
    OR expense_item_id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM annual_plan_lines apl
    WHERE apl.expense_code_registry_id = expense_code_registry.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM budget_allocations ba
    WHERE ba.expense_code_registry_id = expense_code_registry.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM ff3_headers f3
    WHERE f3.expense_code_registry_id = expense_code_registry.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM ff4_headers f4
    WHERE f4.expense_code_registry_id = expense_code_registry.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM funding_allocations fa
    WHERE fa.expense_code_registry_id = expense_code_registry.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM funding_authorities auth
    WHERE auth.restricted_expense_code_registry_id = expense_code_registry.id
  );

COMMENT ON TABLE cost_centres IS
  'Financial charging units. Organisational Sections identify where officers belong; Cost Centres identify where expenditure is charged.';

COMMENT ON TABLE expense_code_registry IS
  'Valid combined Expense / Posting Codes. Active rows should identify Department, Section, Financial Cost Centre, Expense Category and Expense Item.';
