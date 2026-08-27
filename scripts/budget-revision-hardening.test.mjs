import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')

const migration54Path = 'supabase/migrations/054_budget_revision_hardening.sql'
assert.ok(fs.existsSync(migration54Path), 'migration 054 must exist')
const migration54 = read(migration54Path)
const lower = migration54.toLowerCase()
const budgetPage = read('app/dashboard/budget-template/page.tsx')

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
  'divisional_budget_submissions',
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

// Approved operating model: Registrar alone initiates; Line Supervisor prepares/submits;
// Registrar then approves/returns/rejects. There is no mandatory separate REVIEW action.
assert.ok(lower.includes("r.name = 'registrar'"), 'Registrar role must be checked explicitly for revision initiation/approval')
assert.ok(lower.includes("r.name = 'line supervisor'"), 'Line Supervisor role must be checked explicitly for revision preparation/submission')
assert.ok(lower.includes("'registrar', 'budget.revision.create', true"), 'Registrar must receive budget.revision.create')
assert.match(
  lower,
  /\('line supervisor',\s*'budget\.revision\.create',\s*false\)/,
  'legacy Line Supervisor revision-create permission must be disabled',
)
assert.ok(lower.includes('set is_allowed = excluded.is_allowed'), 'role permission correction must overwrite legacy grants')
assert.ok(lower.includes('only the registrar can initiate a budget revision'), 'database must reject non-Registrar revision initiation')
assert.ok(lower.includes('only the line supervisor can submit a budget revision'), 'database must reject non-Line-Supervisor revision submission')
assert.ok(lower.includes('only the registrar can approve, return or reject a budget revision'), 'Registrar must own final revision disposition')
assert.ok(lower.includes("v_action='approve' and v_revision.status not in ('submitted','resubmitted')"), 'Registrar approval must be allowed directly after Line Supervisor submission/resubmission')
assert.ok(!lower.includes('requester cannot review or approve their own budget revision'), 'Registrar requester must be allowed to approve the Line Supervisor-prepared revision')

assert.ok(!budgetPage.includes('Review Revision'), 'revision UI must not force a separate Registrar Review step')
assert.match(
  budgetPage,
  /\["SUBMITTED",\s*"RESUBMITTED"\]\.includes\(revision\.status\).*canRevisionApprove/s,
  'revision UI must offer Registrar approval directly from SUBMITTED/RESUBMITTED',
)

// Direct revision-table edits must be guarded independently of browser/API checks.
assert.ok(lower.includes('create trigger trg_budget_revision_line_write_guard'), 'revision line write guard trigger is required')
assert.ok(lower.includes('create trigger trg_budget_revision_monthly_write_guard'), 'revision monthly write guard trigger is required')
assert.ok(lower.includes('create trigger trg_budget_revision_submission_write_guard'), 'revision submission write guard trigger is required')
assert.match(lower, /revision_status\s+not\s+in\s*\('draft','returned'\)/, 'only DRAFT/RETURNED revisions may be edited directly')

// The ordinary initial-budget transition path must not be able to transition a revision version.
assert.ok(lower.includes("current_setting('njss.budget_revision_workflow', true)"), 'revision status changes need a dedicated transaction-local workflow flag')
assert.ok(lower.includes("set_config('njss.budget_revision_workflow', 'on', true)"), 'only the hardened revision transition wrapper should set the dedicated flag')
assert.ok(lower.includes('budget revision status can only be changed through the dedicated budget revision workflow'), 'generic budget workflow status changes must be blocked for revision submissions')
assert.ok(lower.includes('transition_divisional_budget_submission'), 'migration must document the initial-budget RPC bypass being guarded')

// No ambiguous first-row account fallback may remain usable for new target allocations.
assert.ok(
  lower.includes('count(*)') && lower.includes('chart_of_accounts'),
  'new revision targets must validate an exact Chart of Accounts mapping rather than accepting an arbitrary account',
)

console.log('budget revision Task 7 hardening regression checks passed')