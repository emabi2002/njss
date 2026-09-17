import assert from 'node:assert/strict'
import fs from 'node:fs'

const detailPath = 'app/dashboard/ff3/[ff3_number]/page.tsx'
const listPath = 'app/dashboard/ff3/page.tsx'
const detail = fs.readFileSync(detailPath, 'utf8')
const list = fs.readFileSync(listPath, 'utf8')

for (const needle of [
  'budget_control_status',
  'budget_control_source',
  'budget_available_snapshot',
  'budget_current_approved_snapshot',
  'budget_shortfall_amount',
  'Budget Control',
  'INSUFFICIENT BUDGET',
  'COMMITMENT BLOCKED',
]) {
  assert.ok(detail.includes(needle), `FF3 detail page must contain ${needle}`)
}

assert.ok(detail.includes("header.status === 'ENDORSED_SECTION_HEAD'"), 'workflow approval state must remain independent of budget state')
assert.ok(detail.includes("header.budget_control_status !== 'INSUFFICIENT_BUDGET_BLOCKED'"), 'final approval UI must not offer commitment approval while budget-blocked')
assert.ok(detail.includes('Managerial review may continue'), 'blocked detail must explain managerial review may continue')

for (const needle of [
  'budget_control_status',
  'budget_shortfall_amount',
  'Budget Control',
  'INSUFFICIENT BUDGET',
]) {
  assert.ok(list.includes(needle), `FF3 list page must contain ${needle}`)
}

console.log('FF3 budget state visibility contract: ok')
