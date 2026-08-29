import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')

for (const path of [
  'supabase/migrations/056_operational_budget_activation_finance_master_data.sql',
  'supabase/migrations/057_finance_mapping_admin.sql',
  'supabase/migrations/058_budget_activation_organizational_guard.sql',
  'supabase/migrations/059_finance_posting_one_to_one_integrity.sql',
  'supabase/migrations/060_operational_allocation_organizational_guard.sql',
  'supabase/migrations/061_explicit_finance_posting_mapping_and_cost_centre_fk.sql',
  'supabase/migrations/062_budget_activation_fingerprint_and_immutable_snapshot.sql',
  'supabase/migrations/0625_budget_activation_queue_view_reset.sql',
  'supabase/migrations/063_budget_activation_fk_only_guards.sql',
  'lib/budget-activation.ts',
  'lib/finance-posting-mapping.ts',
  'app/api/budget-activation/route.ts',
  'app/dashboard/master/finance-mapping/page.tsx',
  'app/dashboard/budget/activation/page.tsx',
]) assert.ok(fs.existsSync(path), `missing ${path}`)

// Migrations 057-060 remain historical compatibility controls. New Task 9
// activation authority is canonicalized by migrations 061-063.
const financeMappingMigration = read('supabase/migrations/057_finance_mapping_admin.sql')
for (const token of ['njss_set_finance_posting_mapping', 'System Administrator', 'expense_ledger_id', 'chart_of_account_id', 'FINANCE_POSTING_MAPPING_UPDATED']) {
  assert.ok(financeMappingMigration.includes(token), `finance mapping migration missing ${token}`)
}

const organizationalGuardMigration = read('supabase/migrations/058_budget_activation_organizational_guard.sql')
for (const token of [
  'njss_guard_budget_activation_line_org',
  'Mapped Department does not match the approved budget organisational unit.',
  'Mapped Section does not match the approved budget organisational unit.',
  'Mapped Cost Centre does not match the approved budget organisational unit.',
  "budget.template.approve",
  'Operational activation is a separate dual-control step',
]) {
  assert.ok(organizationalGuardMigration.includes(token), `organisational activation guard missing ${token}`)
}

const oneToOneMigration = read('supabase/migrations/059_finance_posting_one_to_one_integrity.sql')
for (const token of [
  'ux_expense_code_registry_active_expense_ledger',
  'ux_expense_ledger_active_expense_code_registry',
  'Duplicate active Posting Code mappings exist for a Finance Code',
  'Duplicate active Finance Code mappings exist for a Posting Code',
]) {
  assert.ok(oneToOneMigration.includes(token), `one-to-one Finance mapping integrity missing ${token}`)
}

const allocationGuardMigration = read('supabase/migrations/060_operational_allocation_organizational_guard.sql')
for (const token of [
  'njss_guard_operational_allocation_org',
  "NEW.source_module IS DISTINCT FROM 'EXCEL_BUDGET'",
  'Operational allocation Department does not match approved budget organisational unit.',
  'Operational allocation Section does not match approved budget organisational unit.',
  'Operational allocation Cost Centre does not match approved budget organisational unit.',
  'Operational allocation financial year does not match approved budget.',
  'Operational allocation source budget is no longer APPROVED.',
  'BEFORE INSERT OR UPDATE',
]) {
  assert.ok(allocationGuardMigration.includes(token), `operational allocation guard missing ${token}`)
}

const canonicalMigration = read('supabase/migrations/061_explicit_finance_posting_mapping_and_cost_centre_fk.sql')
for (const token of [
  'finance_posting_mappings',
  'budget_divisions',
  'cost_centre_id',
  'njss_resolve_finance_posting_mapping',
  'njss_upsert_finance_posting_mapping',
  'njss_deactivate_finance_posting_mapping',
]) assert.ok(canonicalMigration.includes(token), `canonical mapping migration missing ${token}`)

const fingerprintMigration = read('supabase/migrations/062_budget_activation_fingerprint_and_immutable_snapshot.sql')
for (const token of [
  'validation_fingerprint',
  'finance_posting_mapping_id',
  'budget_activation_line_snapshots',
  'njss_budget_activation_fingerprint',
]) assert.ok(fingerprintMigration.includes(token), `fingerprint migration missing ${token}`)

const fkGuardMigration = read('supabase/migrations/063_budget_activation_fk_only_guards.sql')
for (const token of [
  'finance_posting_mapping_id',
  'budget_divisions.cost_centre_id',
  'v_budget_activation_queue',
  'fingerprint_state',
]) assert.ok(fkGuardMigration.includes(token), `FK-only activation guard missing ${token}`)

const financeMappingPage = read('app/dashboard/master/finance-mapping/page.tsx')
for (const token of [
  'Finance Code',
  'Posting Code',
  'Chart of Accounts',
  'saveFinancePostingMapping',
  'deactivateFinancePostingMapping',
  'Ambiguous Mapping',
]) {
  assert.ok(financeMappingPage.includes(token), `canonical finance mapping page missing ${token}`)
}
assert.ok(!financeMappingPage.includes('njss_set_finance_posting_mapping'), 'canonical Finance Mapping page must not mutate legacy reciprocal pointers directly')

const financeMappingService = read('lib/finance-posting-mapping.ts')
for (const token of ['v_finance_posting_mapping_admin', 'njss_upsert_finance_posting_mapping', 'njss_deactivate_finance_posting_mapping']) {
  assert.ok(financeMappingService.includes(token), `canonical Finance mapping service missing ${token}`)
}

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
for (const token of ['getBudgetActivationQueue', 'getBudgetActivationLines', 'getBudgetActivationSnapshots', 'prepareBudgetActivation', 'submitBudgetActivation', 'activateApprovedBudget']) {
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
for (const label of ['Budget Activation', 'Prepare Activation', 'Submit for Activation', 'Activate Approved Budget', 'Approved Total', 'Activation Total', 'Variance', 'Activated History']) {
  assert.ok(page.includes(label), `activation page missing ${label}`)
}
assert.ok(page.includes('System Administrator'), 'workspace must explicitly distinguish System Administrator')
assert.ok(page.includes('Registrar'), 'workspace must explicitly distinguish Registrar')
assert.ok(page.includes('validation_errors'), 'workspace must expose line-level validation errors')
assert.ok(page.includes('validation_fingerprint'), 'workspace must expose the validated fingerprint state')

console.log('budget activation control regression checks passed')
