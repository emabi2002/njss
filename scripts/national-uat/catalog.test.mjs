import assert from 'node:assert/strict'
import { PROVINCES, COURT_LOCATIONS } from './catalog/organisation.ts'
import { deterministicUuid } from './deterministic-id.ts'

assert.equal(PROVINCES.length, 22, 'expected 22 province-level jurisdictions')
assert.equal(COURT_LOCATIONS.length, 28, 'expected 28 court locations')
assert.equal(new Set(PROVINCES.map((item) => item.code)).size, 22, 'province codes must be unique')
assert.equal(new Set(COURT_LOCATIONS.map((item) => item.code)).size, 28, 'court location codes must be unique')
assert.equal(
  COURT_LOCATIONS.filter((item) => item.locationType === 'NATIONAL_COURT_SUB_REGISTRY').length,
  3,
  'expected three National Court sub-registries',
)
assert.equal(
  deterministicUuid('province:NCD'),
  deterministicUuid('province:NCD'),
  'deterministic IDs must be stable for the same key',
)
assert.notEqual(
  deterministicUuid('province:NCD'),
  deterministicUuid('province:MOR'),
  'different keys must generate different deterministic IDs',
)

for (const location of COURT_LOCATIONS) {
  assert.ok(
    PROVINCES.some((province) => province.code === location.provinceCode),
    `unknown province code ${location.provinceCode} on location ${location.code}`,
  )
}

console.log('national UAT catalogue checks passed')
