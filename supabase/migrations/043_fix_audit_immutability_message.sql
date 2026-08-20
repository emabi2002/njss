-- =============================================================================
-- NJSS 043 — Correct the Access Audit immutability message
--
-- Migration 041 section 13 interpolated LOWER(TG_OP) straight into the message,
-- so a tampering attempt was rejected with
--     "Access Audit records are immutable evidence and cannot be update."
-- instead of "...cannot be updated."
--
-- The rule itself was never wrong: UPDATE and DELETE on audit_logs are still
-- refused with SQLSTATE P0001, even for service_role. Only the wording changes,
-- so nothing that depends on the error code is affected.
--
-- Safe to re-run. Safe on databases where 041 has not been applied.
-- =============================================================================

CREATE OR REPLACE FUNCTION njss_audit_logs_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Access Audit records are immutable evidence and cannot be %.',
    CASE TG_OP
      WHEN 'UPDATE' THEN 'updated'
      WHEN 'DELETE' THEN 'deleted'
      WHEN 'TRUNCATE' THEN 'truncated'
      ELSE LOWER(TG_OP)
    END
  USING HINT = 'Append a correcting entry instead. Existing evidence is never rewritten.';
END;
$$;

DO $migration$
BEGIN
  IF to_regclass('public.audit_logs') IS NULL THEN
    RAISE NOTICE 'NJSS 043: audit_logs does not exist; message corrected for future installs only.';
    RETURN;
  END IF;

  -- CREATE OR REPLACE FUNCTION above keeps any existing trigger bound to the new
  -- body, so this only matters if the trigger was never installed or was dropped.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.audit_logs'::regclass
      AND tgname = 'trg_audit_logs_immutable'
      AND NOT tgisinternal
  ) THEN
    EXECUTE $ddl$
      CREATE TRIGGER trg_audit_logs_immutable
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION njss_audit_logs_immutable()
    $ddl$;
    RAISE NOTICE 'NJSS 043: re-attached trg_audit_logs_immutable to audit_logs.';
  END IF;

  RAISE NOTICE 'NJSS 043 complete. Access Audit remains append-only.';
END
$migration$;
