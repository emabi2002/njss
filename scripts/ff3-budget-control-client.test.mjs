import assert from 'node:assert/strict'
import fs from 'node:fs'

const api = fs.readFileSync('lib/api.ts', 'utf8')
const page = fs.readFileSync('app/dashboard/ff3/new/page.tsx', 'utf8')

assert.ok(api.includes("rpc('preview_ff3_budget_control'"), 'FF3 client must use authoritative preview RPC')
for (const token of [
  'controlSource',
  'budgetControlStatus',
  'expenseLedgerId',
  'currentApproved',
  'shortfall',
]) assert.ok(api.includes(token), `FF3 API mapping must expose ${token}`)

for (const token of [
  'expense_ledger_id',
  'SIMPLIFIED_ACTIVE',
  'Current Approved Budget',
  'Actual Expenditure',
  'SHORTFALL',
  'INSUFFICIENT BUDGET – COMMITMENT BLOCKED',
]) assert.ok(page.includes(token), `FF3 creation UI must contain ${token}`)

assert.ok(
  page.includes(".from(\"expense_ledger\")") || page.includes(".from('expense_ledger')"),
  'simplified FF3 must load the global expense ledger',
)

console.log('FF3 authoritative budget client/UI contract: ok')
