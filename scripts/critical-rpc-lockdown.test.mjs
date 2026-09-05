import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationPath = path.join(root, 'supabase', 'migrations', '20260904010000_security_definer_rpc_lockdown.sql')

assert.ok(fs.existsSync(migrationPath), 'critical SECURITY DEFINER RPC lockdown migration must exist')
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase()

for (const functionName of [
  'njss_set_role_permissions',
  'log_audit_event',
  'validate_divisional_budget_submission',
  'njss_refresh_supplier_compliance_status',
  'njss_resolve_ff3_budget_allocation',
  'njss_sync_commitment_balances',
  'fn_user_has_permission',
]) {
  assert.ok(sql.includes(`revoke execute on function public.${functionName}`), `missing direct-execution revoke for ${functionName}`)
}

assert.ok(sql.includes('transition_divisional_budget_submission_internal'), 'budget workflow must be wrapped behind an authenticated permission gate')
assert.ok(sql.includes("njss_require_permission('budget.template.submit')"), 'budget submit/resubmit must require budget.template.submit')
assert.ok(sql.includes("njss_require_permission('budget.template.review')"), 'budget review/return/reject must require budget.template.review')
assert.ok(sql.includes("njss_require_permission('budget.template.approve')"), 'budget approval must require budget.template.approve')

const transitionWrapperStart = sql.indexOf('create or replace function public.transition_divisional_budget_submission(')
const transitionWrapperEnd = sql.indexOf(
  'revoke execute on function public.transition_divisional_budget_submission(uuid, text, text, text)',
  transitionWrapperStart,
)
assert.ok(transitionWrapperStart >= 0 && transitionWrapperEnd > transitionWrapperStart, 'budget workflow wrapper must be extractable')

const transitionWrapper = sql.slice(transitionWrapperStart, transitionWrapperEnd)
assert.match(
  transitionWrapper,
  /select\s+s\.department_id\s*,\s*d\.section_id\s*,\s*s\.prepared_by\s*,\s*s\.submitted_by\s+into\s+v_submission_department_id\s*,\s*v_submission_section_id\s*,\s*v_submission_prepared_by\s*,\s*v_submission_submitted_by\s+from\s+public\.divisional_budget_submissions\s+s\s+left\s+join\s+public\.budget_divisions\s+d\s+on\s+d\.id\s*=\s*s\.division_id\s+where\s+s\.id\s*=\s*p_submission_id/,
  'budget workflow scope inputs must come from the target submission and its database division',
)
const transitionScopeRejectGuard = /if\s+not\s+coalesce\s*\(\s*public\.fn_current_user_data_scope_allows\(\s*v_submission_department_id\s*,\s*v_submission_section_id\s*,\s*v_submission_prepared_by\s*,\s*v_submission_submitted_by\s*,\s*null\s*\)\s*,\s*false\s*\)\s+then\s+raise exception 'budget submission is outside the current user organisational scope'\s*;\s*end if\s*;/
assert.match(
  transitionWrapper,
  transitionScopeRejectGuard,
  'database-derived scope predicate must directly control the out-of-scope rejection',
)
assert.ok(
  transitionWrapper.search(transitionScopeRejectGuard)
    < transitionWrapper.indexOf('public.transition_divisional_budget_submission_internal('),
  'budget workflow must reject an out-of-scope actor before invoking the internal transition',
)
assert.ok(sql.includes('consolidate_approved_excel_budgets_internal'), 'budget consolidation must be wrapped behind an authenticated permission gate')
assert.ok(sql.includes("njss_require_permission('budget.consolidate')"), 'budget consolidation must require budget.consolidate')
assert.ok(sql.includes('authentication required'), 'wrappers must reject anonymous callers')

assert.ok(!/grant\s+execute[\s\S]{0,300}njss_set_role_permissions[\s\S]{0,200}to\s+authenticated/i.test(sql), 'role-permission seeding helper must not be exposed to authenticated users')
assert.ok(!/grant\s+execute[\s\S]{0,300}log_audit_event[\s\S]{0,200}to\s+authenticated/i.test(sql), 'audit writer must not be exposed to authenticated users')

console.log('critical SECURITY DEFINER RPC lockdown checks passed')
