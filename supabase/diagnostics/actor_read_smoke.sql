-- Read-only integration smoke check of nine core public tables for one active
-- actor in each NJSS group. Returns counts and relation/error codes, never rows
-- or actor identifiers. This is NOT proof of correct row-level authorization.
-- Reporting/aggregate views need separate bounded checks: a full relation sweep
-- reached the 30-second safety limit at v_funding_source_financial_position.
BEGIN READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $smoke$
DECLARE
  v_actor record;
  v_relation text;
  v_relations text[];
  v_visible boolean;
  v_nonempty integer;
  v_empty integer;
  v_errors jsonb;
  v_results jsonb := '[]'::jsonb;
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname) INTO v_relations
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND c.relname = ANY (ARRAY['users', 'roles', 'user_roles', 'budget_cycles',
      'budget_divisions', 'divisional_budget_submissions', 'divisional_budget_lines',
      'funding_sources', 'expense_ledger']);
  IF cardinality(v_relations) <> 9 THEN
    RAISE EXCEPTION 'Core read smoke test requires all nine expected tables';
  END IF;

  FOR v_actor IN
    SELECT DISTINCT ON (r.name) r.name, u.auth_user_id, u.email
    FROM public.users u
    JOIN public.user_roles ur ON ur.user_id = u.id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE u.is_active AND r.is_active AND u.auth_user_id IS NOT NULL
      AND r.name IN ('Requisition Officer', 'Line Supervisor', 'Registrar',
        'Payment/Reconciliation Officer', 'System Administrator')
    ORDER BY r.name, u.id
  LOOP
    v_nonempty := 0;
    v_empty := 0;
    v_errors := '[]'::jsonb;
    PERFORM set_config('request.jwt.claim.sub', v_actor.auth_user_id::text, true);
    PERFORM set_config('request.jwt.claim.email', v_actor.email, true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_actor.auth_user_id, 'email', v_actor.email, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    FOREACH v_relation IN ARRAY v_relations LOOP
      BEGIN
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', v_relation) INTO v_visible;
        IF v_visible THEN v_nonempty := v_nonempty + 1;
        ELSE v_empty := v_empty + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'relation', v_relation, 'sqlstate', SQLSTATE));
      END;
    END LOOP;
    EXECUTE 'RESET ROLE';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'group', v_actor.name, 'visible_nonempty', v_nonempty,
      'empty_or_filtered', v_empty, 'errors', v_errors));
  END LOOP;
  IF jsonb_array_length(v_results) <> 5 THEN
    RAISE EXCEPTION 'Read smoke test requires all four business groups and System Administrator';
  END IF;
  PERFORM set_config('njss.test_read_results', v_results::text, true);
END
$smoke$;
SELECT current_setting('njss.test_read_results')::jsonb AS actor_read_smoke;
ROLLBACK;
