import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('app/dashboard/budget-template/page.tsx', 'utf8')

for (const id of [
  'head-office-budget-dashboard',
  'division-budget-selector',
  'section-budget-grid',
  'budget-document-panel',
  'lock-division-budget',
]) {
  assert.equal(source.includes(`data-testid="${id}"`), true, `${id} missing`)
}

for (const removed of [
  'Monthly allocation',
  'Procurement method',
  'Priority level',
  'Business justification',
  'Activity template',
  'Budget ceiling',
]) {
  assert.equal(source.includes(removed), false, `${removed} should not appear in annual budget capture`)
}

assert.equal(source.includes('Section Total'), true)
assert.equal(source.includes('Division Total'), true)
assert.equal(source.includes('Head Office Total'), true)
assert.equal(source.includes('Save Draft'), true)
assert.equal(source.includes('Print Draft'), true)
assert.equal(source.includes('Lock Division'), true)
assert.equal(source.includes("can('budget.capture')"), true)
assert.equal(source.includes("can('budget.lock')"), true)
assert.equal(source.includes("can('budget.documents.manage')"), true)
assert.equal(source.includes(".from('sections')"), true)
assert.equal(source.includes(".from('expense_ledger')"), true)
assert.equal(source.includes('saveDivisionBudgetLine'), true)

console.log('Simplified annual-budget UI contract passed')
