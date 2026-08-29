import assert from 'node:assert/strict'
import { buildNationalMasterPlan } from './seed-master.ts'
import { buildFinanceMasterPlan } from './seed-finance.ts'
import { buildBudgetSeedPlan } from './seed-budgets.ts'
import { buildTransactionSeedPlan } from './seed-transactions.ts'
import {
  NEGATIVE_VALIDATION_DEFINITIONS,
  POSITIVE_VALIDATION_IDS,
  buildPlanValidationReport,
  runRollbackCase,
  validateReplacementPlans,
} from './validate.ts'

const organisation = buildNationalMasterPlan()
const finance = buildFinanceMasterPlan(organisation)
const budgets = buildBudgetSeedPlan(organisation, finance)
const transactions = buildTransactionSeedPlan(organisation, finance, budgets)

const report = buildPlanValidationReport(organisation, finance, budgets, transactions)

for (const key of ['positive', 'negative', 'reconciliation', 'counts', 'financialTotals', 'protectedManifestMatch']) {
  assert.ok(Object.hasOwn(report, key), `ValidationReport missing ${key}`)
}

assert.deepEqual(new Set(report.positive.map((row) => row.id)), new Set(POSITIVE_VALIDATION_IDS))
assert.ok(report.positive.every((row) => row.passed), 'all deterministic-plan positive checks must pass')
assert.equal(report.negative.length, NEGATIVE_VALIDATION_DEFINITIONS.length)
assert.equal(new Set(report.negative.map((row) => row.id)).size, report.negative.length)
assert.ok(report.negative.every((row) => typeof row.expectedFailure === 'string' && typeof row.passed === 'boolean' && typeof row.databaseMessage === 'string'))

const expectedNegativeIds = [
  'NEG-DUP-PROVINCE',
  'NEG-DUP-COURT-LOCATION',
  'NEG-COURT-LOCATION-PROVINCE',
  'NEG-DUP-DEPARTMENT',
  'NEG-SECTION-DEPARTMENT',
  'NEG-COST-CENTRE-CONTEXT',
  'NEG-DUP-COST-CENTRE',
  'NEG-UNKNOWN-FINANCE-CODE',
  'NEG-INACTIVE-FINANCE-CODE',
  'NEG-MISSING-COA',
  'NEG-POSTING-CODE-COST-CENTRE',
  'NEG-MISSING-CANONICAL-MAPPING',
  'NEG-MONTHLY-ANNUAL',
  'NEG-INVALID-BUDGET-AMOUNT',
  'NEG-UNAPPROVED-ACTIVATION',
  'NEG-ADMIN-SELF-ACTIVATION',
  'NEG-REGISTRAR-PREPARES-ACTIVATION',
  'NEG-FF3-UNACTIVATED',
  'NEG-FF3-OVER-BUDGET',
  'NEG-OUT-OF-SCOPE-USER',
  'NEG-INVALID-LINE-SUPERVISOR',
  'NEG-REVISION-BEFORE-ACTIVATION',
  'NEG-SUPPLEMENTARY-NO-AUTHORITY',
  'NEG-VIREMENT-TOTAL',
  'NEG-FF4-LINEAGE',
  'NEG-PAYMENT-EXCEEDS-COMMITMENT',
  'NEG-INACTIVE-SUPPLIER',
]
assert.deepEqual(new Set(NEGATIVE_VALIDATION_DEFINITIONS.map((row) => row.id)), new Set(expectedNegativeIds))

assert.equal(report.counts.provinces, 22)
assert.equal(report.counts.courtLocations, 28)
assert.equal(report.counts.activeUsersExpected, 7)
assert.equal(report.counts.archivedUsersExpected, 3)
assert.equal(report.financialTotals.annualBudgetCents, report.financialTotals.monthlyBudgetCents)
assert.equal(report.financialTotals.submissionBudgetCents, report.financialTotals.lineBudgetCents)
assert.equal(report.reconciliation.monthlyVarianceCents, 0)
assert.equal(report.reconciliation.submissionVarianceCents, 0)
assert.equal(report.reconciliation.financeContextDuplicates, 0)
assert.equal(report.reconciliation.organisationOrphans, 0)
assert.equal(report.reconciliation.transactionReferenceErrors, 0)
assert.equal(report.protectedManifestMatch, null, 'plan-only validation cannot claim a live protected-manifest result')

assert.doesNotThrow(() => validateReplacementPlans(organisation, finance, budgets, transactions))

const brokenBudgets = structuredClone(budgets)
brokenBudgets.lines[0].monthlyCents[0] += 1
assert.throws(
  () => validateReplacementPlans(organisation, finance, brokenBudgets, transactions),
  /monthly allocations do not equal annual amount/i,
)

const brokenFinance = structuredClone(finance)
brokenFinance.mappings.pop()
assert.throws(
  () => validateReplacementPlans(organisation, brokenFinance, budgets, transactions),
  /canonical finance mapping/i,
)

const queries = []
const fakeClient = {
  async query(sql) {
    queries.push(sql)
    if (sql === 'select invalid_operation()') throw new Error('expected rejection: invalid operation')
    return { rows: [], rowCount: 0 }
  },
}
const rollbackResult = await runRollbackCase(
  fakeClient,
  { id: 'NEG-TEST', expectedFailure: 'invalid operation', expectedPattern: /invalid operation/i },
  async (client) => { await client.query('select invalid_operation()') },
)
assert.equal(rollbackResult.passed, true)
assert.match(rollbackResult.databaseMessage, /invalid operation/i)
assert.deepEqual(queries, [
  'SAVEPOINT neg_neg_test',
  'select invalid_operation()',
  'ROLLBACK TO SAVEPOINT neg_neg_test',
  'RELEASE SAVEPOINT neg_neg_test',
])

console.log(`national UAT validation contract checks passed: ${report.positive.length} positive, ${report.negative.length} negative definitions`)
