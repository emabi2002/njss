import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync('lib/head-office-budget.ts', 'utf8')
for (const needle of [
  'export type BudgetPositionRow',
  'export type SupplementaryBudgetAdjustment',
  'export type BudgetReallocation',
  'getCurrentBudgetPositions',
  'createSupplementaryDraft',
  'updateSupplementaryDraft',
  'postSupplementaryAdjustment',
  'getSupplementaryAdjustments',
  'requestBudgetReallocation',
  'approveBudgetReallocation',
  'rejectBudgetReallocation',
  'executeBudgetReallocation',
  'getBudgetReallocations',
  "supabase.rpc('get_current_budget_position'",
  "supabase.rpc('create_budget_supplementary_draft'",
  "supabase.rpc('execute_budget_reallocation'",
]) {
  assert.ok(src.includes(needle), `head-office-budget client must contain ${needle}`)
}
console.log('head office budget adjustments client contract: ok')
