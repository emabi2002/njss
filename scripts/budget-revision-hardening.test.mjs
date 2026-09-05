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

// UI must be role-aware as well as permission-aware, so technical `all` access
// does not expose business workflow buttons to System Administrator.
assert.match(budgetPage, /const \{ profile, roles, can \} = useAuth\(\)/, 'budget page must load current roles')
assert.ok(budgetPage.includes('const isRegistrar = roles.includes("Registrar")'), 'budget page must identify Registrar role explicitly')
assert.ok(budgetPage.includes('const isLineSupervisor = roles.includes("Line Supervisor")'), 'budget page must identify Line Supervisor role explicitly')
assert.match(budgetPage, /const canRevisionCreate = isRegistrar && can\("budget\.revision\.create"\)/, 'only Registrar UI may initiate revision')
assert.match(budgetPage, /const canRevisionEdit = isLineSupervisor && can\("budget\.revision\.edit"\)/, 'only Line Supervisor UI may edit revision')
assert.match(budgetPage, /const canRevisionSubmit = isLineSupervisor && can\("budget\.revision\.submit"\)/, 'only Line Supervisor UI may submit revision')
assert.match(budgetPage, /const canRevisionApprove = isRegistrar && can\("budget\.revision\.approve"\)/, 'only Registrar UI may approve revision')
assert.match(budgetPage, /const canRevisionReturn = isRegistrar && can\("budget\.revision\.return"\)/, 'only Registrar UI may return revision')
assert.match(budgetPage, /const canRevisionReject = isRegistrar && can\("budget\.revision\.reject"\)/, 'only Registrar UI may reject revision')

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

// Existing operational allocations repointed from an activated baseline line to
// an approved revision line must also transition lineage. Leaving source_module
// as EXCEL_BUDGET makes the operational-allocation guard treat the revision line
// as an activation baseline and blocks Registrar approval.
const lineageHotfixPath = 'supabase/hotfixes/20260905150000_budget_revision_allocation_lineage.sql'
assert.ok(fs.existsSync(lineageHotfixPath), 'budget revision allocation-lineage hotfix must exist')
const lineageHotfix = read(lineageHotfixPath).toLowerCase()
assert.ok(lineageHotfix.includes('create or replace function public.njss_transition_budget_revision_base'), 'lineage hotfix must patch the internal revision transition worker')
assert.match(
  lineageHotfix,
  /update\s+budget_allocations[\s\S]*?source_module\s*=\s*'budget_revision'[\s\S]*?source_budget_submission_id\s*=\s*v_revision\.revision_submission_id[\s\S]*?source_budget_line_id\s*=\s*v_line\.revision_budget_line_id/i,
  'existing revised allocations must switch to BUDGET_REVISION lineage when repointed',
)
// The hotfix verifies the live trigger definition from inside a SQL string, so
// quote characters appear doubled in source. Match the actual escaped preflight
// representation rather than requiring an unescaped trigger expression.
assert.match(
  lineageHotfix,
  /position\('old\.source_module=''excel_budget'''\s+in\s+v_guard\)/i,
  'hotfix must guard the activated EXCEL_BUDGET baseline transition',
)
assert.match(
  lineageHotfix,
  /position\('new\.source_module is distinct from ''excel_budget'''\s+in\s+v_guard\)/i,
  'hotfix evidence must align with the operational allocation guard non-EXCEL_BUDGET path',
)

console.log('budget revision Task 7 hardening regression checks passed')