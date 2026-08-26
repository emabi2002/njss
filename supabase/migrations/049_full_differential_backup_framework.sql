-- 049_full_differential_backup_framework.sql
-- Logical Full + Differential backup framework for NJSS application data.
-- Additive only: no financial/business tables are modified or deleted.

CREATE TABLE IF NOT EXISTS public.system_backup_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_id text NOT NULL UNIQUE,
  backup_type text NOT NULL CHECK (backup_type IN ('FULL', 'DIFFERENTIAL')),
  baseline_backup_id text NULL,
  baseline_change_id bigint NOT NULL DEFAULT 0,
  through_change_id bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  created_by_user_id uuid NULL,
  created_by_email text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  file_name text NULL,
  file_size_bytes bigint NULL,
  sha256 text NULL,
  table_count integer NULL,
  record_count bigint NULL,
  change_count bigint NULL,
  manifest jsonb NULL,
  error_message text NULL
);

CREATE INDEX IF NOT EXISTS idx_system_backup_registry_latest_full
  ON public.system_backup_registry (created_at DESC)
  WHERE backup_type = 'FULL' AND status = 'COMPLETED';

CREATE INDEX IF NOT EXISTS idx_system_backup_registry_baseline
  ON public.system_backup_registry (baseline_backup_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.system_backup_change_log (
  change_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  old_row jsonb NULL,
  new_row jsonb NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_id bigint NOT NULL DEFAULT txid_current()
);

CREATE INDEX IF NOT EXISTS idx_system_backup_change_log_table_change
  ON public.system_backup_change_log (table_name, change_id);
CREATE INDEX IF NOT EXISTS idx_system_backup_change_log_changed_at
  ON public.system_backup_change_log (changed_at);

ALTER TABLE public.system_backup_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_backup_change_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.system_backup_registry FROM anon, authenticated;
REVOKE ALL ON public.system_backup_change_log FROM anon, authenticated;
GRANT ALL ON public.system_backup_registry TO service_role;
GRANT ALL ON public.system_backup_change_log TO service_role;

CREATE OR REPLACE FUNCTION public.njss_capture_backup_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.system_backup_change_log (
    table_name,
    operation,
    old_row,
    new_row,
    changed_at,
    transaction_id
  )
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    clock_timestamp(),
    txid_current()
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.njss_capture_backup_change() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.njss_backup_refresh_change_triggers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND c.relname NOT IN ('system_backup_registry', 'system_backup_change_log')
    ORDER BY c.relname
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class tc ON tc.oid = t.tgrelid
      JOIN pg_namespace tn ON tn.oid = tc.relnamespace
      WHERE tn.nspname = 'public'
        AND tc.relname = r.table_name
        AND t.tgname = 'njss_backup_change_capture'
        AND NOT t.tgisinternal
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER njss_backup_change_capture AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.njss_capture_backup_change()',
        r.table_name
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.njss_backup_refresh_change_triggers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.njss_backup_refresh_change_triggers() TO service_role;

-- Attach change capture to all current NJSS application tables.
SELECT public.njss_backup_refresh_change_triggers();

CREATE OR REPLACE FUNCTION public.njss_backup_full_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_rows jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_count bigint;
  v_total bigint := 0;
  v_table_count integer := 0;
  v_baseline_change_id bigint := 0;
BEGIN
  SELECT COALESCE(MAX(change_id), 0)
    INTO v_baseline_change_id
  FROM public.system_backup_change_log;

  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND c.relname NOT IN ('system_backup_registry', 'system_backup_change_log')
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM public.%I AS t',
      r.table_name
    ) INTO v_rows;

    v_count := jsonb_array_length(v_rows);
    v_tables := v_tables || jsonb_build_object(r.table_name, v_rows);
    v_counts := v_counts || jsonb_build_object(r.table_name, v_count);
    v_total := v_total + v_count;
    v_table_count := v_table_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'capturedAt', statement_timestamp(),
    'baselineChangeId', v_baseline_change_id,
    'tableCount', v_table_count,
    'totalRecords', v_total,
    'recordCounts', v_counts,
    'tables', v_tables
  );
END;
$$;

REVOKE ALL ON FUNCTION public.njss_backup_full_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.njss_backup_full_snapshot() TO service_role;

CREATE OR REPLACE FUNCTION public.njss_backup_differential_snapshot(p_baseline_change_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_through_change_id bigint := 0;
  v_changes jsonb := '[]'::jsonb;
  v_change_count bigint := 0;
  v_tables text[] := ARRAY[]::text[];
BEGIN
  IF p_baseline_change_id IS NULL OR p_baseline_change_id < 0 THEN
    RAISE EXCEPTION 'Invalid baseline change id';
  END IF;

  SELECT COALESCE(MAX(change_id), p_baseline_change_id)
    INTO v_through_change_id
  FROM public.system_backup_change_log;

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'changeId', change_id,
          'tableName', table_name,
          'operation', operation,
          'oldRow', old_row,
          'newRow', new_row,
          'changedAt', changed_at,
          'transactionId', transaction_id
        ) ORDER BY change_id
      ),
      '[]'::jsonb
    ),
    COUNT(*),
    COALESCE(array_agg(DISTINCT table_name ORDER BY table_name), ARRAY[]::text[])
  INTO v_changes, v_change_count, v_tables
  FROM public.system_backup_change_log
  WHERE change_id > p_baseline_change_id
    AND change_id <= v_through_change_id;

  RETURN jsonb_build_object(
    'capturedAt', statement_timestamp(),
    'baselineChangeId', p_baseline_change_id,
    'throughChangeId', v_through_change_id,
    'changeCount', v_change_count,
    'tablesAffected', to_jsonb(v_tables),
    'changes', v_changes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.njss_backup_differential_snapshot(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.njss_backup_differential_snapshot(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.njss_backup_schema_snapshot()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'capturedAt', statement_timestamp(),
    'tables', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', c.relname,
          'rlsEnabled', c.relrowsecurity,
          'columns', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'name', a.attname,
                'type', format_type(a.atttypid, a.atttypmod),
                'notNull', a.attnotnull,
                'identity', a.attidentity,
                'generated', a.attgenerated,
                'default', pg_get_expr(ad.adbin, ad.adrelid)
              ) ORDER BY a.attnum
            )
            FROM pg_attribute a
            LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
            WHERE a.attrelid = c.oid
              AND a.attnum > 0
              AND NOT a.attisdropped
          ), '[]'::jsonb),
          'constraints', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'name', con.conname,
                'type', con.contype,
                'definition', pg_get_constraintdef(con.oid, true)
              ) ORDER BY con.conname
            )
            FROM pg_constraint con
            WHERE con.conrelid = c.oid
          ), '[]'::jsonb),
          'indexes', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'name', ic.relname,
                'definition', pg_get_indexdef(i.indexrelid)
              ) ORDER BY ic.relname
            )
            FROM pg_index i
            JOIN pg_class ic ON ic.oid = i.indexrelid
            WHERE i.indrelid = c.oid
          ), '[]'::jsonb),
          'policies', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'name', p.policyname,
                'permissive', p.permissive,
                'roles', to_jsonb(p.roles),
                'command', p.cmd,
                'using', p.qual,
                'check', p.with_check
              ) ORDER BY p.policyname
            )
            FROM pg_policies p
            WHERE p.schemaname = 'public' AND p.tablename = c.relname
          ), '[]'::jsonb),
          'triggers', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'name', t.tgname,
                'definition', pg_get_triggerdef(t.oid, true)
              ) ORDER BY t.tgname
            )
            FROM pg_trigger t
            WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
          ), '[]'::jsonb)
        ) ORDER BY c.relname
      )
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT c.relispartition
        AND c.relname NOT IN ('system_backup_registry', 'system_backup_change_log')
    ), '[]'::jsonb),
    'views', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('name', viewname, 'definition', definition)
        ORDER BY viewname
      )
      FROM pg_views
      WHERE schemaname = 'public'
    ), '[]'::jsonb),
    'routines', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', p.proname,
          'identityArguments', pg_get_function_identity_arguments(p.oid),
          'kind', p.prokind,
          'definition', pg_get_functiondef(p.oid)
        ) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
      )
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prokind IN ('f', 'p')
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.njss_backup_schema_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.njss_backup_schema_snapshot() TO service_role;

COMMENT ON TABLE public.system_backup_registry IS 'NJSS Full and Differential logical database backup history and baseline registry.';
COMMENT ON TABLE public.system_backup_change_log IS 'Row-level NJSS change journal used to build Differential backups from the latest Full backup baseline.';
COMMENT ON FUNCTION public.njss_backup_full_snapshot() IS 'Returns a consistent logical snapshot of all NJSS public application tables and the matching change-log baseline cursor.';
COMMENT ON FUNCTION public.njss_backup_differential_snapshot(bigint) IS 'Returns all tracked NJSS row changes after a Full backup baseline cursor.';
