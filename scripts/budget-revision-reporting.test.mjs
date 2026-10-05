import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')

const migration53Path = 'supabase/migrations/053_budget_revision_reporting.sql'
assert.ok(fs.existsSync(migration53Path), 'migration 053 must exist')
const migration53 = read(migration53Path)
for (const required of [
  'CREATE OR REPLACE VIEW v_authoritative_budget_position',
  'original_budget',
  'supplemental_budget',
  'revision_adjustment',
  'current_revised_budget',
  'budget_available',
  'released_available',
  'available_amount',
  'projected_available_after_pending',
  'outstanding_amount',
  "'ENDORSED_SUPERVISOR'",
  "'ENDORSED_SECTION_HEAD'",
  'CREATE OR REPLACE VIEW v_budget_revision_history_report',
  'security_invoker',
  'budget-revision-history',
  'budget.revision.report',
]) {
  assert.ok(migration53.includes(required), `migration 053 missing ${required}`)
}
assert.ok(
  migration53.includes('Current Revised Budget = Original + Supplementary + Revision Adjustment'),
  'migration 053 must document the authoritative revision equation',
)
assert.ok(
  migration53.includes('budget_available is budget headroom; available_amount/released_available is released-cash headroom'),
  'migration 053 must preserve the distinction between budget and released availability',
)
assert.ok(
  migration53.indexOf('projected_available_after_pending') < migration53.indexOf('AS original_budget'),
  'new revision columns must be appended after the existing Phase 2 authoritative-view signature',
)

// The historical view contract above remains immutable. It is no longer the active report source.
const budgetControl = read('app/dashboard/budget/page.tsx')
assert.ok(budgetControl.includes('getCurrentBudgetPositions'))
assert.ok(budgetControl.includes('current_approved_budget'))
assert.ok(budgetControl.includes('available_budget'))
assert.equal(budgetControl.includes('getBudgetRevisionHistoryReport'),false)
assert.equal(read('lib/api.ts').includes('v_authoritative_budget_position'),false)
console.log('Historical revision view preserved; annual budget reporting is authoritative')
