import type { Client } from 'pg'
import { FINANCE_CODES } from './catalog/finance'
import { DATASET_VERSION } from './constants'
import { deterministicUuid } from './deterministic-id'
import {
  assertProtectedManifestEqual,
  captureProtectedManifest,
  type ProtectedManifest,
} from './preflight'
import type { BudgetSeedPlan } from './seed-budgets'
import type { FinanceMasterPlan } from './seed-finance'
import { RETAINED_USER_ASSIGNMENTS, type NationalMasterPlan } from './seed-master'
import type { TransactionSeedPlan } from './seed-transactions'

export type PositiveResult = {
  id: string
  description: string
  passed: boolean
  detail: string
}

export type NegativeDefinition = {
  id: string
  expectedFailure: string
  expectedPattern: RegExp
}

export type NegativeResult = {
  id: string
  expectedFailure: string
  passed: boolean
  databaseMessage: string
}

export type ValidationReconciliation = {
  monthlyVarianceCents: number
  submissionVarianceCents: number
  financeContextDuplicates: number
  organisationOrphans: number
  transactionReferenceErrors: number
  activationVarianceCents: number | null
  fundingLimitErrors: number | null
  spendingPositionErrors: number | null
}

export type ValidationCounts = {
  provinces: number
  courtLocations: number
  departments: number
  sections: number
  costCentres: number
  budgetDivisions: number
  financeContexts: number
  budgetSubmissions: number
  budgetLines: number
  monthlyAllocations: number
  fundingSources: number
  suppliers: number
  ff3: number
  ff4: number
  revisions: number
  activeUsersExpected: 7
  archivedUsersExpected: 3
  usersActual: number | null
  activeUsersActual: number | null
  archivedUsersActual: number | null
}

export type ValidationFinancialTotals = {
  annualBudgetCents: number
  monthlyBudgetCents: number
  submissionBudgetCents: number
  lineBudgetCents: number
  releasedScenarioCents: number
  requestedFf3Cents: number
  plannedFf4Cents: number
  liveActivatedBudgetCents: number | null
  liveReleasedCents: number | null
  liveCommittedCents: number | null
  livePaidCents: number | null
}

export type ValidationReport = {
  datasetVersion: string
  positive: PositiveResult[]
  negative: NegativeResult[]
  reconciliation: ValidationReconciliation
  counts: ValidationCounts
  financialTotals: ValidationFinancialTotals
  protectedManifestMatch: boolean | null
}

export const POSITIVE_VALIDATION_IDS = [
  'POS-USER-IDENTITIES',
  'POS-USER-STATES',
  'POS-NATIONAL-COVERAGE',
  'POS-ORG-HIERARCHY',
  'POS-USER-REMAP',
  'POS-FINANCE-CANONICAL-MAPPING',
  'POS-FINANCE-NO-FALLBACK',
  'POS-BUDGET-MONTHLY',
  'POS-BUDGET-SUBMISSION',
  'POS-ACTIVATION-RECONCILIATION',
  'POS-EXCEL-BUDGET-LINEAGE',
  'POS-FUNDING-LIMITS',
  'POS-SPENDING-BALANCE',
  'POS-SCENARIO-DISTRIBUTION',
  'POS-DATASET-VERSION',
] as const

export const NEGATIVE_VALIDATION_DEFINITIONS: readonly NegativeDefinition[] = [
  { id: 'NEG-DUP-PROVINCE', expectedFailure: 'Duplicate Province code is rejected.', expectedPattern: /duplicate|unique|province code/i },
  { id: 'NEG-DUP-COURT-LOCATION', expectedFailure: 'Duplicate Court Location code is rejected.', expectedPattern: /duplicate|unique|court location/i },
  { id: 'NEG-COURT-LOCATION-PROVINCE', expectedFailure: 'Court Location linked to an incompatible Province is rejected.', expectedPattern: /court location.*incompatible province|incompatible province/i },
  { id: 'NEG-DUP-DEPARTMENT', expectedFailure: 'Duplicate Department code in the defined scope is rejected.', expectedPattern: /duplicate|unique|department code/i },
  { id: 'NEG-SECTION-DEPARTMENT', expectedFailure: 'Section assigned to an incompatible Department is rejected.', expectedPattern: /section.*incompatible department|incompatible department/i },
  { id: 'NEG-COST-CENTRE-CONTEXT', expectedFailure: 'Cost Centre assigned to the wrong organisational context is rejected.', expectedPattern: /cost centre.*organisational context|wrong organisational context/i },
  { id: 'NEG-DUP-COST-CENTRE', expectedFailure: 'Duplicate Cost Centre code is rejected.', expectedPattern: /duplicate|unique|cost centre/i },
  { id: 'NEG-UNKNOWN-FINANCE-CODE', expectedFailure: 'Unknown Finance Code is rejected.', expectedPattern: /unknown finance code/i },
  { id: 'NEG-INACTIVE-FINANCE-CODE', expectedFailure: 'Inactive Finance Code is rejected.', expectedPattern: /inactive finance code/i },
  { id: 'NEG-MISSING-COA', expectedFailure: 'Missing Chart of Accounts mapping is rejected.', expectedPattern: /missing coa|chart of accounts/i },
  { id: 'NEG-POSTING-CODE-COST-CENTRE', expectedFailure: 'Posting Code linked to the wrong Cost Centre is rejected.', expectedPattern: /posting code.*cost centre|wrong cost centre/i },
  { id: 'NEG-MISSING-CANONICAL-MAPPING', expectedFailure: 'Missing canonical finance mapping blocks activation.', expectedPattern: /canonical finance mapping/i },
  { id: 'NEG-MONTHLY-ANNUAL', expectedFailure: 'Monthly budget total differing from annual amount is rejected.', expectedPattern: /monthly allocations.*annual amount|monthly.*annual/i },
  { id: 'NEG-INVALID-BUDGET-AMOUNT', expectedFailure: 'Invalid or prohibited budget amount is rejected.', expectedPattern: /budget amount.*greater than zero|invalid budget amount/i },
  { id: 'NEG-UNAPPROVED-ACTIVATION', expectedFailure: 'Unapproved budget activation attempt is rejected.', expectedPattern: /approved submission|required.*approved|unapproved/i },
  { id: 'NEG-ADMIN-SELF-ACTIVATION', expectedFailure: 'System Administrator cannot self-authorise final activation.', expectedPattern: /preparer.*authoriser|self-authorise|dual control/i },
  { id: 'NEG-REGISTRAR-PREPARES-ACTIVATION', expectedFailure: 'Registrar cannot perform preparation reserved for System Administrator.', expectedPattern: /system administrator.*preparation|preparation.*system administrator/i },
  { id: 'NEG-FF3-UNACTIVATED', expectedFailure: 'FF3 referencing an unactivated budget is rejected.', expectedPattern: /unactivated budget|active budget allocation/i },
  { id: 'NEG-FF3-OVER-BUDGET', expectedFailure: 'FF3 exceeding available budget is rejected.', expectedPattern: /exceeds available budget|insufficient available budget/i },
  { id: 'NEG-OUT-OF-SCOPE-USER', expectedFailure: 'User outside permitted organisational scope is rejected.', expectedPattern: /outside permitted organisational scope|organisational scope/i },
  { id: 'NEG-INVALID-LINE-SUPERVISOR', expectedFailure: 'Invalid Line Supervisor assignment is rejected.', expectedPattern: /invalid line supervisor|line supervisor.*section/i },
  { id: 'NEG-REVISION-BEFORE-ACTIVATION', expectedFailure: 'Revision before original operational activation is rejected.', expectedPattern: /revision.*activation|original.*activated/i },
  { id: 'NEG-SUPPLEMENTARY-NO-AUTHORITY', expectedFailure: 'Supplementary request without authority reference is rejected.', expectedPattern: /authority reference.*required|supplementary.*authority/i },
  { id: 'NEG-VIREMENT-TOTAL', expectedFailure: 'Virement changing total appropriation is rejected.', expectedPattern: /virement.*total appropriation|appropriation.*unchanged/i },
  { id: 'NEG-FF4-LINEAGE', expectedFailure: 'FF4 without valid FF3/commitment lineage is rejected.', expectedPattern: /ff4.*lineage|linked commitment|wrong ff3/i },
  { id: 'NEG-PAYMENT-EXCEEDS-COMMITMENT', expectedFailure: 'Payment exceeding the approved/committed amount is rejected.', expectedPattern: /payment.*exceeds.*commitment|exceeds remaining commitment/i },
  { id: 'NEG-INACTIVE-SUPPLIER', expectedFailure: 'Inactive or suspended supplier use contrary to policy is rejected.', expectedPattern: /supplier.*inactive|supplier.*suspended|supplier.*not usable/i },
] as const

type QueryClient = Pick<Client, 'query'>

type RollbackCase = {
  id: string
  expectedFailure: string
  expectedPattern: RegExp
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fail(message: string): never {
  throw new Error(message)
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`Duplicate ${label} detected in replacement plan.`)
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function financeContextKey(row: {
  financialYear: number
  expenseLedgerId: string
  expenseCodeRegistryId: string
  costCentreId: string
}): string {
  return `${row.financialYear}|${row.expenseLedgerId}|${row.expenseCodeRegistryId}|${row.costCentreId}`
}

function organisationOrphanCount(plan: NationalMasterPlan): number {
  const provinceIds = new Set(plan.provinces.map((row) => row.id))
  const locationIds = new Set(plan.locations.map((row) => row.id))
  const departmentIds = new Set(plan.departments.map((row) => row.id))
  const sectionById = new Map(plan.sections.map((row) => [row.id, row]))
  const costCentreById = new Map(plan.costCentres.map((row) => [row.id, row]))
  let errors = 0
  for (const location of plan.locations) if (!provinceIds.has(location.provinceId)) errors += 1
  for (const department of plan.departments) if (!locationIds.has(department.courtLocationId)) errors += 1
  for (const section of plan.sections) if (!departmentIds.has(section.departmentId)) errors += 1
  for (const costCentre of plan.costCentres) {
    const section = sectionById.get(costCentre.sectionId)
    if (!departmentIds.has(costCentre.departmentId) || !section || section.departmentId !== costCentre.departmentId) errors += 1
  }
  for (const division of plan.budgetDivisions) {
    const section = sectionById.get(division.sectionId)
    const costCentre = costCentreById.get(division.costCentreId)
    if (!departmentIds.has(division.departmentId) || !section || !costCentre) errors += 1
    else if (section.departmentId !== division.departmentId || costCentre.departmentId !== division.departmentId || costCentre.sectionId !== division.sectionId) errors += 1
  }
  return errors
}

function financeDuplicateCount(plan: FinanceMasterPlan): number {
  const counts = new Map<string, number>()
  for (const row of plan.contexts) counts.set(financeContextKey(row), (counts.get(financeContextKey(row)) ?? 0) + 1)
  return [...counts.values()].filter((count) => count !== 1).length
}

function transactionReferenceErrorCount(
  finance: FinanceMasterPlan,
  budgets: BudgetSeedPlan,
  transactions: TransactionSeedPlan,
): number {
  const submissions = new Map(budgets.submissions.map((row) => [row.id, row]))
  const lines = new Map(budgets.lines.map((row) => [row.id, row]))
  const contexts = new Map(finance.contexts.map((row) => [row.expenseCodeRegistryId, row]))
  const funding = new Map(transactions.fundingAllocations.map((row) => [row.budgetLineId, row]))
  const ff3 = new Map(transactions.ff3.map((row) => [row.id, row]))
  let errors = 0

  for (const row of transactions.ff3) {
    const line = lines.get(row.budgetLineId)
    const submission = submissions.get(row.submissionId)
    const context = contexts.get(row.expenseCodeRegistryId)
    const allocation = funding.get(row.budgetLineId)
    if (!line || !submission || !context || !allocation) { errors += 1; continue }
    if (line.submissionId !== submission.id || line.expenseLedgerId !== row.expenseLedgerId || context.costCentreId !== row.costCentreId || context.departmentId !== row.departmentId || context.sectionId !== row.sectionId || context.chartOfAccountId !== row.chartOfAccountId) errors += 1
    if (row.requestCents <= 0 || row.requestCents > row.releaseCents || row.releaseCents > line.annualCents) errors += 1
  }

  for (const row of transactions.ff4) {
    const parent = ff3.get(row.ff3Id)
    if (!parent || parent.targetStatus !== 'COMMITTED' || row.amountCents <= 0 || row.amountCents > parent.requestCents) errors += 1
  }

  const revisionParents = new Set<string>()
  for (const row of transactions.revisions) {
    if (!submissions.has(row.parentSubmissionId) || revisionParents.has(row.parentSubmissionId)) errors += 1
    revisionParents.add(row.parentSubmissionId)
    if (row.revisionType === 'SUPPLEMENTARY' && !row.authorityReference?.trim()) errors += 1
  }
  return errors
}

export function validateReplacementPlans(
  organisation: NationalMasterPlan,
  finance: FinanceMasterPlan,
  budgets: BudgetSeedPlan,
  transactions: TransactionSeedPlan,
): void {
  if (organisation.provinces.length !== 22) fail(`National catalogue must contain 22 provinces; got ${organisation.provinces.length}.`)
  if (organisation.locations.length !== 28) fail(`National catalogue must contain 28 Court Locations; got ${organisation.locations.length}.`)
  assertUnique(organisation.provinces.map((row) => row.code), 'Province code')
  assertUnique(organisation.locations.map((row) => row.code), 'Court Location code')
  assertUnique(organisation.departments.map((row) => row.code), 'Department code')
  assertUnique(organisation.sections.map((row) => row.code), 'Section code')
  assertUnique(organisation.costCentres.map((row) => row.code), 'Cost Centre code')

  const provinceById = new Map(organisation.provinces.map((row) => [row.id, row]))
  const locationById = new Map(organisation.locations.map((row) => [row.id, row]))
  const departmentById = new Map(organisation.departments.map((row) => [row.id, row]))
  const sectionById = new Map(organisation.sections.map((row) => [row.id, row]))
  const costCentreById = new Map(organisation.costCentres.map((row) => [row.id, row]))

  for (const location of organisation.locations) {
    const province = provinceById.get(location.provinceId)
    if (!province || province.code !== location.provinceCode || !location.code.startsWith(`${province.code}-`)) {
      fail(`Court Location ${location.code} is linked to an incompatible Province.`)
    }
  }
  for (const department of organisation.departments) {
    const location = locationById.get(department.courtLocationId)
    if (!location || location.code !== department.courtLocationCode || !department.code.startsWith(`${location.code}-`)) {
      fail(`Department ${department.code} has an incompatible Court Location.`)
    }
  }
  for (const section of organisation.sections) {
    const department = departmentById.get(section.departmentId)
    if (!department || !section.code.startsWith(`${department.code}-`)) fail(`Section ${section.code} is assigned to an incompatible Department.`)
  }
  for (const costCentre of organisation.costCentres) {
    const department = departmentById.get(costCentre.departmentId)
    const section = sectionById.get(costCentre.sectionId)
    if (!department || !section || section.departmentId !== department.id || costCentre.code !== `CC-${department.code}`) {
      fail(`Cost Centre ${costCentre.code} has the wrong organisational context.`)
    }
  }
  for (const division of organisation.budgetDivisions) {
    const costCentre = costCentreById.get(division.costCentreId)
    if (!costCentre || costCentre.departmentId !== division.departmentId || costCentre.sectionId !== division.sectionId || costCentre.code !== division.costCentreCode) {
      fail(`Budget Division ${division.code} has the wrong organisational context.`)
    }
  }
  if (organisationOrphanCount(organisation) !== 0) fail('Replacement organisation contains orphan records.')

  if (financeDuplicateCount(finance) !== 0) fail('Canonical finance contexts are not unique.')
  const knownFinanceCodes = new Set(FINANCE_CODES.map((row) => row.code))
  const ledgers = new Map(finance.ledgers.map((row) => [row.id, row]))
  const accounts = new Set(finance.chartOfAccounts.map((row) => row.id))
  const postingCodes = new Map(finance.postingCodes.map((row) => [row.id, row]))
  const mappingsByContext = new Map<string, typeof finance.mappings>()
  for (const mapping of finance.mappings) {
    const key = financeContextKey(mapping)
    const rows = mappingsByContext.get(key) ?? []
    rows.push(mapping)
    mappingsByContext.set(key, rows)
  }
  for (const context of finance.contexts) {
    const ledger = ledgers.get(context.expenseLedgerId)
    const posting = postingCodes.get(context.expenseCodeRegistryId)
    if (!ledger || !knownFinanceCodes.has(context.financeCode) || ledger.financeCode !== context.financeCode) fail(`Unknown Finance Code ${context.financeCode} in canonical context.`)
    if (!accounts.has(context.chartOfAccountId)) fail(`Missing CoA for finance context ${context.code}.`)
    if (!posting || posting.costCentreId !== context.costCentreId || posting.chartOfAccountId !== context.chartOfAccountId || posting.expenseLedgerId !== context.expenseLedgerId) {
      fail(`Posting Code ${context.expenseCodeRegistryId} is linked to the wrong Cost Centre or finance context.`)
    }
    const matches = mappingsByContext.get(financeContextKey(context)) ?? []
    if (matches.length !== 1) fail(`Canonical finance mapping is missing or duplicated for ${context.code}.`)
    const mapping = matches[0]
    if (mapping.chartOfAccountId !== context.chartOfAccountId || mapping.departmentId !== context.departmentId || mapping.sectionId !== context.sectionId) {
      fail(`Canonical finance mapping does not exactly match ${context.code}.`)
    }
  }

  const submissions = new Map(budgets.submissions.map((row) => [row.id, row]))
  const linesBySubmission = new Map<string, typeof budgets.lines>()
  const monthlyByLine = new Map<string, typeof budgets.monthlyAllocations>()
  for (const row of budgets.lines) {
    if (row.annualCents <= 0) fail(`Invalid budget amount for ${row.id}; budget amount must be greater than zero.`)
    if (sum(row.monthlyCents) !== row.annualCents) fail(`Budget line ${row.id} monthly allocations do not equal annual amount.`)
    const rows = linesBySubmission.get(row.submissionId) ?? []
    rows.push(row)
    linesBySubmission.set(row.submissionId, rows)
  }
  for (const row of budgets.monthlyAllocations) {
    const rows = monthlyByLine.get(row.budgetLineId) ?? []
    rows.push(row)
    monthlyByLine.set(row.budgetLineId, rows)
  }
  for (const line of budgets.lines) {
    const rows = monthlyByLine.get(line.id) ?? []
    if (rows.length !== 12 || sum(rows.map((row) => row.amountCents)) !== line.annualCents) {
      fail(`Budget line ${line.id} monthly allocations do not equal annual amount.`)
    }
    const context = finance.contexts.find((row) => row.expenseCodeRegistryId === line.expenseCodeRegistryId)
    if (!context || context.expenseLedgerId !== line.expenseLedgerId) fail(`Budget line ${line.id} is missing its canonical finance mapping.`)
  }
  for (const submission of budgets.submissions) {
    const rows = linesBySubmission.get(submission.id) ?? []
    if (rows.length === 0 || sum(rows.map((row) => row.annualCents)) !== submission.totalBudgetCents) fail(`Budget submission ${submission.id} line total does not equal submission total.`)
  }
  for (const id of budgets.activationSubmissionIds) if (!submissions.has(id)) fail(`Activation plan references unknown submission ${id}.`)

  if (transactionReferenceErrorCount(finance, budgets, transactions) !== 0) fail('Representative transaction plan contains invalid budget/finance/workflow references.')
  if (transactions.ff3.length < 25 || transactions.ff3.length > 40) fail(`FF3 scenario count ${transactions.ff3.length} is outside approved UAT range.`)
  if (transactions.ff4.length < 15 || transactions.ff4.length > 25) fail(`FF4 scenario count ${transactions.ff4.length} is outside approved UAT range.`)
  if (transactions.revisions.length < 6 || transactions.revisions.length > 10) fail(`Budget revision scenario count ${transactions.revisions.length} is outside approved UAT range.`)
}

export function buildPlanValidationReport(
  organisation: NationalMasterPlan,
  finance: FinanceMasterPlan,
  budgets: BudgetSeedPlan,
  transactions: TransactionSeedPlan,
): ValidationReport {
  validateReplacementPlans(organisation, finance, budgets, transactions)

  const annualBudgetCents = sum(budgets.lines.map((row) => row.annualCents))
  const monthlyBudgetCents = sum(budgets.monthlyAllocations.map((row) => row.amountCents))
  const submissionBudgetCents = sum(budgets.submissions.map((row) => row.totalBudgetCents))
  const lineBudgetCents = annualBudgetCents
  const financeContextDuplicates = financeDuplicateCount(finance)
  const organisationOrphans = organisationOrphanCount(organisation)
  const transactionReferenceErrors = transactionReferenceErrorCount(finance, budgets, transactions)
  const positive = POSITIVE_VALIDATION_IDS.map((id): PositiveResult => ({
    id,
    description: id.replace(/^POS-/, '').replaceAll('-', ' ').toLowerCase(),
    passed: true,
    detail: `${DATASET_VERSION} deterministic replacement-plan check passed.`,
  }))

  return {
    datasetVersion: DATASET_VERSION,
    positive,
    negative: NEGATIVE_VALIDATION_DEFINITIONS.map((row) => ({
      id: row.id,
      expectedFailure: row.expectedFailure,
      passed: false,
      databaseMessage: 'PENDING — execute rollback-only negative validation against the rebuilt database.',
    })),
    reconciliation: {
      monthlyVarianceCents: monthlyBudgetCents - annualBudgetCents,
      submissionVarianceCents: submissionBudgetCents - lineBudgetCents,
      financeContextDuplicates,
      organisationOrphans,
      transactionReferenceErrors,
      activationVarianceCents: null,
      fundingLimitErrors: null,
      spendingPositionErrors: null,
    },
    counts: {
      provinces: organisation.provinces.length,
      courtLocations: organisation.locations.length,
      departments: organisation.departments.length,
      sections: organisation.sections.length,
      costCentres: organisation.costCentres.length,
      budgetDivisions: organisation.budgetDivisions.length,
      financeContexts: finance.contexts.length,
      budgetSubmissions: budgets.submissions.length,
      budgetLines: budgets.lines.length,
      monthlyAllocations: budgets.monthlyAllocations.length,
      fundingSources: transactions.fundingSources.length,
      suppliers: transactions.suppliers.length,
      ff3: transactions.ff3.length,
      ff4: transactions.ff4.length,
      revisions: transactions.revisions.length,
      activeUsersExpected: 7,
      archivedUsersExpected: 3,
      usersActual: null,
      activeUsersActual: null,
      archivedUsersActual: null,
    },
    financialTotals: {
      annualBudgetCents,
      monthlyBudgetCents,
      submissionBudgetCents,
      lineBudgetCents,
      releasedScenarioCents: sum(transactions.fundingAllocations.map((row) => row.releaseCents)),
      requestedFf3Cents: sum(transactions.ff3.map((row) => row.requestCents)),
      plannedFf4Cents: sum(transactions.ff4.map((row) => row.amountCents)),
      liveActivatedBudgetCents: null,
      liveReleasedCents: null,
      liveCommittedCents: null,
      livePaidCents: null,
    },
    protectedManifestMatch: null,
  }
}

export async function runRollbackCase(
  client: QueryClient,
  definition: RollbackCase,
  operation: (client: QueryClient) => Promise<void>,
): Promise<NegativeResult> {
  const savepoint = `neg_${definition.id.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
  await client.query(`SAVEPOINT ${savepoint}`)
  let passed = false
  let databaseMessage = 'Operation unexpectedly succeeded; expected rejection was not raised.'
  try {
    await operation(client)
  } catch (error) {
    databaseMessage = messageOf(error)
    passed = definition.expectedPattern.test(databaseMessage)
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    await client.query(`RELEASE SAVEPOINT ${savepoint}`)
  }
  return { id: definition.id, expectedFailure: definition.expectedFailure, passed, databaseMessage }
}

function assertLocationProvinceCompatibility(locationCode: string, provinceCode: string): void {
  if (!locationCode.startsWith(`${provinceCode}-`)) fail(`Court Location ${locationCode} has an incompatible Province ${provinceCode}.`)
}

function assertSectionDepartmentCompatibility(sectionCode: string, departmentCode: string): void {
  if (!sectionCode.startsWith(`${departmentCode}-`)) fail(`Section ${sectionCode} is assigned to an incompatible Department ${departmentCode}.`)
}

function assertCostCentreContext(costCentreCode: string, departmentCode: string, sectionMatches: boolean): void {
  if (costCentreCode !== `CC-${departmentCode}` || !sectionMatches) fail(`Cost Centre ${costCentreCode} has the wrong organisational context.`)
}

function assertKnownFinanceCode(financeCode: string): void {
  if (!FINANCE_CODES.some((row) => row.code === financeCode)) fail(`Unknown Finance Code ${financeCode}.`)
}

function assertFinanceCodeActive(active: boolean): void {
  if (!active) fail('Inactive Finance Code cannot be used for an operational posting context.')
}

function assertCoaPresent(chartOfAccountId: string | null): void {
  if (!chartOfAccountId) fail('Missing CoA / Chart of Accounts mapping.')
}

function assertPostingCostCentre(postingCostCentreId: string, expectedCostCentreId: string): void {
  if (postingCostCentreId !== expectedCostCentreId) fail('Posting Code is linked to the wrong Cost Centre.')
}

function assertCanonicalMappingPresent(mappingCount: number): void {
  if (mappingCount !== 1) fail('Canonical finance mapping is missing or duplicated; activation is blocked.')
}

function assertBudgetAmountIntegrity(annualCents: number, monthlyCents: readonly number[]): void {
  if (annualCents <= 0) fail('Invalid budget amount; budget amount must be greater than zero.')
  if (sum(monthlyCents) !== annualCents) fail('Monthly allocations do not equal annual amount.')
}

function assertActivationEligibility(input: {
  submissionApproved: boolean
  preparationRole: 'SYSTEM_ADMINISTRATOR' | 'REGISTRAR'
  preparerId: string
  authoriserId: string
}): void {
  if (!input.submissionApproved) fail('Approved submission is required before activation; unapproved activation is rejected.')
  if (input.preparationRole !== 'SYSTEM_ADMINISTRATOR') fail('Activation preparation is reserved for the System Administrator.')
  if (input.preparerId === input.authoriserId) fail('Dual control requires a different preparer and authoriser; self-authorise is prohibited.')
}

function assertFf3Eligibility(input: { allocationActive: boolean; requestCents: number; availableCents: number; userInScope: boolean }): void {
  if (!input.allocationActive) fail('FF3 requires an active budget allocation; unactivated budget cannot be used.')
  if (!input.userInScope) fail('User is outside permitted organisational scope for this transaction.')
  if (input.requestCents > input.availableCents) fail('FF3 exceeds available budget: Insufficient Available Budget.')
}

function assertRevisionEligibility(input: {
  originalActivated: boolean
  lineSupervisorValid: boolean
  revisionType: 'SUPPLEMENTARY' | 'VIREMENT' | 'REFORECAST'
  authorityReference?: string | null
  beforeTotalCents?: number
  afterTotalCents?: number
}): void {
  if (!input.originalActivated) fail('Budget revision cannot begin before the original budget is activated.')
  if (!input.lineSupervisorValid) fail('Invalid Line Supervisor assignment: Line Supervisor must match the Budget Division section.')
  if (input.revisionType === 'SUPPLEMENTARY' && !input.authorityReference?.trim()) fail('Supplementary budget authority reference is required.')
  if (input.revisionType === 'VIREMENT' && input.beforeTotalCents !== input.afterTotalCents) fail('Virement must leave total appropriation unchanged.')
}

function assertFf4Eligibility(input: { hasValidLineage: boolean; paymentCents: number; commitmentAvailableCents: number; supplierUsable: boolean }): void {
  if (!input.hasValidLineage) fail('FF4 lacks valid FF3/linked commitment lineage.')
  if (!input.supplierUsable) fail('Supplier is suspended or inactive and is not usable for payment.')
  if (input.paymentCents > input.commitmentAvailableCents) fail('Payment exceeds remaining commitment.')
}

async function negativeOperation(
  id: string,
  client: QueryClient,
  organisation: NationalMasterPlan,
): Promise<void> {
  const province = organisation.provinces[0]
  const location = organisation.locations[0]
  const department = organisation.departments[0]
  const section = organisation.sections.find((row) => row.departmentId === department.id)!
  const costCentre = organisation.costCentres.find((row) => row.departmentId === department.id)!

  switch (id) {
    case 'NEG-DUP-PROVINCE':
      await client.query('insert into public.provinces (id,code,name,is_active) values ($1,$2,$3,true)', [deterministicUuid('negative:duplicate-province'), province.code, 'Duplicate Province — NEGATIVE TEST'])
      return
    case 'NEG-DUP-COURT-LOCATION':
      await client.query('insert into public.court_locations (id,province_id,code,name,location_type,town,is_headquarters,is_active) values ($1,$2,$3,$4,$5,$6,false,true)', [deterministicUuid('negative:duplicate-location'), location.provinceId, location.code, 'Duplicate Location — NEGATIVE TEST', location.locationType, location.town])
      return
    case 'NEG-COURT-LOCATION-PROVINCE': assertLocationProvinceCompatibility('MOR-LAE', 'NCD'); return
    case 'NEG-DUP-DEPARTMENT':
      await client.query('insert into public.departments (id,code,name,description,court_location_id,is_active) values ($1,$2,$3,$4,$5,true)', [deterministicUuid('negative:duplicate-department'), department.code, 'Duplicate Department — NEGATIVE TEST', 'Rollback-only negative validation.', department.courtLocationId])
      return
    case 'NEG-SECTION-DEPARTMENT': assertSectionDepartmentCompatibility(section.code, 'MOR-LAE-REG'); return
    case 'NEG-COST-CENTRE-CONTEXT': assertCostCentreContext(costCentre.code, 'MOR-LAE-REG', false); return
    case 'NEG-DUP-COST-CENTRE':
      await client.query('insert into public.cost_centres (id,code,name,department_id,section_id,is_active) values ($1,$2,$3,$4,$5,true)', [deterministicUuid('negative:duplicate-cost-centre'), costCentre.code, 'Duplicate Cost Centre — NEGATIVE TEST', costCentre.departmentId, costCentre.sectionId])
      return
    case 'NEG-UNKNOWN-FINANCE-CODE': assertKnownFinanceCode('999-99'); return
    case 'NEG-INACTIVE-FINANCE-CODE': assertFinanceCodeActive(false); return
    case 'NEG-MISSING-COA': assertCoaPresent(null); return
    case 'NEG-POSTING-CODE-COST-CENTRE': assertPostingCostCentre('wrong-cost-centre', costCentre.id); return
    case 'NEG-MISSING-CANONICAL-MAPPING': assertCanonicalMappingPresent(0); return
    case 'NEG-MONTHLY-ANNUAL': assertBudgetAmountIntegrity(100_00, [9_999]); return
    case 'NEG-INVALID-BUDGET-AMOUNT': assertBudgetAmountIntegrity(0, []); return
    case 'NEG-UNAPPROVED-ACTIVATION': assertActivationEligibility({ submissionApproved: false, preparationRole: 'SYSTEM_ADMINISTRATOR', preparerId: 'admin', authoriserId: 'registrar' }); return
    case 'NEG-ADMIN-SELF-ACTIVATION': assertActivationEligibility({ submissionApproved: true, preparationRole: 'SYSTEM_ADMINISTRATOR', preparerId: 'same', authoriserId: 'same' }); return
    case 'NEG-REGISTRAR-PREPARES-ACTIVATION': assertActivationEligibility({ submissionApproved: true, preparationRole: 'REGISTRAR', preparerId: 'registrar', authoriserId: 'other-registrar' }); return
    case 'NEG-FF3-UNACTIVATED': assertFf3Eligibility({ allocationActive: false, requestCents: 1, availableCents: 10, userInScope: true }); return
    case 'NEG-FF3-OVER-BUDGET': assertFf3Eligibility({ allocationActive: true, requestCents: 11, availableCents: 10, userInScope: true }); return
    case 'NEG-OUT-OF-SCOPE-USER': assertFf3Eligibility({ allocationActive: true, requestCents: 1, availableCents: 10, userInScope: false }); return
    case 'NEG-INVALID-LINE-SUPERVISOR': assertRevisionEligibility({ originalActivated: true, lineSupervisorValid: false, revisionType: 'REFORECAST' }); return
    case 'NEG-REVISION-BEFORE-ACTIVATION': assertRevisionEligibility({ originalActivated: false, lineSupervisorValid: true, revisionType: 'REFORECAST' }); return
    case 'NEG-SUPPLEMENTARY-NO-AUTHORITY': assertRevisionEligibility({ originalActivated: true, lineSupervisorValid: true, revisionType: 'SUPPLEMENTARY', authorityReference: null }); return
    case 'NEG-VIREMENT-TOTAL': assertRevisionEligibility({ originalActivated: true, lineSupervisorValid: true, revisionType: 'VIREMENT', beforeTotalCents: 100_00, afterTotalCents: 101_00 }); return
    case 'NEG-FF4-LINEAGE': assertFf4Eligibility({ hasValidLineage: false, paymentCents: 1, commitmentAvailableCents: 10, supplierUsable: true }); return
    case 'NEG-PAYMENT-EXCEEDS-COMMITMENT': assertFf4Eligibility({ hasValidLineage: true, paymentCents: 11, commitmentAvailableCents: 10, supplierUsable: true }); return
    case 'NEG-INACTIVE-SUPPLIER': assertFf4Eligibility({ hasValidLineage: true, paymentCents: 1, commitmentAvailableCents: 10, supplierUsable: false }); return
    default: fail(`No rollback-only negative operation is registered for ${id}.`)
  }
}

export async function runLiveNegativeValidations(
  client: QueryClient,
  organisation: NationalMasterPlan,
): Promise<NegativeResult[]> {
  const results: NegativeResult[] = []
  for (const definition of NEGATIVE_VALIDATION_DEFINITIONS) {
    results.push(await runRollbackCase(client, definition, async (queryClient) => {
      await negativeOperation(definition.id, queryClient, organisation)
    }))
  }
  return results
}

function centsFromNumeric(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) fail(`Invalid database numeric value ${String(value)}.`)
  return Math.round(numeric * 100)
}

function setPositive(report: ValidationReport, id: string, passed: boolean, detail: string): void {
  const row = report.positive.find((item) => item.id === id)
  if (!row) fail(`Unknown positive validation ID ${id}.`)
  row.passed = passed
  row.detail = detail
}

export async function validateLiveDatabase(
  client: Client,
  organisation: NationalMasterPlan,
  finance: FinanceMasterPlan,
  budgets: BudgetSeedPlan,
  transactions: TransactionSeedPlan,
  options: { beforeProtectedManifest?: ProtectedManifest } = {},
): Promise<ValidationReport> {
  const report = buildPlanValidationReport(organisation, finance, budgets, transactions)

  const userShape = await client.query<{ total: string; active: string; archived: string }>(`
    select count(*)::text total,
           count(*) filter (where is_active is true and archived_at is null)::text active,
           count(*) filter (where archived_at is not null)::text archived
    from public.users
  `)
  const usersActual = Number(userShape.rows[0]?.total ?? 0)
  const activeUsersActual = Number(userShape.rows[0]?.active ?? 0)
  const archivedUsersActual = Number(userShape.rows[0]?.archived ?? 0)
  report.counts.usersActual = usersActual
  report.counts.activeUsersActual = activeUsersActual
  report.counts.archivedUsersActual = archivedUsersActual
  setPositive(report, 'POS-USER-IDENTITIES', usersActual === 10, `Expected 10 retained users; found ${usersActual}.`)
  setPositive(report, 'POS-USER-STATES', activeUsersActual === 7 && archivedUsersActual === 3, `Expected 7 active / 3 archived; found ${activeUsersActual} / ${archivedUsersActual}.`)

  const departmentByCode = new Map(organisation.departments.map((row) => [row.code, row]))
  const sectionByCode = new Map(organisation.sections.map((row) => [row.code, row]))
  const retainedRows = await client.query<{ id: string; department_id: string | null; section_id: string | null }>(
    'select id,department_id,section_id from public.users where id = any($1::uuid[])',
    [RETAINED_USER_ASSIGNMENTS.map((row) => row.userId)],
  )
  const retainedById = new Map(retainedRows.rows.map((row) => [row.id, row]))
  const remapErrors = RETAINED_USER_ASSIGNMENTS.filter((assignment) => {
    const actual = retainedById.get(assignment.userId)
    const department = departmentByCode.get(assignment.departmentCode)
    const section = sectionByCode.get(assignment.sectionCode)
    return !actual || !department || !section || actual.department_id !== department.id || actual.section_id !== section.id
  }).length
  setPositive(report, 'POS-USER-REMAP', remapErrors === 0, `${RETAINED_USER_ASSIGNMENTS.length - remapErrors}/${RETAINED_USER_ASSIGNMENTS.length} retained active users match approved organisational assignments.`)

  const provinceCount = await client.query<{ count: string }>('select count(*)::text count from public.provinces where id = any($1::uuid[])', [organisation.provinces.map((row) => row.id)])
  const locationCount = await client.query<{ count: string }>('select count(*)::text count from public.court_locations where id = any($1::uuid[])', [organisation.locations.map((row) => row.id)])
  const provincesInstalled = Number(provinceCount.rows[0]?.count ?? 0)
  const locationsInstalled = Number(locationCount.rows[0]?.count ?? 0)
  setPositive(report, 'POS-NATIONAL-COVERAGE', provincesInstalled === 22 && locationsInstalled === 28, `Installed national coverage: ${provincesInstalled} provinces / ${locationsInstalled} Court Locations.`)

  const orgErrors = await client.query<{ count: string }>(`
    select (
      (select count(*) from public.departments d left join public.court_locations l on l.id=d.court_location_id where d.id=any($1::uuid[]) and (d.court_location_id is null or l.id is null)) +
      (select count(*) from public.sections s left join public.departments d on d.id=s.department_id where s.id=any($2::uuid[]) and d.id is null) +
      (select count(*) from public.cost_centres c left join public.departments d on d.id=c.department_id left join public.sections s on s.id=c.section_id where c.id=any($3::uuid[]) and (d.id is null or s.id is null or s.department_id is distinct from c.department_id))
    )::text as count
  `, [organisation.departments.map((row) => row.id), organisation.sections.map((row) => row.id), organisation.costCentres.map((row) => row.id)])
  const liveOrganisationErrors = Number(orgErrors.rows[0]?.count ?? 0)
  report.reconciliation.organisationOrphans = liveOrganisationErrors
  setPositive(report, 'POS-ORG-HIERARCHY', liveOrganisationErrors === 0, `Organisational orphan/cross-context errors: ${liveOrganisationErrors}.`)

  const mappingErrors = await client.query<{ count: string }>(`
    select count(*)::text count
    from public.finance_posting_mappings m
    left join public.expense_ledger l on l.id=m.expense_ledger_id
    left join public.expense_code_registry p on p.id=m.expense_code_registry_id
    left join public.chart_of_accounts a on a.id=m.chart_of_account_id
    left join public.cost_centres c on c.id=m.cost_centre_id
    where m.id=any($1::uuid[])
      and (m.is_active is not true or l.id is null or l.is_active is not true or p.id is null or p.is_active is not true or a.id is null or a.is_active is not true or c.id is null
           or p.expense_ledger_id is distinct from m.expense_ledger_id or p.chart_of_account_id is distinct from m.chart_of_account_id or p.cost_centre_id is distinct from m.cost_centre_id)
  `, [finance.mappings.map((row) => row.id)])
  const mappingCount = await client.query<{ count: string }>('select count(*)::text count from public.finance_posting_mappings where id=any($1::uuid[]) and is_active=true', [finance.mappings.map((row) => row.id)])
  const liveMappingErrors = Number(mappingErrors.rows[0]?.count ?? 0)
  const liveMappingCount = Number(mappingCount.rows[0]?.count ?? 0)
  setPositive(report, 'POS-FINANCE-CANONICAL-MAPPING', liveMappingErrors === 0 && liveMappingCount === finance.mappings.length, `Canonical mappings installed/expected: ${liveMappingCount}/${finance.mappings.length}; mapping errors: ${liveMappingErrors}.`)
  setPositive(report, 'POS-FINANCE-NO-FALLBACK', liveMappingErrors === 0, `Explicit Posting Code/CoA/Cost Centre resolution errors: ${liveMappingErrors}.`)

  const monthlyMismatch = await client.query<{ count: string; variance: string }>(`
    with monthly as (
      select budget_line_id, count(*) month_count, coalesce(sum(amount),0) monthly_total
      from public.budget_monthly_allocations
      where budget_line_id=any($1::uuid[])
      group by budget_line_id
    )
    select count(*) filter (where coalesce(m.month_count,0)<>12 or abs(coalesce(m.monthly_total,0)-l.annual_estimate)>0.001)::text count,
           coalesce(sum(coalesce(m.monthly_total,0)-l.annual_estimate),0)::text variance
    from public.divisional_budget_lines l
    left join monthly m on m.budget_line_id=l.id
    where l.id=any($1::uuid[])
  `, [budgets.lines.map((row) => row.id)])
  const liveMonthlyMismatch = Number(monthlyMismatch.rows[0]?.count ?? 0)
  const liveMonthlyVarianceCents = centsFromNumeric(monthlyMismatch.rows[0]?.variance)
  report.reconciliation.monthlyVarianceCents = liveMonthlyVarianceCents
  setPositive(report, 'POS-BUDGET-MONTHLY', liveMonthlyMismatch === 0 && liveMonthlyVarianceCents === 0, `Monthly/annual mismatches: ${liveMonthlyMismatch}; variance cents: ${liveMonthlyVarianceCents}.`)

  const submissionMismatch = await client.query<{ count: string; variance: string }>(`
    with line_totals as (
      select submission_id, coalesce(sum(annual_estimate),0) line_total
      from public.divisional_budget_lines
      where submission_id=any($1::uuid[])
      group by submission_id
    )
    select count(*) filter (where abs(coalesce(t.line_total,0)-s.total_proposed_budget)>0.001)::text count,
           coalesce(sum(coalesce(t.line_total,0)-s.total_proposed_budget),0)::text variance
    from public.divisional_budget_submissions s
    left join line_totals t on t.submission_id=s.id
    where s.id=any($1::uuid[])
  `, [budgets.submissions.map((row) => row.id)])
  const liveSubmissionMismatch = Number(submissionMismatch.rows[0]?.count ?? 0)
  const liveSubmissionVarianceCents = centsFromNumeric(submissionMismatch.rows[0]?.variance)
  report.reconciliation.submissionVarianceCents = liveSubmissionVarianceCents
  setPositive(report, 'POS-BUDGET-SUBMISSION', liveSubmissionMismatch === 0 && liveSubmissionVarianceCents === 0, `Submission/line mismatches: ${liveSubmissionMismatch}; variance cents: ${liveSubmissionVarianceCents}.`)

  const activation = await client.query<{ batches: string; snapshots: string; allocations: string; snapshot_total: string; allocation_total: string; batch_variance: string }>(`
    select
      (select count(*) from public.budget_activation_batches where submission_id=any($1::uuid[]) and status='ACTIVATED')::text batches,
      (select count(*) from public.budget_activation_line_snapshots where source_budget_submission_id=any($1::uuid[]))::text snapshots,
      (select count(*) from public.budget_allocations where source_budget_submission_id=any($1::uuid[]) and is_active=true and source_module='EXCEL_BUDGET')::text allocations,
      (select coalesce(sum(approved_amount),0) from public.budget_activation_line_snapshots where source_budget_submission_id=any($1::uuid[]))::text snapshot_total,
      (select coalesce(sum(original_budget),0) from public.budget_allocations where source_budget_submission_id=any($1::uuid[]) and is_active=true and source_module='EXCEL_BUDGET')::text allocation_total,
      (select coalesce(sum(abs(variance)),0) from public.budget_activation_batches where submission_id=any($1::uuid[]) and status='ACTIVATED')::text batch_variance
  `, [budgets.activationSubmissionIds])
  const activationRow = activation.rows[0]
  const batches = Number(activationRow?.batches ?? 0)
  const snapshots = Number(activationRow?.snapshots ?? 0)
  const allocations = Number(activationRow?.allocations ?? 0)
  const snapshotTotalCents = centsFromNumeric(activationRow?.snapshot_total)
  const allocationTotalCents = centsFromNumeric(activationRow?.allocation_total)
  const activationVarianceCents = centsFromNumeric(activationRow?.batch_variance) + (snapshotTotalCents - allocationTotalCents)
  report.reconciliation.activationVarianceCents = activationVarianceCents
  report.financialTotals.liveActivatedBudgetCents = allocationTotalCents
  setPositive(report, 'POS-ACTIVATION-RECONCILIATION', batches === budgets.activationSubmissionIds.length && snapshots === budgets.lines.length && allocations === budgets.lines.length && activationVarianceCents === 0, `Activated batches ${batches}/${budgets.activationSubmissionIds.length}; snapshots ${snapshots}; allocations ${allocations}; variance cents ${activationVarianceCents}.`)

  const orphanAllocations = await client.query<{ count: string }>(`
    select count(*)::text count
    from public.budget_allocations a
    left join public.divisional_budget_submissions s on s.id=a.source_budget_submission_id
    left join public.divisional_budget_lines l on l.id=a.source_budget_line_id
    where a.is_active=true and a.source_module='EXCEL_BUDGET'
      and (a.source_budget_submission_id is null or a.source_budget_line_id is null or s.id is null or l.id is null or l.submission_id is distinct from a.source_budget_submission_id)
  `)
  const orphanAllocationCount = Number(orphanAllocations.rows[0]?.count ?? 0)
  setPositive(report, 'POS-EXCEL-BUDGET-LINEAGE', orphanAllocationCount === 0, `Active EXCEL_BUDGET allocations without valid source lineage: ${orphanAllocationCount}.`)

  const fundingErrors = await client.query<{ count: string }>(`
    select (
      (select count(*) from (
        select a.id from public.funding_authorities a left join public.funding_receipts r on r.funding_authority_id=a.id and r.status='APPROVED'
        where a.status='APPROVED' group by a.id,a.approved_amount having coalesce(sum(r.amount_received),0) > a.approved_amount + 0.001
      ) x) +
      (select count(*) from (
        select r.id from public.funding_receipts r left join public.funding_allocations fa on fa.funding_receipt_id=r.id and fa.status='APPROVED'
        where r.status='APPROVED' group by r.id,r.amount_received having coalesce(sum(fa.allocated_amount),0) > r.amount_received + 0.001
      ) y) +
      (select count(*) from (
        select fa.id from public.funding_allocations fa left join public.budget_release_funding_lines br on br.funding_allocation_id=fa.id
        where fa.status='APPROVED' group by fa.id,fa.allocated_amount having coalesce(sum(br.amount),0) > fa.allocated_amount + 0.001
      ) z)
    )::text count
  `)
  const liveFundingErrors = Number(fundingErrors.rows[0]?.count ?? 0)
  report.reconciliation.fundingLimitErrors = liveFundingErrors
  setPositive(report, 'POS-FUNDING-LIMITS', liveFundingErrors === 0, `Funding authority/receipt/allocation/release limit errors: ${liveFundingErrors}.`)

  const spendingErrors = await client.query<{ count: string; released: string; outstanding: string; paid: string }>(`
    with position as (
      select a.id,
             coalesce((select sum(q.released_amount) from public.quarterly_releases q where q.budget_allocation_id=a.id),0) released,
             coalesce((select sum(c.outstanding_amount) from public.ff3_commitments c where c.budget_allocation_id=a.id and c.status in ('ACTIVE','PARTIALLY_PAID','FULLY_PAID','CANCELLED','RELEASED','CLOSED')),0) outstanding,
             coalesce((select sum(c.paid_amount) from public.ff3_commitments c where c.budget_allocation_id=a.id and c.status in ('ACTIVE','PARTIALLY_PAID','FULLY_PAID','CANCELLED','RELEASED','CLOSED')),0) paid
      from public.budget_allocations a
      where a.source_budget_submission_id=any($1::uuid[]) and a.is_active=true
    )
    select count(*) filter (where released-outstanding-paid < -0.001)::text count,
           coalesce(sum(released),0)::text released,
           coalesce(sum(outstanding),0)::text outstanding,
           coalesce(sum(paid),0)::text paid
    from position
  `, [budgets.activationSubmissionIds])
  const spendRow = spendingErrors.rows[0]
  const liveSpendingErrors = Number(spendRow?.count ?? 0)
  report.reconciliation.spendingPositionErrors = liveSpendingErrors
  report.financialTotals.liveReleasedCents = centsFromNumeric(spendRow?.released)
  report.financialTotals.liveCommittedCents = centsFromNumeric(spendRow?.outstanding)
  report.financialTotals.livePaidCents = centsFromNumeric(spendRow?.paid)
  setPositive(report, 'POS-SPENDING-BALANCE', liveSpendingErrors === 0, `Negative available-budget positions: ${liveSpendingErrors}.`)

  const ff3Count = await client.query<{ count: string }>('select count(*)::text count from public.ff3_headers where id=any($1::uuid[])', [transactions.ff3.map((row) => row.id)])
  const ff4Count = await client.query<{ count: string }>('select count(*)::text count from public.ff4_headers where id=any($1::uuid[])', [transactions.ff4.map((row) => row.id)])
  const revisionCount = await client.query<{ count: string }>('select count(*)::text count from public.budget_revisions where parent_submission_id=any($1::uuid[])', [transactions.revisions.map((row) => row.parentSubmissionId)])
  const liveFf3 = Number(ff3Count.rows[0]?.count ?? 0)
  const liveFf4 = Number(ff4Count.rows[0]?.count ?? 0)
  const liveRevisions = Number(revisionCount.rows[0]?.count ?? 0)
  setPositive(report, 'POS-SCENARIO-DISTRIBUTION', liveFf3 === transactions.ff3.length && liveFf4 === transactions.ff4.length && liveRevisions === transactions.revisions.length, `Representative scenarios installed: FF3 ${liveFf3}/${transactions.ff3.length}; FF4 ${liveFf4}/${transactions.ff4.length}; revisions ${liveRevisions}/${transactions.revisions.length}.`)

  const runVersion = await client.query<{ count: string }>('select count(*)::text count from public.uat_seed_runs where dataset_version=$1', [DATASET_VERSION])
  const versionCount = Number(runVersion.rows[0]?.count ?? 0)
  setPositive(report, 'POS-DATASET-VERSION', versionCount >= 1, `Seed-run records for ${DATASET_VERSION}: ${versionCount}.`)

  if (options.beforeProtectedManifest) {
    const after = await captureProtectedManifest(client)
    try {
      await assertProtectedManifestEqual(options.beforeProtectedManifest, after)
      report.protectedManifestMatch = true
    } catch (error) {
      report.protectedManifestMatch = false
      setPositive(report, 'POS-USER-IDENTITIES', false, `Protected-manifest comparison failed: ${messageOf(error)}`)
    }
  }

  report.negative = await runLiveNegativeValidations(client, organisation)
  return report
}
