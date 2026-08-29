-- 066_national_uat_location_seed_registry.sql
-- Additive schema foundation for the NJSS national UAT dataset.
-- This migration does not delete, reset, or seed existing business data.

CREATE TABLE IF NOT EXISTS public.court_locations (
  id uuid PRIMARY KEY,
  province_id uuid NOT NULL REFERENCES public.provinces(id) ON DELETE RESTRICT,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  location_type varchar(40) NOT NULL CHECK (
    location_type IN ('HEADQUARTERS', 'NATIONAL_COURT_REGISTRY', 'NATIONAL_COURT_SUB_REGISTRY')
  ),
  town varchar(120),
  is_headquarters boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT court_locations_headquarters_consistency CHECK (
    is_headquarters = (location_type = 'HEADQUARTERS')
  )
);

CREATE INDEX IF NOT EXISTS idx_court_locations_province
  ON public.court_locations (province_id, is_active, code);

CREATE UNIQUE INDEX IF NOT EXISTS ux_court_locations_single_headquarters
  ON public.court_locations (is_headquarters)
  WHERE is_headquarters = true;

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS court_location_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'departments_court_location_id_fkey'
      AND conrelid = 'public.departments'::regclass
  ) THEN
    ALTER TABLE public.departments
      ADD CONSTRAINT departments_court_location_id_fkey
      FOREIGN KEY (court_location_id)
      REFERENCES public.court_locations(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_departments_court_location
  ON public.departments (court_location_id, is_active, code);

CREATE TABLE IF NOT EXISTS public.uat_seed_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version text NOT NULL,
  run_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (
    status IN (
      'PLANNED',
      'PREFLIGHT_PASSED',
      'RESET_IN_PROGRESS',
      'RESET_COMPLETED',
      'SEEDING',
      'VALIDATING',
      'COMPLETED',
      'FAILED',
      'ROLLED_BACK'
    )
  ),
  backup_id text,
  protected_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  pre_reset_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  post_reset_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_email text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uat_seed_runs_dataset_status
  ON public.uat_seed_runs (dataset_version, status, started_at DESC);

CREATE TABLE IF NOT EXISTS public.uat_seed_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL REFERENCES public.uat_seed_runs(run_id) ON DELETE CASCADE,
  table_name text NOT NULL,
  entity_id text NOT NULL,
  business_code text,
  provenance text NOT NULL CHECK (provenance IN ('OFFICIAL', 'DERIVED', 'UAT')),
  source_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, table_name, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_uat_seed_entities_lookup
  ON public.uat_seed_entities (table_name, entity_id, run_id);

ALTER TABLE public.court_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uat_seed_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uat_seed_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS court_locations_select ON public.court_locations;
CREATE POLICY court_locations_select ON public.court_locations
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS court_locations_manage ON public.court_locations;
CREATE POLICY court_locations_manage ON public.court_locations
  FOR ALL TO authenticated
  USING (
    public.fn_current_user_has_permission('masterdata.manage')
    OR public.fn_current_user_has_permission('registry.manage')
    OR public.fn_current_user_has_permission('all')
  )
  WITH CHECK (
    public.fn_current_user_has_permission('masterdata.manage')
    OR public.fn_current_user_has_permission('registry.manage')
    OR public.fn_current_user_has_permission('all')
  );

REVOKE ALL ON public.court_locations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.court_locations TO authenticated;
GRANT ALL ON public.court_locations TO service_role;

REVOKE ALL ON public.uat_seed_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.uat_seed_entities FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.uat_seed_runs TO service_role;
GRANT ALL ON public.uat_seed_entities TO service_role;

-- Include the new tables in the existing logical backup change-capture framework.
DO $$
BEGIN
  IF to_regprocedure('public.njss_backup_refresh_change_triggers()') IS NOT NULL THEN
    PERFORM public.njss_backup_refresh_change_triggers();
  END IF;
END
$$;

-- Keep the operational migration marker current when the settings table is present.
DO $$
BEGIN
  IF to_regclass('public.system_settings') IS NOT NULL THEN
    INSERT INTO public.system_settings (setting_key, setting_value, description)
    VALUES (
      'latest_database_migration',
      to_jsonb('066_national_uat_location_seed_registry'::text),
      'Latest applied NJSS migration identifier.'
    )
    ON CONFLICT (setting_key) DO UPDATE
    SET setting_value = EXCLUDED.setting_value,
        description = EXCLUDED.description,
        updated_at = now();
  END IF;
END
$$;
