import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrationPath = 'supabase/migrations/20260917030000_ff3_simplified_budget_integration.sql'
assert.ok(fs.existsSync(migrationPath), 'Phase 3 FF3 simplified-budget integration migration must exist')

const sql = fs.readFileSync(migrationPath, 'utf8')

for (const needle of [
  'CREATE OR REPLACE FUNCTION public.njss_transition_ff3',
  'njss_transition_ff3_legacy',
  "'COMMIT'",
  "'ff3.approve'",
  'v_ff3.expense_ledger_id IS NULL',
  'v_ff3.expense_ledger_id IS NOT NULL',
  "'INSUFFICIENT_BUDGET_BLOCKED'",
  "'SUFFICIENT'",
  "v_next_status := 'SUBMITTED'",
  "v_next_status := 'ENDORSED_SUPERVISOR'",
  "v_next_status := 'ENDORSED_SECTION_HEAD'",
  "status = 'APPROVED'",
  "status = 'COMMITTED'",
  'Duplicate original commitment blocked',
  'FOR UPDATE',
  'njss_evaluate_ff3_budget',
  'njss_commit_simplified_ff3',
  'njss_resolve_simplified_ff3_allocation',
  'INSERT INTO public.ff3_commitments',
  'INSERT INTO public.commitment_transactions',
  'managerial_approval_recorded',
]) {
  assert.ok(sql.includes(needle), `FF3 transition migration must contain ${needle}`)
}

const transitionStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.njss_transition_ff3')
assert.ok(transitionStart >= 0, 'transition function must exist')
const transitionSql = sql.slice(transitionStart)

// The simplified SUBMIT path must not carry the legacy hard-stop message.
const submitStart = transitionSql.indexOf("IF p_action = 'SUBMIT' THEN")
const supervisorStart = transitionSql.indexOf("ELSIF p_action = 'ENDORSE_SUPERVISOR' THEN")
assert.ok(submitStart >= 0 && supervisorStart > submitStart, 'simplified SUBMIT branch must exist')
const simplifiedSubmit = transitionSql.slice(submitStart, supervisorStart)
assert.ok(!simplifiedSubmit.includes('Insufficient Available Budget'), 'simplified SUBMIT must not reject managerial workflow for insufficient budget')

// Financial commitment is delegated to an atomic helper only after managerial approval.
const approveStart = transitionSql.indexOf("ELSIF p_action = 'APPROVE' THEN")
const commitStart = transitionSql.indexOf("ELSIF p_action = 'COMMIT' THEN")
assert.ok(approveStart >= 0 && commitStart > approveStart, 'APPROVE and COMMIT branches must exist')
assert.ok(transitionSql.slice(approveStart, commitStart).includes('njss_commit_simplified_ff3'), 'APPROVE must use the atomic simplified commitment helper')
assert.ok(transitionSql.slice(commitStart).includes('njss_commit_simplified_ff3'), 'COMMIT must re-use the atomic commitment helper')

// No privileged role bypass is allowed for the simplified budget ceiling.
for (const bypass of [
  "njss_current_user_has_role('System Administrator')",
  'override_budget',
  'budget_override',
]) {
  assert.ok(!transitionSql.includes(bypass), `simplified FF3 transition must not contain budget override bypass: ${bypass}`)
}

console.log('FF3 simplified-budget transition contract: ok')
