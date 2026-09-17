import assert from 'node:assert/strict'
import fs from 'node:fs'

const pagePath = 'app/dashboard/ff3/new/page.tsx'
assert.ok(fs.existsSync(pagePath), 'new FF3 page must exist')
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
]) {
  assert.ok(page.includes(needle), `new FF3 UI must contain ${needle}`)
}

assert.ok(!page.includes('await checkBudgetAndNotify(totalEstimate'), 'new FF3 submit must not use the legacy hard-stop notifier')
assert.ok(!page.includes('if (!checkedBudget.withinBudget)'), 'new FF3 submit must not hard-stop managerial workflow on insufficient budget')

// Budget authority is ledger based. An expense code can still be populated later as
// accounting metadata, but the requester must not be required to create/select one to submit.
const canSubmitLine = page.split('\n').find((line) => line.includes('const canSubmit =')) || ''
assert.ok(!canSubmitLine.includes('expense_code_registry_id'), 'submission eligibility must not require an expense code')
assert.ok(canSubmitLine.includes('expense_ledger_id'), 'submission eligibility must require an expense ledger')

console.log('FF3 simplified-budget UI contract: ok')
