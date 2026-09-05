-- =============================================================================
-- NJSS HARD-10A — UAT SUPERVISOR / ORGANISATIONAL ASSIGNMENT RECONCILIATION
--
-- Root cause: the certified NJSS-NATIONAL-UAT-2026-V1 seed temporarily moved a
-- single UAT Line Supervisor into eight target sections while creating revision
-- requests, then restored the supervisor's home section. The requests therefore
-- became organisationally invalid immediately after seed completion.
--
-- This hotfix keeps the Line Supervisor role SECTION_WIDE and keeps the user's
-- home Department/Section unchanged. It records an explicit UAT-only
-- DEPARTMENT_WIDE user_data_scopes delegation for the eight seeded revision
-- departments and teaches the canonical revision-supervisor matcher to honour
-- explicit, current user-level delegated department scope.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.njss_budget_revision_supervisor_matches(
  p_division_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_matches boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.budget_divisions bd
    JOIN public.users u
      ON u.id = p_user_id
     AND u.is_active = true
    JOIN public.user_roles ur
      ON ur.user_id = u.id
    JOIN public.roles r
      ON r.id = ur.role_id
     AND r.name = 'Line Supervisor'
     AND r.is_active = true
    LEFT JOIN public.departments d
      ON d.is_active = true
     AND d.code = bd.code
    WHERE bd.id = p_division_id
      AND (
        -- Canonical home-unit match remains unchanged.
        (bd.section_id IS NOT NULL AND u.section_id = bd.section_id)
        OR (
          bd.section_id IS NULL
          AND u.department_id = COALESCE(d.id, bd.department_id)
        )
        -- Explicit user-level delegated department scope is eligible only while
        -- the delegation is current. Role-wide scope does not satisfy this arm.
        OR EXISTS (
          SELECT 1
          FROM public.user_data_scopes uds
          WHERE uds.user_id = u.id
            AND uds.scope_type = 'DEPARTMENT_WIDE'
            AND (uds.valid_from IS NULL OR uds.valid_from <= now())
            AND (uds.valid_until IS NULL OR uds.valid_until >= now())
            AND bd.department_id IS NOT NULL
            AND bd.department_id = ANY(COALESCE(uds.department_ids, '{}'::uuid[]))
        )
      )
  ) INTO v_matches;

  RETURN COALESCE(v_matches, false);
END;
$function$;

DO $hard10a_reconcile$
DECLARE
  v_run_id constant text := 'UAT-2026-V1-20260829';
  v_dataset constant text := 'NJSS-NATIONAL-UAT-2026-V1';
  v_supervisor_id constant uuid := 'a7a7aeb9-082d-4ed0-a4a7-07ba92f24f00'::uuid;
  v_scope_id uuid;
  v_target_departments uuid[];
  v_target_count integer;
  v_existing_is_uat boolean := false;
  v_home_department uuid;
  v_home_section uuid;
  v_expected_home_department uuid;
  v_expected_home_section uuid;
  v_bad_count integer;
BEGIN
  -- Bind the correction to the completed certified UAT dataset only.
  IF NOT EXISTS (
    SELECT 1
    FROM public.uat_seed_runs usr
    WHERE usr.run_id = v_run_id
      AND lower(usr.dataset_version) = lower(v_dataset)
      AND lower(usr.dataset_version) = 'njss-national-uat-2026-v1'
      AND usr.status = 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'HARD-10A requires completed UAT dataset % / %', v_run_id, v_dataset;
  END IF;

  SELECT d.id, s.id
  INTO v_expected_home_department, v_expected_home_section
  FROM public.departments d
  JOIN public.sections s ON s.department_id = d.id
  WHERE d.code = 'NCD-WGN-HR'
    AND s.code = 'NCD-WGN-HR-HRA';

  SELECT u.department_id, u.section_id
  INTO v_home_department, v_home_section
  FROM public.users u
  WHERE u.id = v_supervisor_id
    AND u.is_active = true;

  IF v_home_department IS DISTINCT FROM v_expected_home_department
     OR v_home_section IS DISTINCT FROM v_expected_home_section THEN
    RAISE EXCEPTION 'HARD-10A refused: UAT Line Supervisor home assignment is not the expected Waigani HR section';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_supervisor_id
      AND r.name = 'Line Supervisor'
      AND r.data_scope_type = 'SECTION_WIDE'
      AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'HARD-10A refused: UAT actor must remain an active SECTION_WIDE Line Supervisor';
  END IF;

  -- Derive exactly the eight affected Departments from registered UAT revision
  -- provenance; do not hard-code or manufacture business organisational units.
  SELECT array_agg(DISTINCT bd.department_id ORDER BY bd.department_id),
         count(DISTINCT bd.department_id)
  INTO v_target_departments, v_target_count
  FROM public.uat_seed_entities useed
  JOIN public.budget_revisions br
    ON useed.entity_id = br.id::text
  JOIN public.budget_divisions bd
    ON bd.id = br.division_id
  WHERE useed.run_id = v_run_id
    AND useed.table_name = 'budget_revisions'
    AND useed.provenance = 'UAT'
    AND br.supporting_reference = v_dataset
    AND br.status = 'DRAFT'
    AND br.assigned_line_supervisor_id = v_supervisor_id;

  IF v_target_count <> 8 OR COALESCE(cardinality(v_target_departments), 0) <> 8 THEN
    RAISE EXCEPTION 'HARD-10A expected exactly 8 registered UAT revision Departments, found %', v_target_count;
  END IF;

  SELECT uds.id,
         EXISTS (
           SELECT 1
           FROM public.uat_seed_entities useed
           WHERE useed.run_id = v_run_id
             AND useed.table_name = 'user_data_scopes'
             AND useed.entity_id = uds.id::text
             AND useed.provenance = 'UAT'
         )
  INTO v_scope_id, v_existing_is_uat
  FROM public.user_data_scopes uds
  WHERE uds.user_id = v_supervisor_id
    AND uds.scope_type = 'DEPARTMENT_WIDE';

  IF v_scope_id IS NOT NULL AND NOT v_existing_is_uat THEN
    RAISE EXCEPTION 'HARD-10A refused to overwrite an existing non-UAT DEPARTMENT_WIDE user delegation';
  END IF;

  IF v_scope_id IS NULL THEN
    INSERT INTO public.user_data_scopes (
      user_id,
      scope_type,
      department_ids,
      division_ids,
      branch_ids,
      province_ids,
      valid_from,
      valid_until,
      assigned_by
    )
    VALUES (
      v_supervisor_id,
      'DEPARTMENT_WIDE',
      v_target_departments,
      '{}'::uuid[],
      '{}'::uuid[],
      '{}'::uuid[],
      now(),
      NULL,
      NULL
    )
    RETURNING id INTO v_scope_id;
  ELSE
    UPDATE public.user_data_scopes uds
    SET department_ids = v_target_departments,
        division_ids = '{}'::uuid[],
        branch_ids = '{}'::uuid[],
        province_ids = '{}'::uuid[],
        valid_until = NULL
    WHERE uds.id = v_scope_id;
  END IF;

  INSERT INTO public.uat_seed_entities (
    run_id,
    table_name,
    entity_id,
    business_code,
    provenance,
    source_reference
  )
  VALUES (
    v_run_id,
    'user_data_scopes',
    v_scope_id::text,
    'HARD10A-UAT-LINE-SUPERVISOR-DELEGATION',
    'UAT',
    'NJSS-HARD-10A explicit delegated Department scope; Alex Supervisor home section remains NCD-WGN-HR-HRA'
  )
  ON CONFLICT (run_id, table_name, entity_id) DO UPDATE
  SET business_code = EXCLUDED.business_code,
      provenance = EXCLUDED.provenance,
      source_reference = EXCLUDED.source_reference;

  -- Home assignment is an invariant: this migration never relocates the user.
  SELECT u.department_id, u.section_id
  INTO v_home_department, v_home_section
  FROM public.users u
  WHERE u.id = v_supervisor_id;

  IF v_home_department IS DISTINCT FROM v_expected_home_department
     OR v_home_section IS DISTINCT FROM v_expected_home_section THEN
    RAISE EXCEPTION 'HARD-10A failed: UAT Line Supervisor home assignment changed';
  END IF;

  -- Every registered UAT revision must now have a durable eligible supervisor.
  SELECT count(*)
  INTO v_bad_count
  FROM public.uat_seed_entities useed
  JOIN public.budget_revisions br
    ON useed.entity_id = br.id::text
  WHERE useed.run_id = v_run_id
    AND useed.table_name = 'budget_revisions'
    AND useed.provenance = 'UAT'
    AND br.supporting_reference = v_dataset
    AND br.assigned_line_supervisor_id IS NOT NULL
    AND NOT public.njss_budget_revision_supervisor_matches(
      br.division_id,
      br.assigned_line_supervisor_id
    );

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'HARD-10A failed: % registered UAT revision assignments remain invalid', v_bad_count;
  END IF;
END;
$hard10a_reconcile$;
