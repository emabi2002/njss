-- =============================================================================
-- NJSS 061 — EXPLICIT FINANCE POSTING MAPPING & COST CENTRE FK
-- Approved Task 9 conformance hardening.
-- Production-schema compatible: users.full_name, text REVIEW/APPROVE actors,
-- JSONB system settings, exact Cost Centre identifiers only.
-- =============================================================================

BEGIN;

-- 1. Exact Budget Division -> Cost Centre relationship.
ALTER TABLE public.budget_divisions
  ADD COLUMN IF NOT EXISTS cost_centre_id UUID REFERENCES public.cost_centres(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_budget_divisions_cost_centre_id
  ON public.budget_divisions(cost_centre_id)
  WHERE cost_centre_id IS NOT NULL;

-- Deterministic backfill by active exact CODE only. Never resolve by name.
UPDATE public.budget_divisions bd
SET cost_centre_id = (
      SELECT cc.id
      FROM public.cost_centres cc
      WHERE cc.is_active = true
        AND NULLIF(trim(bd.cost_centre_code), '') IS NOT NULL
        AND upper(trim(cc.code)) = upper(trim(bd.cost_centre_code))
        AND (bd.department_id IS NULL OR cc.department_id = bd.department_id)
        AND (bd.section_id IS NULL OR cc.section_id IS NULL OR cc.section_id = bd.section_id)
      ORDER BY cc.id
      LIMIT 1
    ),
    updated_at = NOW()
WHERE bd.cost_centre_id IS NULL
  AND 1 = (
    SELECT COUNT(*)
    FROM public.cost_centres cc2
    WHERE cc2.is_active = true
      AND NULLIF(trim(bd.cost_centre_code), '') IS NOT NULL
      AND upper(trim(cc2.code)) = upper(trim(bd.cost_centre_code))
      AND (bd.department_id IS NULL OR cc2.department_id = bd.department_id)
      AND (bd.section_id IS NULL OR cc2.section_id IS NULL OR cc2.section_id = bd.section_id)
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.budget_divisions bd
    JOIN public.cost_centres cc ON cc.id = bd.cost_centre_id
    WHERE bd.cost_centre_id IS NOT NULL
      AND (
        cc.is_active IS DISTINCT FROM true
        OR (bd.department_id IS NOT NULL AND cc.department_id IS DISTINCT FROM bd.department_id)
        OR (
          bd.section_id IS NOT NULL
          AND cc.section_id IS NOT NULL
          AND cc.section_id IS DISTINCT FROM bd.section_id
        )
        OR (
          NULLIF(trim(bd.cost_centre_code), '') IS NOT NULL
          AND upper(trim(cc.code)) IS DISTINCT FROM upper(trim(bd.cost_centre_code))
        )
      )
  ) THEN
    RAISE EXCEPTION 'A Budget Division Cost Centre FK conflicts with its active code/organisation. Reconcile the Division before applying migration 061.';
  END IF;
END $$;

-- 2. Canonical Finance Code -> Posting Code -> CoA -> Cost Centre mapping.
CREATE TABLE IF NOT EXISTS public.finance_posting_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year INTEGER,
  expense_ledger_id UUID NOT NULL REFERENCES public.expense_ledger(id) ON DELETE RESTRICT,
  expense_code_registry_id UUID NOT NULL REFERENCES public.expense_code_registry(id) ON DELETE RESTRICT,
  chart_of_account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_centre_id UUID NOT NULL REFERENCES public.cost_centres(id) ON DELETE RESTRICT,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  section_id UUID REFERENCES public.sections(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  mapping_notes TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_by UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  deactivated_at TIMESTAMPTZ,
  deactivation_reason TEXT,
  CONSTRAINT finance_posting_mappings_financial_year_check
    CHECK (financial_year IS NULL OR financial_year BETWEEN 2000 AND 2200)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_mapping_active_specific_year
  ON public.finance_posting_mappings(expense_ledger_id, cost_centre_id, financial_year)
  WHERE is_active = true AND financial_year IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_mapping_active_generic
  ON public.finance_posting_mappings(expense_ledger_id, cost_centre_id)
  WHERE is_active = true AND financial_year IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_mapping_posting_active_specific_year
  ON public.finance_posting_mappings(expense_code_registry_id, financial_year)
  WHERE is_active = true AND financial_year IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_mapping_posting_active_generic
  ON public.finance_posting_mappings(expense_code_registry_id)
  WHERE is_active = true AND financial_year IS NULL;
CREATE INDEX IF NOT EXISTS idx_finance_posting_mappings_lookup
  ON public.finance_posting_mappings(expense_ledger_id, cost_centre_id, financial_year, is_active);
CREATE INDEX IF NOT EXISTS idx_finance_posting_mappings_org
  ON public.finance_posting_mappings(department_id, section_id, cost_centre_id)
  WHERE is_active = true;

COMMENT ON TABLE public.finance_posting_mappings IS
  'Task 9 canonical bridge from approved Finance Code to Posting Code, Chart of Accounts and exact Cost Centre. Initial budget activation must resolve through this table.';

-- Backfill only reciprocal, active, fully scoped legacy mappings.
INSERT INTO public.finance_posting_mappings (
  financial_year, expense_ledger_id, expense_code_registry_id,
  chart_of_account_id, cost_centre_id, department_id, section_id,
  is_active, mapping_notes
)
SELECT
  ecr.financial_year, el.id, ecr.id, ecr.chart_of_account_id,
  ecr.cost_centre_id, ecr.department_id, ecr.section_id,
  true, 'Deterministic reciprocal legacy mapping backfill from migration 061'
FROM public.expense_ledger el
JOIN public.expense_code_registry ecr
  ON ecr.id = el.expense_code_registry_id
 AND ecr.expense_ledger_id = el.id
JOIN public.chart_of_accounts coa
  ON coa.id = ecr.chart_of_account_id AND coa.is_active = true
JOIN public.cost_centres cc
  ON cc.id = ecr.cost_centre_id AND cc.is_active = true
JOIN public.departments d
  ON d.id = ecr.department_id AND d.is_active = true
LEFT JOIN public.sections sec ON sec.id = ecr.section_id
WHERE el.is_active = true
  AND el.is_posting = true
  AND ecr.is_active = true
  AND ecr.chart_of_account_id IS NOT NULL
  AND ecr.cost_centre_id IS NOT NULL
  AND ecr.department_id IS NOT NULL
  AND cc.department_id = d.id
  AND (ecr.section_id IS NULL OR sec.is_active = true)
  AND (ecr.section_id IS NULL OR cc.section_id IS NULL OR cc.section_id = ecr.section_id)
ON CONFLICT DO NOTHING;

-- 3. Exact-year-first canonical resolver.
CREATE OR REPLACE FUNCTION public.njss_resolve_finance_posting_mapping(
  p_expense_ledger_id UUID,
  p_financial_year INTEGER,
  p_cost_centre_id UUID
)
RETURNS public.finance_posting_mappings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result public.finance_posting_mappings;
  v_count INTEGER := 0;
  v_use_exact BOOLEAN := false;
BEGIN
  IF p_expense_ledger_id IS NULL OR p_cost_centre_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.finance_posting_mappings fpm
    WHERE fpm.is_active = true
      AND fpm.expense_ledger_id = p_expense_ledger_id
      AND fpm.cost_centre_id = p_cost_centre_id
      AND fpm.financial_year = p_financial_year
  ) INTO v_use_exact;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.finance_posting_mappings fpm
  WHERE fpm.is_active = true
    AND fpm.expense_ledger_id = p_expense_ledger_id
    AND fpm.cost_centre_id = p_cost_centre_id
    AND (
      (v_use_exact AND fpm.financial_year = p_financial_year)
      OR (NOT v_use_exact AND fpm.financial_year IS NULL)
    );

  IF v_count = 0 THEN RETURN NULL; END IF;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Finance Code must resolve to exactly one active canonical posting mapping for the approved Cost Centre and financial year.';
  END IF;

  SELECT fpm.* INTO v_result
  FROM public.finance_posting_mappings fpm
  WHERE fpm.is_active = true
    AND fpm.expense_ledger_id = p_expense_ledger_id
    AND fpm.cost_centre_id = p_cost_centre_id
    AND (
      (v_use_exact AND fpm.financial_year = p_financial_year)
      OR (NOT v_use_exact AND fpm.financial_year IS NULL)
    )
  ORDER BY fpm.updated_at DESC, fpm.id
  LIMIT 1;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.njss_resolve_finance_posting_mapping(UUID,INTEGER,UUID)
  FROM PUBLIC, anon, authenticated;

-- 4. System Administrator-only canonical mapping maintenance.
CREATE OR REPLACE FUNCTION public.njss_upsert_finance_posting_mapping(
  p_mapping_id UUID,
  p_financial_year INTEGER,
  p_expense_ledger_id UUID,
  p_expense_code_registry_id UUID,
  p_chart_of_account_id UUID,
  p_cost_centre_id UUID,
  p_department_id UUID,
  p_section_id UUID,
  p_mapping_notes TEXT
)
RETURNS public.finance_posting_mappings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := public.fn_current_app_user_id();
  v_user_email TEXT;
  v_user_name TEXT;
  v_ledger public.expense_ledger;
  v_registry public.expense_code_registry;
  v_account public.chart_of_accounts;
  v_cost_centre public.cost_centres;
  v_existing public.finance_posting_mappings;
  v_result public.finance_posting_mappings;
BEGIN
  IF v_user_id IS NULL OR NOT public.njss_current_user_has_role('System Administrator') THEN
    RAISE EXCEPTION 'Only a System Administrator may maintain canonical Finance posting mappings.';
  END IF;

  SELECT u.email, COALESCE(NULLIF(trim(u.full_name), ''), u.email)
  INTO v_user_email, v_user_name
  FROM public.users u
  WHERE u.id = v_user_id AND u.is_active = true;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'Active System Administrator user record is required.';
  END IF;

  IF p_expense_ledger_id IS NULL
     OR p_expense_code_registry_id IS NULL
     OR p_chart_of_account_id IS NULL
     OR p_cost_centre_id IS NULL
     OR p_department_id IS NULL THEN
    RAISE EXCEPTION 'Finance Code, Posting Code, Chart of Accounts, Department and Cost Centre are required.';
  END IF;
  IF p_financial_year IS NOT NULL AND (p_financial_year < 2000 OR p_financial_year > 2200) THEN
    RAISE EXCEPTION 'Financial Year is outside the supported range.';
  END IF;

  SELECT * INTO v_ledger FROM public.expense_ledger
  WHERE id = p_expense_ledger_id FOR UPDATE;
  IF NOT FOUND OR v_ledger.is_active IS DISTINCT FROM true OR v_ledger.is_posting IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Finance Code must be an active posting ledger code.';
  END IF;

  SELECT * INTO v_registry FROM public.expense_code_registry
  WHERE id = p_expense_code_registry_id FOR UPDATE;
  IF NOT FOUND OR v_registry.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Posting Code must be active.';
  END IF;

  SELECT * INTO v_account FROM public.chart_of_accounts
  WHERE id = p_chart_of_account_id FOR UPDATE;
  IF NOT FOUND OR v_account.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Chart of Accounts record must be active.';
  END IF;

  SELECT * INTO v_cost_centre FROM public.cost_centres
  WHERE id = p_cost_centre_id FOR UPDATE;
  IF NOT FOUND OR v_cost_centre.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Cost Centre must be active.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = p_department_id AND d.is_active = true
  ) THEN
    RAISE EXCEPTION 'Department must be active.';
  END IF;
  IF p_section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sections s
    WHERE s.id = p_section_id AND s.is_active = true AND s.department_id = p_department_id
  ) THEN
    RAISE EXCEPTION 'Section must be active and belong to the selected Department.';
  END IF;

  IF v_cost_centre.department_id IS DISTINCT FROM p_department_id THEN
    RAISE EXCEPTION 'Cost Centre does not belong to the selected Department.';
  END IF;
  IF p_section_id IS NOT NULL
     AND v_cost_centre.section_id IS NOT NULL
     AND v_cost_centre.section_id IS DISTINCT FROM p_section_id THEN
    RAISE EXCEPTION 'Cost Centre does not belong to the selected Section.';
  END IF;
  IF v_registry.department_id IS DISTINCT FROM p_department_id THEN
    RAISE EXCEPTION 'Posting Code Department does not match the canonical mapping Department.';
  END IF;
  IF v_registry.cost_centre_id IS DISTINCT FROM p_cost_centre_id THEN
    RAISE EXCEPTION 'Posting Code Cost Centre does not match the canonical mapping Cost Centre.';
  END IF;
  IF v_registry.section_id IS NOT NULL AND v_registry.section_id IS DISTINCT FROM p_section_id THEN
    RAISE EXCEPTION 'Posting Code Section does not match the canonical mapping Section.';
  END IF;
  IF v_registry.chart_of_account_id IS NOT NULL
     AND v_registry.chart_of_account_id IS DISTINCT FROM p_chart_of_account_id THEN
    RAISE EXCEPTION 'Posting Code is already associated with a different Chart of Accounts record.';
  END IF;
  IF v_registry.financial_year IS NOT NULL
     AND v_registry.financial_year IS DISTINCT FROM p_financial_year THEN
    RAISE EXCEPTION 'Posting Code Financial Year does not match the canonical mapping Financial Year.';
  END IF;

  IF p_mapping_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.finance_posting_mappings
    WHERE id = p_mapping_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Finance posting mapping not found.'; END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.finance_posting_mappings fpm
    WHERE fpm.is_active = true
      AND fpm.expense_ledger_id = p_expense_ledger_id
      AND fpm.cost_centre_id = p_cost_centre_id
      AND fpm.financial_year IS NOT DISTINCT FROM p_financial_year
      AND (p_mapping_id IS NULL OR fpm.id <> p_mapping_id)
  ) THEN
    RAISE EXCEPTION 'An active canonical Finance mapping already exists for this Finance Code, Cost Centre and applicability year.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.finance_posting_mappings fpm
    WHERE fpm.is_active = true
      AND fpm.expense_code_registry_id = p_expense_code_registry_id
      AND fpm.financial_year IS NOT DISTINCT FROM p_financial_year
      AND (p_mapping_id IS NULL OR fpm.id <> p_mapping_id)
  ) THEN
    RAISE EXCEPTION 'Posting Code is already assigned to another active canonical Finance mapping for this applicability year.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.finance_posting_mappings fpm
    WHERE fpm.is_active = true
      AND fpm.expense_code_registry_id = p_expense_code_registry_id
      AND fpm.expense_ledger_id IS DISTINCT FROM p_expense_ledger_id
      AND (fpm.financial_year IS NULL OR p_financial_year IS NULL OR fpm.financial_year = p_financial_year)
      AND (p_mapping_id IS NULL OR fpm.id <> p_mapping_id)
  ) THEN
    RAISE EXCEPTION 'Posting Code cannot map to a different Finance Code in an overlapping applicability period.';
  END IF;

  IF p_mapping_id IS NULL THEN
    INSERT INTO public.finance_posting_mappings (
      financial_year, expense_ledger_id, expense_code_registry_id,
      chart_of_account_id, cost_centre_id, department_id, section_id,
      is_active, mapping_notes, created_by, updated_by
    ) VALUES (
      p_financial_year, p_expense_ledger_id, p_expense_code_registry_id,
      p_chart_of_account_id, p_cost_centre_id, p_department_id, p_section_id,
      true, NULLIF(trim(p_mapping_notes), ''), v_user_id, v_user_id
    ) RETURNING * INTO v_result;
  ELSE
    UPDATE public.finance_posting_mappings
    SET financial_year = p_financial_year,
        expense_ledger_id = p_expense_ledger_id,
        expense_code_registry_id = p_expense_code_registry_id,
        chart_of_account_id = p_chart_of_account_id,
        cost_centre_id = p_cost_centre_id,
        department_id = p_department_id,
        section_id = p_section_id,
        is_active = true,
        mapping_notes = NULLIF(trim(p_mapping_notes), ''),
        updated_by = v_user_id,
        updated_at = NOW(),
        deactivated_by = NULL,
        deactivated_at = NULL,
        deactivation_reason = NULL
    WHERE id = p_mapping_id
    RETURNING * INTO v_result;
  END IF;

  PERFORM public.log_audit_event(
    v_user_id, v_user_email, v_user_name,
    CASE WHEN p_mapping_id IS NULL THEN 'FINANCE_POSTING_MAPPING_CREATED' ELSE 'FINANCE_POSTING_MAPPING_UPDATED' END,
    'FINANCE_POSTING_MAPPING', v_result.id, v_ledger.finance_code,
    CASE WHEN p_mapping_id IS NULL THEN NULL ELSE to_jsonb(v_existing) END,
    to_jsonb(v_result),
    jsonb_build_object(
      'finance_code', v_ledger.finance_code,
      'posting_code', v_registry.full_expense_code,
      'chart_of_account', v_account.account_code,
      'cost_centre', v_cost_centre.code,
      'financial_year', p_financial_year
    ),
    jsonb_build_object('source', 'Task 9 canonical Finance mapping')
  );

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.njss_upsert_finance_posting_mapping(UUID,INTEGER,UUID,UUID,UUID,UUID,UUID,UUID,TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_upsert_finance_posting_mapping(UUID,INTEGER,UUID,UUID,UUID,UUID,UUID,UUID,TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.njss_deactivate_finance_posting_mapping(
  p_mapping_id UUID,
  p_reason TEXT
)
RETURNS public.finance_posting_mappings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := public.fn_current_app_user_id();
  v_user_email TEXT;
  v_user_name TEXT;
  v_existing public.finance_posting_mappings;
  v_result public.finance_posting_mappings;
BEGIN
  IF v_user_id IS NULL OR NOT public.njss_current_user_has_role('System Administrator') THEN
    RAISE EXCEPTION 'Only a System Administrator may deactivate canonical Finance posting mappings.';
  END IF;
  IF p_mapping_id IS NULL OR NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Mapping and deactivation reason are required.';
  END IF;

  SELECT u.email, COALESCE(NULLIF(trim(u.full_name), ''), u.email)
  INTO v_user_email, v_user_name
  FROM public.users u
  WHERE u.id = v_user_id AND u.is_active = true;

  SELECT * INTO v_existing
  FROM public.finance_posting_mappings
  WHERE id = p_mapping_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Finance posting mapping not found.'; END IF;
  IF v_existing.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Finance posting mapping is already inactive.';
  END IF;

  UPDATE public.finance_posting_mappings
  SET is_active = false,
      deactivated_by = v_user_id,
      deactivated_at = NOW(),
      deactivation_reason = trim(p_reason),
      updated_by = v_user_id,
      updated_at = NOW()
  WHERE id = p_mapping_id
  RETURNING * INTO v_result;

  PERFORM public.log_audit_event(
    v_user_id, v_user_email, v_user_name,
    'FINANCE_POSTING_MAPPING_DEACTIVATED', 'FINANCE_POSTING_MAPPING',
    v_result.id, v_result.id::TEXT,
    to_jsonb(v_existing), to_jsonb(v_result),
    jsonb_build_object('reason', trim(p_reason)),
    jsonb_build_object('source', 'Task 9 canonical Finance mapping')
  );

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.njss_deactivate_finance_posting_mapping(UUID,TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_deactivate_finance_posting_mapping(UUID,TEXT)
  TO authenticated;

-- 5. RLS and administration read model.
ALTER TABLE public.finance_posting_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_posting_mappings_select_authorised ON public.finance_posting_mappings;
CREATE POLICY finance_posting_mappings_select_authorised
  ON public.finance_posting_mappings
  FOR SELECT TO authenticated
  USING (
    public.njss_current_user_has_role('System Administrator')
    OR public.njss_current_user_has_role('Registrar')
  );
REVOKE ALL ON TABLE public.finance_posting_mappings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.finance_posting_mappings TO authenticated;

CREATE OR REPLACE VIEW public.v_finance_posting_mapping_admin
WITH (security_invoker = true)
AS
SELECT
  fpm.id,
  fpm.financial_year,
  fpm.expense_ledger_id,
  el.finance_code,
  el.standard_description AS finance_description,
  fpm.expense_code_registry_id,
  ecr.full_expense_code AS posting_code,
  ecr.description AS posting_description,
  fpm.chart_of_account_id,
  coa.account_code AS chart_account_code,
  coa.account_name AS chart_account_name,
  fpm.department_id,
  d.code AS department_code,
  d.name AS department_name,
  fpm.section_id,
  sec.code AS section_code,
  sec.name AS section_name,
  fpm.cost_centre_id,
  cc.code AS cost_centre_code,
  cc.name AS cost_centre_name,
  ecr.expense_category_id,
  cat.code AS expense_category_code,
  cat.name AS expense_category_name,
  ecr.expense_item_id,
  item.code AS expense_item_code,
  item.name AS expense_item_name,
  fpm.is_active,
  fpm.mapping_notes,
  fpm.created_by,
  COALESCE(NULLIF(trim(creator.full_name), ''), creator.email) AS created_by_name,
  fpm.created_at,
  fpm.updated_by,
  COALESCE(NULLIF(trim(updater.full_name), ''), updater.email) AS updated_by_name,
  fpm.updated_at,
  CASE
    WHEN fpm.is_active IS DISTINCT FROM true THEN 'INACTIVE'
    WHEN el.id IS NULL OR el.is_active IS DISTINCT FROM true OR el.is_posting IS DISTINCT FROM true THEN 'INACTIVE_REFERENCE'
    WHEN ecr.id IS NULL OR ecr.is_active IS DISTINCT FROM true THEN 'INACTIVE_REFERENCE'
    WHEN coa.id IS NULL OR coa.is_active IS DISTINCT FROM true THEN 'INACTIVE_REFERENCE'
    WHEN cc.id IS NULL OR cc.is_active IS DISTINCT FROM true THEN 'INACTIVE_REFERENCE'
    WHEN d.id IS NULL OR d.is_active IS DISTINCT FROM true THEN 'INACTIVE_REFERENCE'
    WHEN fpm.section_id IS NOT NULL AND (sec.id IS NULL OR sec.is_active IS DISTINCT FROM true) THEN 'INACTIVE_REFERENCE'
    WHEN ecr.department_id IS DISTINCT FROM fpm.department_id
      OR ecr.cost_centre_id IS DISTINCT FROM fpm.cost_centre_id
      OR (ecr.section_id IS NOT NULL AND ecr.section_id IS DISTINCT FROM fpm.section_id)
      OR cc.department_id IS DISTINCT FROM fpm.department_id
      OR (fpm.section_id IS NOT NULL AND cc.section_id IS NOT NULL AND cc.section_id IS DISTINCT FROM fpm.section_id)
      THEN 'SCOPE_MISMATCH'
    ELSE 'READY'
  END AS mapping_status
FROM public.finance_posting_mappings fpm
JOIN public.expense_ledger el ON el.id = fpm.expense_ledger_id
JOIN public.expense_code_registry ecr ON ecr.id = fpm.expense_code_registry_id
JOIN public.chart_of_accounts coa ON coa.id = fpm.chart_of_account_id
JOIN public.cost_centres cc ON cc.id = fpm.cost_centre_id
JOIN public.departments d ON d.id = fpm.department_id
LEFT JOIN public.sections sec ON sec.id = fpm.section_id
LEFT JOIN public.expense_categories cat ON cat.id = ecr.expense_category_id
LEFT JOIN public.expense_items item ON item.id = ecr.expense_item_id
LEFT JOIN public.users creator ON creator.id = fpm.created_by
LEFT JOIN public.users updater ON updater.id = fpm.updated_by;

REVOKE ALL ON public.v_finance_posting_mapping_admin FROM PUBLIC, anon;
GRANT SELECT ON public.v_finance_posting_mapping_admin TO authenticated;

-- 6. Explicit reporting permission for Registrar.
INSERT INTO public.permissions (code, module_code, menu_code, action, label, description, is_active)
VALUES (
  'budget.activation.report', 'budget', 'budget.activation', 'report',
  'Report budget activation',
  'View activation reconciliation, Finance mapping and immutable activation history',
  true
)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  menu_code = EXCLUDED.menu_code,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = true;

INSERT INTO public.role_permissions (role_id, permission, is_allowed)
SELECT r.id, 'budget.activation.report', true
FROM public.roles r
WHERE r.name = 'Registrar' AND r.is_active = true
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

-- 7. Deployed NJSS stores REVIEW/APPROVE actor labels as text, while
-- SUBMIT/REJECT actor fields are UUIDs. Preserve that schema deliberately.
CREATE OR REPLACE FUNCTION public.transition_divisional_budget_submission(
  p_submission_id UUID,
  p_action TEXT,
  p_comments TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS public.divisional_budget_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old public.divisional_budget_submissions;
  v_new_status VARCHAR(40);
  v_out public.divisional_budget_submissions;
  v_user_id UUID;
  v_actor_email TEXT;
  v_actor_label TEXT;
BEGIN
  SELECT * INTO v_old
  FROM public.divisional_budget_submissions
  WHERE id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget submission not found'; END IF;

  v_user_id := public.fn_current_app_user_id();
  IF v_user_id IS NULL AND COALESCE(trim(p_user_email), '') <> '' THEN
    SELECT id INTO v_user_id
    FROM public.users
    WHERE lower(email) = lower(trim(p_user_email)) AND is_active = true
    LIMIT 1;
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT u.email, COALESCE(NULLIF(trim(u.full_name), ''), u.email)
    INTO v_actor_email, v_actor_label
    FROM public.users u
    WHERE u.id = v_user_id AND u.is_active = true;
  END IF;
  v_actor_email := COALESCE(v_actor_email, NULLIF(trim(p_user_email), ''));
  v_actor_label := COALESCE(v_actor_label, v_actor_email);

  IF UPPER(p_action) = 'SUBMIT' AND v_old.status NOT IN ('DRAFT') THEN RAISE EXCEPTION 'Only DRAFT budgets can be submitted'; END IF;
  IF UPPER(p_action) = 'RESUBMIT' AND v_old.status NOT IN ('RETURNED') THEN RAISE EXCEPTION 'Only RETURNED budgets can be resubmitted'; END IF;
  IF UPPER(p_action) = 'RETURN' AND v_old.status NOT IN ('SUBMITTED','RESUBMITTED') THEN RAISE EXCEPTION 'Only submitted budgets can be returned'; END IF;
  IF UPPER(p_action) = 'RETURN' AND COALESCE(trim(p_comments), '') = '' THEN RAISE EXCEPTION 'Return comments/reason are required'; END IF;
  IF UPPER(p_action) = 'REVIEW' AND v_old.status NOT IN ('SUBMITTED','RESUBMITTED') THEN RAISE EXCEPTION 'Only SUBMITTED or RESUBMITTED budgets can be reviewed'; END IF;
  IF UPPER(p_action) = 'APPROVE' AND v_old.status <> 'REVIEWED' THEN RAISE EXCEPTION 'Only REVIEWED budgets can be approved'; END IF;

  v_new_status := CASE UPPER(p_action)
    WHEN 'SUBMIT' THEN 'SUBMITTED'
    WHEN 'RESUBMIT' THEN 'RESUBMITTED'
    WHEN 'RETURN' THEN 'RETURNED'
    WHEN 'REVIEW' THEN 'REVIEWED'
    WHEN 'APPROVE' THEN 'APPROVED'
    WHEN 'REJECT' THEN 'REJECTED'
    WHEN 'ARCHIVE' THEN 'ARCHIVED'
    ELSE NULL
  END;
  IF v_new_status IS NULL THEN RAISE EXCEPTION 'Unsupported budget workflow action: %', p_action; END IF;

  IF UPPER(p_action) IN ('SUBMIT','RESUBMIT','APPROVE') THEN
    PERFORM public.validate_divisional_budget_submission(p_submission_id);
    SELECT * INTO v_old FROM public.divisional_budget_submissions WHERE id = p_submission_id FOR UPDATE;
  END IF;

  PERFORM set_config('njss.budget_workflow', 'on', true);

  UPDATE public.divisional_budget_submissions
  SET status = v_new_status,
      validation_status = CASE WHEN ABS(COALESCE(unallocated_variance,0)) <= 0.009 THEN 'VALID' ELSE 'VARIANCE' END,
      is_locked = v_new_status IN ('SUBMITTED','RESUBMITTED','REVIEWED','APPROVED','ARCHIVED'),
      submitted_by = CASE WHEN UPPER(p_action) IN ('SUBMIT','RESUBMIT') THEN COALESCE(v_user_id, submitted_by) ELSE submitted_by END,
      reviewed_by = CASE WHEN UPPER(p_action) = 'REVIEW' THEN COALESCE(v_actor_label, reviewed_by) ELSE reviewed_by END,
      approved_by = CASE WHEN UPPER(p_action) = 'APPROVE' THEN COALESCE(v_actor_label, approved_by) ELSE approved_by END,
      rejected_by = CASE WHEN UPPER(p_action) = 'REJECT' THEN COALESCE(v_user_id, rejected_by) ELSE rejected_by END,
      submitted_at = CASE WHEN UPPER(p_action) IN ('SUBMIT','RESUBMIT') THEN NOW() ELSE submitted_at END,
      reviewed_at = CASE WHEN UPPER(p_action) = 'REVIEW' THEN NOW() ELSE reviewed_at END,
      approved_at = CASE WHEN UPPER(p_action) = 'APPROVE' THEN NOW() ELSE approved_at END,
      rejected_at = CASE WHEN UPPER(p_action) = 'REJECT' THEN NOW() ELSE rejected_at END,
      return_reason = CASE WHEN UPPER(p_action) = 'RETURN' THEN p_comments ELSE return_reason END,
      approval_comments = CASE WHEN UPPER(p_action) IN ('REVIEW','APPROVE','REJECT') THEN p_comments ELSE approval_comments END,
      updated_at = NOW()
  WHERE id = p_submission_id
  RETURNING * INTO v_out;

  IF UPPER(p_action) = 'APPROVE' THEN
    INSERT INTO public.budget_activation_batches (
      submission_id, financial_year, department_id, budget_division_id,
      status, approved_line_count, approved_total, mapped_line_count,
      unmapped_line_count, activation_total, variance, validation_snapshot,
      created_at, updated_at
    )
    SELECT
      s.id, s.budget_year, s.department_id, s.division_id,
      'DRAFT_MAPPING', COUNT(l.id), COALESCE(SUM(l.annual_estimate),0),
      0, COUNT(l.id), 0, COALESCE(SUM(l.annual_estimate),0),
      jsonb_build_object(
        'approval_status', s.status,
        'approved_at', s.approved_at,
        'approved_total', COALESCE(SUM(l.annual_estimate),0),
        'approved_line_count', COUNT(l.id)
      ),
      NOW(), NOW()
    FROM public.divisional_budget_submissions s
    JOIN public.divisional_budget_lines l ON l.submission_id = s.id
    WHERE s.id = p_submission_id
    GROUP BY s.id, s.budget_year, s.department_id, s.division_id, s.status, s.approved_at
    ON CONFLICT (submission_id) DO UPDATE SET
      financial_year = EXCLUDED.financial_year,
      department_id = EXCLUDED.department_id,
      budget_division_id = EXCLUDED.budget_division_id,
      status = CASE WHEN public.budget_activation_batches.status = 'ACTIVATED' THEN 'ACTIVATED' ELSE 'DRAFT_MAPPING' END,
      approved_line_count = EXCLUDED.approved_line_count,
      approved_total = EXCLUDED.approved_total,
      mapped_line_count = CASE WHEN public.budget_activation_batches.status = 'ACTIVATED' THEN public.budget_activation_batches.mapped_line_count ELSE 0 END,
      unmapped_line_count = CASE WHEN public.budget_activation_batches.status = 'ACTIVATED' THEN public.budget_activation_batches.unmapped_line_count ELSE EXCLUDED.unmapped_line_count END,
      activation_total = CASE WHEN public.budget_activation_batches.status = 'ACTIVATED' THEN public.budget_activation_batches.activation_total ELSE 0 END,
      variance = CASE WHEN public.budget_activation_batches.status = 'ACTIVATED' THEN public.budget_activation_batches.variance ELSE EXCLUDED.approved_total END,
      validation_snapshot = CASE WHEN public.budget_activation_batches.status = 'ACTIVATED' THEN public.budget_activation_batches.validation_snapshot ELSE EXCLUDED.validation_snapshot END,
      updated_at = NOW();
  END IF;

  INSERT INTO public.budget_workflow_history (
    submission_id, from_status, to_status, action, comments, changed_by, changed_by_email
  ) VALUES (
    p_submission_id, v_old.status, v_new_status, UPPER(p_action), p_comments, v_user_id, v_actor_email
  );

  PERFORM public.log_audit_event(
    v_user_id, v_actor_email, COALESCE(v_actor_label, v_actor_email, 'System'),
    'BUDGET_' || UPPER(p_action), 'BUDGET_SUBMISSION', p_submission_id, v_out.submission_number,
    jsonb_build_object('status', v_old.status),
    jsonb_build_object('status', v_new_status),
    jsonb_build_object('old_status', v_old.status, 'new_status', v_new_status, 'activation_required', UPPER(p_action) = 'APPROVE'),
    NULL
  );

  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.transition_divisional_budget_submission(UUID,TEXT,TEXT,TEXT) TO authenticated;

-- 8. JSONB migration marker for deployed NJSS system_settings schema.
INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES (
  'latest_database_migration',
  to_jsonb('061_explicit_finance_posting_mapping_and_cost_centre_fk'::TEXT),
  'Latest applied NJSS migration identifier.'
)
ON CONFLICT (setting_key) DO UPDATE SET
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  updated_at = NOW();

COMMIT;
