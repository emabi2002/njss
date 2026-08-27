import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')

assert.ok(fs.existsSync('supabase/migrations/056_operational_budget_activation_finance_master_data.sql'))
assert.ok(fs.existsSync('supabase/migrations/057_finance_mapping_admin.sql'))
assert.ok(fs.existsSync('lib/budget-activation.ts'))
assert.ok(fs.existsSync('app/api/budget-activation/route.ts'))
assert.ok(fs.existsSync('app/dashboard/master/finance-mapping/page.tsx'))

const financeMappingMigration = read('supabase/migrations/057_finance_mapping_admin.sql')
for (const token of ['njss_set_finance_posting_mapping', 'System Administrator', 'expense_ledger_id', 'chart_of_account_id', 'FINANCE_POSTING_MAPPING_UPDATED']) {
  assert.ok(financeMappingMigration.includes(token), `finance mapping migration missing ${token}`)
}

const financeMappingPage = read('app/dashboard/master/finance-mapping/page.tsx')
for (const token of ['Finance Code', 'Posting Code', 'Chart of Accounts', 'expense_ledger_id', 'chart_of_account_id', 'njss_set_finance_posting_mapping']) {
  assert.ok(financeMappingPage.includes(token), `finance mapping master-data page missing ${token}`)
}

assert.ok(fs.existsSync('app/dashboard/budget/activation/page.tsx'))

const migration = read('supabase/migrations/056_operational_budget_activation_finance_master_data.sql')
for (const token of [
  'budget_activation_batches',
  'budget_activation_lines',
  'chart_of_account_id',
  'DRAFT_MAPPING',
  'VALIDATION_FAILED',
  'READY_FOR_ACTIVATION',
  'ACTIVATED',
  'njss_prepare_budget_activation',
  'njss_submit_budget_activation',
  'njss_activate_approved_budget',
  'BUDGET_ACTIVATION_VALIDATED',
  'BUDGET_ACTIVATED',
]) assert.ok(migration.includes(token), `missing ${token}`)

assert.ok(!/SELECT\s+id\s+INTO\s+v_fallback_account[\s\S]*FROM\s+chart_of_accounts/i.test(migration), 'Task 9 migration must not contain fallback Chart of Accounts selection')
assert.match(migration, /REVOKE\s+(?:ALL|EXECUTE)[\s\S]*create_operational_allocations_from_divisional_budget/i, 'legacy allocation function must be revoked')
assert.match(migration, /System Administrator cannot authorise operational budget activation/i)
assert.match(migration, /Only a Registrar may authorise activation/i)
assert.match(migration, /source_budget_line_id[\s\S]*is_active\s*=\s*true/i)
assert.ok(!/UPPER\(p_action\)\s*=\s*'APPROVE'[\s\S]{0,500}create_operational_allocations_from_divisional_budget/i.test(migration), 'APPROVE must not create operational allocations')

const service = read('lib/budget-activation.ts')
for (const token of ['getBudgetActivationQueue', 'getBudgetActivationLines', 'prepareBudgetActivation', 'submitBudgetActivation', 'activateApprovedBudget']) {
  assert.ok(service.includes(token), `service missing ${token}`)
}

const route = read('app/api/budget-activation/route.ts')
for (const token of ["operation === 'prepare'", "operation === 'submit'", "operation === 'activate'"]) {
  assert.ok(route.includes(token), `route missing ${token}`)
}
assert.ok(route.includes("['budget.activation.prepare']"))
assert.ok(route.includes("['budget.activation.submit']"))
assert.ok(route.includes("['budget.activation.authorize']"))

const page = read('app/dashboard/budget/activation/page.tsx')
for (const label of ['Budget Activation', 'Prepare Activation', 'Submit for Activation', 'Activate Approved Budget', 'Approved Total', 'Activation Total', 'Variance']) {
  assert.ok(page.includes(label), `activation page missing ${label}`)
}
assert.ok(page.includes('System Administrator'), 'workspace must explicitly distinguish System Administrator')
assert.ok(page.includes('Registrar'), 'workspace must explicitly distinguish Registrar')
assert.ok(page.includes('validation_errors'), 'workspace must expose line-level validation errors')

console.log('budget activation control regression checks passed')
