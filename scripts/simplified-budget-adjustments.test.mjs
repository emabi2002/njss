import fs from 'node:fs'
import assert from 'node:assert/strict'

const migrationPath = 'supabase/migrations/20260917020000_budget_supplementary_reallocation.sql'
const clientPath = 'lib/head-office-budget.ts'
const panelPath = 'app/dashboard/budget-template/BudgetAdjustmentsPanel.tsx'

assert.equal(fs.existsSync(migrationPath), true, 'Supplementary/reallocation migration must exist')
assert.equal(fs.existsSync(clientPath), true, 'Head Office budget client must exist')
assert.equal(fs.existsSync(panelPath), true, 'Budget Adjustments panel must exist')

const sql = fs.readFileSync(migrationPath, 'utf8')
const client = fs.readFileSync(clientPath, 'utf8')
const panel = fs.readFileSync(panelPath, 'utf8')

for (const table of ['budget_supplementary_adjustments', 'budget_reallocations']) {
  assert.match(sql, new RegExp(`create table(?: if not exists)? public\\.${table}`, 'i'), `${table} must be created`)
}

for (const permission of [
  'budget.supplementary.enter',
  'budget.reallocation.request',
  'budget.reallocation.approve',
  'budget.reallocation.execute',
]) {
  assert.match(sql, new RegExp(permission.replaceAll('.', '\\.'), 'i'), `${permission} permission must exist`)
}

for (const rpc of [
  'create_supplementary_adjustment_draft',
  'post_supplementary_adjustment',
  'request_budget_reallocation',
  'approve_budget_reallocation',
  'reject_budget_reallocation',
  'execute_budget_reallocation',
]) {
  assert.match(sql, new RegExp(`create or replace function public\\.${rpc}`, 'i'), `${rpc} RPC must exist`)
  assert.match(client, new RegExp(`rpc\\(['\"]${rpc}['\"]`, 'i'), `${rpc} must be called by the client API`)
}

assert.match(sql, /create(?:\s+or\s+replace)?\s+view\s+public\.v_current_budget_position/i, 'Canonical budget position view must exist')
assert.match(sql, /original_budget/i)
assert.match(sql, /supplementary_adjustments/i)
assert.match(sql, /reallocations_in/i)
assert.match(sql, /reallocations_out/i)
assert.match(sql, /current_approved_budget/i)
assert.match(sql, /outstanding_commitments/i)
assert.match(sql, /actual_expenditure/i)
assert.match(sql, /available_budget/i)
assert.match(sql, /annual_cycle_status\s*=\s*'ACTIVE'/i, 'Position must expose ACTIVE authority state')

assert.match(sql, /njss_current_user_has_role\s*\(\s*'Registrar'\s*\)/i, 'Registrar approval must hard-check Registrar role')
assert.match(sql, /REGISTRAR_REALLOCATION_AUTHORITY/i, 'Registrar authority document type must be validated')
assert.match(sql, /SUPPLEMENTARY_AUTHORITY/i, 'Supplementary authority document type must be validated')
assert.match(sql, /source_available_budget/i, 'Execution must calculate source available budget')
assert.match(sql, /p_amount\s*>\s*v_source_available_budget|v_reallocation\.amount\s*>\s*v_source_available_budget/i, 'Reallocation must be blocked above source available balance')
assert.match(sql, /set search_path = public, auth/i, 'SECURITY DEFINER functions must pin search_path')
assert.match(sql, /enable row level security/i, 'Adjustment tables must use RLS')
assert.match(sql, /revoke\s+(insert|update|delete|all)/i, 'Direct authenticated mutation must be revoked')

for (const fn of [
  'getCurrentBudgetPosition',
  'createSupplementaryAdjustmentDraft',
  'postSupplementaryAdjustment',
  'requestBudgetReallocation',
  'approveBudgetReallocation',
  'rejectBudgetReallocation',
  'executeBudgetReallocation',
]) {
  assert.match(client, new RegExp(`export async function ${fn}\\b`), `${fn} client function must exist`)
}

assert.match(panel, /Original/i)
assert.match(panel, /Supplementary/i)
assert.match(panel, /Reallocation In/i)
assert.match(panel, /Reallocation Out/i)
assert.match(panel, /Current Approved/i)
assert.match(panel, /Commitments/i)
assert.match(panel, /Actual/i)
assert.match(panel, /Available/i)

console.log('Simplified supplementary/reallocation budget contract passed')
