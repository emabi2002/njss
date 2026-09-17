import assert from 'node:assert/strict'
import fs from 'node:fs'

const apiPath = 'lib/api.ts'
const api = fs.readFileSync(apiPath, 'utf8')

assert.ok(api.includes(".rpc('check_ff3_budget_availability'"), 'checkBudgetAvailability must call the secured FF3 budget RPC')
for (const key of [
  'budgetControlSource',
  'budgetControlStatus',
  'currentApproved',
  'available',
  'shortfall',
  'withinBudget',
  'budgetAllocationId',
  'mappingStatus',
  'commitmentMappingStatus',
  'expenseLedgerId',
]) {
  assert.ok(api.includes(key), `FF3 client adapter must expose ${key}`)
}

const functionStart = api.indexOf('export async function checkBudgetAvailability')
assert.ok(functionStart >= 0, 'checkBudgetAvailability must exist')
const functionBody = api.slice(functionStart, api.indexOf('export async function createSupplier', functionStart))
assert.ok(!functionBody.includes("from('v_authoritative_budget_position')"), 'FF3 availability must not independently calculate from the legacy budget view')

console.log('FF3 authoritative budget client contract: ok')
