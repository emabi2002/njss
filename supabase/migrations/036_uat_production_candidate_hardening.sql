-- NJSS UAT Production Candidate hardening
-- Additive migration: preserves existing business workflow and historical migrations.

BEGIN;

-- 1) Authoritative business configuration for active financial year and periods.
CREATE TABLE IF NOT EXISTS public.financial_year_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year integer NOT NULL UNIQUE,
  cycle_code text NOT NULL DEFAULT 'ANNUAL',
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','OPEN','CLOSED','ARCHIVED')),
  is_active boolean NOT NULL DEFAULT false,
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_year_config_date_order CHECK (end_date >= start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_financial_year_config_one_active
  ON public.financial_year_config (is_active)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS public.financial_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year integer NOT NULL REFERENCES public.financial_year_config(financial_year) ON DELETE CASCADE,
  period_number integer NOT NULL CHECK (period_number BETWEEN 1 AND 12),
  period_name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','LOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (financial_year, period_number),
  CONSTRAINT financial_periods_date_order CHECK (end_date >= start_date)
);

-- 2) Controlled UAT register. No fake PASS results are preloaded.
CREATE TABLE IF NOT EXISTS public.uat_test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_number text NOT NULL UNIQUE,
  module text NOT NULL,
  scenario text NOT NULL,
  preconditions text,
  expected_result text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.uat_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number text NOT NULL UNIQUE,
  title text NOT NULL,
  environment text NOT NULL DEFAULT 'UAT',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.uat_defects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_reference text NOT NULL UNIQUE,
  title text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','FIXED','RETEST','CLOSED','DEFERRED')),
  description text,
  assigned_to uuid REFERENCES public.users(id),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.uat_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id uuid NOT NULL REFERENCES public.uat_test_runs(id) ON DELETE CASCADE,
  test_case_id uuid NOT NULL REFERENCES public.uat_test_cases(id),
  actual_result text,
  result_status text NOT NULL DEFAULT 'BLOCKED' CHECK (result_status IN ('PASS','FAIL','BLOCKED')),
  tester_id uuid REFERENCES public.users(id),
  execution_date timestamptz NOT NULL DEFAULT now(),
  comments text,
  defect_id uuid REFERENCES public.uat_defects(id),
  retest_result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (test_run_id, test_case_id)
);

CREATE TABLE IF NOT EXISTS public.uat_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uat_result_id uuid NOT NULL REFERENCES public.uat_results(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_type text,
  uploaded_by uuid REFERENCES public.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.uat_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id uuid NOT NULL REFERENCES public.uat_test_runs(id) ON DELETE CASCADE,
  signoff_role text NOT NULL,
  signed_by uuid NOT NULL REFERENCES public.users(id),
  signed_at timestamptz NOT NULL DEFAULT now(),
  decision text NOT NULL CHECK (decision IN ('APPROVED','APPROVED_WITH_CONDITIONS','REJECTED')),
  comments text,
  UNIQUE (test_run_id, signoff_role, signed_by)
);

-- 3) Idempotently reassert RLS posture after earlier demo/testing migrations.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'financial_year_config','financial_periods','uat_test_cases','uat_test_runs','uat_results','uat_defects','uat_evidence','uat_signoffs',
    'budget_monthly_allocations','expense_code_registry','ff3_items','ff3_quotations','ff3_attachments','ff4_attachments','divisional_budget_lines','documents','notifications','cost_centres','expense_items','audit_logs'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- 4) Permission-scoped policies for new config/UAT structures.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_year_config','financial_periods','uat_test_cases','uat_test_runs','uat_results','uat_defects','uat_evidence','uat_signoffs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.fn_user_has_permission(auth.uid(), ''operations.view'') OR public.fn_user_has_permission(auth.uid(), ''settings.manage'') OR public.fn_user_has_permission(auth.uid(), ''all''))', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_manage', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.fn_user_has_permission(auth.uid(), ''operations.manage'') OR public.fn_user_has_permission(auth.uid(), ''settings.manage'') OR public.fn_user_has_permission(auth.uid(), ''all'')) WITH CHECK (public.fn_user_has_permission(auth.uid(), ''operations.manage'') OR public.fn_user_has_permission(auth.uid(), ''settings.manage'') OR public.fn_user_has_permission(auth.uid(), ''all''))', t || '_manage', t);
  END LOOP;
END $$;

-- 5) Budget preparation write policies required for UAT budget grid operation.
DROP POLICY IF EXISTS budget_monthly_allocations_write ON public.budget_monthly_allocations;
CREATE POLICY budget_monthly_allocations_write ON public.budget_monthly_allocations
  FOR ALL TO authenticated
  USING (
    public.fn_user_has_permission(auth.uid(), 'budget.template.edit')
    OR public.fn_user_has_permission(auth.uid(), 'budget.template.create')
    OR public.fn_user_has_permission(auth.uid(), 'all')
  )
  WITH CHECK (
    public.fn_user_has_permission(auth.uid(), 'budget.template.edit')
    OR public.fn_user_has_permission(auth.uid(), 'budget.template.create')
    OR public.fn_user_has_permission(auth.uid(), 'all')
  );

DROP POLICY IF EXISTS expense_code_registry_manage ON public.expense_code_registry;
CREATE POLICY expense_code_registry_manage ON public.expense_code_registry
  FOR ALL TO authenticated
  USING (public.fn_user_has_permission(auth.uid(), 'registry.manage') OR public.fn_user_has_permission(auth.uid(), 'all'))
  WITH CHECK (public.fn_user_has_permission(auth.uid(), 'registry.manage') OR public.fn_user_has_permission(auth.uid(), 'all'));

-- 6) Harden audit log direct writes to authenticated application users only.
DROP POLICY IF EXISTS audit_insert_auth ON public.audit_logs;
CREATE POLICY audit_insert_auth ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = public.fn_current_app_user_id() OR public.fn_user_has_permission(auth.uid(), 'all'));

-- 7) Storage correction: make financial-support buckets private and create supplier bucket.
INSERT INTO storage.buckets (id, name, public)
VALUES ('supplier-documents', 'supplier-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

UPDATE storage.buckets
SET public = false
WHERE id IN ('ff3-attachments', 'ff4-attachments', 'quotations', 'supplier-documents');

-- 8) FF4 segregation of duties wrapper: preserve existing transition implementation when present.
DO $$
BEGIN
  IF to_regprocedure('public.njss_transition_ff4(uuid,text,text,text)') IS NOT NULL THEN
    IF to_regprocedure('public.njss_transition_ff4_base(uuid,text,text,text)') IS NULL THEN
      ALTER FUNCTION public.njss_transition_ff4(uuid,text,text,text) RENAME TO njss_transition_ff4_base;
    END IF;

    CREATE OR REPLACE FUNCTION public.njss_transition_ff4(
      p_ff4_id uuid,
      p_action text,
      p_comments text DEFAULT NULL,
      p_user_email text DEFAULT NULL
    ) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
    DECLARE
      v_ff4 record;
      v_actor uuid;
    BEGIN
      SELECT * INTO v_ff4 FROM public.ff4_headers WHERE id = p_ff4_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'FF4 not found';
      END IF;

      v_actor := public.fn_current_app_user_id();
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Authenticated NJSS user profile is required';
      END IF;

      IF upper(p_action) IN ('VERIFY','APPROVE','PROCESS','PAY','RECONCILE') THEN
        PERFORM public.fn_check_segregation_of_duties('FF4', v_ff4.created_by, v_ff4.verified_by, v_ff4.approved_by, v_actor);
      END IF;

      RETURN public.njss_transition_ff4_base(p_ff4_id, p_action, p_comments, p_user_email);
    END;
    $fn$;

    GRANT EXECUTE ON FUNCTION public.njss_transition_ff4(uuid,text,text,text) TO authenticated;
  END IF;
END $$;

-- 9) Classify target system status for operations reporting.
-- Compatibility: older NJSS databases may not yet have updated_at on system_settings.
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES
  ('release_readiness_status', 'UAT READY - PRODUCTION CANDIDATE', 'Target status after hardening; not a Production Ready declaration.'),
  ('latest_database_migration', '036_uat_production_candidate_hardening', 'Latest applied NJSS migration identifier.'),
  ('backup_strategy', 'Use managed Supabase/database backups for production recovery. In-app export is portable data export only.', 'Production backup strategy summary.')
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value,
    description = EXCLUDED.description,
    updated_at = now();

COMMIT;
