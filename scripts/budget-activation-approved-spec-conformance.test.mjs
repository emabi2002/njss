import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')
const migration061 = 'supabase/migrations/061_explicit_finance_posting_mapping_and_cost_centre_fk.sql'
const migration062 = 'supabase/migrations/062_budget_activation_fingerprint_and_immutable_snapshot.sql'
const migration0625 = 'supabase/migrations/0625_budget_activation_queue_view_reset.sql'
const migration063 = 'supabase/migrations/063_budget_activation_fk_only_guards.sql'

for (const path of [migration061, migration062, migration0625, migration063]) {
  assert.ok(fs.existsSync(path), `missing ${path}`)
}

const m61 = read(migration061)
const m62 = read(migration062)
const m625 = read(migration0625)
const m63 = read(migration063)

for (const token of [
  'finance_posting_mappings',
  'budget_divisions',
  'cost_centre_id',
  'njss_resolve_finance_posting_mapping',
  'njss_upsert_finance_posting_mapping',
  'njss_deactivate_finance_posting_mapping',
  'v_finance_posting_mapping_admin',
  'budget.activation.report',
]) assert.ok(m61.includes(token), `migration 061 missing ${token}`)

// Deployed NJSS user identity schema is full_name + email.
for (const [name, sql] of [['061', m61], ['062', m62], ['063', m63]]) {
  assert.doesNotMatch(
    sql,
    /\b(?:u|creator|updater|approver|prep|auth)\.(?:first_name|last_name)\b/i,
    `migration ${name} must not reference nonexistent users.first_name/last_name columns`,
  )
}
assert.match(m61, /\b(?:u|creator|updater)\.full_name\b/i, 'migration 061 must use users.full_name')
assert.match(m62, /\bu\.full_name\b/i, 'migration 062 must use users.full_name')
assert.match(m63, /\b(?:prep|auth)\.full_name\b/i, 'migration 063 must use users.full_name for UUID-backed activation actors')

// reviewed_by / approved_by are deployed as text audit labels; UUID workflow
// actor fields remain submitted_by / rejected_by.
assert.match(m61, /reviewed_by\s*=\s*CASE[\s\S]*v_actor_label/i, 'REVIEW must store the actor label in reviewed_by')
assert.match(m61, /approved_by\s*=\s*CASE[\s\S]*v_actor_label/i, 'APPROVE must store the actor label in approved_by')
assert.match(m61, /submitted_by\s*=\s*CASE[\s\S]*v_user_id/i, 'SUBMIT must continue using the UUID actor')
assert.match(m61, /rejected_by\s*=\s*CASE[\s\S]*v_user_id/i, 'REJECT must continue using the UUID actor')
assert.doesNotMatch(
  m63,
  /JOIN\s+public\.users\s+approver\s+ON\s+approver\.id\s*=\s*s\.approved_by/i,
  'approved_by is VARCHAR and must never be joined to users.id as a UUID',
)
assert.match(m63, /s\.approved_by\s+AS\s+approved_by_name/i, 'queue must preserve the deployed approved_by audit label')

for (const token of [
  'validation_fingerprint',
  'prepared_against_submission_updated_at',
  'finance_posting_mapping_id',
  'budget_activation_line_snapshots',
  'budget_allocation_id',
  'njss_budget_activation_fingerprint',
  'VALIDATION_FAILED',
]) assert.ok(m62.includes(token), `migration 062 missing ${token}`)

assert.match(m62, /extensions\.digest\s*\(/i, 'Supabase pgcrypto digest must be schema-qualified')
assert.doesNotMatch(m62, /(?<!extensions\.)\bdigest\s*\(/i, 'unqualified digest is unsafe with the restricted SECURITY DEFINER search_path')
assert.match(m62, /WITH\s+inserted_allocations\s+AS\s*\([\s\S]*INSERT\s+INTO\s+(?:public\.)?budget_allocations[\s\S]*RETURNING[\s\S]*source_budget_line_id/i)
assert.match(m62, /INSERT\s+INTO\s+(?:public\.)?budget_activation_line_snapshots/i)
assert.match(m62, /UPDATE\s+(?:public\.)?budget_activation_batches[\s\S]*status\s*=\s*'VALIDATION_FAILED'[\s\S]*validation_fingerprint\s*=\s*NULL/i)
assert.match(m62, /p_activation_batch_id::TEXT/i, 'activation notification reference_id must use deployed TEXT storage')

// system_settings.setting_value is JSONB in the deployed NJSS schema.
for (const [name, sql] of [['061', m61], ['062', m62], ['063', m63]]) {
  assert.match(
    sql,
    /latest_database_migration[\s\S]*to_jsonb\s*\(/i,
    `migration ${name} must store latest_database_migration as JSONB`,
  )
}

assert.match(m625, /DROP\s+VIEW\s+IF\s+EXISTS\s+public\.v_budget_activation_queue\s*;/i, 'migration 0625 must safely reset the pre-fingerprint queue view before migration 063 recreates it')
assert.doesNotMatch(
  m625,
  /DROP\s+VIEW\s+IF\s+EXISTS\s+public\.v_budget_activation_queue\s+CASCADE\s*;/i,
  'queue-view reset must fail safely when unexpected database dependencies exist',
)
assert.match(m63, /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.v_budget_activation_queue/i, 'migration 063 must recreate the activation queue after the safety reset')

assert.ok(m62.includes('cost_centre_name_snapshot'), 'immutable snapshots must retain descriptive Cost Centre name evidence')
assert.doesNotMatch(m62, /submission_cost_centre/i, 'activation staging must not resolve Cost Centre from free-text submission value')
assert.doesNotMatch(
  m62,
  /(?:JOIN|WHERE|AND|OR)[^\n]*cost_centre_name\s*(?:=|ILIKE|LIKE)/i,
  'migration 062 must not use Cost Centre name as a resolver predicate',
)

assert.doesNotMatch(m63, /cost_centre_name/i, 'live activation guards must rely on Cost Centre ids only')
assert.doesNotMatch(m63, /submission_cost_centre/i, 'live guards must not resolve Cost Centre from free-text submission value')
assert.doesNotMatch(
  m63,
  /cc\.name\s*=|lower\s*\(\s*trim\s*\(\s*coalesce\s*\(\s*[^)]*cc\.name/i,
  'no Cost Centre name fallback is allowed in live guards',
)

const service = read('lib/budget-activation.ts')
for (const token of ['validation_fingerprint', 'finance_posting_mapping_id', 'getBudgetActivationSnapshots']) {
  assert.ok(service.includes(token), `budget activation service missing ${token}`)
}

const mappingService = read('lib/finance-posting-mapping.ts')
for (const token of ['FinancePostingMapping', 'getFinancePostingMappings', 'saveFinancePostingMapping', 'deactivateFinancePostingMapping']) {
  assert.ok(mappingService.includes(token), `finance mapping service missing ${token}`)
}

const api = read('app/api/budget-activation/route.ts')
assert.match(api, /status\s*===\s*['"]VALIDATION_FAILED['"][\s\S]*409/, 'stale activation must return HTTP 409 after committing validation failure')

const notificationTypes = read('lib/notifications.ts')
assert.ok(notificationTypes.includes("'BUDGET_ACTIVATION_READY'"))
assert.ok(notificationTypes.includes("'BUDGET_ACTIVATED'"))
assert.ok(notificationTypes.includes("'BUDGET_ACTIVATION'"))

for (const path of ['components/NotificationsDropdown.tsx', 'app/dashboard/notifications/page.tsx']) {
  const source = read(path)
  assert.ok(source.includes("reference_type === 'BUDGET_ACTIVATION'"), `${path} missing activation deep-link routing`)
  assert.ok(source.includes('/dashboard/budget/activation?batch='), `${path} missing exact batch link`)
}

const activationPage = read('app/dashboard/budget/activation/page.tsx')
for (const token of ['useSearchParams', 'validation_fingerprint', 'getBudgetActivationSnapshots', 'Activated History']) {
  assert.ok(activationPage.includes(token), `activation page missing ${token}`)
}

const mappingPage = read('app/dashboard/master/finance-mapping/page.tsx')
for (const label of ['Section', 'Category', 'Expense Item', 'Financial Year', 'Last Updated By', 'Last Updated At', 'Ambiguous Mapping']) {
  assert.ok(mappingPage.includes(label), `finance mapping page missing ${label}`)
}

const masterPage = read('app/dashboard/master/page.tsx')
for (const token of ['saveFinancePostingMapping', 'Finance Code (optional)', 'Chart of Accounts (optional)', 'expenseCodeRegistryId: createdPosting.id']) {
  assert.ok(masterPage.includes(token), `Posting Code builder missing canonical linkage token ${token}`)
}

console.log('approved Task 9 spec conformance checks passed')
