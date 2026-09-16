import assert from 'node:assert/strict'
import fs from 'node:fs'

const path = 'supabase/migrations/20260917030000_ff3_simplified_budget_control.sql'
assert.ok(fs.existsSync(path), 'Phase 3 FF3 budget-control migration must exist')
const sql = fs.readFileSync(path, 'utf8')

for (const token of [
  'CREATE OR REPLACE FUNCTION public.njss_transition_ff3',
  "p_action IN ('SUBMIT','ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD')",
  'refresh_ff3_budget_control',
  'pg_advisory_xact_lock',
  'INSUFFICIENT BUDGET - COMMITMENT BLOCKED',
  "v_control_source = 'SIMPLIFIED_ACTIVE'",
  "v_control_source = 'LEGACY_FALLBACK'",
  'expense_ledger_id',
  'COMMITMENT_CREATED',
]) {
  assert.ok(sql.includes(token), `workflow migration must contain ${token}`)
}

assert.ok(
  sql.includes("v_control_status = 'INSUFFICIENT_BUDGET_BLOCKED'"),
  'final approval must explicitly recognize the blocked state',
)
assert.ok(
  sql.includes("v_next_status := 'SUBMITTED'"),
  'blocked simplified FF3 must still be able to enter managerial review',
)

console.log('FF3 workflow blocking contract: ok')
