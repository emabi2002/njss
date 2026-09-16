import assert from 'node:assert/strict'
import fs from 'node:fs'

const path = 'supabase/migrations/20260917021000_simplified_budget_event_dimensions_hardening.sql'
assert.ok(fs.existsSync(path), 'event-dimension hardening migration must exist')
const sql = fs.readFileSync(path, 'utf8')

for (const needle of [
  'CREATE OR REPLACE FUNCTION public.get_current_budget_position',
  'event_dimensions',
  'UNION',
  'public.budget_supplementary_adjustments',
  "sa.status = 'POSTED'",
  'public.budget_reallocations',
  "br.status = 'EXECUTED'",
  'br.source_division_budget_id',
  'br.destination_division_budget_id',
  'COALESCE(o.original_amount, 0)',
  'CREATE OR REPLACE FUNCTION public.create_budget_supplementary_draft',
  'CREATE OR REPLACE FUNCTION public.request_budget_reallocation',
  'CREATE OR REPLACE FUNCTION public.execute_budget_reallocation',
  "el.is_active = true",
  "el.is_posting = true",
  'FROM public.division_budgets db',
  'FOR UPDATE OF db',
]) {
  assert.ok(sql.includes(needle), `event-dimension hardening must contain ${needle}`)
}

// A destination or positive supplementary target must not require an original zero-value line.
const requestStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.request_budget_reallocation')
const requestEnd = sql.indexOf('CREATE OR REPLACE FUNCTION public.approve_budget_reallocation', requestStart)
const requestBody = sql.slice(requestStart, requestEnd > requestStart ? requestEnd : undefined)
assert.ok(!/destination.*division_budget_lines/is.test(requestBody), 'reallocation destination must not require an original budget line')

const supplementaryStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.create_budget_supplementary_draft')
const supplementaryEnd = sql.indexOf('CREATE OR REPLACE FUNCTION public.update_budget_supplementary_draft', supplementaryStart)
const supplementaryBody = sql.slice(supplementaryStart, supplementaryEnd > supplementaryStart ? supplementaryEnd : undefined)
assert.ok(!/Selected budget line does not exist in the approved original budget/.test(supplementaryBody), 'supplementary target must permit a valid event-only budget key')

console.log('simplified budget event-only dimension contract: ok')
