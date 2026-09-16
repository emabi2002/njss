import fs from 'node:fs'
import assert from 'node:assert/strict'

const clientPath = 'lib/head-office-budget.ts'
assert.equal(fs.existsSync(clientPath), true, 'Head Office budget client module must exist')
const source = fs.readFileSync(clientPath, 'utf8')

for (const fn of [
  'getHeadOfficeBudgetDashboard',
  'getDivisionBudget',
  'createOrGetHeadOfficeBudgetCycle',
  'createOrGetDivisionBudget',
  'updateDivisionBudgetDraftHeader',
  'saveDivisionBudgetLine',
  'registerBudgetDocument',
  'lockDivisionBudget',
  'activateAnnualBudget',
]) {
  assert.ok(
    source.includes(`function ${fn}`) || source.includes(`const ${fn}`),
    `${fn} must exist`,
  )
}

assert.equal(source.includes("supabase.rpc('create_or_get_head_office_budget_cycle'"), true)
assert.equal(source.includes("supabase.rpc('create_or_get_division_budget'"), true)
assert.equal(source.includes("supabase.rpc('upsert_division_budget_line'"), true)
assert.equal(source.includes("supabase.rpc('register_budget_document'"), true)
assert.equal(source.includes("supabase.rpc('lock_division_budget'"), true)
assert.equal(source.includes("supabase.rpc('activate_annual_budget'"), true)
assert.equal(source.includes(".from('annual_budget_cycles')"), true)
assert.equal(source.includes(".from('division_budgets')"), true)
assert.equal(source.includes(".from('division_budget_lines')"), true)
assert.equal(source.includes(".from('budget_documents')"), true)

console.log('Head Office budget client contract passed')
