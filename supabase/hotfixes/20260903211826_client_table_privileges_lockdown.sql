-- NJSS HARD-10: remove non-row privileges from public client roles.
-- Applied live as 20260903211826; this comment is post-application metadata.
-- PostgreSQL 17+. No business rows, RLS policies, or DML grants are changed.
-- This is independent of the pending business-policy migrations.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $lockdown$
DECLARE
  v_table record;
  v_before jsonb;
  v_after jsonb;
BEGIN
  -- Do not silently extend this migration to objects owned by managed roles.
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relowner <> 'postgres'::regrole
  ) THEN
    RAISE EXCEPTION 'Unexpected public table owner: review before changing privileges';
  END IF;

  -- Schema-specific revocation cannot subtract a GLOBAL default grant.
  -- Stop if such a grant appears; do not change other schemas implicitly.
  IF EXISTS (
    SELECT 1 FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = 'postgres'::regrole AND d.defaclobjtype = 'r'
      AND d.defaclnamespace = 0
      AND a.grantee IN (0, 'anon'::regrole, 'authenticated'::regrole)
      AND a.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'Global client table default needs separate review';
  END IF;

  -- Snapshot all client DML and every service-role table privilege. Aborting
  -- the transaction below also rolls back the revocations if anything drifts.
  SELECT jsonb_agg(jsonb_build_array(c.oid, r.name, p.name,
      has_table_privilege(r.name, c.oid, p.name)) ORDER BY c.oid, r.name, p.name)
  INTO v_before
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(name)
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
    ('TRUNCATE'), ('TRIGGER'), ('REFERENCES'), ('MAINTAIN')) p(name)
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND (r.name = 'service_role' OR p.name IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'));

  FOR v_table IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table.relname);
  END LOOP;

  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLES FROM PUBLIC, anon, authenticated;

  SELECT jsonb_agg(jsonb_build_array(c.oid, r.name, p.name,
      has_table_privilege(r.name, c.oid, p.name)) ORDER BY c.oid, r.name, p.name)
  INTO v_after
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(name)
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
    ('TRUNCATE'), ('TRIGGER'), ('REFERENCES'), ('MAINTAIN')) p(name)
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND (r.name = 'service_role' OR p.name IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'));
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'Client DML or service-role privileges changed unexpectedly';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) r(name)
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND (has_table_privilege(r.name, c.oid, 'TRUNCATE,TRIGGER,REFERENCES,MAINTAIN')
        OR has_any_column_privilege(r.name, c.oid, 'REFERENCES'))
  ) THEN
    RAISE EXCEPTION 'Inherited or column-level client privileges require separate review';
  END IF;
END
$lockdown$;
