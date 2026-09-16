import assert from 'node:assert/strict'
import fs from 'node:fs'

const path = 'supabase/migrations/20260917030000_ff3_simplified_budget_control.sql'
assert.ok(fs.existsSync(path), 'Phase 3 FF3 budget-control migration must exist')

const sql = fs.readFileSync(path, 'utf8')
for (const token of [
  'ADD COLUMN IF NOT EXISTS expense_ledger_id uuid',
  'budget_control_status',
  'budget_control_source',
  'budget_available_at_check',
  'budget_shortfall_amount',
  'preview_ff3_budget_control',
  'refresh_ff3_budget_control',
  'INSUFFICIENT_BUDGET_BLOCKED',
  'SIMPLIFIED_ACTIVE',
  'LEGACY_FALLBACK',
  'get_current_budget_position',
  'ff3_commitments',
  'commitment_transactions',
]) {
  assert.ok(sql.includes(token), `migration must contain ${token}`)
}

assert.ok(
  /ALTER TABLE public\.commitment_transactions\s+ALTER COLUMN budget_allocation_id DROP NOT NULL/i.test(sql),
  'simplified commitments must not require a legacy budget allocation',
)

for (const destructive of [
  'DROP TABLE public.ff3_headers',
  'DROP TABLE public.ff3_commitments',
  'DROP TABLE public.commitment_transactions',
  'TRUNCATE public.ff3_headers',
]) {
  assert.ok(!sql.includes(destructive), `migration must not contain destructive DDL: ${destructive}`)
}

console.log('FF3 budget-control migration contract: ok')
