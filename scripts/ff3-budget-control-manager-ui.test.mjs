import assert from 'node:assert/strict'
import fs from 'node:fs'

const list = fs.readFileSync('app/dashboard/ff3/page.tsx', 'utf8')
const detail = fs.readFileSync('app/dashboard/ff3/[ff3_number]/page.tsx', 'utf8')

for (const token of ['budget_control_status', 'Budget Status', 'INSUFFICIENT_BUDGET_BLOCKED']) {
  assert.ok(list.includes(token), `FF3 list must contain ${token}`)
}
for (const token of ['budget_control_status', 'Commitment Created', 'INSUFFICIENT BUDGET', 'Shortfall']) {
  assert.ok(detail.includes(token), `FF3 detail must contain ${token}`)
}

assert.ok(detail.includes('canEndorseSupervisor'), 'blocked FF3 must retain supervisor review path')
assert.ok(detail.includes('canEndorseSectionHead'), 'blocked FF3 must retain higher managerial review path')

console.log('FF3 manager budget-state UI contract: ok')
