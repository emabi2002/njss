import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationPath = path.join(root, 'supabase', 'migrations', '20260904013000_rls_and_legacy_policy_lockdown.sql')
const cleanupPath = path.join(root, 'supabase', 'migrations', '20260904013100_budget_legacy_policy_cleanup.sql')

assert.ok(fs.existsSync(migrationPath), 'HARD-10 RLS lockdown migration must exist')
assert.ok(fs.existsSync(cleanupPath), 'HARD-10 ancillary budget policy cleanup migration must exist')
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase()
const cleanup = fs.readFileSync(cleanupPath, 'utf8').toLowerCase()
const combined = `${sql}\n${cleanup}`

const rlsTables = [
  'activity_templates','annual_plan_lines','approval_limits','budget_consolidations','budget_cycles',
  'budget_divisions','budget_periods','budget_release_funding_lines','budget_workflow_history',
  'chart_of_accounts','cost_centres','divisional_budget_lines','documents','expense_categories',
  'expense_items','financial_years','funding_sources','payee_types','payment_methods','priority_levels',
  'procurement_methods','projects','provinces','rbac_data_scope_types','role_migration_map_041',
  'role_migration_map_045','segregation_rules','units_of_measure','urgency_levels','workflow_statuses',
]

for (const table of rlsTables) {
  assert.ok(sql.includes(`alter table public.${table} enable row level security`), `RLS not enabled for ${table}`)
}

for (const unsafePolicy of [
  'divisional_budget_submissions_read',
  'divisional_budget_submissions_insert',
  'divisional_budget_submissions_update',
  'divisional_budget_submissions_delete',
  'divisional_budget_lines_read',
  'divisional_budget_lines_insert',
  'divisional_budget_lines_update',
  'divisional_budget_lines_delete',
  'budget_workflow_history_read',
  'budget_workflow_history_insert',
  'budget_import_batches_read',
  'budget_import_batches_insert',
  'budget_import_batches_update',
  'budget_import_batches_delete',
  'budget_import_staging_read',
  'budget_import_staging_insert',
  'budget_import_staging_update',
  'budget_import_staging_delete',
  'budget_line_attachments_read',
  'budget_monthly_allocations_read',
]) {
  assert.ok(combined.includes(`drop policy if exists ${unsafePolicy}`), `unsafe legacy policy not removed: ${unsafePolicy}`)
}

assert.ok(combined.includes("masterdata.manage"), 'master-data mutations must require masterdata.manage')
assert.ok(combined.includes("registry.manage"), 'registry mutations must require registry.manage where applicable')
assert.ok(combined.includes("budget.template.view"), 'budget reads must require budget.template.view/budget permission')
assert.ok(combined.includes('fn_current_user_data_scope_allows'), 'transactional budget rows must enforce data scope')
assert.ok(combined.includes('auth.uid() is not null'), 'RLS policies must require an authenticated identity')
assert.ok(cleanup.includes('revoke execute on function public.njss_is_budget_contributor()'), 'obsolete any-authenticated budget contributor helper must be retired')
assert.ok(cleanup.includes("a policy still depends on njss_is_budget_contributor()"), 'cleanup must fail if a legacy contributor policy survives')
assert.ok(!combined.includes('to anon'), 'HARD-10 migrations must not grant table access to anon')
assert.ok(!/for\s+all\s+to\s+authenticated\s+using\s*\(\s*true\s*\)/i.test(combined), 'no authenticated allow-all mutation policy is permitted')

console.log('RLS and legacy policy lockdown checks passed')
