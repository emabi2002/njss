import assert from 'node:assert/strict'
import fs from 'node:fs'

const apiPath = 'lib/api.ts'
assert.ok(fs.existsSync(apiPath), 'lib/api.ts must exist')
const api = fs.readFileSync(apiPath, 'utf8')

for (const needle of [
  'export type HeadOfficeFF3BudgetCheck',
  'export async function checkHeadOfficeFF3Budget',
  "supabase.rpc('check_head_office_ff3_budget'",
  'currentApprovedBudget',
  'outstandingCommitments',
  'actualExpenditure',
  'availableBudget',
  'shortfall',
  "'COMMIT'",
  'export async function approveFF3',
  "authJsonFetch('/api/workflows/ff3'",
]) {
  assert.ok(api.includes(needle), `FF3 client contract must contain ${needle}`)
}

// The old availability helper remains for legacy consumers but the new simplified API
// must exist separately rather than silently changing historical behavior.
assert.ok(api.includes('export async function checkBudgetAvailability'), 'legacy budget availability API must remain available')

console.log('FF3 simplified-budget client contract: ok')
