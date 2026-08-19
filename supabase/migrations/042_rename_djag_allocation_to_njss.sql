-- =============================================================================
-- NJSS 042 — Rename the DJAG_ALLOCATION funding authority type to NJSS_ALLOCATION
--
-- Migration 021 created funding_authorities with an inline CHECK constraint that
-- allowed 'DJAG_ALLOCATION'. That name is incorrect: this system belongs to the
-- National Judiciary Staff Services, not DJAG. Migration 021 has been corrected
-- for fresh installations; this migration fixes databases where 021 already ran.
--
-- Safe to re-run. Safe on databases that never had the old value.
-- =============================================================================

DO $$
DECLARE
  v_constraint_name TEXT;
  v_renamed INTEGER := 0;
BEGIN
  IF to_regclass('public.funding_authorities') IS NULL THEN
    RAISE NOTICE 'funding_authorities does not exist; nothing to rename.';
    RETURN;
  END IF;

  -- The constraint was declared inline, so its name is server-generated.
  -- Resolve it rather than assuming the default naming.
  SELECT con.conname
  INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'funding_authorities'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%authority_type%'
  LIMIT 1;

  -- Drop first: the existing constraint forbids the new value, so the UPDATE
  -- below would fail while it is still in force.
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.funding_authorities DROP CONSTRAINT %I',
      v_constraint_name
    );
  END IF;

  UPDATE funding_authorities
  SET authority_type = 'NJSS_ALLOCATION'
  WHERE authority_type = 'DJAG_ALLOCATION';
  GET DIAGNOSTICS v_renamed = ROW_COUNT;

  UPDATE funding_authorities
  SET source_agency = 'NJSS'
  WHERE UPPER(TRIM(COALESCE(source_agency, ''))) = 'DJAG';

  ALTER TABLE public.funding_authorities
    ADD CONSTRAINT funding_authorities_authority_type_check
    CHECK (authority_type IN (
      'GOVERNMENT_APPROPRIATION', 'WARRANT', 'NJSS_ALLOCATION',
      'TREASURY_FINANCE_AUTHORITY', 'SUPPLEMENTAL_ALLOCATION', 'DONOR_GRANT',
      'DEVELOPMENT_PARTNER', 'TRUST_FUND', 'PROJECT_FUNDING', 'OTHER'
    ));

  RAISE NOTICE 'NJSS 042 complete. Authority rows renamed: %.', v_renamed;
END $$;
