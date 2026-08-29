import fs from 'node:fs'
import assert from 'node:assert/strict'
import {
  PROTECTED_TABLES,
  REBUILDABLE_TABLES,
  NULLABLE_CYCLE_DETACHMENTS,
  topologicalPurgeOrder,
} from './reset.ts'
import { APPEND_ONLY_PROTECTED_TABLES } from './preflight.ts'

const protectedSet = new Set(PROTECTED_TABLES)
const rebuildableSet = new Set(REBUILDABLE_TABLES)

for (const required of [
  'users', 'roles', 'user_roles', 'permissions', 'role_permissions', 'modules', 'menu_items',
  'workflow_statuses', 'report_categories', 'report_definitions', 'system_settings',
  'system_alert_settings', 'system_backup_registry', 'system_backup_change_log', 'audit_logs',
  'rbac_data_scope_types', 'role_data_scopes', 'user_data_scopes', 'user_permissions',
]) assert.ok(protectedSet.has(required), `protected table missing ${required}`)

for (const required of [
  'budget_activation_line_snapshots', 'budget_activation_lines', 'budget_activation_batches',
  'budget_revision_lines', 'budget_revisions', 'budget_allocations',
  'divisional_budget_lines', 'divisional_budget_submissions', 'budget_monthly_allocations',
  'commitment_transactions', 'ff3_commitments', 'ff3_headers', 'ff4_headers', 'payment_transactions',
  'funding_allocations', 'funding_receipts', 'funding_authorities', 'funding_sources',
  'suppliers', 'finance_posting_mappings', 'expense_code_registry', 'expense_ledger',
  'chart_of_accounts', 'cost_centres', 'sections', 'departments', 'projects', 'provinces',
]) assert.ok(rebuildableSet.has(required), `rebuildable table missing ${required}`)

for (const table of protectedSet) {
  assert.ok(!rebuildableSet.has(table), `protected/rebuildable overlap: ${table}`)
}
assert.ok(APPEND_ONLY_PROTECTED_TABLES.has('audit_logs'), 'audit_logs must be protected as append-only history')

assert.ok(NULLABLE_CYCLE_DETACHMENTS.some((item) => item.table === 'expense_ledger' && item.column === 'expense_code_registry_id'))
assert.ok(!NULLABLE_CYCLE_DETACHMENTS.some((item) => item.table === 'expense_code_registry' && item.column === 'expense_ledger_id'), 'only one side of the ledger/registry cycle should be detached')
assert.ok(NULLABLE_CYCLE_DETACHMENTS.some((item) => item.table === 'ff3_headers' && item.column === 'selected_quotation_id'))

assert.deepEqual(
  topologicalPurgeOrder(
    ['parent', 'child', 'grandchild'],
    [
      { childTable: 'child', parentTable: 'parent' },
      { childTable: 'grandchild', parentTable: 'child' },
    ],
  ),
  ['grandchild', 'child', 'parent'],
)
assert.throws(
  () => topologicalPurgeOrder(
    ['a', 'b'],
    [
      { childTable: 'a', parentTable: 'b' },
      { childTable: 'b', parentTable: 'a' },
    ],
  ),
  /cycle/i,
)

for (const file of ['scripts/national-uat/preflight.ts', 'scripts/national-uat/reset.ts']) {
  assert.ok(fs.existsSync(file), `missing ${file}`)
}
const resetSource = fs.readFileSync('scripts/national-uat/reset.ts', 'utf8')
const preflightSource = fs.readFileSync('scripts/national-uat/preflight.ts', 'utf8')
const safetySource = `${preflightSource}\n${resetSource}`

for (const token of [
  'njss_backup_full_snapshot',
  'system_backup_registry',
]) assert.ok(safetySource.includes(token), `combined reset safety layer missing ${token}`)

for (const token of [
  '--execute-reset',
  'BEGIN',
  'ROLLBACK',
  'COMMIT',
  'UPDATE public.users SET department_id = NULL, section_id = NULL',
  'trg_users_keep_section_for_scoped_group',
  'DISABLE TRIGGER',
  'ENABLE TRIGGER',
  'afterResetBeforeCommit',
  'Refusing committed reset without an atomic retained-user remap',
]) assert.ok(resetSource.includes(token), `reset execution source missing ${token}`)

assert.ok(!/TRUNCATE\s+/i.test(safetySource), 'reset must not use TRUNCATE')
assert.ok(!/DELETE\s+FROM\s+public\.users/i.test(resetSource), 'reset must never delete users')
assert.ok(!/DELETE\s+FROM\s+public\.roles/i.test(resetSource), 'reset must never delete roles')
assert.ok(!/DELETE\s+FROM\s+public\.permissions/i.test(resetSource), 'reset must never delete permissions')
assert.ok(!/DELETE\s+FROM\s+public\.audit_logs/i.test(resetSource), 'reset must preserve audit_logs')

console.log('national UAT reset safety checks passed')
