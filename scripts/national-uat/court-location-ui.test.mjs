import fs from 'node:fs'
import assert from 'node:assert/strict'

const pagePath = 'app/dashboard/master/court-locations/page.tsx'
const helperPath = 'lib/court-locations.ts'
assert.ok(fs.existsSync(pagePath), 'focused Court Locations master page must exist')
assert.ok(fs.existsSync(helperPath), 'focused Court Locations data helper must exist')

const page = fs.readFileSync(pagePath, 'utf8')
const helper = fs.readFileSync(helperPath, 'utf8')
const migration = fs.readFileSync('supabase/migrations/066_national_uat_location_seed_registry.sql', 'utf8')
const combined = `${page}\n${helper}`

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
  'is_active',
]) {
  assert.ok(combined.includes(token), `Court Location maintenance missing token: ${token}`)
}

assert.match(page, /can\("masterdata\.manage"\)/, 'Court Location maintenance must require master-data permission')
assert.match(page, /can\("registry\.manage"\)/, 'Court Location maintenance must permit registry-management permission')
assert.match(helper, /supabase\s*\.from\("provinces"\)/, 'Province lookup must load from the provinces master')
assert.match(helper, /supabase\s*\.from\("court_locations"\)/, 'Court Location CRUD must use the court_locations master')
assert.match(helper, /is_headquarters:\s*input\.location_type\s*===\s*"HEADQUARTERS"/, 'Headquarters flag must be derived from location type')
assert.match(helper, /province:provinces\(id, code, name\)/, 'Court Location rows must display Province context')
assert.match(migration, /code varchar\(30\) NOT NULL UNIQUE/, 'duplicate Court Location codes must remain rejected by the database')
assert.match(migration, /court_locations_headquarters_consistency/, 'Headquarters flag/type consistency must remain enforced by the database')

console.log('court location master UI contract checks passed')
