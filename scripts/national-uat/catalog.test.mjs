import assert from 'node:assert/strict'
import { DATASET_VERSION, EXPECTED_PROJECT_REF, runIdFor } from './constants.ts'
import {
  PROVINCES,
  COURT_LOCATIONS,
  WAIGANI_FUNCTIONS,
  PROVINCIAL_TEMPLATE,
  SUBREGISTRY_TEMPLATE,
} from './catalog/organisation.ts'
import { deterministicUuid } from './deterministic-id.ts'

assert.equal(DATASET_VERSION, 'NJSS-NATIONAL-UAT-2026-V1')
assert.equal(EXPECTED_PROJECT_REF, 'qzsmmalfeinoagvronpb')
assert.equal(runIdFor(new Date('2026-08-29T00:00:00Z')), 'UAT-2026-V1-20260829')

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
  COURT_LOCATIONS.filter((item) => item.locationType === 'HEADQUARTERS').length,
  1,
  'expected one headquarters location',
)
assert.ok(WAIGANI_FUNCTIONS.some((item) => item.code === 'FIN'), 'Waigani template must include Finance')
assert.ok(WAIGANI_FUNCTIONS.some((item) => item.code === 'ICT'), 'Waigani template must include ICT')
assert.ok(PROVINCIAL_TEMPLATE.some((item) => item.code === 'REG'), 'provincial template must include Registry')
assert.ok(PROVINCIAL_TEMPLATE.some((item) => item.code === 'SHF'), 'provincial template must include Sheriff')
assert.ok(SUBREGISTRY_TEMPLATE.length < PROVINCIAL_TEMPLATE.length, 'sub-registry template must be reduced')

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

for (const province of PROVINCES) {
  assert.equal(province.provenance, 'OFFICIAL', `province ${province.code} must be OFFICIAL provenance`)
}
for (const location of COURT_LOCATIONS) {
  assert.equal(location.provenance, 'OFFICIAL', `location ${location.code} must be OFFICIAL provenance`)
  assert.ok(
    PROVINCES.some((province) => province.code === location.provinceCode),
    `unknown province code ${location.provinceCode} on location ${location.code}`,
  )
}

console.log('national UAT catalogue checks passed')
