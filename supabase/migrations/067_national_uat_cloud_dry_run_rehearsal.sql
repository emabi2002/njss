-- Task 13 cloud-only rollback rehearsal for NJSS National UAT rebuild.
--
-- This migration deliberately performs the approved rebuild purge inside a
-- PL/pgSQL exception subtransaction, validates the zero-row/reset invariants,
-- raises an intentional private SQLSTATE, and catches it so every business-data
-- mutation is rolled back before the migration completes.
--
-- The only persistent data change is the uat_seed_runs evidence row recording
-- PREFLIGHT, BACKUP and DRY_RUN_RESET completion. No rebuildable business data
-- is committed by this migration.

DO $njss$
DECLARE
  v_dataset_version constant text := 'NJSS-NATIONAL-UAT-2026-V1';
  v_run_id constant text := 'UAT-2026-V1-20260829';

  v_protected_tables text[] := ARRAY[
    'users','roles','user_roles','permissions','role_permissions','modules','menu_items',
    'workflow_statuses','report_categories','report_definitions','system_settings',
    'system_alert_settings','system_backup_registry','system_backup_change_log','audit_logs',
    'rbac_data_scope_types','role_data_scopes','user_data_scopes','user_permissions'
  ];

  v_rebuildable_tables text[] := ARRAY[
    'budget_activation_line_snapshots','budget_activation_lines','budget_activation_batches',
    'budget_release_funding_lines','budget_revision_lines','budget_revisions','budget_workflow_history',
    'budget_line_attachments','budget_monthly_allocations','budget_import_staging','budget_import_batches',
    'budget_consolidations','commitment_transactions','payment_transactions','ff4_approvals','ff4_attachments',
    'ff4_headers','ff3_approvals','ff3_attachments','ff3_items','ff3_quotations','ff3_commitments','ff3_headers',
    'quarterly_releases','funding_allocations','funding_receipts','funding_authorities','budget_allocations',
    'budget_division_ceilings','budget_periods','divisional_budget_lines','divisional_budget_submissions',
    'annual_plan_lines','annual_plan_headers','supplier_category_assignments','supplier_contacts','supplier_documents',
    'supplier_followups','supplier_status_history','supplier_legacy_candidates','suppliers',
    'supplier_document_requirements','supplier_categories','documents','notifications','finance_posting_mappings',
    'expense_code_registry','expense_ledger','category_expense_item_mappings','expense_items','expense_categories',
    'chart_of_accounts','budget_reference_values','budget_activity_templates','activity_templates',
    'budget_expense_categories','budget_classes','budget_cycles','budget_divisions','cost_centres','sections',
    'departments','court_locations','projects','funding_sources','financial_years','payee_types','payment_methods',
    'priority_levels','procurement_methods','units_of_measure','urgency_levels','provinces'
  ];

  -- Generated from the live pg_constraint graph using the same child-before-parent
  -- Kahn ordering as scripts/national-uat/reset.ts, with the approved nullable
  -- cycle detachments excluded from the graph.
  v_purge_order text[] := ARRAY[
    'activity_templates','budget_activation_line_snapshots','budget_activation_lines',
    'budget_activation_batches','budget_activity_templates','budget_consolidations',
    'budget_division_ceilings','budget_import_staging','budget_import_batches','budget_line_attachments',
    'budget_monthly_allocations','budget_periods','budget_reference_values','budget_release_funding_lines',
    'budget_revision_lines','budget_revisions','budget_workflow_history','category_expense_item_mappings',
    'commitment_transactions','documents','ff3_approvals','ff3_attachments','ff3_items','ff3_quotations',
    'ff4_approvals','ff4_attachments','finance_posting_mappings','financial_years','notifications',
    'payment_transactions','ff4_headers','ff3_commitments','ff3_headers','payee_types','payment_methods',
    'quarterly_releases','funding_allocations','budget_allocations','annual_plan_lines','annual_plan_headers',
    'divisional_budget_lines','divisional_budget_submissions','budget_cycles','budget_divisions','expense_ledger',
    'budget_classes','budget_expense_categories','funding_receipts','funding_authorities','expense_code_registry',
    'chart_of_accounts','cost_centres','expense_items','expense_categories','funding_sources','priority_levels',
    'procurement_methods','projects','sections','departments','court_locations','supplier_category_assignments',
    'supplier_contacts','supplier_document_requirements','supplier_categories','supplier_documents',
    'supplier_followups','supplier_legacy_candidates','supplier_status_history','suppliers','provinces',
    'units_of_measure','urgency_levels'
  ];

  v_backup_id text;
  v_backup_created_at timestamptz;
  v_backup_file_name text;
  v_backup_file_size bigint;
  v_backup_sha256 text;
  v_backup_table_count integer;
  v_backup_record_count bigint;

  v_snapshot jsonb;
  v_snapshot_table_count integer;
  v_snapshot_total_records bigint;

  v_total bigint;
  v_active bigint;
  v_archived bigint;
  v_count bigint;
  v_digest text;
  v_row_expr text;
  v_table text;
  v_before_count bigint;
  v_after_count bigint;
  v_before_digest text;
  v_after_digest text;

  v_protected_before jsonb := '{}'::jsonb;
  v_protected_after jsonb := '{}'::jsonb;
  v_pre_counts jsonb := '{}'::jsonb;
  v_post_counts jsonb := '{}'::jsonb;
  v_notes jsonb;
BEGIN
  -- Fresh, completed, materially populated full-backup gate.
  SELECT backup_id, created_at, file_name, file_size_bytes, sha256, table_count, record_count
  INTO v_backup_id, v_backup_created_at, v_backup_file_name, v_backup_file_size,
       v_backup_sha256, v_backup_table_count, v_backup_record_count
  FROM public.system_backup_registry
  WHERE backup_type = 'FULL'
    AND status = 'COMPLETED'
    AND created_at >= now() - interval '120 minutes'
    AND file_name IS NOT NULL
    AND coalesce(file_size_bytes, 0) > 0
    AND sha256 IS NOT NULL
    AND coalesce(table_count, 0) > 0
    AND coalesce(record_count, 0) > 0
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_backup_id IS NULL THEN
    RAISE EXCEPTION 'No verified completed FULL backup exists within the last 120 minutes';
  END IF;

  -- Independent logical snapshot probe. This runs under the privileged migration
  -- role because the ordinary Supabase connector is intentionally read-only.
  SELECT public.njss_backup_full_snapshot() INTO v_snapshot;
  v_snapshot_table_count := coalesce((v_snapshot ->> 'tableCount')::integer, 0);
  v_snapshot_total_records := coalesce((v_snapshot ->> 'totalRecords')::bigint, 0);
  IF v_snapshot_table_count <= 0 OR v_snapshot_total_records <= 0 THEN
    RAISE EXCEPTION 'njss_backup_full_snapshot returned an invalid empty snapshot';
  END IF;

  SELECT count(*)::bigint,
         count(*) FILTER (WHERE is_active IS TRUE AND archived_at IS NULL)::bigint,
         count(*) FILTER (WHERE archived_at IS NOT NULL)::bigint
  INTO v_total, v_active, v_archived
  FROM public.users;

  IF v_total <> 10 OR v_active <> 7 OR v_archived <> 3 THEN
    RAISE EXCEPTION 'Retained-user preflight failed: expected 10 total / 7 active / 3 archived; got % / % / %',
      v_total, v_active, v_archived;
  END IF;

  -- Capture protected manifest. For users, intentionally ignore department_id and
  -- section_id so temporary organisational detachment does not invalidate identity/security.
  FOREACH v_table IN ARRAY v_protected_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'Protected table public.% is missing', v_table;
    END IF;

    IF v_table = 'users' THEN
      v_row_expr := $expr$jsonb_build_object(
        'id', id,
        'auth_user_id', auth_user_id,
        'employee_id', employee_id,
        'full_name', full_name,
        'email', email,
        'phone', phone,
        'position', position,
        'is_active', is_active,
        'must_change_password', must_change_password,
        'password_set_at', password_set_at,
        'password_changed_at', password_changed_at,
        'last_login_at', last_login_at,
        'invited_at', invited_at,
        'is_protected', is_protected,
        'archived_at', archived_at,
        'archived_by', archived_by,
        'archive_reason', archive_reason,
        'created_at', created_at
      )::text$expr$;
    ELSE
      v_row_expr := 'to_jsonb(t)::text';
    END IF;

    EXECUTE format(
      'select count(*)::bigint, coalesce(md5(string_agg(row_text, '''' order by row_text)), md5('''')) from (select %s as row_text from public.%I t) s',
      v_row_expr, v_table
    ) INTO v_count, v_digest;

    v_protected_before := v_protected_before || jsonb_build_object(
      v_table, jsonb_build_object('count', v_count, 'digest', v_digest)
    );
  END LOOP;

  FOREACH v_table IN ARRAY v_rebuildable_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'Required rebuildable table public.% is missing', v_table;
    END IF;
    EXECUTE format('select count(*)::bigint from public.%I', v_table) INTO v_count;
    v_pre_counts := v_pre_counts || jsonb_build_object(v_table, v_count);
  END LOOP;

  -- The inner block is a PL/pgSQL subtransaction. The intentional PDR01 error at
  -- the end rolls back every UPDATE/DELETE in this block, while retaining local
  -- validation variables for evidence persistence after the rollback.
  BEGIN
    UPDATE public.users
    SET department_id = NULL, section_id = NULL
    WHERE department_id IS NOT NULL OR section_id IS NOT NULL;

    UPDATE public.expense_ledger
    SET expense_code_registry_id = NULL
    WHERE expense_code_registry_id IS NOT NULL;

    UPDATE public.expense_code_registry
    SET expense_ledger_id = NULL
    WHERE expense_ledger_id IS NOT NULL;

    UPDATE public.ff3_headers
    SET selected_quotation_id = NULL
    WHERE selected_quotation_id IS NOT NULL;

    FOREACH v_table IN ARRAY v_purge_order LOOP
      IF NOT (v_table = ANY(v_rebuildable_tables)) THEN
        RAISE EXCEPTION 'Refusing delete outside rebuild allowlist: public.%', v_table;
      END IF;
      EXECUTE format('delete from public.%I', v_table);
    END LOOP;

    FOREACH v_table IN ARRAY v_rebuildable_tables LOOP
      EXECUTE format('select count(*)::bigint from public.%I', v_table) INTO v_count;
      v_post_counts := v_post_counts || jsonb_build_object(v_table, v_count);
      IF v_count <> 0 THEN
        RAISE EXCEPTION 'Reset left rebuildable rows behind: public.%=%', v_table, v_count;
      END IF;
    END LOOP;

    SELECT count(*)::bigint,
           count(*) FILTER (WHERE is_active IS TRUE AND archived_at IS NULL)::bigint,
           count(*) FILTER (WHERE archived_at IS NOT NULL)::bigint
    INTO v_total, v_active, v_archived
    FROM public.users;

    IF v_total <> 10 OR v_active <> 7 OR v_archived <> 3 THEN
      RAISE EXCEPTION 'Retained-user reset validation failed: expected 10 / 7 / 3; got % / % / %',
        v_total, v_active, v_archived;
    END IF;

    v_protected_after := '{}'::jsonb;
    FOREACH v_table IN ARRAY v_protected_tables LOOP
      IF v_table = 'users' THEN
        v_row_expr := $expr$jsonb_build_object(
          'id', id,
          'auth_user_id', auth_user_id,
          'employee_id', employee_id,
          'full_name', full_name,
          'email', email,
          'phone', phone,
          'position', position,
          'is_active', is_active,
          'must_change_password', must_change_password,
          'password_set_at', password_set_at,
          'password_changed_at', password_changed_at,
          'last_login_at', last_login_at,
          'invited_at', invited_at,
          'is_protected', is_protected,
          'archived_at', archived_at,
          'archived_by', archived_by,
          'archive_reason', archive_reason,
          'created_at', created_at
        )::text$expr$;
      ELSE
        v_row_expr := 'to_jsonb(t)::text';
      END IF;

      EXECUTE format(
        'select count(*)::bigint, coalesce(md5(string_agg(row_text, '''' order by row_text)), md5('''')) from (select %s as row_text from public.%I t) s',
        v_row_expr, v_table
      ) INTO v_count, v_digest;

      v_protected_after := v_protected_after || jsonb_build_object(
        v_table, jsonb_build_object('count', v_count, 'digest', v_digest)
      );

      v_before_count := (v_protected_before -> v_table ->> 'count')::bigint;
      v_after_count := (v_protected_after -> v_table ->> 'count')::bigint;
      v_before_digest := v_protected_before -> v_table ->> 'digest';
      v_after_digest := v_protected_after -> v_table ->> 'digest';

      IF v_table = ANY(ARRAY['system_backup_registry','system_backup_change_log']::text[]) THEN
        NULL;
      ELSIF v_table = 'audit_logs' THEN
        IF v_after_count < v_before_count THEN
          RAISE EXCEPTION 'Append-only protected table public.audit_logs lost historic rows during reset dry-run';
        END IF;
      ELSIF v_before_count <> v_after_count OR v_before_digest IS DISTINCT FROM v_after_digest THEN
        RAISE EXCEPTION 'Protected table public.% changed during reset dry-run', v_table;
      END IF;
    END LOOP;

    RAISE EXCEPTION USING ERRCODE = 'PDR01', MESSAGE = 'NJSS_UAT_DRY_RUN_ROLLBACK';
  EXCEPTION
    WHEN SQLSTATE 'PDR01' THEN
      NULL;
  END;

  -- Prove the intentional subtransaction rollback restored the live business rows.
  FOREACH v_table IN ARRAY v_rebuildable_tables LOOP
    EXECUTE format('select count(*)::bigint from public.%I', v_table) INTO v_count;
    IF v_count <> coalesce((v_pre_counts ->> v_table)::bigint, -1) THEN
      RAISE EXCEPTION 'Rollback verification failed for public.%: expected %, got %',
        v_table, v_pre_counts ->> v_table, v_count;
    END IF;
  END LOOP;

  SELECT count(*)::bigint,
         count(*) FILTER (WHERE is_active IS TRUE AND archived_at IS NULL)::bigint,
         count(*) FILTER (WHERE archived_at IS NOT NULL)::bigint
  INTO v_total, v_active, v_archived
  FROM public.users;

  IF v_total <> 10 OR v_active <> 7 OR v_archived <> 3 THEN
    RAISE EXCEPTION 'Post-rollback retained-user verification failed: expected 10 / 7 / 3; got % / % / %',
      v_total, v_active, v_archived;
  END IF;

  v_notes := jsonb_build_object(
    'datasetVersion', v_dataset_version,
    'runId', v_run_id,
    'executionMode', 'SUPABASE_CLOUD_PRIVILEGED_MIGRATION',
    'snapshotProbe', jsonb_build_object(
      'tableCount', v_snapshot_table_count,
      'totalRecords', v_snapshot_total_records
    ),
    'phaseHistory', jsonb_build_array(
      jsonb_build_object('phase','PREFLIGHT','outcome','STARTED','at',now()),
      jsonb_build_object('phase','PREFLIGHT','outcome','COMPLETED','at',now(),
        'message',format('Validated 73-table rebuild allowlist and retained 10/7/3 user baseline.')),
      jsonb_build_object('phase','BACKUP','outcome','STARTED','at',now()),
      jsonb_build_object('phase','BACKUP','outcome','COMPLETED','at',now(),
        'message',format('Verified FULL backup %s (%s tables / %s records).',v_backup_id,v_backup_table_count,v_backup_record_count)),
      jsonb_build_object('phase','DRY_RUN_RESET','outcome','STARTED','at',now()),
      jsonb_build_object('phase','DRY_RUN_RESET','outcome','COMPLETED','at',now(),
        'message','Rollback-only purge validated all 73 rebuildable tables; all business-data mutations rolled back.')
    )
  );

  INSERT INTO public.uat_seed_runs (
    dataset_version, run_id, status, backup_id, protected_manifest,
    pre_reset_counts, post_reset_counts, validation_results, notes, updated_at
  ) VALUES (
    v_dataset_version, v_run_id, 'PREFLIGHT_PASSED', v_backup_id, v_protected_before,
    v_pre_counts, v_post_counts, '{}'::jsonb, v_notes::text, now()
  )
  ON CONFLICT (run_id) DO UPDATE
  SET dataset_version = excluded.dataset_version,
      status = 'PREFLIGHT_PASSED',
      backup_id = excluded.backup_id,
      protected_manifest = excluded.protected_manifest,
      pre_reset_counts = excluded.pre_reset_counts,
      post_reset_counts = excluded.post_reset_counts,
      notes = excluded.notes,
      updated_at = now();
END
$njss$;
