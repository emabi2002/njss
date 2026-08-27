-- =============================================================================
-- NJSS 057 — TASK 9 FINANCE MAPPING ADMINISTRATION
-- Transactional System Administrator control for:
-- Finance Code -> Posting Code -> Chart of Accounts.
-- =============================================================================

BEGIN;

INSERT INTO menu_items (
  code, module_code, parent_code, label, href, icon, sort_order,
  required_permissions, is_active
) VALUES (
  'system.finance_mapping', 'system', 'system.master', 'Finance Mapping',
  '/dashboard/master/finance-mapping', 'Hash', 101,
  ARRAY['masterdata.manage','registry.manage'], true
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
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.njss_set_finance_posting_mapping(
  p_expense_ledger_id UUID,
  p_expense_code_registry_id UUID,
  p_chart_of_account_id UUID,
  p_user_email TEXT DEFAULT NULL
)
RETURNS expense_code_registry
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := fn_current_app_user_id();
  v_user_email TEXT;
  v_user_name TEXT;
  v_ledger expense_ledger;
  v_registry expense_code_registry;
  v_account chart_of_accounts;
  v_old_registry_id UUID;
  v_result expense_code_registry;
BEGIN
  IF v_user_id IS NULL OR NOT public.njss_current_user_has_role('System Administrator') THEN
    RAISE EXCEPTION 'Only a System Administrator may maintain Finance posting mappings.';
  END IF;

  SELECT email, COALESCE(full_name, email)
  INTO v_user_email, v_user_name
  FROM users
  WHERE id = v_user_id AND is_active = true;

  v_user_email := COALESCE(NULLIF(v_user_email, ''), NULLIF(trim(p_user_email), ''));

  IF p_expense_ledger_id IS NULL OR p_expense_code_registry_id IS NULL OR p_chart_of_account_id IS NULL THEN
    RAISE EXCEPTION 'Finance Code, Posting Code and Chart of Accounts are all required.';
  END IF;

  SELECT * INTO v_ledger
  FROM expense_ledger
  WHERE id = p_expense_ledger_id
  FOR UPDATE;
  IF NOT FOUND OR v_ledger.is_active IS DISTINCT FROM true OR v_ledger.is_posting IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Finance Code must be an active posting ledger code.';
  END IF;

  SELECT * INTO v_registry
  FROM expense_code_registry
  WHERE id = p_expense_code_registry_id
  FOR UPDATE;
  IF NOT FOUND OR v_registry.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Posting Code must be active.';
  END IF;

  SELECT * INTO v_account
  FROM chart_of_accounts
  WHERE id = p_chart_of_account_id
  FOR UPDATE;
  IF NOT FOUND OR v_account.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Chart of Accounts record must be active.';
  END IF;

  IF v_registry.department_id IS NULL THEN
    RAISE EXCEPTION 'Posting Code must have a Department relationship.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM departments d
    WHERE d.id = v_registry.department_id AND d.is_active = true
  ) THEN
    RAISE EXCEPTION 'Posting Code Department relationship is missing or inactive.';
  END IF;

  IF v_registry.cost_centre_id IS NULL THEN
    RAISE EXCEPTION 'Posting Code must have a Cost Centre relationship.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cost_centres cc
    WHERE cc.id = v_registry.cost_centre_id
      AND cc.is_active = true
      AND cc.department_id = v_registry.department_id
      AND (
        v_registry.section_id IS NULL
        OR cc.section_id IS NULL
        OR cc.section_id = v_registry.section_id
      )
  ) THEN
    RAISE EXCEPTION 'Posting Code Cost Centre relationship is missing, inactive or inconsistent.';
  END IF;

  IF v_registry.section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sections s
    WHERE s.id = v_registry.section_id AND s.is_active = true
  ) THEN
    RAISE EXCEPTION 'Posting Code Section relationship is missing or inactive.';
  END IF;

  IF v_registry.expense_ledger_id IS NOT NULL
     AND v_registry.expense_ledger_id IS DISTINCT FROM p_expense_ledger_id THEN
    RAISE EXCEPTION 'Posting Code is already mapped to another Finance Code.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM expense_code_registry ecr
    WHERE ecr.expense_ledger_id = p_expense_ledger_id
      AND ecr.id <> p_expense_code_registry_id
      AND ecr.is_active = true
  ) AND v_ledger.expense_code_registry_id IS DISTINCT FROM p_expense_code_registry_id THEN
    -- The replacement is explicit from the administrator. The previous reverse
    -- link is cleared in the same transaction before the new pair is written.
    NULL;
  END IF;

  v_old_registry_id := v_ledger.expense_code_registry_id;

  UPDATE expense_code_registry
  SET expense_ledger_id = NULL,
      updated_at = NOW()
  WHERE expense_ledger_id = p_expense_ledger_id
    AND id <> p_expense_code_registry_id;

  UPDATE expense_code_registry
  SET expense_ledger_id = p_expense_ledger_id,
      chart_of_account_id = p_chart_of_account_id,
      updated_at = NOW()
  WHERE id = p_expense_code_registry_id
  RETURNING * INTO v_result;

  UPDATE expense_ledger
  SET expense_code_registry_id = p_expense_code_registry_id,
      updated_at = NOW()
  WHERE id = p_expense_ledger_id;

  IF v_old_registry_id IS DISTINCT FROM p_expense_code_registry_id THEN
    UPDATE expense_code_registry
    SET updated_at = NOW()
    WHERE id = v_old_registry_id;
  END IF;

  PERFORM log_audit_event(
    v_user_id,
    v_user_email,
    COALESCE(v_user_name, v_user_email, 'System Administrator'),
    'FINANCE_POSTING_MAPPING_UPDATED',
    'EXPENSE_CODE',
    p_expense_code_registry_id,
    v_result.full_expense_code,
    jsonb_build_object(
      'expense_ledger_id', p_expense_ledger_id,
      'previous_expense_code_registry_id', v_old_registry_id
    ),
    jsonb_build_object(
      'expense_ledger_id', p_expense_ledger_id,
      'expense_code_registry_id', p_expense_code_registry_id,
      'chart_of_account_id', p_chart_of_account_id
    ),
    jsonb_build_object(
      'finance_code', v_ledger.finance_code,
      'posting_code', v_result.full_expense_code,
      'chart_of_account', v_account.account_code
    ),
    jsonb_build_object('source', 'Task 9 Finance Mapping')
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.njss_set_finance_posting_mapping(UUID,UUID,UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_set_finance_posting_mapping(UUID,UUID,UUID,TEXT) TO authenticated;

COMMIT;
