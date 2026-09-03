import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrationPath = new URL(
  '../supabase/migrations/20260904030000_public_table_rls_lockdown.sql',
  import.meta.url,
)

assert.ok(fs.existsSync(migrationPath), 'public-table RLS lockdown migration must exist')
const sql = fs.readFileSync(migrationPath, 'utf8')

const previouslyUnprotectedTables = [
  'activity_templates',
  'annual_plan_lines',
  'approval_limits',
  'budget_consolidations',
  'budget_cycles',
  'budget_divisions',
  'budget_periods',
  'budget_release_funding_lines',
  'budget_workflow_history',
  'chart_of_accounts',
  'cost_centres',
  'divisional_budget_lines',
  'documents',
  'expense_categories',
  'expense_items',
  'financial_years',
  'funding_sources',
  'payee_types',
  'payment_methods',
  'priority_levels',
  'procurement_methods',
  'projects',
  'provinces',
  'rbac_data_scope_types',
  'role_migration_map_041',
  'role_migration_map_045',
  'segregation_rules',
  'units_of_measure',
  'urgency_levels',
  'workflow_statuses',
]

for (const table of previouslyUnprotectedTables) {
  assert.match(
    sql,
    new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'),
    `${table} must have RLS enabled`,
  )
}

assert.ok(
  !sql.includes('njss_is_budget_contributor()'),
  'legacy any-authenticated-user budget contributor helper must not authorize writes',
)

for (const permission of ['masterdata.manage', 'registry.manage', 'budget.template.edit', 'budget.template.approve']) {
  assert.ok(sql.includes(permission), `RLS migration must enforce ${permission}`)
}

assert.match(
  sql,
  /divisional_budget_lines[\s\S]*fn_current_user_data_scope_allows/i,
  'budget lines must enforce organisational data scope',
)
assert.match(
  sql,
  /budget_workflow_history[\s\S]*WITH CHECK \(false\)/i,
  'workflow history must reject direct client inserts',
)
assert.match(
  sql,
  /budget_release_funding_lines[\s\S]*WITH CHECK \(false\)/i,
  'release-funding lines must be RPC-controlled',
)
assert.match(
  sql,
  /documents[\s\S]*uploaded_by[\s\S]*fn_current_app_user_id/i,
  'document writes must be tied to the authenticated NJSS user',
)

assert.match(
  sql,
  /role_migration_map_041[\s\S]*roles\.manage/i,
  'role migration maps must be restricted to access-control administrators',
)
assert.match(
  sql,
  /segregation_rules[\s\S]*settings\.manage/i,
  'segregation rules must be restricted to settings/access administrators',
)

console.log('public-table RLS lockdown regression checks passed')
