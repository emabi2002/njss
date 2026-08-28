import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')
const migration061 = 'supabase/migrations/061_explicit_finance_posting_mapping_and_cost_centre_fk.sql'
const migration062 = 'supabase/migrations/062_budget_activation_fingerprint_and_immutable_snapshot.sql'
const migration063 = 'supabase/migrations/063_budget_activation_fk_only_guards.sql'

for (const path of [migration061, migration062, migration063]) {
  assert.ok(fs.existsSync(path), `missing ${path}`)
}

const m61 = read(migration061)
const m62 = read(migration062)
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

for (const token of [
  'validation_fingerprint',
  'prepared_against_submission_updated_at',
  'finance_posting_mapping_id',
  'budget_activation_line_snapshots',
  'budget_allocation_id',
  'njss_budget_activation_fingerprint',
  'VALIDATION_FAILED',
]) assert.ok(m62.includes(token), `migration 062 missing ${token}`)

assert.match(m62, /digest\s*\(/i, 'fingerprint must be cryptographic and deterministic')
assert.match(m62, /WITH\s+inserted_allocations\s+AS\s*\([\s\S]*INSERT\s+INTO\s+budget_allocations[\s\S]*RETURNING[\s\S]*source_budget_line_id/i)
assert.match(m62, /INSERT\s+INTO\s+budget_activation_line_snapshots/i)
assert.match(m62, /UPDATE\s+budget_activation_batches[\s\S]*status\s*=\s*'VALIDATION_FAILED'[\s\S]*validation_fingerprint\s*=\s*NULL/i)

// Migration 062 deliberately stores descriptive Cost Centre names in immutable
// audit snapshots. What is prohibited is using a name/free-text value as the
// resolver predicate for an operational Cost Centre.
assert.ok(m62.includes('cost_centre_name_snapshot'), 'immutable snapshots must retain descriptive Cost Centre name evidence')
assert.doesNotMatch(m62, /submission_cost_centre/i, 'activation staging must not resolve Cost Centre from free-text submission value')
assert.doesNotMatch(
  m62,
  /(?:JOIN|WHERE|AND|OR)[^\n]*cost_centre_name\s*(?:=|ILIKE|LIKE)/i,
  'migration 062 must not use Cost Centre name as a resolver predicate',
)

// The live transaction-boundary guard has no need for descriptive name fields;
// it must be id/canonical-mapping only.
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

console.log('approved Task 9 spec conformance checks passed')
