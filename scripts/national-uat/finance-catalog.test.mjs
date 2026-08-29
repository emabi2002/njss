import assert from 'node:assert/strict'
import { COURT_LOCATIONS } from './catalog/organisation.ts'
import {
  ECONOMIC_CLASSES,
  FINANCE_CODES,
} from './catalog/finance.ts'
import {
  BUDGET_TIERS,
  MONTHLY_PROFILES,
  FUNDING_SOURCES,
  SUPPLIER_SCENARIOS,
  TRANSACTION_SCENARIOS,
} from './catalog/scenarios.ts'

assert.ok(ECONOMIC_CLASSES.length >= 18, 'expected approved PNG-aligned parent economic classes')
assert.equal(new Set(ECONOMIC_CLASSES.map((item) => item.code)).size, ECONOMIC_CLASSES.length, 'economic class codes must be unique')
assert.ok(FINANCE_CODES.length >= 35 && FINANCE_CODES.length <= 45, 'expected 35-45 UAT Finance Codes')
assert.equal(new Set(FINANCE_CODES.map((item) => item.code)).size, FINANCE_CODES.length, 'Finance Codes must be unique')

const parents = new Set(ECONOMIC_CLASSES.map((item) => item.code))
for (const financeCode of FINANCE_CODES) {
  assert.equal(financeCode.provenance, 'UAT', `${financeCode.code} must be UAT provenance`)
  assert.ok(parents.has(financeCode.parentCode), `${financeCode.code} references unknown parent ${financeCode.parentCode}`)
}

for (const required of ['221-01', '223-01', '224-01', '225-01', '227-01', '227-02', '228-01', '231-01', '233-01', '271-02']) {
  assert.ok(FINANCE_CODES.some((item) => item.code === required), `missing required Finance Code ${required}`)
}

for (const [name, profile] of Object.entries(MONTHLY_PROFILES)) {
  assert.equal(profile.length, 12, `${name} must have 12 monthly weights`)
  assert.equal(profile.reduce((sum, value) => sum + value, 0), 10_000, `${name} must total 10,000 basis points`)
  assert.ok(profile.every((value) => Number.isInteger(value) && value >= 0), `${name} weights must be non-negative integers`)
}

for (const location of COURT_LOCATIONS) {
  assert.ok(BUDGET_TIERS[location.code], `missing budget tier for ${location.code}`)
}
assert.equal(BUDGET_TIERS['NCD-WGN'], 'H')
for (const code of ['MOR-LAE', 'WHP-MHG', 'ENB-KOK', 'ESP-WEW', 'MAD-MAD', 'EHP-GOR']) {
  assert.equal(BUDGET_TIERS[code], 'T1', `${code} must be Tier 1`)
}
for (const location of COURT_LOCATIONS.filter((item) => item.locationType === 'NATIONAL_COURT_SUB_REGISTRY')) {
  assert.equal(BUDGET_TIERS[location.code], 'T3', `${location.code} must be Tier 3`)
}

assert.ok(FUNDING_SOURCES.length >= 5)
assert.ok(SUPPLIER_SCENARIOS.length >= 15 && SUPPLIER_SCENARIOS.length <= 25)
for (const supplier of SUPPLIER_SCENARIOS) {
  assert.match(supplier.name, /UAT/i, `${supplier.name} must be visibly marked UAT`)
  assert.equal(supplier.provenance, 'UAT')
}

const transactionLocations = new Set(TRANSACTION_SCENARIOS.map((scenario) => scenario.locationCode))
for (const required of ['NCD-WGN', 'MOR-LAE', 'WHP-MHG', 'ESP-WEW', 'ENB-KOK', 'MBA-ALO', 'HEL-TAR', 'ARB-BUK']) {
  assert.ok(transactionLocations.has(required), `missing detailed transaction scenario for ${required}`)
}
assert.ok(
  [...transactionLocations].every((code) => ['NCD-WGN', 'MOR-LAE', 'WHP-MHG', 'ESP-WEW', 'ENB-KOK', 'MBA-ALO', 'HEL-TAR', 'ARB-BUK'].includes(code)),
  'detailed transaction scenarios must be limited to approved representative centres',
)

console.log('national UAT finance and scenario catalogue checks passed')
