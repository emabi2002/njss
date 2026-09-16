import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrationPath = 'supabase/migrations/20260917020000_simplified_budget_adjustments_reallocations.sql'
assert.ok(fs.existsSync(migrationPath), 'simplified budget adjustments migration must exist')

const sql = fs.readFileSync(migrationPath, 'utf8')
const required = [
  'CREATE TABLE IF NOT EXISTS public.budget_supplementary_adjustments',
  'CREATE TABLE IF NOT EXISTS public.budget_reallocations',
  "'budget.supplementary.enter'",
  "'budget.reallocation.request'",
  "'budget.reallocation.approve'",
  "'budget.reallocation.execute'",
  'create_budget_supplementary_draft',
  'update_budget_supplementary_draft',
  'post_budget_supplementary_adjustment',
  'request_budget_reallocation',
  'approve_budget_reallocation',
  'reject_budget_reallocation',
  'execute_budget_reallocation',
  'get_current_budget_position',
  "njss_current_user_has_role('Registrar')",
  "document_type = 'SUPPLEMENTARY_AUTHORITY'",
  "document_type = 'REGISTRAR_REALLOCATION_AUTHORITY'",
  "status = 'ACTIVE'",
  'FOR UPDATE',
  'available_budget',
  'SECURITY DEFINER',
  'SET search_path = public, auth',
]
for (const needle of required) {
  assert.ok(sql.includes(needle), `migration must contain ${needle}`)
}

for (const destructive of [
  'DROP TABLE public.budget_allocations',
  'DROP TABLE public.ff3_headers',
  'DROP TABLE public.ff4_headers',
  'TRUNCATE public.budget_allocations',
]) {
  assert.ok(!sql.includes(destructive), `migration must not contain destructive legacy DDL: ${destructive}`)
}

const hardeningPath = 'supabase/migrations/20260917023000_simplified_budget_adjustments_audit_concurrency.sql'
assert.ok(fs.existsSync(hardeningPath), 'audit/concurrency hardening migration must exist')
const hardening = fs.readFileSync(hardeningPath, 'utf8')
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
  assert.ok(hardening.includes(needle), `audit/concurrency hardening must contain ${needle}`)
}

console.log('simplified budget adjustments contract: ok')
