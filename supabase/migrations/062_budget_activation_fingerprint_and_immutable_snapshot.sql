-- =============================================================================
-- NJSS 062 — BUDGET ACTIVATION FINGERPRINT & IMMUTABLE SNAPSHOT
-- Approved Task 9 conformance hardening.
-- Production-schema compatible Supabase implementation.
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1. Extend activation metadata and canonical mapping lineage.
ALTER TABLE public.budget_activation_batches
  ADD COLUMN IF NOT EXISTS validation_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS prepared_against_submission_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validation_error_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submitted_for_activation_by UUID REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE public.budget_activation_lines
  ADD COLUMN IF NOT EXISTS finance_posting_mapping_id UUID
    REFERENCES public.finance_posting_mappings(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_budget_activation_lines_finance_mapping
  ON public.budget_activation_lines(finance_posting_mapping_id)
  WHERE finance_posting_mapping_id IS NOT NULL;

-- 2. Immutable post-activation evidence, separate from mutable staging.
CREATE TABLE IF NOT EXISTS public.budget_activation_line_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_batch_id UUID NOT NULL REFERENCES public.budget_activation_batches(id) ON DELETE RESTRICT,
  source_budget_submission_id UUID NOT NULL REFERENCES public.divisional_budget_submissions(id) ON DELETE RESTRICT,
  source_budget_line_id UUID NOT NULL REFERENCES public.divisional_budget_lines(id) ON DELETE RESTRICT,
  budget_allocation_id UUID NOT NULL UNIQUE REFERENCES public.budget_allocations(id) ON DELETE RESTRICT,
  finance_posting_mapping_id UUID NOT NULL REFERENCES public.finance_posting_mappings(id) ON DELETE RESTRICT,
  expense_ledger_id UUID NOT NULL REFERENCES public.expense_ledger(id) ON DELETE RESTRICT,
  finance_code_snapshot TEXT NOT NULL,
  finance_description_snapshot TEXT,
  expense_code_registry_id UUID NOT NULL REFERENCES public.expense_code_registry(id) ON DELETE RESTRICT,
  posting_code_snapshot TEXT NOT NULL,
  posting_description_snapshot TEXT,
  chart_of_account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  chart_account_code_snapshot TEXT NOT NULL,
  chart_account_name_snapshot TEXT,
  cost_centre_id UUID NOT NULL REFERENCES public.cost_centres(id) ON DELETE RESTRICT,
  cost_centre_code_snapshot TEXT NOT NULL,
  cost_centre_name_snapshot TEXT,
  approved_amount NUMERIC(15,2) NOT NULL,
  monthly_cashflow_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (activation_batch_id, source_budget_line_id)
);

CREATE INDEX IF NOT EXISTS idx_budget_activation_snapshots_batch
  ON public.budget_activation_line_snapshots(activation_batch_id, source_budget_line_id);
CREATE INDEX IF NOT EXISTS idx_budget_activation_snapshots_submission
  ON public.budget_activation_line_snapshots(source_budget_submission_id, source_budget_line_id);

CREATE OR REPLACE FUNCTION public.njss_block_activation_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Activated budget line snapshots are immutable.';
END;
$$;

DROP TRIGGER IF EXISTS trg_budget_activation_snapshot_immutable
  ON public.budget_activation_line_snapshots;
CREATE TRIGGER trg_budget_activation_snapshot_immutable
  BEFORE UPDATE OR DELETE ON public.budget_activation_line_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.njss_block_activation_snapshot_mutation();

ALTER TABLE public.budget_activation_line_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_activation_snapshots_select_controlled_roles
  ON public.budget_activation_line_snapshots;
CREATE POLICY budget_activation_snapshots_select_controlled_roles
  ON public.budget_activation_line_snapshots
  FOR SELECT TO authenticated
  USING (
    public.njss_current_user_has_role('System Administrator')
    OR public.njss_current_user_has_role('Registrar')
  );

REVOKE ALL ON TABLE public.budget_activation_line_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.budget_activation_line_snapshots TO authenticated;
REVOKE ALL ON FUNCTION public.njss_block_activation_snapshot_mutation()
  FROM PUBLIC, anon, authenticated;

-- 3. Authoritative monthly snapshot helper.
CREATE OR REPLACE FUNCTION public.njss_budget_line_monthly_snapshot(
  p_budget_line_id UUID
)
RETURNS TABLE (
  monthly_cashflow JSONB,
  q1 NUMERIC(15,2),
  q2 NUMERIC(15,2),
  q3 NUMERIC(15,2),
  q4 NUMERIC(15,2)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH months AS (
    SELECT
      g.month_number,
      COALESCE(SUM(bma.amount), 0)::NUMERIC(15,2) AS amount
    FROM generate_series(1,12) AS g(month_number)
    LEFT JOIN public.budget_monthly_allocations bma
      ON bma.budget_line_id = p_budget_line_id
     AND bma.month_number = g.month_number
    GROUP BY g.month_number
  )
  SELECT
    jsonb_build_object(
      'january',   MAX(amount) FILTER (WHERE month_number = 1),
      'february',  MAX(amount) FILTER (WHERE month_number = 2),
      'march',     MAX(amount) FILTER (WHERE month_number = 3),
      'april',     MAX(amount) FILTER (WHERE month_number = 4),
      'may',       MAX(amount) FILTER (WHERE month_number = 5),
      'june',      MAX(amount) FILTER (WHERE month_number = 6),
      'july',      MAX(amount) FILTER (WHERE month_number = 7),
      'august',    MAX(amount) FILTER (WHERE month_number = 8),
      'september', MAX(amount) FILTER (WHERE month_number = 9),
      'october',   MAX(amount) FILTER (WHERE month_number = 10),
      'november',  MAX(amount) FILTER (WHERE month_number = 11),
      'december',  MAX(amount) FILTER (WHERE month_number = 12)
    ),
    COALESCE(SUM(amount) FILTER (WHERE month_number BETWEEN 1 AND 3), 0)::NUMERIC(15,2),
    COALESCE(SUM(amount) FILTER (WHERE month_number BETWEEN 4 AND 6), 0)::NUMERIC(15,2),
    COALESCE(SUM(amount) FILTER (WHERE month_number BETWEEN 7 AND 9), 0)::NUMERIC(15,2),
    COALESCE(SUM(amount) FILTER (WHERE month_number BETWEEN 10 AND 12), 0)::NUMERIC(15,2)
  FROM months;
$$;
REVOKE ALL ON FUNCTION public.njss_budget_line_monthly_snapshot(UUID)
  FROM PUBLIC, anon, authenticated;

-- 4. Deterministic SHA-256 fingerprint. Supabase exposes pgcrypto in the
-- extensions schema, so digest is explicitly schema-qualified.
CREATE OR REPLACE FUNCTION public.njss_budget_activation_fingerprint(
  p_activation_batch_id UUID
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'submission_id', s.id,
          'submission_version', s.version,
          'submission_updated_at', s.updated_at,
          'submission_status', s.status,
          'division_id', s.division_id,
          'division_cost_centre_id', bd.cost_centre_id,
          'lines', jsonb_agg(
            jsonb_build_object(
              'line_id', l.id,
              'annual_estimate', l.annual_estimate,
              'funding_source_id', l.funding_source_id,
              'expense_ledger_id', l.expense_ledger_id,
              'monthly', monthly.months,
              'mapping_id', bal.finance_posting_mapping_id,
              'mapping_active', fpm.is_active,
              'mapping_financial_year', fpm.financial_year,
              'posting_code_id', fpm.expense_code_registry_id,
              'chart_of_account_id', fpm.chart_of_account_id,
              'cost_centre_id', fpm.cost_centre_id,
              'department_id', fpm.department_id,
              'section_id', fpm.section_id,
              'finance_active', el.is_active,
              'finance_is_posting', el.is_posting,
              'posting_active', ecr.is_active,
              'chart_active', coa.is_active,
              'cost_centre_active', cc.is_active
            )
            ORDER BY l.id::TEXT
          )
        )::TEXT,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  FROM public.budget_activation_batches bab
  JOIN public.divisional_budget_submissions s ON s.id = bab.submission_id
  JOIN public.budget_divisions bd ON bd.id = s.division_id
  JOIN public.divisional_budget_lines l ON l.submission_id = s.id
  LEFT JOIN public.budget_activation_lines bal
    ON bal.activation_batch_id = bab.id
   AND bal.budget_line_id = l.id
  LEFT JOIN public.finance_posting_mappings fpm ON fpm.id = bal.finance_posting_mapping_id
  LEFT JOIN public.expense_ledger el ON el.id = l.expense_ledger_id
  LEFT JOIN public.expense_code_registry ecr ON ecr.id = fpm.expense_code_registry_id
  LEFT JOIN public.chart_of_accounts coa ON coa.id = fpm.chart_of_account_id
  LEFT JOIN public.cost_centres cc ON cc.id = fpm.cost_centre_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'month_number', g.month_number,
        'amount', COALESCE(bma.amount,0)
      )
      ORDER BY g.month_number
    ) AS months
    FROM generate_series(1,12) AS g(month_number)
    LEFT JOIN public.budget_monthly_allocations bma
      ON bma.budget_line_id = l.id
     AND bma.month_number = g.month_number
  ) monthly ON true
  WHERE bab.id = p_activation_batch_id
  GROUP BY
    s.id, s.version, s.updated_at, s.status, s.division_id, bd.cost_centre_id;
$$;
REVOKE ALL ON FUNCTION public.njss_budget_activation_fingerprint(UUID)
  FROM PUBLIC, anon, authenticated;

-- 5. System Administrator preparation: canonical mapping only.
CREATE OR REPLACE FUNCTION public.njss_prepare_budget_activation(
  p_activation_batch_id UUID,
  p_user_email TEXT DEFAULT NULL
)
RETURNS public.budget_activation_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch public.budget_activation_batches;
  v_out public.budget_activation_batches;
  v_user_id UUID := public.fn_current_app_user_id();
  v_user_email TEXT;
  v_user_name TEXT;
  v_approved_count INTEGER := 0;
  v_ready_count INTEGER := 0;
  v_invalid_count INTEGER := 0;
  v_existing_allocation_count INTEGER := 0;
  v_approved_total NUMERIC(15,2) := 0;
  v_activation_total NUMERIC(15,2) := 0;
  v_existing_allocation_total NUMERIC(15,2) := 0;
  v_legacy_state TEXT := 'ZERO';
BEGIN
  IF v_user_id IS NULL OR NOT public.njss_current_user_has_role('System Administrator') THEN
    RAISE EXCEPTION 'Only a System Administrator may prepare operational budget activation.';
  END IF;

  SELECT u.email, COALESCE(NULLIF(trim(u.full_name), ''), u.email)
  INTO v_user_email, v_user_name
  FROM public.users u
  WHERE u.id = v_user_id AND u.is_active = true;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'Active System Administrator user record is required.';
  END IF;
  p_user_email := v_user_email;

  SELECT * INTO v_batch
  FROM public.budget_activation_batches
  WHERE id = p_activation_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Budget activation batch not found.'; END IF;
  IF v_batch.status = 'ACTIVATED' THEN RAISE EXCEPTION 'Activated budgets are immutable and cannot be prepared again.'; END IF;
  IF v_batch.status = 'CANCELLED' THEN RAISE EXCEPTION 'Cancelled activation batches cannot be prepared.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.divisional_budget_submissions s
    WHERE s.id = v_batch.submission_id
      AND s.status = 'APPROVED'
      AND s.is_locked = true
  ) THEN
    RAISE EXCEPTION 'Only an APPROVED and locked budget can be prepared for activation.';
  END IF;

  DELETE FROM public.budget_activation_lines
  WHERE activation_batch_id = p_activation_batch_id;

  INSERT INTO public.budget_activation_lines (
    activation_batch_id, submission_id, budget_line_id,
    expense_ledger_id, finance_code, finance_posting_mapping_id,
    expense_code_registry_id, chart_of_account_id,
    department_id, section_id, cost_centre_id,
    approved_amount, mapped_amount, mapping_status,
    validation_errors, validation_snapshot,
    source_line_updated_at, source_monthly_updated_at,
    created_at, updated_at
  )
  SELECT
    v_batch.id,
    s.id,
    l.id,
    l.expense_ledger_id,
    el.finance_code,
    fpm.id,
    fpm.expense_code_registry_id,
    fpm.chart_of_account_id,
    fpm.department_id,
    fpm.section_id,
    fpm.cost_centre_id,
    COALESCE(l.annual_estimate,0),
    CASE WHEN validation.is_ready THEN COALESCE(l.annual_estimate,0) ELSE 0 END,
    CASE WHEN validation.is_ready THEN 'READY' ELSE 'INVALID' END,
    to_jsonb(array_remove(ARRAY[
      CASE WHEN l.expense_ledger_id IS NULL THEN 'Finance Code is required.' END,
      CASE WHEN el.id IS NULL THEN 'Finance Code does not exist.' END,
      CASE WHEN el.id IS NOT NULL AND (el.is_active IS DISTINCT FROM true OR el.is_posting IS DISTINCT FROM true)
        THEN 'Finance Code must be an active posting ledger code.' END,
      CASE WHEN bd.cost_centre_id IS NULL THEN 'Approved budget Division has no exact Cost Centre mapping.' END,
      CASE WHEN bd.cost_centre_id IS NOT NULL AND (approved_cc.id IS NULL OR approved_cc.is_active IS DISTINCT FROM true)
        THEN 'Approved budget Division Cost Centre is missing or inactive.' END,
      CASE WHEN fpm.id IS NULL THEN 'Finance Code has no canonical Posting/CoA mapping for the approved Cost Centre and financial year.' END,
      CASE WHEN fpm.id IS NOT NULL AND fpm.is_active IS DISTINCT FROM true
        THEN 'Canonical Finance posting mapping is inactive.' END,
      CASE WHEN ecr.id IS NULL OR ecr.is_active IS DISTINCT FROM true
        THEN 'Canonical Posting Code is missing or inactive.' END,
      CASE WHEN coa.id IS NULL OR coa.is_active IS DISTINCT FROM true
        THEN 'Canonical Chart of Accounts record is missing or inactive.' END,
      CASE WHEN mapped_cc.id IS NULL OR mapped_cc.is_active IS DISTINCT FROM true
        THEN 'Canonical Cost Centre is missing or inactive.' END,
      CASE WHEN expected_dep.id IS NULL OR expected_dep.is_active IS DISTINCT FROM true
        THEN 'Approved budget Department is missing or inactive.' END,
      CASE WHEN fpm.id IS NOT NULL AND fpm.department_id IS DISTINCT FROM expected_dep.id
        THEN 'Canonical mapping Department does not match the approved budget.' END,
      CASE WHEN bd.section_id IS NOT NULL AND fpm.id IS NOT NULL AND fpm.section_id IS DISTINCT FROM bd.section_id
        THEN 'Canonical mapping Section does not match the approved budget.' END,
      CASE WHEN fpm.id IS NOT NULL AND fpm.cost_centre_id IS DISTINCT FROM bd.cost_centre_id
        THEN 'Canonical mapping Cost Centre does not match budget_divisions.cost_centre_id.' END,
      CASE WHEN mapped_cc.id IS NOT NULL AND fpm.id IS NOT NULL
             AND mapped_cc.department_id IS DISTINCT FROM fpm.department_id
        THEN 'Canonical Cost Centre does not belong to the mapped Department.' END,
      CASE WHEN fpm.section_id IS NOT NULL AND mapped_cc.id IS NOT NULL
             AND mapped_cc.section_id IS NOT NULL
             AND mapped_cc.section_id IS DISTINCT FROM fpm.section_id
        THEN 'Canonical Cost Centre does not belong to the mapped Section.' END,
      CASE WHEN ecr.id IS NOT NULL AND fpm.id IS NOT NULL
             AND ecr.department_id IS DISTINCT FROM fpm.department_id
        THEN 'Posting Code Department does not match the canonical mapping.' END,
      CASE WHEN ecr.id IS NOT NULL AND fpm.id IS NOT NULL
             AND ecr.cost_centre_id IS DISTINCT FROM fpm.cost_centre_id
        THEN 'Posting Code Cost Centre does not match the canonical mapping.' END,
      CASE WHEN ecr.id IS NOT NULL AND ecr.section_id IS NOT NULL AND fpm.id IS NOT NULL
             AND ecr.section_id IS DISTINCT FROM fpm.section_id
        THEN 'Posting Code Section does not match the canonical mapping.' END,
      CASE WHEN ABS(COALESCE(l.allocation_variance,0)) > 0.009
             OR ABS(COALESCE(l.monthly_allocation_total,0) - COALESCE(l.annual_estimate,0)) > 0.009
        THEN 'Monthly allocation must equal Annual Estimate.' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.budget_allocations ba
        WHERE ba.source_budget_line_id = l.id AND ba.is_active = true
      ) THEN 'Operational allocation already exists for source budget line.' END
    ]::TEXT[], NULL)),
    jsonb_build_object(
      'line_number', l.line_number,
      'budget_line_number', l.budget_line_number,
      'finance_code', el.finance_code,
      'finance_posting_mapping_id', fpm.id,
      'posting_code', ecr.full_expense_code,
      'chart_of_account_id', fpm.chart_of_account_id,
      'cost_centre_id', fpm.cost_centre_id,
      'approved_amount', COALESCE(l.annual_estimate,0),
      'monthly_total', COALESCE(l.monthly_allocation_total,0),
      'line_updated_at', l.updated_at,
      'monthly_updated_at', monthly.max_updated_at
    ),
    l.updated_at,
    monthly.max_updated_at,
    NOW(),
    NOW()
  FROM public.divisional_budget_submissions s
  JOIN public.budget_divisions bd ON bd.id = s.division_id
  JOIN public.divisional_budget_lines l ON l.submission_id = s.id
  LEFT JOIN public.expense_ledger el ON el.id = l.expense_ledger_id
  LEFT JOIN public.cost_centres approved_cc ON approved_cc.id = bd.cost_centre_id
  LEFT JOIN public.departments expected_dep
    ON expected_dep.id = COALESCE(s.department_id, bd.department_id)
  LEFT JOIN LATERAL public.njss_resolve_finance_posting_mapping(
    l.expense_ledger_id, s.budget_year, bd.cost_centre_id
  ) fpm ON true
  LEFT JOIN public.expense_code_registry ecr ON ecr.id = fpm.expense_code_registry_id
  LEFT JOIN public.chart_of_accounts coa ON coa.id = fpm.chart_of_account_id
  LEFT JOIN public.cost_centres mapped_cc ON mapped_cc.id = fpm.cost_centre_id
  LEFT JOIN LATERAL (
    SELECT MAX(bma.updated_at) AS max_updated_at
    FROM public.budget_monthly_allocations bma
    WHERE bma.budget_line_id = l.id
  ) monthly ON true
  LEFT JOIN LATERAL (
    SELECT (
      l.expense_ledger_id IS NOT NULL
      AND el.id IS NOT NULL
      AND el.is_active = true
      AND el.is_posting = true
      AND bd.cost_centre_id IS NOT NULL
      AND approved_cc.id IS NOT NULL
      AND approved_cc.is_active = true
      AND expected_dep.id IS NOT NULL
      AND expected_dep.is_active = true
      AND fpm.id IS NOT NULL
      AND fpm.is_active = true
      AND ecr.id IS NOT NULL
      AND ecr.is_active = true
      AND coa.id IS NOT NULL
      AND coa.is_active = true
      AND mapped_cc.id IS NOT NULL
      AND mapped_cc.is_active = true
      AND fpm.department_id = expected_dep.id
      AND (bd.section_id IS NULL OR fpm.section_id = bd.section_id)
      AND fpm.cost_centre_id = bd.cost_centre_id
      AND mapped_cc.department_id = fpm.department_id
      AND (fpm.section_id IS NULL OR mapped_cc.section_id IS NULL OR mapped_cc.section_id = fpm.section_id)
      AND ecr.department_id = fpm.department_id
      AND ecr.cost_centre_id = fpm.cost_centre_id
      AND (ecr.section_id IS NULL OR ecr.section_id = fpm.section_id)
      AND ABS(COALESCE(l.allocation_variance,0)) <= 0.009
      AND ABS(COALESCE(l.monthly_allocation_total,0) - COALESCE(l.annual_estimate,0)) <= 0.009
      AND NOT EXISTS (
        SELECT 1 FROM public.budget_allocations ba
        WHERE ba.source_budget_line_id = l.id AND ba.is_active = true
      )
    ) AS is_ready
  ) validation ON true
  WHERE s.id = v_batch.submission_id
  ORDER BY l.line_number;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE mapping_status = 'READY')::INTEGER,
    COUNT(*) FILTER (WHERE mapping_status <> 'READY')::INTEGER,
    COALESCE(SUM(approved_amount),0)::NUMERIC(15,2),
    COALESCE(SUM(mapped_amount),0)::NUMERIC(15,2)
  INTO
    v_approved_count, v_ready_count, v_invalid_count,
    v_approved_total, v_activation_total
  FROM public.budget_activation_lines
  WHERE activation_batch_id = p_activation_batch_id;

  SELECT
    COUNT(*)::INTEGER,
    COALESCE(SUM(ba.original_budget),0)::NUMERIC(15,2)
  INTO v_existing_allocation_count, v_existing_allocation_total
  FROM public.budget_allocations ba
  WHERE ba.source_budget_submission_id = v_batch.submission_id
    AND ba.source_module = 'EXCEL_BUDGET'
    AND ba.is_active = true;

  v_legacy_state := CASE
    WHEN v_existing_allocation_count = 0 THEN 'ZERO'
    WHEN v_existing_allocation_count = v_approved_count
      AND ABS(v_existing_allocation_total - v_approved_total) <= 0.009 THEN 'COMPLETE'
    ELSE 'PARTIAL'
  END;

  UPDATE public.budget_activation_batches
  SET approved_line_count = v_approved_count,
      approved_total = v_approved_total,
      mapped_line_count = v_ready_count,
      unmapped_line_count = v_invalid_count,
      activation_total = v_activation_total,
      variance = v_approved_total - v_activation_total,
      validation_error_count = v_invalid_count,
      status = CASE
        WHEN v_legacy_state IN ('PARTIAL','COMPLETE') THEN 'VALIDATION_FAILED'
        WHEN v_invalid_count = 0 AND v_approved_count > 0 THEN 'DRAFT_MAPPING'
        ELSE 'VALIDATION_FAILED'
      END,
      validation_fingerprint = NULL,
      prepared_against_submission_updated_at = NULL,
      prepared_by = v_user_id,
      prepared_by_email = v_user_email,
      prepared_at = NOW(),
      validated_at = NOW(),
      submitted_for_activation_by = NULL,
      submitted_for_activation_at = NULL,
      validation_snapshot = jsonb_build_object(
        'approved_line_count', v_approved_count,
        'mapped_line_count', v_ready_count,
        'unmapped_line_count', v_invalid_count,
        'approved_total', v_approved_total,
        'activation_total', v_activation_total,
        'variance', v_approved_total - v_activation_total,
        'validation_error_count', v_invalid_count,
        'legacy_allocation_state', v_legacy_state,
        'legacy_allocation_count', v_existing_allocation_count,
        'legacy_allocation_total', v_existing_allocation_total,
        'legacy_message', CASE
          WHEN v_legacy_state = 'PARTIAL' THEN
            'Partial legacy operational allocation requires reconciliation; activation will not auto-complete it.'
          WHEN v_legacy_state = 'COMPLETE' THEN
            'Complete legacy operational allocation is preserved; do not recreate it merely to generate a Task 9 activation event.'
          ELSE NULL
        END,
        'validated_at', NOW()
      ),
      updated_at = NOW()
  WHERE id = p_activation_batch_id
  RETURNING * INTO v_out;

  PERFORM public.log_audit_event(
    v_user_id, v_user_email, v_user_name,
    CASE
      WHEN v_legacy_state IN ('PARTIAL','COMPLETE') THEN 'BUDGET_ACTIVATION_LEGACY_RECONCILIATION_REQUIRED'
      WHEN v_invalid_count = 0 THEN 'BUDGET_ACTIVATION_VALIDATED'
      ELSE 'BUDGET_ACTIVATION_VALIDATION_FAILED'
    END,
    'BUDGET_ACTIVATION', p_activation_batch_id, v_out.submission_id::TEXT,
    NULL, jsonb_build_object('status', v_out.status),
    jsonb_build_object(
      'approved_line_count', v_approved_count,
      'mapped_line_count', v_ready_count,
      'unmapped_line_count', v_invalid_count,
      'approved_total', v_approved_total,
      'activation_total', v_activation_total,
      'variance', v_approved_total - v_activation_total,
      'legacy_allocation_state', v_legacy_state
    ),
    jsonb_build_object('source', 'Task 9 canonical activation preparation')
  );

  RETURN v_out;
END;
$$;

-- 6. System Administrator submit: revalidate and store fingerprint.
CREATE OR REPLACE FUNCTION public.njss_submit_budget_activation(
  p_activation_batch_id UUID,
  p_user_email TEXT DEFAULT NULL
)
RETURNS public.budget_activation_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch public.budget_activation_batches;
  v_out public.budget_activation_batches;
  v_user_id UUID := public.fn_current_app_user_id();
  v_user_email TEXT;
  v_user_name TEXT;
  v_fingerprint TEXT;
BEGIN
  IF v_user_id IS NULL OR NOT public.njss_current_user_has_role('System Administrator') THEN
    RAISE EXCEPTION 'Only a System Administrator may submit operational budget activation.';
  END IF;

  SELECT u.email, COALESCE(NULLIF(trim(u.full_name), ''), u.email)
  INTO v_user_email, v_user_name
  FROM public.users u
  WHERE u.id = v_user_id AND u.is_active = true;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'Active System Administrator user record is required.';
  END IF;
  p_user_email := v_user_email;

  PERFORM public.njss_prepare_budget_activation(p_activation_batch_id, p_user_email);

  SELECT * INTO v_batch
  FROM public.budget_activation_batches
  WHERE id = p_activation_batch_id
  FOR UPDATE;

  IF v_batch.status <> 'DRAFT_MAPPING' THEN
    RAISE EXCEPTION 'Activation cannot be submitted until every canonical Finance mapping is valid.';
  END IF;
  IF v_batch.approved_line_count <= 0
     OR v_batch.mapped_line_count <> v_batch.approved_line_count
     OR v_batch.unmapped_line_count <> 0
     OR v_batch.validation_error_count <> 0
     OR ABS(v_batch.variance) > 0.009
     OR ABS(v_batch.approved_total - v_batch.activation_total) > 0.009 THEN
    RAISE EXCEPTION 'Activation totals or line counts do not reconcile to the approved budget.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.divisional_budget_submissions s
    WHERE s.id = v_batch.submission_id
      AND s.status = 'APPROVED'
      AND s.is_locked = true
  ) THEN
    RAISE EXCEPTION 'Approved budget changed after activation preparation.';
  END IF;

  v_fingerprint := public.njss_budget_activation_fingerprint(p_activation_batch_id);
  IF v_fingerprint IS NULL OR trim(v_fingerprint) = '' THEN
    RAISE EXCEPTION 'Activation fingerprint could not be calculated.';
  END IF;

  UPDATE public.budget_activation_batches
  SET status = 'READY_FOR_ACTIVATION',
      validation_fingerprint = v_fingerprint,
      prepared_against_submission_updated_at = (
        SELECT s.updated_at
        FROM public.divisional_budget_submissions s
        WHERE s.id = v_batch.submission_id
      ),
      submitted_for_activation_by = v_user_id,
      submitted_for_activation_at = NOW(),
      validation_snapshot = validation_snapshot || jsonb_build_object(
        'validation_fingerprint', v_fingerprint,
        'submitted_for_activation_by', v_user_id,
        'submitted_for_activation_at', NOW()
      ),
      updated_at = NOW()
  WHERE id = p_activation_batch_id
  RETURNING * INTO v_out;

  INSERT INTO public.notifications (
    user_id, notification_type, title, message, reference_type, reference_id,
    is_read, is_email_sent, priority
  )
  SELECT
    u.id,
    'BUDGET_ACTIVATION_READY',
    'Approved budget ready for activation',
    'A fully validated approved budget is ready for Registrar authorisation.',
    'BUDGET_ACTIVATION',
    p_activation_batch_id::TEXT,
    false,
    false,
    'HIGH'
  FROM public.users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  JOIN public.roles r ON r.id = ur.role_id
  WHERE u.is_active = true
    AND r.name = 'Registrar'
    AND r.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = u.id
        AND n.notification_type = 'BUDGET_ACTIVATION_READY'
        AND n.reference_type = 'BUDGET_ACTIVATION'
        AND n.reference_id = p_activation_batch_id::TEXT
    );

  PERFORM public.log_audit_event(
    v_user_id, v_user_email, v_user_name,
    'BUDGET_ACTIVATION_SUBMITTED', 'BUDGET_ACTIVATION',
    p_activation_batch_id, v_out.submission_id::TEXT,
    jsonb_build_object('status', 'DRAFT_MAPPING'),
    jsonb_build_object('status', 'READY_FOR_ACTIVATION'),
    jsonb_build_object(
      'approved_line_count', v_out.approved_line_count,
      'mapped_line_count', v_out.mapped_line_count,
      'approved_total', v_out.approved_total,
      'activation_total', v_out.activation_total,
      'variance', v_out.variance,
      'validation_fingerprint', v_out.validation_fingerprint,
      'preparer', v_out.prepared_by_email
    ),
    jsonb_build_object('source', 'Task 9 canonical activation submission')
  );

  RETURN v_out;
END;
$$;

-- 7. Registrar-only atomic activation. Stale fingerprints become a committed
-- VALIDATION_FAILED state rather than rolling back the detection.
CREATE OR REPLACE FUNCTION public.njss_activate_approved_budget(
  p_activation_batch_id UUID,
  p_user_email TEXT DEFAULT NULL
)
RETURNS public.budget_activation_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch public.budget_activation_batches;
  v_out public.budget_activation_batches;
  v_user_id UUID := public.fn_current_app_user_id();
  v_user_email TEXT;
  v_user_name TEXT;
  v_current_fingerprint TEXT;
  v_source_count INTEGER := 0;
  v_stage_count INTEGER := 0;
  v_invalid_count INTEGER := 0;
  v_snapshot_count INTEGER := 0;
  v_source_total NUMERIC(15,2) := 0;
  v_stage_total NUMERIC(15,2) := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Only a Registrar may authorise activation.';
  END IF;
  IF public.njss_current_user_has_role('System Administrator') THEN
    RAISE EXCEPTION 'System Administrator cannot authorise operational budget activation.';
  END IF;
  IF NOT public.njss_current_user_has_role('Registrar') THEN
    RAISE EXCEPTION 'Only a Registrar may authorise activation.';
  END IF;

  SELECT u.email, COALESCE(NULLIF(trim(u.full_name), ''), u.email)
  INTO v_user_email, v_user_name
  FROM public.users u
  WHERE u.id = v_user_id AND u.is_active = true;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'Active Registrar user record is required.';
  END IF;
  p_user_email := v_user_email;

  SELECT * INTO v_batch
  FROM public.budget_activation_batches
  WHERE id = p_activation_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Budget activation batch not found.'; END IF;
  IF v_batch.status = 'ACTIVATED' THEN RAISE EXCEPTION 'Approved budget has already been activated.'; END IF;
  IF v_batch.status <> 'READY_FOR_ACTIVATION' THEN RAISE EXCEPTION 'Only a READY_FOR_ACTIVATION batch can be activated.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.divisional_budget_submissions s
    WHERE s.id = v_batch.submission_id
      AND s.status = 'APPROVED'
      AND s.is_locked = true
  ) THEN
    RAISE EXCEPTION 'Approved budget changed after activation preparation.';
  END IF;
  IF v_batch.prepared_by IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.user_roles ur ON ur.user_id = u.id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE u.id = v_batch.prepared_by
      AND u.is_active = true
      AND r.name = 'System Administrator'
      AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'Activation preparer must be an active System Administrator.';
  END IF;
  IF v_batch.prepared_by = v_user_id THEN
    RAISE EXCEPTION 'Activation authoriser cannot be the technical preparer.';
  END IF;

  v_current_fingerprint := public.njss_budget_activation_fingerprint(p_activation_batch_id);

  IF v_batch.validation_fingerprint IS NULL
     OR v_current_fingerprint IS DISTINCT FROM v_batch.validation_fingerprint THEN
    UPDATE public.budget_activation_batches
    SET status = 'VALIDATION_FAILED',
        validation_fingerprint = NULL,
        prepared_against_submission_updated_at = NULL,
        validation_error_count = GREATEST(validation_error_count, 1),
        submitted_for_activation_by = NULL,
        submitted_for_activation_at = NULL,
        validation_snapshot = validation_snapshot || jsonb_build_object(
          'stale_validation', true,
          'stale_detected_at', NOW(),
          'error', 'Technical mapping or approved budget state changed after Administrator validation. Re-prepare activation.'
        ),
        updated_at = NOW()
    WHERE id = p_activation_batch_id
    RETURNING * INTO v_out;

    PERFORM public.log_audit_event(
      v_user_id, v_user_email, v_user_name,
      'BUDGET_ACTIVATION_STALE', 'BUDGET_ACTIVATION',
      p_activation_batch_id, v_out.submission_id::TEXT,
      jsonb_build_object('status', 'READY_FOR_ACTIVATION'),
      jsonb_build_object('status', 'VALIDATION_FAILED'),
      jsonb_build_object(
        'stored_fingerprint', v_batch.validation_fingerprint,
        'current_fingerprint', v_current_fingerprint
      ),
      jsonb_build_object('source', 'Task 9 stale fingerprint control')
    );

    RETURN v_out;
  END IF;

  SELECT COUNT(*)::INTEGER, COALESCE(SUM(l.annual_estimate),0)::NUMERIC(15,2)
  INTO v_source_count, v_source_total
  FROM public.divisional_budget_lines l
  WHERE l.submission_id = v_batch.submission_id;

  SELECT COUNT(*)::INTEGER, COALESCE(SUM(al.approved_amount),0)::NUMERIC(15,2)
  INTO v_stage_count, v_stage_total
  FROM public.budget_activation_lines al
  WHERE al.activation_batch_id = p_activation_batch_id
    AND al.mapping_status = 'READY';

  IF v_source_count <= 0
     OR v_source_count <> v_batch.approved_line_count
     OR v_stage_count <> v_batch.approved_line_count
     OR v_batch.mapped_line_count <> v_batch.approved_line_count
     OR v_batch.unmapped_line_count <> 0
     OR v_batch.validation_error_count <> 0
     OR ABS(v_source_total - v_batch.approved_total) > 0.009
     OR ABS(v_stage_total - v_batch.approved_total) > 0.009
     OR ABS(v_batch.activation_total - v_batch.approved_total) > 0.009
     OR ABS(v_batch.variance) > 0.009 THEN
    RAISE EXCEPTION 'Activation total does not reconcile to approved total.';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_invalid_count
  FROM public.budget_activation_lines bal
  JOIN public.divisional_budget_lines l ON l.id = bal.budget_line_id
  JOIN public.divisional_budget_submissions s ON s.id = l.submission_id
  JOIN public.budget_divisions bd ON bd.id = s.division_id
  LEFT JOIN public.finance_posting_mappings fpm ON fpm.id = bal.finance_posting_mapping_id
  LEFT JOIN public.expense_ledger el ON el.id = l.expense_ledger_id
  LEFT JOIN public.expense_code_registry ecr ON ecr.id = fpm.expense_code_registry_id
  LEFT JOIN public.chart_of_accounts coa ON coa.id = fpm.chart_of_account_id
  LEFT JOIN public.cost_centres cc ON cc.id = fpm.cost_centre_id
  LEFT JOIN public.departments dep ON dep.id = fpm.department_id
  LEFT JOIN public.sections sec ON sec.id = fpm.section_id
  WHERE bal.activation_batch_id = p_activation_batch_id
    AND (
      bal.mapping_status <> 'READY'
      OR bal.expense_ledger_id IS DISTINCT FROM l.expense_ledger_id
      OR fpm.id IS NULL
      OR fpm.is_active IS DISTINCT FROM true
      OR fpm.id IS DISTINCT FROM bal.finance_posting_mapping_id
      OR fpm.expense_code_registry_id IS DISTINCT FROM bal.expense_code_registry_id
      OR fpm.chart_of_account_id IS DISTINCT FROM bal.chart_of_account_id
      OR fpm.cost_centre_id IS DISTINCT FROM bal.cost_centre_id
      OR fpm.department_id IS DISTINCT FROM bal.department_id
      OR fpm.section_id IS DISTINCT FROM bal.section_id
      OR bd.cost_centre_id IS NULL
      OR fpm.cost_centre_id IS DISTINCT FROM bd.cost_centre_id
      OR fpm.department_id IS DISTINCT FROM COALESCE(s.department_id, bd.department_id)
      OR (bd.section_id IS NOT NULL AND fpm.section_id IS DISTINCT FROM bd.section_id)
      OR el.id IS NULL OR el.is_active IS DISTINCT FROM true OR el.is_posting IS DISTINCT FROM true
      OR ecr.id IS NULL OR ecr.is_active IS DISTINCT FROM true
      OR coa.id IS NULL OR coa.is_active IS DISTINCT FROM true
      OR cc.id IS NULL OR cc.is_active IS DISTINCT FROM true
      OR dep.id IS NULL OR dep.is_active IS DISTINCT FROM true
      OR (fpm.section_id IS NOT NULL AND (sec.id IS NULL OR sec.is_active IS DISTINCT FROM true))
      OR cc.department_id IS DISTINCT FROM fpm.department_id
      OR (fpm.section_id IS NOT NULL AND cc.section_id IS NOT NULL AND cc.section_id IS DISTINCT FROM fpm.section_id)
      OR ecr.department_id IS DISTINCT FROM fpm.department_id
      OR ecr.cost_centre_id IS DISTINCT FROM fpm.cost_centre_id
      OR (ecr.section_id IS NOT NULL AND ecr.section_id IS DISTINCT FROM fpm.section_id)
      OR ABS(COALESCE(l.allocation_variance,0)) > 0.009
      OR ABS(COALESCE(l.monthly_allocation_total,0) - COALESCE(l.annual_estimate,0)) > 0.009
      OR EXISTS (
        SELECT 1 FROM public.budget_allocations ba
        WHERE ba.source_budget_line_id = l.id AND ba.is_active = true
      )
    );

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Approved budget or canonical Finance mapping is no longer valid. Re-prepare activation.';
  END IF;

  WITH inserted_allocations AS (
    INSERT INTO public.budget_allocations (
      financial_year, department_id, section_id, cost_centre_id,
      project_id, funding_source_id, account_id, expense_code_registry_id,
      source_budget_submission_id, source_budget_line_id, budget_division_id,
      source_module, annual_plan_line_id, original_budget, supplemental_budget,
      monthly_cashflow, q1_planned, q2_planned, q3_planned, q4_planned,
      is_active, created_by, updated_at
    )
    SELECT
      s.budget_year,
      fpm.department_id,
      fpm.section_id,
      fpm.cost_centre_id,
      NULL,
      l.funding_source_id,
      fpm.chart_of_account_id,
      fpm.expense_code_registry_id,
      s.id,
      l.id,
      s.division_id,
      'EXCEL_BUDGET',
      NULL,
      l.annual_estimate,
      0,
      monthly.monthly_cashflow,
      monthly.q1,
      monthly.q2,
      monthly.q3,
      monthly.q4,
      true,
      v_user_id,
      NOW()
    FROM public.budget_activation_lines bal
    JOIN public.finance_posting_mappings fpm
      ON fpm.id = bal.finance_posting_mapping_id
     AND fpm.is_active = true
    JOIN public.divisional_budget_lines l ON l.id = bal.budget_line_id
    JOIN public.divisional_budget_submissions s ON s.id = l.submission_id
    JOIN LATERAL public.njss_budget_line_monthly_snapshot(l.id) monthly ON true
    WHERE bal.activation_batch_id = p_activation_batch_id
      AND bal.mapping_status = 'READY'
    RETURNING id, source_budget_line_id
  )
  INSERT INTO public.budget_activation_line_snapshots (
    activation_batch_id, source_budget_submission_id, source_budget_line_id,
    budget_allocation_id, finance_posting_mapping_id, expense_ledger_id,
    finance_code_snapshot, finance_description_snapshot,
    expense_code_registry_id, posting_code_snapshot, posting_description_snapshot,
    chart_of_account_id, chart_account_code_snapshot, chart_account_name_snapshot,
    cost_centre_id, cost_centre_code_snapshot, cost_centre_name_snapshot,
    approved_amount, monthly_cashflow_snapshot
  )
  SELECT
    p_activation_batch_id,
    bab.submission_id,
    bal.budget_line_id,
    ia.id,
    bal.finance_posting_mapping_id,
    bal.expense_ledger_id,
    el.finance_code,
    el.standard_description,
    ecr.id,
    ecr.full_expense_code,
    ecr.description,
    coa.id,
    coa.account_code,
    coa.account_name,
    cc.id,
    cc.code,
    cc.name,
    bal.approved_amount,
    monthly.monthly_cashflow
  FROM inserted_allocations ia
  JOIN public.budget_activation_lines bal
    ON bal.budget_line_id = ia.source_budget_line_id
   AND bal.activation_batch_id = p_activation_batch_id
  JOIN public.budget_activation_batches bab ON bab.id = bal.activation_batch_id
  JOIN public.expense_ledger el ON el.id = bal.expense_ledger_id
  JOIN public.expense_code_registry ecr ON ecr.id = bal.expense_code_registry_id
  JOIN public.chart_of_accounts coa ON coa.id = bal.chart_of_account_id
  JOIN public.cost_centres cc ON cc.id = bal.cost_centre_id
  JOIN LATERAL public.njss_budget_line_monthly_snapshot(bal.budget_line_id) monthly ON true;

  GET DIAGNOSTICS v_snapshot_count = ROW_COUNT;

  IF v_snapshot_count <> v_batch.approved_line_count THEN
    RAISE EXCEPTION
      'Atomic activation failed: expected % allocations/snapshots but created %.',
      v_batch.approved_line_count, v_snapshot_count;
  END IF;

  UPDATE public.budget_activation_batches
  SET status = 'ACTIVATED',
      authorised_by = v_user_id,
      authorised_by_email = v_user_email,
      authorised_at = NOW(),
      activated_at = NOW(),
      activation_total = approved_total,
      variance = 0,
      validation_snapshot = validation_snapshot || jsonb_build_object(
        'authorised_by', v_user_email,
        'authorised_at', NOW(),
        'activated_line_count', v_snapshot_count,
        'activated_total', approved_total,
        'activation_snapshot_count', v_snapshot_count,
        'validation_fingerprint', validation_fingerprint
      ),
      updated_at = NOW()
  WHERE id = p_activation_batch_id
  RETURNING * INTO v_out;

  PERFORM public.log_audit_event(
    v_user_id, v_user_email, v_user_name,
    'BUDGET_ACTIVATED', 'BUDGET_ACTIVATION',
    p_activation_batch_id, v_out.submission_id::TEXT,
    jsonb_build_object('status', 'READY_FOR_ACTIVATION'),
    jsonb_build_object('status', 'ACTIVATED'),
    jsonb_build_object(
      'approved_line_count', v_out.approved_line_count,
      'activated_line_count', v_snapshot_count,
      'activation_snapshot_count', v_snapshot_count,
      'approved_total', v_out.approved_total,
      'activation_total', v_out.activation_total,
      'variance', v_out.variance,
      'validation_fingerprint', v_out.validation_fingerprint,
      'preparer', v_out.prepared_by_email,
      'registrar_authoriser', v_out.authorised_by_email
    ),
    jsonb_build_object('source', 'Task 9 atomic canonical activation')
  );

  IF v_out.prepared_by IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, notification_type, title, message, reference_type, reference_id,
      is_read, is_email_sent, priority
    )
    SELECT
      v_out.prepared_by,
      'BUDGET_ACTIVATED',
      'Approved budget activated',
      'Registrar authorisation is complete and the approved budget is now operational for FF3/FF4 and revision controls.',
      'BUDGET_ACTIVATION',
      p_activation_batch_id::TEXT,
      false,
      false,
      'HIGH'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = v_out.prepared_by
        AND n.notification_type = 'BUDGET_ACTIVATED'
        AND n.reference_type = 'BUDGET_ACTIVATION'
        AND n.reference_id = p_activation_batch_id::TEXT
    );
  END IF;

  RETURN v_out;
END;
$$;

-- 8. RPC execute permissions remain role-enforced inside the functions.
REVOKE ALL ON FUNCTION public.njss_prepare_budget_activation(UUID,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.njss_submit_budget_activation(UUID,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.njss_activate_approved_budget(UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_prepare_budget_activation(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.njss_submit_budget_activation(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.njss_activate_approved_budget(UUID,TEXT) TO authenticated;

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES (
  'latest_database_migration',
  to_jsonb('062_budget_activation_fingerprint_and_immutable_snapshot'::TEXT),
  'Latest applied NJSS migration identifier.'
)
ON CONFLICT (setting_key) DO UPDATE SET
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  updated_at = NOW();

COMMIT;
