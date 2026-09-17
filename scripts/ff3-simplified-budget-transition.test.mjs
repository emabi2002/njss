import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrationPath = 'supabase/migrations/20260917030000_ff3_simplified_budget_integration.sql'
assert.ok(fs.existsSync(migrationPath), 'Phase 3 FF3 simplified-budget integration migration must exist')

const sql = fs.readFileSync(migrationPath, 'utf8')

for (const needle of [
  'CREATE OR REPLACE FUNCTION public.njss_transition_ff3',
  "'COMMIT'",
  "WHEN p_action = 'COMMIT' THEN 'ff3.approve'",
  "v_ff3.expense_ledger_id IS NULL",
  "v_ff3.status = 'APPROVED'",
  "budget_control_status = 'INSUFFICIENT_BUDGET_BLOCKED'",
  "budget_control_status = 'SUFFICIENT'",
  "v_next_status := 'SUBMITTED'",
  "v_next_status := 'ENDORSED_SUPERVISOR'",
  "v_next_status := 'ENDORSED_SECTION_HEAD'",
  "status = 'APPROVED'",
  "status = 'COMMITTED'",
  'Duplicate original commitment blocked',
  'FOR UPDATE',
  'njss_evaluate_ff3_budget',
  'njss_resolve_simplified_ff3_allocation',
  'INSERT INTO ff3_commitments',
  'INSERT INTO commitment_transactions',
]) {
  assert.ok(sql.includes(needle), `FF3 transition migration must contain ${needle}`)
}

// The simplified branch must not hard-stop managerial SUBMIT solely because the request exceeds budget.
const transitionStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.njss_transition_ff3')
assert.ok(transitionStart >= 0, 'transition function must exist')
const transitionSql = sql.slice(transitionStart)
const simplifiedMarker = transitionSql.indexOf('v_ff3.expense_ledger_id IS NOT NULL')
assert.ok(simplifiedMarker >= 0, 'transition must contain an explicit simplified-budget branch')

// No privileged role bypass is allowed for the simplified budget ceiling.
for (const bypass of [
  "fn_current_user_has_permission('all') AND v_request >",
  "njss_current_user_has_role('System Administrator')",
  'override_budget',
]) {
  assert.ok(!transitionSql.includes(bypass), `simplified FF3 transition must not contain budget override bypass: ${bypass}`)
}

console.log('FF3 simplified-budget transition contract: ok')
