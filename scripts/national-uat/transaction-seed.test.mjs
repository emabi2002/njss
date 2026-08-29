import assert from 'node:assert/strict'
import { FUNDING_SOURCES, SUPPLIERS, TRANSACTION_SCENARIOS } from './catalog/scenarios.ts'
import { buildNationalMasterPlan, RETAINED_USER_ASSIGNMENTS } from './seed-master.ts'
import { buildFinanceMasterPlan } from './seed-finance.ts'
import { buildBudgetSeedPlan } from './seed-budgets.ts'
import { buildTransactionSeedPlan } from './seed-transactions.ts'

const organisation = buildNationalMasterPlan()
const finance = buildFinanceMasterPlan(organisation)
const budgets = buildBudgetSeedPlan(organisation, finance)
const plan = buildTransactionSeedPlan(organisation, finance, budgets)

assert.equal(plan.fundingSources.length, FUNDING_SOURCES.length)
assert.equal(plan.suppliers.length, SUPPLIERS.length)
assert.equal(plan.ff3.length, TRANSACTION_SCENARIOS.length * 4)
assert.equal(plan.ff4.length, TRANSACTION_SCENARIOS.length * 2)
assert.equal(plan.revisions.length, TRANSACTION_SCENARIOS.length)

assert.equal(plan.ff3.filter((row) => row.targetStatus === 'COMMITTED').length, 20)
assert.equal(plan.ff3.filter((row) => row.targetStatus === 'SUBMITTED').length, 4)
assert.equal(plan.ff3.filter((row) => row.targetStatus === 'RETURNED').length, 4)
assert.equal(plan.ff3.filter((row) => row.targetStatus === 'REJECTED').length, 4)

assert.equal(plan.ff4.filter((row) => row.targetStatus === 'SUBMITTED').length, 4)
assert.equal(plan.ff4.filter((row) => row.targetStatus === 'APPROVED').length, 4)
assert.equal(plan.ff4.filter((row) => row.targetStatus === 'PAID').length, 4)
assert.equal(plan.ff4.filter((row) => row.targetStatus === 'RECONCILED').length, 4)

const scenarioCodes = new Set(TRANSACTION_SCENARIOS.map((scenario) => scenario.code))
for (const scenario of TRANSACTION_SCENARIOS) {
  const ff3 = plan.ff3.filter((row) => row.scenarioCode === scenario.code)
  assert.equal(ff3.length, 4, `scenario ${scenario.code} must have four FF3 cases`)
  assert.equal(new Set(ff3.map((row) => row.budgetLineId)).size, ff3.length, `scenario ${scenario.code} FF3 cases must use distinct budget lines`)
  assert.ok(ff3.every((row) => row.locationCode === scenario.locationCode))
  assert.ok(ff3.every((row) => scenario.financeCodes.includes(row.financeCode)))
  assert.ok(ff3.every((row) => row.requestCents > 0 && row.releaseCents >= row.requestCents))

  const revision = plan.revisions.find((row) => row.scenarioCode === scenario.code)
  assert.ok(revision, `scenario ${scenario.code} must have a revision request`)
  assert.equal(revision.locationCode, scenario.locationCode)
  assert.ok(['SUPPLEMENTARY', 'REFORECAST'].includes(revision.revisionType))
  if (revision.revisionType === 'SUPPLEMENTARY') assert.ok(revision.authorityReference?.startsWith('UAT-SUP-2026-'))
}

for (const row of plan.ff3) {
  assert.ok(scenarioCodes.has(row.scenarioCode))
  const budgetLine = budgets.lines.find((line) => line.id === row.budgetLineId)
  const submission = budgets.submissions.find((item) => item.id === row.submissionId)
  const context = finance.contexts.find((item) => item.expenseCodeRegistryId === row.expenseCodeRegistryId)
  assert.ok(budgetLine && submission && context, `FF3 ${row.code} has an invalid budget/finance reference`)
  assert.equal(budgetLine.submissionId, submission.id)
  assert.equal(context.costCentreId, submission.costCentreId)
  assert.equal(context.expenseLedgerId, budgetLine.expenseLedgerId)
  assert.ok(row.requestCents <= row.releaseCents)
  assert.ok(row.releaseCents <= budgetLine.annualCents)
  assert.ok(plan.fundingAllocations.some((funding) => funding.budgetLineId === row.budgetLineId && funding.releaseCents === row.releaseCents))
}

const committed = new Map(plan.ff3.filter((row) => row.targetStatus === 'COMMITTED').map((row) => [row.id, row]))
for (const row of plan.ff4) {
  assert.ok(committed.has(row.ff3Id), `FF4 ${row.code} must reference a committed FF3`)
  assert.ok(row.amountCents > 0)
  assert.ok(row.amountCents <= committed.get(row.ff3Id).requestCents)
}

assert.equal(new Set(plan.ff3.map((row) => row.id)).size, plan.ff3.length)
assert.equal(new Set(plan.ff4.map((row) => row.id)).size, plan.ff4.length)
assert.equal(new Set(plan.revisions.map((row) => row.parentSubmissionId)).size, plan.revisions.length, 'revision requests must use distinct approved parent submissions')

const lineSupervisor = RETAINED_USER_ASSIGNMENTS.find((item) => item.userId === plan.revisionActorPlan.lineSupervisorId)
assert.ok(lineSupervisor)
assert.equal(plan.revisionActorPlan.restoreDepartmentCode, lineSupervisor.departmentCode)
assert.equal(plan.revisionActorPlan.restoreSectionCode, lineSupervisor.sectionCode)
assert.ok(plan.revisionActorPlan.requiresTemporaryScopeAlignment, 'revision seeding must explicitly record temporary scope alignment')

console.log(`national transaction plan checks passed: ${plan.ff3.length} FF3, ${plan.ff4.length} FF4, ${plan.revisions.length} revisions`)
