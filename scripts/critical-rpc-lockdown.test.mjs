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
assert.ok(sql.includes('consolidate_approved_excel_budgets_internal'), 'budget consolidation must be wrapped behind an authenticated permission gate')
assert.ok(sql.includes("njss_require_permission('budget.consolidate')"), 'budget consolidation must require budget.consolidate')
assert.ok(sql.includes('authentication required'), 'wrappers must reject anonymous callers')

assert.ok(!/grant\s+execute[\s\S]{0,300}njss_set_role_permissions[\s\S]{0,200}to\s+authenticated/i.test(sql), 'role-permission seeding helper must not be exposed to authenticated users')
assert.ok(!/grant\s+execute[\s\S]{0,300}log_audit_event[\s\S]{0,200}to\s+authenticated/i.test(sql), 'audit writer must not be exposed to authenticated users')

console.log('critical SECURITY DEFINER RPC lockdown checks passed')
