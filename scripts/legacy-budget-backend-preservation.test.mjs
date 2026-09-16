import fs from 'node:fs'
import assert from 'node:assert/strict'

const requiredFiles = [
  'supabase/migrations/051_budget_revision_reforecast_schema.sql',
  'supabase/migrations/052_budget_revision_workflow.sql',
  'supabase/migrations/053_budget_revision_reporting.sql',
  'supabase/migrations/054_budget_revision_hardening.sql',
  'supabase/migrations/055_budget_revision_workspace_notifications.sql',
  'supabase/migrations/056_operational_budget_activation_finance_master_data.sql',
  'supabase/migrations/061_explicit_finance_posting_mapping_and_cost_centre_fk.sql',
  'supabase/migrations/062_budget_activation_fingerprint_and_immutable_snapshot.sql',
  'supabase/migrations/063_budget_activation_fk_only_guards.sql',
  'lib/budget-revision.ts',
  'lib/budget-revision-workspace.ts',
  'lib/budget-activation.ts',
  'app/api/workflows/budget/route.ts',
]

for (const path of requiredFiles) {
  assert.ok(fs.existsSync(path), `legacy financial-control backend must remain available: ${path}`)
}

const simplifiedPage = fs.readFileSync('app/dashboard/budget-template/page.tsx', 'utf8')
for (const obsoleteUiToken of [
  'BudgetRevisionPanel',
  'BudgetRevisionDialog',
  'monthly_allocations',
  'Allocate Evenly',
]) {
  assert.equal(
    simplifiedPage.includes(obsoleteUiToken),
    false,
    `simplified annual capture must not reintroduce legacy UI token: ${obsoleteUiToken}`,
  )
}

const activationPage = fs.readFileSync('app/dashboard/budget/activation/page.tsx', 'utf8')
assert.ok(activationPage.includes('Annual Budget Activation'), 'new annual activation workspace must remain the active UI')
assert.ok(activationPage.includes('activateAnnualBudget'), 'new annual activation workspace must use the secured simplified activation RPC')

console.log('Legacy financial-control backend preserved while simplified budget UI remains authoritative')
