import assert from 'node:assert/strict'
import { COURT_LOCATIONS } from './catalog/organisation.ts'
import { BUDGET_TIERS, MONTHLY_PROFILES } from './catalog/scenarios.ts'
import { buildNationalMasterPlan } from './seed-master.ts'
import { buildFinanceMasterPlan } from './seed-finance.ts'
import { allocateMonthlyCents, buildBudgetSeedPlan } from './seed-budgets.ts'

const organisation = buildNationalMasterPlan()
const finance = buildFinanceMasterPlan(organisation)
const plan = buildBudgetSeedPlan(organisation, finance)

assert.equal(plan.financialYear, 2026)
assert.equal(plan.cycles.length, 1)
assert.equal(plan.ceilings.length, organisation.budgetDivisions.length)
assert.equal(plan.submissions.length, organisation.budgetDivisions.length)
assert.equal(plan.activationSubmissionIds.length, plan.submissions.length)
assert.ok(plan.lines.length >= plan.submissions.length * 2)
assert.equal(plan.monthlyAllocations.length, plan.lines.length * 12)

const coveredLocations = new Set(plan.submissions.map((submission) => submission.courtLocationCode))
assert.equal(coveredLocations.size, COURT_LOCATIONS.length)
for (const location of COURT_LOCATIONS) {
  assert.ok(coveredLocations.has(location.code), `budget plan does not cover ${location.code}`)
}

for (const profile of Object.values(MONTHLY_PROFILES)) {
  const allocated = allocateMonthlyCents(1_234_567, profile)
  assert.equal(allocated.length, 12)
  assert.equal(allocated.reduce((sum, value) => sum + value, 0), 1_234_567)
  assert.ok(allocated.every(Number.isSafeInteger))
}

const submissionById = new Map(plan.submissions.map((submission) => [submission.id, submission]))
const contextById = new Map(finance.contexts.map((context) => [context.expenseCodeRegistryId, context]))
for (const line of plan.lines) {
  const submission = submissionById.get(line.submissionId)
  assert.ok(submission, `line ${line.id} has no submission`)
  assert.ok(Number.isSafeInteger(line.annualCents) && line.annualCents > 0)
  assert.equal(line.monthlyCents.length, 12)
  assert.equal(line.monthlyCents.reduce((sum, value) => sum + value, 0), line.annualCents)
  const context = contextById.get(line.expenseCodeRegistryId)
  assert.ok(context, `line ${line.id} has no canonical finance context`)
  assert.equal(context.costCentreId, submission.costCentreId)
  assert.equal(context.expenseLedgerId, line.expenseLedgerId)
}

for (const submission of plan.submissions) {
  const lines = plan.lines.filter((line) => line.submissionId === submission.id)
  assert.ok(lines.length >= 2, `submission ${submission.code} must have at least two lines`)
  const total = lines.reduce((sum, line) => sum + line.annualCents, 0)
  assert.equal(total, submission.totalBudgetCents)
  assert.equal(total, submission.ceilingCents)
  assert.ok(plan.ceilings.some((ceiling) => ceiling.divisionId === submission.divisionId && ceiling.ceilingCents === total))
}

const tierTotals = new Map()
for (const submission of plan.submissions) {
  const tier = BUDGET_TIERS[submission.courtLocationCode]
  tierTotals.set(tier, (tierTotals.get(tier) ?? 0) + submission.totalBudgetCents)
}
assert.ok((tierTotals.get('H') ?? 0) > 0)
assert.ok((tierTotals.get('T1') ?? 0) > 0)
assert.ok((tierTotals.get('T2') ?? 0) > 0)
assert.ok((tierTotals.get('T3') ?? 0) > 0)

const subregistryPerDivisionAverage = plan.submissions
  .filter((submission) => BUDGET_TIERS[submission.courtLocationCode] === 'T3')
  .reduce((sum, submission, _, rows) => sum + submission.totalBudgetCents / rows.length, 0)
const hqPerDivisionAverage = plan.submissions
  .filter((submission) => BUDGET_TIERS[submission.courtLocationCode] === 'H')
  .reduce((sum, submission, _, rows) => sum + submission.totalBudgetCents / rows.length, 0)
assert.ok(subregistryPerDivisionAverage < hqPerDivisionAverage, 'sub-registry budget template must be smaller than headquarters')

for (const collection of [plan.cycles, plan.ceilings, plan.submissions, plan.lines, plan.monthlyAllocations]) {
  assert.equal(new Set(collection.map((item) => item.id)).size, collection.length, 'budget deterministic IDs must be unique')
}

console.log(`national budget seed plan checks passed: ${plan.submissions.length} submissions, ${plan.lines.length} lines`)
