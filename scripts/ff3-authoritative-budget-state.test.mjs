import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrationPath = 'supabase/migrations/20260917030000_ff3_authoritative_budget_state.sql'
assert.ok(fs.existsSync(migrationPath), 'FF3 authoritative budget state migration must exist')

const sql = fs.readFileSync(migrationPath, 'utf8')

for (const needle of [
  'ALTER TABLE public.ff3_headers',
  'budget_control_status',
  'budget_control_source',
  'budget_available_snapshot',
  'budget_current_approved_snapshot',
  'budget_shortfall_amount',
  'budget_checked_at',
  'expense_ledger_id',
  "'INSUFFICIENT_BUDGET_BLOCKED'",
  "'MAPPING_REQUIRED'",
  "'SIMPLIFIED'",
  "'LEGACY'",
  'CREATE OR REPLACE FUNCTION public.check_ff3_budget_availability',
  'CREATE OR REPLACE FUNCTION public.njss_refresh_ff3_budget_state',
  'get_current_budget_position',
  "c.status = 'ACTIVE'",
  'public.njss_budget_position_for_allocation',
  'released_amount',
  'current_approved_budget',
  'available_budget',
  'shortfall',
  'within_budget',
  'SECURITY DEFINER',
  'SET search_path = public, auth, pg_temp',
]) {
  assert.ok(sql.includes(needle), `migration must contain ${needle}`)
}

assert.ok(
  sql.includes("CASE WHEN v_has_simplified_cycle THEN 'SIMPLIFIED' ELSE 'LEGACY' END"),
  'simplified budget source must be selected only when an active simplified cycle exists',
)
assert.ok(
  sql.includes("'LEGACY'"),
  'legacy budget source must remain available before simplified activation',
)
assert.ok(
  sql.includes('v_legacy_position := public.njss_budget_position_for_allocation(v_budget_allocation_id)'),
  'legacy fallback must reuse the existing production budget-position helper until simplified activation',
)

for (const destructive of [
  'DROP TABLE public.budget_allocations',
  'DROP TABLE public.ff3_commitments',
  'DROP TABLE public.ff4_headers',
  'TRUNCATE public.ff3_headers',
]) {
  assert.ok(!sql.includes(destructive), `migration must not contain destructive DDL: ${destructive}`)
}

console.log('FF3 authoritative budget state contract: ok')
