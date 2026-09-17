import assert from 'node:assert/strict'
import fs from 'node:fs'

const path = 'supabase/migrations/20260917212000_ff3_budget_scope_notification_hardening.sql'
assert.ok(fs.existsSync(path), 'FF3 budget scope hardening migration must exist')
const sql = fs.readFileSync(path, 'utf8')

for (const needle of [
  'CREATE OR REPLACE FUNCTION public.check_head_office_ff3_budget',
  'fn_current_user_data_scope_allows',
  'Selected Division / Section is outside the current user organisational scope',
  'CREATE OR REPLACE FUNCTION public.njss_notify_ff3_budget_block',
  'u.department_id = v_ff3.department_id',
  "rp.permission IN ('ff3.endorse', 'ff3.approve')",
  "REVOKE EXECUTE ON FUNCTION public.njss_notify_ff3_budget_block",
]) {
  assert.ok(sql.includes(needle), `scope hardening must contain ${needle}`)
}

assert.ok(!sql.includes("OR rp.permission = 'ff3.approve'"), 'budget-block notices must not broadcast to approvers outside the FF3 Division')

console.log('FF3 budget scope and notification hardening contract: ok')
