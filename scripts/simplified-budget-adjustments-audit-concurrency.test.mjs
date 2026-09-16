import assert from 'node:assert/strict'
import fs from 'node:fs'

const path = 'supabase/migrations/20260917023000_simplified_budget_adjustments_audit_concurrency.sql'
assert.ok(fs.existsSync(path), 'audit/concurrency hardening migration must exist')
const sql = fs.readFileSync(path, 'utf8')

for (const needle of [
  'CREATE OR REPLACE FUNCTION public.njss_next_supplementary_number',
  'CREATE OR REPLACE FUNCTION public.njss_next_reallocation_number',
  'pg_advisory_xact_lock',
  'CREATE OR REPLACE FUNCTION public.request_budget_reallocation',
  'public.fn_current_app_user_id()',
  'public.users',
  'department_id',
  'Requester Division does not match the authenticated user',
]) {
  assert.ok(sql.includes(needle), `audit/concurrency hardening must contain ${needle}`)
}

console.log('simplified budget audit/concurrency contract: ok')
