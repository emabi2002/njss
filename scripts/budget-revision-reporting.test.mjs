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
  'CREATE OR REPLACE VIEW v_budget_revision_history_report',
  'security_invoker',
  'budget-revision-history',
  'budget.revision.report',
]) {
  assert.ok(migration53.includes(required), `migration 053 missing ${required}`)
}

const apiSource = read('lib/api.ts')
for (const field of [
  'original_budget',
  'supplemental_budget',
  'revision_adjustment',
  'current_revised_budget',
  'budget_available',
  'released_available',
  'getBudgetRevisionHistoryReport',
  'v_budget_revision_history_report',
]) {
  assert.ok(apiSource.includes(field), `authoritative budget API missing ${field}`)
}

const budgetControl = read('app/dashboard/budget/page.tsx')
for (const label of [
  'Original Budget',
  'Supplementary',
  'Revision Adjustment',
  'Current Revised Budget',
  'Budget Available',
  'Released Available',
  'Revision History',
]) {
  assert.ok(budgetControl.includes(label), `Budget Control missing ${label}`)
}
assert.ok(budgetControl.includes('getBudgetRevisionHistoryReport'), 'Budget Control must load revision history reporting')
assert.ok(budgetControl.includes('budget_available'), 'Budget Control must use budget availability from the authoritative view')
assert.ok(budgetControl.includes('released_available'), 'Budget Control must use released cash availability from the authoritative view')

console.log('budget revision reporting regression checks passed')
