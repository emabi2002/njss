import assert from 'node:assert/strict'
import fs from 'node:fs'

const basePath = 'supabase/migrations/20260917210000_ff3_simplified_budget_integration.sql'
const gatePath = 'supabase/migrations/20260917211000_ff3_approval_commitment_gate.sql'
assert.ok(fs.existsSync(basePath), 'Phase 3 FF3 simplified-budget integration migration must exist')
assert.ok(fs.existsSync(gatePath), 'Phase 3 approval/commitment hardening migration must exist')

const base = fs.readFileSync(basePath, 'utf8')
const gate = fs.readFileSync(gatePath, 'utf8')
const sql = `${base}\n${gate}`

for (const needle of [
  'CREATE OR REPLACE FUNCTION public.njss_transition_ff3',
  'njss_transition_ff3_legacy',
  "'ff3.approve'",
  'v_ff3.expense_ledger_id IS NULL',
  "'INSUFFICIENT_BUDGET_BLOCKED'",
  "'POSTING_MAPPING_REQUIRED'",
  "v_next_status := 'SUBMITTED'",
  "v_next_status := 'ENDORSED_SUPERVISOR'",
  "v_next_status := 'ENDORSED_SECTION_HEAD'",
  "status = 'APPROVED'",
  "status = 'COMMITTED'",
  'Duplicate original commitment blocked',
  'FOR UPDATE OF db',
  'njss_evaluate_ff3_budget',
  'njss_commit_simplified_ff3',
  'njss_resolve_simplified_ff3_allocation',
  'INSERT INTO public.ff3_commitments',
  'INSERT INTO public.commitment_transactions',
]) {
  assert.ok(sql.includes(needle), `FF3 transition migrations must contain ${needle}`)
}

// The final effective workflow intentionally does not expose a second COMMIT action.
const finalTransitionStart = gate.indexOf('CREATE OR REPLACE FUNCTION public.njss_transition_ff3')
assert.ok(finalTransitionStart >= 0, 'hardening migration must replace the FF3 transition function')
const finalTransition = gate.slice(finalTransitionStart)
assert.ok(!finalTransition.includes("p_action = 'COMMIT'"), 'final workflow must not require a second COMMIT action')
assert.ok(!finalTransition.includes("'APPROVE','COMMIT'"), 'final workflow must keep APPROVE as the financial commitment gate')

const submitStart = finalTransition.indexOf("IF p_action = 'SUBMIT' THEN")
const supervisorStart = finalTransition.indexOf("ELSIF p_action = 'ENDORSE_SUPERVISOR' THEN")
assert.ok(submitStart >= 0 && supervisorStart > submitStart, 'simplified SUBMIT branch must exist')
const simplifiedSubmit = finalTransition.slice(submitStart, supervisorStart)
assert.ok(!simplifiedSubmit.includes('Insufficient Available Budget'), 'simplified SUBMIT must not reject managerial workflow for insufficient budget')

const approveStart = finalTransition.indexOf("ELSIF p_action = 'APPROVE' THEN")
assert.ok(approveStart >= 0, 'APPROVE branch must exist')
const approveSql = finalTransition.slice(approveStart)
assert.ok(approveSql.includes('FOR UPDATE OF db'), 'APPROVE must serialize on the active Division budget before final recheck')
assert.ok(approveSql.includes('njss_evaluate_ff3_budget'), 'APPROVE must recheck the authoritative simplified budget')
assert.ok(approveSql.includes("v_budget_status <> 'SUFFICIENT'"), 'APPROVE must refuse commitment unless budget state is sufficient')
assert.ok(approveSql.includes('njss_commit_simplified_ff3'), 'APPROVE must use the atomic simplified commitment helper')

for (const bypass of [
  "njss_current_user_has_role('System Administrator')",
  'override_budget',
  'budget_override',
]) {
  assert.ok(!finalTransition.includes(bypass), `simplified FF3 transition must not contain budget override bypass: ${bypass}`)
}

console.log('FF3 simplified-budget transition contract: ok')