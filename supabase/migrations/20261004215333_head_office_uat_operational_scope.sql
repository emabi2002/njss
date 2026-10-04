-- UAT project qzsmmalfeinoagvronpb only. Reversible operational retirement;
-- retain historical records, financial links, user identities and geography.
DO $scope$
DECLARE
  v_hq_departments integer;
  v_hq_sections integer;
  v_budget_count integer;
BEGIN
  IF (SELECT count(*) FROM public.court_locations WHERE is_headquarters AND is_active) <> 1 THEN
    RAISE EXCEPTION 'Expected one active Head Office registry';
  END IF;
  IF EXISTS (SELECT 1 FROM public.annual_budget_cycles WHERE status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Head Office retirement is restricted to pre-activation UAT';
  END IF;
  LOCK TABLE public.departments, public.sections, public.court_locations, public.users IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) INTO v_hq_departments FROM public.departments d JOIN public.court_locations c ON c.id=d.court_location_id WHERE c.is_headquarters AND d.is_active;
  SELECT count(*) INTO v_hq_sections FROM public.sections s JOIN public.departments d ON d.id=s.department_id JOIN public.court_locations c ON c.id=d.court_location_id WHERE c.is_headquarters AND s.is_active;
  SELECT count(*) INTO v_budget_count FROM public.division_budgets;
  IF v_hq_departments = 0 OR v_hq_sections = 0 THEN RAISE EXCEPTION 'Head Office structure is missing'; END IF;

  CREATE SCHEMA IF NOT EXISTS njss_reset_archive;
  REVOKE ALL ON SCHEMA njss_reset_archive FROM PUBLIC, anon, authenticated;
  CREATE TABLE IF NOT EXISTS njss_reset_archive.operational_scope_20261005 (
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    was_active boolean NOT NULL,
    archived_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(entity_type, entity_id)
  );
  REVOKE ALL ON njss_reset_archive.operational_scope_20261005 FROM PUBLIC, anon, authenticated;

  INSERT INTO njss_reset_archive.operational_scope_20261005(entity_type,entity_id,was_active)
  SELECT 'department',d.id,d.is_active FROM public.departments d LEFT JOIN public.court_locations c ON c.id=d.court_location_id WHERE NOT coalesce(c.is_headquarters,false)
  UNION ALL SELECT 'section',s.id,s.is_active FROM public.sections s JOIN public.departments d ON d.id=s.department_id LEFT JOIN public.court_locations c ON c.id=d.court_location_id WHERE NOT coalesce(c.is_headquarters,false)
  UNION ALL SELECT 'user',u.id,u.is_active FROM public.users u JOIN public.departments d ON d.id=u.department_id LEFT JOIN public.court_locations c ON c.id=d.court_location_id WHERE NOT coalesce(c.is_headquarters,false)
  UNION ALL SELECT 'location',c.id,c.is_active FROM public.court_locations c WHERE NOT c.is_headquarters
  ON CONFLICT DO NOTHING;

  UPDATE public.sections s SET is_active=false FROM public.departments d LEFT JOIN public.court_locations c ON c.id=d.court_location_id WHERE s.department_id=d.id AND s.is_active AND NOT coalesce(c.is_headquarters,false);
  UPDATE public.users u SET is_active=false FROM public.departments d LEFT JOIN public.court_locations c ON c.id=d.court_location_id WHERE u.department_id=d.id AND u.is_active AND NOT coalesce(c.is_headquarters,false);
  UPDATE public.departments d SET is_active=false WHERE d.is_active AND NOT EXISTS (SELECT 1 FROM public.court_locations c WHERE c.id=d.court_location_id AND c.is_headquarters);
  UPDATE public.court_locations SET is_active=false WHERE is_active AND NOT is_headquarters;

  IF EXISTS (SELECT 1 FROM public.departments d LEFT JOIN public.court_locations c ON c.id=d.court_location_id WHERE d.is_active AND NOT coalesce(c.is_headquarters,false)) THEN RAISE EXCEPTION 'Provincial division remains active'; END IF;
  IF (SELECT count(*) FROM public.departments d JOIN public.court_locations c ON c.id=d.court_location_id WHERE c.is_headquarters AND d.is_active) <> v_hq_departments THEN RAISE EXCEPTION 'Head Office divisions changed'; END IF;
  IF (SELECT count(*) FROM public.sections s JOIN public.departments d ON d.id=s.department_id JOIN public.court_locations c ON c.id=d.court_location_id WHERE c.is_headquarters AND s.is_active) <> v_hq_sections THEN RAISE EXCEPTION 'Head Office sections changed'; END IF;
  IF (SELECT count(*) FROM public.division_budgets) <> v_budget_count THEN RAISE EXCEPTION 'Current budgets changed'; END IF;
END
$scope$;
