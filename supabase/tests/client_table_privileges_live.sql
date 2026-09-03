-- Read-only regression assertion. Safe to run against NJSS: no TRUNCATE,
-- trigger creation, row writes, or temporary fixtures are attempted here.
-- Catches reintroduced broad table/default grants, even when RLS is enabled.
DO $test$
DECLARE
  v_exposures integer;
BEGIN
  SELECT count(*) INTO v_exposures
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS roles(name)
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND (has_table_privilege(roles.name, c.oid, 'TRUNCATE,TRIGGER,REFERENCES,MAINTAIN')
      OR has_any_column_privilege(roles.name, c.oid, 'REFERENCES'));
  IF v_exposures <> 0 THEN
    RAISE EXCEPTION 'Client non-row privileges remain on % table/role pairs', v_exposures;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = 'postgres'::regrole AND d.defaclobjtype = 'r'
      AND d.defaclnamespace IN (0, 'public'::regnamespace)
      AND a.grantee IN (0, 'anon'::regrole, 'authenticated'::regrole)
      AND a.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'Postgres table defaults still grant client non-row privileges';
  END IF;
END
$test$;
SELECT 'PASS: public client non-row privileges and postgres public defaults are restricted' AS result;
