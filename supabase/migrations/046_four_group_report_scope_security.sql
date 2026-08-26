-- =============================================================================
-- NJSS 046 — FOUR-GROUP REPORT SCOPE SECURITY
-- Completes migration 045 by enforcing SECTION_WIDE inside database RLS and
-- removing generic report-access paths to central funding and audit data.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Database-side scope resolver used by RLS and security-invoker views.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_current_user_data_scope_allows(
  p_department_id UUID DEFAULT NULL,
  p_section_id UUID DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_requesting_officer_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_app_user_id UUID := fn_current_app_user_id();
  v_department_id UUID;
  v_section_id UUID;
  v_allowed BOOLEAN := false;
BEGIN
  IF COALESCE(fn_current_user_has_permission('all'), false) THEN
    RETURN true;
  END IF;

  IF v_app_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT u.department_id, u.section_id
  INTO v_department_id, v_section_id
  FROM users u
  WHERE u.id = v_app_user_id;

  -- A user always retains access to records they personally raised or own.
  IF p_created_by IS NOT NULL AND p_created_by = v_app_user_id THEN
    RETURN true;
  END IF;
  IF p_requesting_officer_id IS NOT NULL AND p_requesting_officer_id = v_app_user_id THEN
    RETURN true;
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id = v_app_user_id THEN
    RETURN true;
  END IF;

  WITH effective_scopes AS (
    SELECT uds.scope_type, uds.department_ids, uds.division_ids, uds.branch_ids, uds.province_ids
    FROM user_data_scopes uds
    WHERE uds.user_id = v_app_user_id
      AND (uds.valid_from IS NULL OR uds.valid_from <= NOW())
      AND (uds.valid_until IS NULL OR uds.valid_until >= NOW())
    UNION ALL
    SELECT rds.scope_type, rds.department_ids, rds.division_ids, rds.branch_ids, rds.province_ids
    FROM user_roles ur
    JOIN role_data_scopes rds ON rds.role_id = ur.role_id
    WHERE ur.user_id = v_app_user_id
    UNION ALL
    SELECT COALESCE(r.data_scope_type, 'OWN_RECORDS') AS scope_type,
           '{}'::UUID[], '{}'::UUID[], '{}'::UUID[], '{}'::UUID[]
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_app_user_id
      AND r.is_active = true
  )
  SELECT EXISTS (
    SELECT 1
    FROM effective_scopes s
    WHERE s.scope_type = 'SYSTEM_WIDE'
       OR (s.scope_type = 'SECTION_WIDE'
           AND p_section_id IS NOT NULL
           AND v_section_id IS NOT NULL
           AND p_section_id = v_section_id)
       OR (s.scope_type = 'DEPARTMENT_WIDE'
           AND p_department_id IS NOT NULL
           AND (p_department_id = v_department_id
                OR p_department_id = ANY(COALESCE(s.department_ids, '{}'::UUID[]))))
       OR (s.scope_type = 'OWN_DIVISION'
           AND p_department_id IS NOT NULL
           AND (p_department_id = v_department_id
                OR p_department_id = ANY(COALESCE(s.department_ids, '{}'::UUID[]))))
       OR (s.scope_type = 'OWN_BRANCH'
           AND p_department_id IS NOT NULL
           AND (p_department_id = v_department_id
                OR p_department_id = ANY(COALESCE(s.department_ids, '{}'::UUID[]))))
       OR (s.scope_type = 'OWN_PROVINCE'
           AND p_department_id IS NOT NULL
           AND (p_department_id = v_department_id
                OR p_department_id = ANY(COALESCE(s.department_ids, '{}'::UUID[]))))
       OR (s.scope_type = 'OWN_RECORDS' AND (
            (p_created_by IS NOT NULL AND p_created_by = v_app_user_id)
         OR (p_requesting_officer_id IS NOT NULL AND p_requesting_officer_id = v_app_user_id)
         OR (p_user_id IS NOT NULL AND p_user_id = v_app_user_id)
       ))
  ) INTO v_allowed;

  RETURN COALESCE(v_allowed, false);
END;
$$;

REVOKE ALL ON FUNCTION fn_current_user_data_scope_allows(UUID, UUID, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_current_user_data_scope_allows(UUID, UUID, UUID, UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Report catalogue: required permission is authoritative.
--    reports.view no longer overrides audit/funding-specific requirements.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_report_catalogue
WITH (security_invoker = true) AS
SELECT
  c.code AS category_code,
  c.name AS category_name,
  c.description AS category_description,
  c.sort_order AS category_sort_order,
  d.report_code,
  d.report_name,
  d.description,
  d.handler_key,
  d.sort_order,
  d.allowed_export_formats,
  d.required_permission
FROM report_categories c
JOIN report_definitions d ON d.category_id = c.id
WHERE c.is_active = true
  AND d.is_active = true
  AND (
    d.required_permission IS NULL
    OR fn_current_user_has_permission(d.required_permission)
    OR fn_current_user_has_permission('all')
  );

-- Central funding registers are organisation-level records. Section officers
-- obtain funded/released values through section-scoped budget views instead.
UPDATE report_definitions
SET required_permission = 'funding.view', updated_at = NOW()
WHERE report_code IN (
  'funding-authority-register',
  'funding-receipt-register',
  'funding-allocation-report',
  'funding-vs-approved-budget',
  'funding-vs-releases',
  'unfunded-budget-report',
  'unreleased-funding-report',
  'funding-source-report'
);

-- Registrar has organisation-wide business visibility, including funding.
INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, 'funding.view', true
FROM roles r
WHERE r.name = 'Registrar'
  AND EXISTS (SELECT 1 FROM permissions p WHERE p.code = 'funding.view')
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

-- -----------------------------------------------------------------------------
-- 3. Funding RLS: central authorities/receipts are not exposed by reports.view.
--    Funding allocations remain visible to section roles only inside their scope.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS funding_authorities_select_rbac ON funding_authorities;
DROP POLICY IF EXISTS funding_authorities_select_phase6 ON funding_authorities;
DROP POLICY IF EXISTS funding_authorities_select_four_group ON funding_authorities;
CREATE POLICY funding_authorities_select_four_group ON funding_authorities
  FOR SELECT USING (
    (SELECT fn_current_user_has_permission('all'))
    OR (
      (SELECT fn_current_user_has_permission('funding.view'))
      AND (
        fn_current_user_data_scope_allows(
          restricted_department_id,
          restricted_section_id,
          created_by,
          NULL,
          NULL
        )
        OR (
          restricted_department_id IS NULL
          AND restricted_section_id IS NULL
          AND fn_current_user_data_scope_allows(NULL, NULL, NULL, NULL, NULL)
        )
      )
    )
  );

DROP POLICY IF EXISTS funding_receipts_select_rbac ON funding_receipts;
DROP POLICY IF EXISTS funding_receipts_select_phase6 ON funding_receipts;
DROP POLICY IF EXISTS funding_receipts_select_four_group ON funding_receipts;
CREATE POLICY funding_receipts_select_four_group ON funding_receipts
  FOR SELECT USING (
    (SELECT fn_current_user_has_permission('all'))
    OR (
      (SELECT fn_current_user_has_permission('funding.view'))
      AND EXISTS (
        SELECT 1
        FROM funding_authorities fa
        WHERE fa.id = funding_receipts.funding_authority_id
          AND (
            fn_current_user_data_scope_allows(
              fa.restricted_department_id,
              fa.restricted_section_id,
              fa.created_by,
              NULL,
              NULL
            )
            OR (
              fa.restricted_department_id IS NULL
              AND fa.restricted_section_id IS NULL
              AND fn_current_user_data_scope_allows(NULL, NULL, NULL, NULL, NULL)
            )
          )
      )
    )
  );

DROP POLICY IF EXISTS funding_allocations_select_rbac ON funding_allocations;
DROP POLICY IF EXISTS funding_allocations_select_phase6 ON funding_allocations;
DROP POLICY IF EXISTS funding_allocations_select_four_group ON funding_allocations;
CREATE POLICY funding_allocations_select_four_group ON funding_allocations
  FOR SELECT USING (
    (
      (SELECT fn_current_user_has_permission('funding.view'))
      OR (SELECT fn_current_user_has_permission('budget.view'))
      OR (SELECT fn_current_user_has_permission('budget.control.view'))
      OR (SELECT fn_current_user_has_permission('budget.report.view'))
      OR (SELECT fn_current_user_has_permission('reports.view'))
      OR (SELECT fn_current_user_has_permission('all'))
    )
    AND fn_current_user_data_scope_allows(department_id, section_id, created_by, NULL, NULL)
  );

-- -----------------------------------------------------------------------------
-- 4. Audit access: ordinary report permission is not an audit permission.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_logs_select_authorized ON audit_logs;
CREATE POLICY audit_logs_select_authorized ON audit_logs
  FOR SELECT USING (
    user_id = fn_current_app_user_id()
    OR (SELECT fn_current_user_has_permission('audit.view'))
    OR (SELECT fn_current_user_has_permission('audit.export'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

-- Make sure affected reporting views continue to invoke the caller's RLS.
DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'v_report_catalogue',
    'v_management_financial_summary',
    'v_department_financial_position',
    'v_section_financial_position',
    'v_cost_centre_financial_position',
    'v_expense_code_financial_position',
    'v_funding_source_financial_position',
    'v_authoritative_budget_position',
    'v_budget_by_code',
    'v_commitment_ledger',
    'v_ff3_ff4_transaction_trace',
    'v_monthly_expenditure_summary',
    'v_quarterly_expenditure_summary',
    'v_ff4_reconciliation_summary'
  ] LOOP
    IF to_regclass('public.' || v_name) IS NOT NULL THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v_name);
    END IF;
  END LOOP;
END $$;
