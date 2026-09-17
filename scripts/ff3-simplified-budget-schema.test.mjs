import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrationPath = 'supabase/migrations/20260917030000_ff3_simplified_budget_integration.sql'
assert.ok(fs.existsSync(migrationPath), 'Phase 3 FF3 simplified-budget integration migration must exist')

const sql = fs.readFileSync(migrationPath, 'utf8')

for (const needle of [
  'ALTER TABLE public.ff3_headers',
  'expense_ledger_id',
  'budget_control_status',
  'budget_current_approved_snapshot',
  'budget_available_snapshot',
  'budget_shortfall',
  'budget_checked_at',
  "'NOT_CHECKED'",
  "'SUFFICIENT'",
  "'INSUFFICIENT_BUDGET_BLOCKED'",
  "'NO_ACTIVE_BUDGET'",
  "'POSTING_MAPPING_REQUIRED'",
  'get_current_budget_position',
  'finance_posting_mappings',
  'njss_evaluate_ff3_budget',
  'njss_refresh_ff3_budget_states',
  "source_module = 'HEAD_OFFICE_SIMPLIFIED'",
  'SECURITY DEFINER',
  "SET search_path = public, pg_temp",
]) {
  assert.ok(sql.includes(needle), `Phase 3 migration must contain ${needle}`)
}

for (const destructive of [
  'DROP TABLE public.ff3_headers',
  'DROP TABLE public.ff3_commitments',
  'DROP TABLE public.ff4_headers',
  'TRUNCATE public.ff3_headers',
  'TRUNCATE public.ff3_commitments',
  'DELETE FROM public.ff3_headers',
  'DELETE FROM public.ff3_commitments',
]) {
  assert.ok(!sql.includes(destructive), `Phase 3 migration must not contain destructive legacy change: ${destructive}`)
}

console.log('FF3 simplified-budget schema contract: ok')
