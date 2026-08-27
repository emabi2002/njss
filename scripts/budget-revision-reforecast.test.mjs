import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')
const config = read('lib/rbac/config.ts')

for (const permission of [
  'budget.revision.view',
  'budget.revision.create',
  'budget.revision.edit',
  'budget.revision.submit',
  'budget.revision.review',
  'budget.revision.approve',
  'budget.revision.reject',
  'budget.revision.return',
  'budget.revision.report',
]) {
  assert.ok(config.includes(permission), `missing ${permission}`)
}

const migration51Path = 'supabase/migrations/051_budget_revision_reforecast_schema.sql'
assert.ok(fs.existsSync(migration51Path), 'migration 051 must exist')
const migration51 = read(migration51Path)

for (const required of [
  'CREATE TABLE budget_revisions',
  'CREATE TABLE budget_revision_lines',
  'revision_adjustment',
  'ALTER COLUMN revised_budget DROP EXPRESSION',
  'budget.revision.create',
  'budget.revision.approve',
  'ux_budget_revisions_one_active_parent',
  'Requisition Officer',
  'Line Supervisor',
  'Registrar',
  'Payment/Reconciliation Officer',
]) {
  assert.ok(migration51.includes(required), `migration 051 missing ${required}`)
}

assert.ok(migration51.includes("revision_type IN ('VIREMENT','SUPPLEMENTARY','REDUCTION','RECLASSIFICATION','REFORECAST')"), 'revision types must be constrained')
assert.ok(migration51.includes('fn_current_user_data_scope_allows'), 'revision RLS must enforce data scope')
assert.ok(migration51.includes('fn_current_user_has_permission'), 'revision RLS must enforce permission')

console.log('budget revision and reforecast regression checks passed')
