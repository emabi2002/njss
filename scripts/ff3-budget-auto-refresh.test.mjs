import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrationPath = 'supabase/migrations/20260917032000_ff3_budget_state_auto_refresh.sql'
assert.ok(fs.existsSync(migrationPath), 'FF3 budget auto-refresh migration must exist')

const sql = fs.readFileSync(migrationPath, 'utf8')

for (const needle of [
  'CREATE OR REPLACE FUNCTION public.njss_refresh_pending_ff3_for_budget_key',
  "status IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD')",
  'public.njss_refresh_ff3_budget_state',
  'CREATE OR REPLACE FUNCTION public.njss_ff3_refresh_after_supplementary',
  'CREATE OR REPLACE FUNCTION public.njss_ff3_refresh_after_reallocation',
  'trg_ff3_refresh_after_supplementary',
  'trg_ff3_refresh_after_reallocation',
  "NEW.status = 'POSTED'",
  "NEW.status = 'EXECUTED'",
  'NEW.source_section_id',
  'NEW.destination_section_id',
  'NEW.source_expense_ledger_id',
  'NEW.destination_expense_ledger_id',
]) {
  assert.ok(sql.includes(needle), `auto-refresh migration must contain ${needle}`)
}

for (const forbidden of [
  "SET status = 'SUBMITTED'",
  "SET status = 'ENDORSED_SUPERVISOR'",
  "SET status = 'ENDORSED_SECTION_HEAD'",
  "SET status = 'APPROVED'",
  "INSERT INTO public.ff3_commitments",
]) {
  assert.ok(!sql.includes(forbidden), `auto-refresh migration must not mutate workflow/commitments: ${forbidden}`)
}

console.log('FF3 budget auto-refresh contract: ok')
