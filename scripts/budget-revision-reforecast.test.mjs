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
  'CREATE TABLE budget_revisions', 'CREATE TABLE budget_revision_lines', 'revision_adjustment',
  'ALTER COLUMN revised_budget DROP EXPRESSION', 'budget.revision.create', 'budget.revision.approve',
  'ux_budget_revisions_one_active_parent', 'Requisition Officer', 'Line Supervisor', 'Registrar',
  'Payment/Reconciliation Officer',
]) assert.ok(migration51.includes(required), `migration 051 missing ${required}`)
assert.ok(migration51.includes("revision_type IN ('VIREMENT','SUPPLEMENTARY','REDUCTION','RECLASSIFICATION','REFORECAST')"), 'revision types must be constrained')
assert.ok(migration51.includes('fn_current_user_data_scope_allows'), 'revision RLS must enforce data scope')
assert.ok(migration51.includes('fn_current_user_has_permission'), 'revision RLS must enforce permission')

const migration52Path = 'supabase/migrations/052_budget_revision_workflow.sql'
assert.ok(fs.existsSync(migration52Path), 'migration 052 must exist')
const migration52 = read(migration52Path)
const migration52Lower = migration52.toLowerCase()
for (const required of [
  'CREATE OR REPLACE VIEW v_budget_revision_position', 'njss_create_budget_revision', 'njss_transition_budget_revision',
  'FOR UPDATE', 'protected_minimum', 'actual_expenditure_at_submission', 'actual_expenditure_at_approval',
  'superseded_by_id', 'VIREMENT', 'SUPPLEMENTARY', 'REDUCTION', 'RECLASSIFICATION', 'REFORECAST',
]) assert.ok(migration52.includes(required), `migration 052 missing ${required}`)
assert.ok(migration52Lower.includes('active revision already exists'), 'workflow must reject a second active revision')
assert.ok(migration52.includes("fn_current_user_has_permission('budget.revision.create')"), 'create RPC must enforce create permission')
assert.ok(migration52.includes("'APPROVE' THEN 'budget.revision.approve'"), 'approval action must map to budget.revision.approve')
assert.ok(migration52.includes('fn_current_user_has_permission(v_permission)'), 'transition RPC must enforce its action-specific permission')
assert.ok(migration52.includes('fn_current_user_data_scope_allows'), 'workflow RPCs must enforce data scope')
assert.match(migration52, /set_config\(\s*'njss\.budget_workflow'\s*,\s*'on'\s*,\s*true\s*\)/, 'revision workflow must use budget workflow privileged context')
assert.ok(!/transition_divisional_budget_submission\s*\([^;]*'APPROVE'/s.test(migration52), 'revision approval must not call initial-budget allocation creation path')

assert.ok(fs.existsSync('lib/budget-revision.ts'), 'budget revision service must exist')
const service = read('lib/budget-revision.ts')
for (const required of [
  "export type BudgetRevisionType", "'VIREMENT'", "'SUPPLEMENTARY'", "'REDUCTION'", "'RECLASSIFICATION'", "'REFORECAST'",
  'export type BudgetRevisionAction', 'getRevisionForSubmission', 'getBudgetRevisionPosition',
  'getBudgetRevisionHistory', 'createBudgetRevision', 'transitionBudgetRevision',
  "operation: 'create-budget-revision'", "operation: 'transition-budget-revision'",
]) assert.ok(service.includes(required), `budget revision service missing ${required}`)

const budgetModule = read('lib/budget-module.ts')
assert.ok(budgetModule.includes('parent_submission_id: string | null'), 'BudgetSubmission must type parent_submission_id')
assert.ok(budgetModule.includes('superseded_by_id: string | null'), 'BudgetSubmission must type superseded_by_id')

const budgetRoute = read('app/api/workflows/budget/route.ts')
for (const required of [
  'REVISION_PERMISSION', "operation === 'create-budget-revision'", "operation === 'transition-budget-revision'",
  "SUBMIT: ['budget.revision.submit']", "REVIEW: ['budget.revision.review']", "RETURN: ['budget.revision.return']",
  "REJECT: ['budget.revision.reject']", "APPROVE: ['budget.revision.approve']",
  "['budget.revision.create']", "supabase.rpc('njss_create_budget_revision'", "supabase.rpc('njss_transition_budget_revision'",
  "p_user_email: guard.context?.email || ''",
]) assert.ok(budgetRoute.includes(required), `budget API route missing ${required}`)

console.log('budget revision and reforecast regression checks passed')
