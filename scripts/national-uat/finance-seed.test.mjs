import assert from 'node:assert/strict'
import { buildNationalMasterPlan } from './seed-master.ts'
import { buildFinanceMasterPlan } from './seed-finance.ts'
import { ECONOMIC_CLASSES, FINANCE_CODES } from './catalog/finance.ts'
import { TRANSACTION_SCENARIOS } from './catalog/scenarios.ts'

const organisation = buildNationalMasterPlan()
const plan = buildFinanceMasterPlan(organisation)

assert.equal(plan.financialYear, 2026)
assert.equal(plan.budgetClasses.length, ECONOMIC_CLASSES.length)
assert.equal(plan.budgetExpenseCategories.length, ECONOMIC_CLASSES.length)
assert.equal(plan.chartOfAccounts.length, ECONOMIC_CLASSES.length)
assert.equal(plan.expenseCategories.length, ECONOMIC_CLASSES.length)
assert.equal(plan.expenseItems.length, FINANCE_CODES.length)
assert.equal(plan.ledgers.length, FINANCE_CODES.length)
assert.ok(plan.contexts.length >= organisation.costCentres.length * 2, `expected at least two controlled finance contexts per cost centre, got ${plan.contexts.length}`)
assert.equal(plan.postingCodes.length, plan.contexts.length)
assert.equal(plan.mappings.length, plan.contexts.length)

for (const collection of [
  plan.budgetClasses,
  plan.budgetExpenseCategories,
  plan.chartOfAccounts,
  plan.expenseCategories,
  plan.expenseItems,
  plan.ledgers,
  plan.postingCodes,
  plan.mappings,
]) {
  assert.equal(new Set(collection.map((item) => item.id)).size, collection.length, 'finance deterministic IDs must be unique per collection')
}

const contextKeys = new Set()
for (const context of plan.contexts) {
  const department = organisation.departments.find((item) => item.id === context.departmentId)
  const costCentre = organisation.costCentres.find((item) => item.id === context.costCentreId)
  const section = organisation.sections.find((item) => item.id === context.sectionId)
  const ledger = plan.ledgers.find((item) => item.id === context.expenseLedgerId)
  const postingCode = plan.postingCodes.find((item) => item.id === context.expenseCodeRegistryId)
  const account = plan.chartOfAccounts.find((item) => item.id === context.chartOfAccountId)
  assert.ok(department, `context missing department ${context.code}`)
  assert.ok(costCentre, `context missing cost centre ${context.code}`)
  assert.ok(section, `context missing section ${context.code}`)
  assert.ok(ledger, `context missing finance code ${context.code}`)
  assert.ok(postingCode, `context missing posting code ${context.code}`)
  assert.ok(account, `context missing CoA ${context.code}`)
  assert.equal(costCentre.departmentId, department.id)
  assert.equal(section.departmentId, department.id)
  assert.equal(postingCode.costCentreId, costCentre.id)
  assert.equal(postingCode.expenseLedgerId, ledger.id)
  assert.equal(postingCode.chartOfAccountId, account.id)
  const key = `${context.financialYear}|${context.expenseLedgerId}|${context.expenseCodeRegistryId}|${context.costCentreId}`
  assert.ok(!contextKeys.has(key), `duplicate canonical mapping context ${key}`)
  contextKeys.add(key)
}

for (const scenario of TRANSACTION_SCENARIOS) {
  for (const financeCode of scenario.financeCodes) {
    assert.ok(
      plan.contexts.some((context) => context.courtLocationCode === scenario.locationCode && context.financeCode === financeCode),
      `scenario ${scenario.code} lacks finance mapping for ${scenario.locationCode} / ${financeCode}`,
    )
  }
}

for (const mapping of plan.mappings) {
  assert.ok(mapping.mappingNotes.includes('NJSS-NATIONAL-UAT-2026-V1'))
  assert.ok(mapping.mappingNotes.includes('UAT generated mapping'))
}

assert.ok(!plan.mappings.some((mapping) => /fallback/i.test(mapping.mappingNotes)), 'fallback mappings are forbidden')
console.log(`national finance seed checks passed: ${plan.contexts.length} canonical contexts`)
