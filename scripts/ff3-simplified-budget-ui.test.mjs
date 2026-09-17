import assert from 'node:assert/strict'
import fs from 'node:fs'

const pagePath = 'app/dashboard/ff3/new/SimplifiedHeadOfficeFF3.tsx'
assert.ok(fs.existsSync(pagePath), 'simplified Head Office FF3 form must exist')
const page = fs.readFileSync(pagePath, 'utf8')

for (const needle of [
  'expense_ledger_id',
  'expense_ledger',
  'checkHeadOfficeFF3Budget',
  'Current Approved Budget',
  'Outstanding Commitments',
  'Actual Expenditure',
  'Available Budget',
  'This FF3 Request',
  'Shortfall',
  'INSUFFICIENT BUDGET – COMMITMENT BLOCKED',
  'budget_control_status',
  'Submit for Managerial Review',
]) {
  assert.ok(page.includes(needle), `new FF3 UI must contain ${needle}`)
}

assert.ok(!page.includes('checkBudgetAndNotify'), 'new FF3 submit must not use the legacy insufficient-budget hard stop')
assert.ok(!page.includes('if (!checkedBudget.withinBudget)'), 'new FF3 submit must not hard-stop managerial workflow on insufficient budget')

const canSubmitStart = page.indexOf('const canSubmit =')
assert.ok(canSubmitStart >= 0, 'submission eligibility must be explicit')
const canSubmitBlock = page.slice(canSubmitStart, page.indexOf('const changeItem', canSubmitStart))
assert.ok(!canSubmitBlock.includes('expense_code_registry_id'), 'submission eligibility must not require an expense code')
assert.ok(canSubmitBlock.includes('expense_ledger_id'), 'submission eligibility must require an expense ledger')

const route = fs.readFileSync('app/dashboard/ff3/new/page.tsx', 'utf8')
assert.ok(route.includes("SimplifiedHeadOfficeFF3"), 'active new FF3 route must use the simplified direct-ledger workspace')

console.log('FF3 simplified-budget UI contract: ok')