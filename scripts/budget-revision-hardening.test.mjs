import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')

const migration54Path = 'supabase/migrations/054_budget_revision_hardening.sql'
assert.ok(fs.existsSync(migration54Path), 'migration 054 must exist')
const migration54 = read(migration54Path)
const lower = migration54.toLowerCase()

for (const required of [
  'njss_validate_budget_revision_base',
  'njss_create_budget_revision_base',
  'njss_transition_budget_revision_base',
  'Authenticated NJSS user profile is required',
  'budget.revision.edit',
  'fn_current_user_data_scope_allows',
  'source_budget_line_id',
  'CREATE UNIQUE INDEX',
  'DRAFT',
  'RETURNED',
  'budget_monthly_allocations',
  'divisional_budget_lines',
  'REFORECAST',
  'REDUCTION',
  'VIREMENT',
  'RECLASSIFICATION',
  'SUPPLEMENTARY',
  'funding_allocations',
  'chart_of_accounts',
  'expense_ledger',
  'cost_centres',
]) {
  assert.ok(migration54.includes(required), `migration 054 missing ${required}`)
}

// Strict organisational scope must not pass the current/requesting user as an ownership bypass.
assert.match(
  migration54,
  /fn_current_user_data_scope_allows\(\s*v_division\.department_id\s*,\s*v_division\.section_id\s*,\s*NULL\s*,\s*NULL\s*,\s*NULL\s*\)/,
  'revision mutations must enforce strict organisational scope without own-record bypass',
)

// The underlying SECURITY DEFINER implementations are internal after wrapping.
for (const signature of [
  'njss_validate_budget_revision_base(UUID,TEXT)',
  'njss_create_budget_revision_base(UUID,TEXT,TEXT,TEXT,DATE,TEXT,TEXT)',
  'njss_transition_budget_revision_base(UUID,TEXT,TEXT,TEXT)',
]) {
  assert.ok(
    migration54.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, authenticated`) ||
      migration54.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, authenticated`),
    `${signature} must not remain directly executable by authenticated clients`,
  )
}

// Edge-case and financial-control rules must be explicit and user-readable.
for (const message of [
  'effective date must fall within budget year',
  'cannot review or approve their own budget revision',
  'rejection comments/reason are required',
  'exactly one active operational budget allocation',
  'Reforecast can only change monthly phasing',
  'Reduction revision cannot contain positive adjustments',
  'Reduction revision must reduce the authorised budget',
  'Virement/reclassification must include both a decrease and an increase',
  'Only Supplementary Budget may increase the total authorised budget',
  'cannot be reduced below approved funded amount',
  'exact active Chart of Accounts mapping',
  'exact active Financial Cost Centre mapping',
  'active posting Expense / Posting Code mapping',
]) {
  assert.ok(lower.includes(message.toLowerCase()), `migration 054 missing hardening message: ${message}`)
}

// Direct revision-table edits must be guarded independently of browser/API checks.
assert.ok(lower.includes('create trigger trg_budget_revision_line_write_guard'), 'revision line write guard trigger is required')
assert.ok(lower.includes('create trigger trg_budget_revision_monthly_write_guard'), 'revision monthly write guard trigger is required')
assert.match(lower, /revision_status\s+not\s+in\s*\('draft','returned'\)/, 'only DRAFT/RETURNED revisions may be edited directly')

// No ambiguous first-row account fallback may remain usable for new target allocations.
assert.ok(
  lower.includes('count(*)') && lower.includes('chart_of_accounts'),
  'new revision targets must validate an exact Chart of Accounts mapping rather than accepting an arbitrary account',
)

console.log('budget revision Task 7 hardening regression checks passed')
