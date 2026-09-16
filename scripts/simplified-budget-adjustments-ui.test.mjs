import assert from 'node:assert/strict'
import fs from 'node:fs'

const path = 'app/dashboard/budget/adjustments/page.tsx'
assert.ok(fs.existsSync(path), 'Budget Adjustments workspace must exist')
const src = fs.readFileSync(path, 'utf8')
for (const needle of [
  'Budget Adjustments',
  'Supplementary Budget',
  'Budget Reallocation',
  'Current Approved',
  'Outstanding Commitments',
  'Actual Expenditure',
  'Available Budget',
  'REGISTRAR_APPROVED',
  'Registrar',
  'SUPPLEMENTARY_AUTHORITY',
  'REGISTRAR_REALLOCATION_AUTHORITY',
  'createSupplementaryDraft',
  'postSupplementaryAdjustment',
  'requestBudgetReallocation',
  'approveBudgetReallocation',
  'rejectBudgetReallocation',
  'executeBudgetReallocation',
  "can('budget.reallocation.approve')",
  "can('budget.reallocation.execute')",
]) {
  assert.ok(src.includes(needle), `Budget Adjustments workspace must contain ${needle}`)
}
console.log('simplified budget adjustments UI contract: ok')
