import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrationPath = 'supabase/migrations/20260917031000_ff3_blocked_managerial_workflow.sql'
assert.ok(fs.existsSync(migrationPath), 'FF3 blocked managerial workflow migration must exist')

const sql = fs.readFileSync(migrationPath, 'utf8')

for (const needle of [
  'CREATE OR REPLACE FUNCTION public.njss_transition_ff3',
  'public.njss_refresh_ff3_budget_state',
  "p_action = 'SUBMIT'",
  "v_next_status := 'SUBMITTED'",
  "'INSUFFICIENT_BUDGET_BLOCKED'",
  "p_action = 'ENDORSE_SUPERVISOR'",
  "p_action = 'ENDORSE_SECTION_HEAD'",
  "p_action = 'APPROVE'",
  'FOR UPDATE',
  'Duplicate original commitment blocked',
  'fn_check_segregation_of_duties',
  'INSERT INTO public.ff3_commitments',
  'INSERT INTO public.commitment_transactions',
  "budget_control_status = 'SUFFICIENT'",
  'budget_allocation_id IS NULL',
]) {
  assert.ok(sql.includes(needle), `managerial workflow migration must contain ${needle}`)
}

assert.ok(
  !sql.includes("RAISE EXCEPTION 'Insufficient Available Budget. Available:"),
  'SUBMIT must not hard-stop managerial review merely because available budget is insufficient',
)
assert.ok(
  sql.includes("IF v_budget_state->>'budget_control_status' = 'INSUFFICIENT_BUDGET_BLOCKED' THEN"),
  'final approval must explicitly stop commitment while the refreshed FF3 remains budget-blocked',
)
assert.ok(
  sql.includes("RAISE EXCEPTION 'FF3 commitment blocked by insufficient budget."),
  'final approval must return a clear commitment-blocked error',
)
assert.ok(
  sql.includes("IF v_budget_state->>'budget_control_status' <> 'SUFFICIENT' THEN"),
  'commitment creation must require a freshly sufficient budget state',
)
assert.ok(
  sql.includes("SELECT id INTO v_serialization_id") && sql.includes('FROM public.division_budgets'),
  'simplified final approval must serialize on the matching Division budget before commitment',
)
assert.ok(
  sql.includes('SELECT * INTO v_budget FROM public.budget_allocations') && sql.includes('FOR UPDATE'),
  'legacy commitment routing must remain locked during final approval',
)

const commitmentInsert = sql.indexOf('INSERT INTO public.ff3_commitments')
const sufficientGuard = sql.lastIndexOf("IF v_budget_state->>'budget_control_status' <> 'SUFFICIENT' THEN", commitmentInsert)
assert.ok(commitmentInsert > 0 && sufficientGuard >= 0 && sufficientGuard < commitmentInsert,
  'the sufficient-budget guard must occur before commitment insertion')

for (const destructive of [
  'DROP TABLE public.ff3_headers',
  'DROP TABLE public.ff3_commitments',
  'TRUNCATE public.ff3_headers',
  'TRUNCATE public.ff3_commitments',
]) {
  assert.ok(!sql.includes(destructive), `managerial workflow migration must not contain destructive DDL: ${destructive}`)
}

console.log('FF3 blocked managerial workflow contract: ok')
