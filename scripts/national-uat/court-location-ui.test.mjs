import fs from 'node:fs'
import assert from 'node:assert/strict'

const pagePath = 'app/dashboard/master/page.tsx'
assert.ok(fs.existsSync(pagePath), 'existing master-data page must be extended rather than duplicated')
const page = fs.readFileSync(pagePath, 'utf8')
const migration = fs.readFileSync('supabase/migrations/066_national_uat_location_seed_registry.sql', 'utf8')

for (const token of [
  'court_locations',
  'Court Locations',
  'Court Location',
  'Province',
  'Location Type',
  'Headquarters',
  'National Court Registry',
  'National Court Sub-Registry',
  'HEADQUARTERS',
  'NATIONAL_COURT_REGISTRY',
  'NATIONAL_COURT_SUB_REGISTRY',
  'province_id',
  'is_headquarters',
  'town',
]) {
  assert.ok(page.includes(token), `master-data page missing Court Location UI token: ${token}`)
}

assert.match(page, /can\("masterdata\.manage"\)/, 'Court Location maintenance must inherit the master-data permission guard')
assert.match(page, /can\("registry\.manage"\)/, 'Court Location maintenance must inherit the registry-management permission guard')
assert.match(page, /SourceKey[^\n]*provinces|type SourceKey[\s\S]*provinces/, 'Province must be available as a select source')
assert.match(page, /supabase\.from\("provinces"\)/, 'Province lookup must load from the provinces master')
assert.match(page, /table:\s*"court_locations"/, 'Court Locations must be maintained through the existing master CRUD engine')
assert.match(page, /province:c?provinces|province:provinces|provinces\(name\)/, 'Court Location rows must display Province context')
assert.match(migration, /code varchar\(30\) NOT NULL UNIQUE/, 'duplicate Court Location codes must remain rejected by the database')
assert.match(migration, /court_locations_headquarters_consistency/, 'Headquarters flag/type consistency must remain enforced by the database')

console.log('court location master UI contract checks passed')
