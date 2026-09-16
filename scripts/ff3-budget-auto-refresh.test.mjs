import assert from 'node:assert/strict'
import fs from 'node:fs'

const path = 'supabase/migrations/20260917030000_ff3_simplified_budget_control.sql'
assert.ok(fs.existsSync(path), 'Phase 3 FF3 budget-control migration must exist')
const sql = fs.readFileSync(path, 'utf8')

for (const token of [
  'refresh_pending_ff3_budget_control_for_key',
  'budget_supplementary_adjustments',
  'budget_reallocations',
  "status IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD')",
  'trg_refresh_ff3_after_supplementary',
  'trg_refresh_ff3_after_reallocation',
]) assert.ok(sql.includes(token), `automatic refresh migration must contain ${token}`)

assert.ok(
  sql.includes('fc.expense_ledger_id = d.ledger_id'),
  'authoritative budget position must count direct simplified commitments by ledger',
)
assert.ok(
  sql.includes('fc.budget_allocation_id IS NULL') || sql.includes('fc.expense_ledger_id IS NOT NULL'),
  'direct simplified commitment path must not depend on a legacy allocation',
)

console.log('FF3 automatic budget refresh and direct commitment accounting contract: ok')
