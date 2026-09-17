import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrationPath = 'supabase/migrations/20260917030000_ff3_budget_blocked_workflow.sql'
assert.ok(fs.existsSync(migrationPath), 'FF3 budget-blocked workflow migration must exist')

const sql = fs.readFileSync(migrationPath, 'utf8')
for (const needle of [
  'budget_control_status',
  'budget_expense_ledger_id',
  'budget_available_amount',
  'budget_shortfall_amount',
  'budget_checked_at',
  'INSUFFICIENT_BUDGET_BLOCKED',
  'SUFFICIENT',
  'check_ff3_budget_position',
  'njss_transition_ff3',
  "p_action = 'SUBMIT'",
  "p_action = 'APPROVE'",
  'ff3_commitments',
  'FOR UPDATE',
]) {
  assert.ok(sql.includes(needle), `migration must contain ${needle}`)
}

assert.ok(
  sql.includes("budget_control_status = 'INSUFFICIENT_BUDGET_BLOCKED'") || sql.includes("'INSUFFICIENT_BUDGET_BLOCKED'"),
  'insufficient budget must be represented as an FF3 budget-control state',
)
assert.ok(
  sql.includes('Reallocation or supplementary budget is required before final approval') || sql.includes('cannot be finally approved'),
  'final approval must remain blocked while the budget shortfall exists',
)

const api = fs.readFileSync('lib/api.ts', 'utf8')
assert.ok(api.includes("supabase.rpc('check_ff3_budget_position'"), 'client budget check must use the authoritative FF3 budget RPC')
assert.ok(api.includes('budgetControlStatus'), 'client budget check must expose budget-control state')
assert.ok(api.includes('shortfall'), 'client budget check must expose shortfall')

const page = fs.readFileSync('app/dashboard/ff3/new/page.tsx', 'utf8')
assert.ok(page.includes('INSUFFICIENT_BUDGET_BLOCKED'), 'New FF3 page must render the blocked budget state')
assert.ok(page.includes('COMMITMENT BLOCKED'), 'New FF3 page must explain that commitment is blocked')
assert.ok(page.includes('Current Approved Budget'), 'New FF3 page must show current approved budget')
assert.ok(page.includes('Shortfall'), 'New FF3 page must show the shortfall')
assert.ok(!page.includes('setSubmitting(false)\n          return\n        }\n      }\n\n      const selectedQuotation'), 'insufficient budget must not hard-stop managerial submission in the old client path')

console.log('FF3 budget-blocked workflow contract: ok')
