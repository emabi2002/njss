import assert from 'node:assert/strict'
import fs from 'node:fs'

const pagePath = 'app/dashboard/ff3/new/page.tsx'
const page = fs.readFileSync(pagePath, 'utf8')

for (const needle of [
  'budgetControlStatus',
  'budgetControlSource',
  'currentApproved',
  'shortfall',
  'INSUFFICIENT BUDGET',
  'COMMITMENT BLOCKED',
  'Current Approved Budget',
  'Actual Expenditure',
  'Available Budget',
]) {
  assert.ok(page.includes(needle), `FF3 creation UI must contain ${needle}`)
}

const submitStart = page.indexOf('const saveFF3')
assert.ok(submitStart >= 0, 'saveFF3 must exist')
const submitBody = page.slice(submitStart, page.indexOf('const handleSaveDraft', submitStart))
assert.ok(!/if\s*\(\s*!checkedBudget\.withinBudget\s*\)[\s\S]{0,800}?return/.test(submitBody), 'insufficient budget must not hard-stop managerial submission')
assert.ok(submitBody.includes("checkedBudget.budgetControlStatus === 'MAPPING_REQUIRED'"), 'unresolved budget key must remain a hard stop')
assert.ok(submitBody.includes('budget_control_status:'), 'FF3 header must persist budget-control status snapshot')
assert.ok(submitBody.includes('budget_shortfall_amount:'), 'FF3 header must persist budget shortfall snapshot')

console.log('FF3 insufficient-budget UI contract: ok')
