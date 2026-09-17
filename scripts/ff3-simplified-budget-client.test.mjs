import assert from 'node:assert/strict'
import fs from 'node:fs'

const clientPath = 'lib/ff3-simplified-budget.ts'
assert.ok(fs.existsSync(clientPath), 'simplified FF3 budget client must exist')
const client = fs.readFileSync(clientPath, 'utf8')

for (const needle of [
  'export type HeadOfficeFF3BudgetStatus',
  'export type HeadOfficeFF3BudgetCheck',
  'export async function checkHeadOfficeFF3Budget',
  "supabase.rpc('check_head_office_ff3_budget'",
  'expenseLedgerId',
  'currentApprovedBudget',
  'outstandingCommitments',
  'actualExpenditure',
  'availableBudget',
  'shortfall',
]) {
  assert.ok(client.includes(needle), `FF3 client contract must contain ${needle}`)
}

const api = fs.readFileSync('lib/api.ts', 'utf8')
assert.ok(api.includes('export async function checkBudgetAvailability'), 'legacy budget availability API must remain available')
assert.ok(api.includes('export async function approveFF3'), 'existing controlled FF3 workflow API must remain available')

console.log('FF3 simplified-budget client contract: ok')