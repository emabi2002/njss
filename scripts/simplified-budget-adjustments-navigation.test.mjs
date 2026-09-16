import assert from 'node:assert/strict'
import fs from 'node:fs'

const path = 'supabase/migrations/20260917022000_simplified_budget_adjustments_navigation.sql'
assert.ok(fs.existsSync(path), 'Budget Adjustments navigation migration must exist')
const sql = fs.readFileSync(path, 'utf8')
for (const needle of [
  "'budget.adjustments'",
  "'/dashboard/budget/adjustments'",
  "'Budget Adjustments'",
  "'budget.control'",
  "'budget.supplementary.enter'",
  "'budget.reallocation.request'",
  "'budget.reallocation.approve'",
  "'budget.reallocation.execute'",
  'required_permissions',
  'is_active',
]) {
  assert.ok(sql.includes(needle), `navigation migration must contain ${needle}`)
}
console.log('simplified budget adjustments navigation contract: ok')
