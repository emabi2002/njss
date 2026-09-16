import fs from 'node:fs'
import assert from 'node:assert/strict'

const migrationPath = 'supabase/migrations/20260917020000_simplified_budget_adjustments.sql'
assert.equal(fs.existsSync(migrationPath), true, 'Phase 2 simplified budget adjustments migration must exist')
const sql = fs.readFileSync(migrationPath, 'utf8')

for (const table of ['budget_supplementary_adjustments', 'budget_reallocations']) {
  assert.match(sql, new RegExp(`create table(?: if not exists)? public\\.${table}`, 'i'), `${table} must be created`)
}

for (const permission of [
  'budget.supplementary.enter',
  'budget.reallocation.request',
  'budget.reallocation.approve',
  'budget.reallocation.execute',
]) {
  assert.equal(sql.includes(permission), true, `${permission} must be defined`)
}

for (const rpc of [
  'post_budget_supplementary_adjustment',
  'request_budget_reallocation',
  'authorise_budget_reallocation',
  'reject_budget_reallocation',
  'execute_budget_reallocation',
]) {
  assert.match(sql, new RegExp(`create or replace function public\\.${rpc}`, 'i'), `${rpc} must exist`)
}

assert.match(sql, /v_head_office_budget_position/i, 'authoritative approved-position source must exist')
assert.match(sql, /original_budget/i)
assert.match(sql, /supplementary_adjustments/i)
assert.match(sql, /reallocation_in/i)
assert.match(sql, /reallocation_out/i)
assert.match(sql, /current_approved_budget/i)
assert.match(sql, /outstanding_commitments/i)
assert.match(sql, /actual_expenditure/i)
assert.match(sql, /available_budget/i)

assert.match(sql, /njss_current_user_has_role\s*\(\s*'Registrar'\s*\)/i, 'reallocation approval must require the Registrar role')
assert.match(sql, /REGISTRAR_REALLOCATION_AUTHORITY/i, 'Registrar authority document is mandatory')
assert.match(sql, /SUPPLEMENTARY_AUTHORITY/i, 'supplementary authority document is mandatory')
assert.match(sql, /status\s*=\s*'ACTIVE'/i, 'adjustments must operate against an active annual cycle')
assert.match(sql, /status\s*=\s*'AUTHORISED'/i, 'execution must require an authorised reallocation')
assert.match(sql, /available_budget/i, 'execution must validate the source available balance')
assert.match(sql, /FOR UPDATE/i, 'reallocation execution must lock rows for concurrency safety')

for (const table of ['budget_supplementary_adjustments', 'budget_reallocations']) {
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} must enable RLS`)
}
assert.match(sql, /revoke\s+(?:all|insert|update|delete)[\s\S]*budget_supplementary_adjustments/i)
assert.match(sql, /revoke\s+(?:all|insert|update|delete)[\s\S]*budget_reallocations/i)

console.log('Simplified supplementary budget and reallocation schema contract passed')
