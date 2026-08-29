import fs from 'node:fs'
import assert from 'node:assert/strict'

const migrationPath = 'supabase/migrations/066_national_uat_location_seed_registry.sql'
assert.ok(fs.existsSync(migrationPath), `missing ${migrationPath}`)

const sql = fs.readFileSync(migrationPath, 'utf8')
for (const token of [
  'CREATE TABLE IF NOT EXISTS public.court_locations',
  'province_id uuid NOT NULL',
  "'HEADQUARTERS'",
  "'NATIONAL_COURT_REGISTRY'",
  "'NATIONAL_COURT_SUB_REGISTRY'",
  'ALTER TABLE public.departments',
  'ADD COLUMN IF NOT EXISTS court_location_id',
  'CREATE TABLE IF NOT EXISTS public.uat_seed_runs',
  'CREATE TABLE IF NOT EXISTS public.uat_seed_entities',
  "provenance IN ('OFFICIAL', 'DERIVED', 'UAT')",
  'ENABLE ROW LEVEL SECURITY',
  "fn_current_user_has_permission('masterdata.manage')",
  'GRANT ALL ON public.uat_seed_runs TO service_role',
  'GRANT ALL ON public.uat_seed_entities TO service_role',
]) {
  assert.ok(sql.includes(token), `migration 066 missing ${token}`)
}

assert.ok(!/ALTER TABLE public\.departments[\s\S]*court_location_id uuid NOT NULL/i.test(sql), 'migration 066 must not make the new department FK NOT NULL before reset')
assert.ok(!sql.includes('TRUNCATE'), 'schema migration must be additive and non-destructive')

console.log('national UAT schema contract checks passed')
