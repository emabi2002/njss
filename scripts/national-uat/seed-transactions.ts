import type { Client } from 'pg'
import { FUNDING_SOURCES, SUPPLIER_SCENARIOS, TRANSACTION_SCENARIOS, type SupplierScenarioStatus } from './catalog/scenarios'
import { DATASET_VERSION } from './constants'
import { setActorContext } from './db'
import { deterministicUuid } from './deterministic-id'
import type { BudgetSeedPlan } from './seed-budgets'
import type { FinanceMasterPlan } from './seed-finance'
import { RETAINED_USER_ASSIGNMENTS, type NationalMasterPlan } from './seed-master'

export const TRANSACTION_ACTORS = Object.freeze({
  requisitionOfficer: '87075d67-26d8-4144-993d-56a2b244e76c',
  lineSupervisor: 'a7a7aeb9-082d-4ed0-a4a7-07ba92f24f00',
  registrar: '7343951c-b3ec-47e3-a177-5fb12c68c3aa',
  alternateRegistrar: '843dd453-59b4-4436-b85f-3f4a35954e5b',
  paymentOfficer: '4883e82e-316e-4681-853b-0a412f2644a8',
  systemAdministrator: '73302177-32a5-4433-bd9e-d370af2abe83',
  alternateSystemAdministrator: '7a2fe5c9-7da2-42ae-8d3f-6d02266ff26a',
})

type SupplierWorkflowStatus = 'DRAFT' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'
type Ff3TargetStatus = 'COMMITTED' | 'SUBMITTED' | 'RETURNED' | 'REJECTED'
type Ff4TargetStatus = 'SUBMITTED' | 'APPROVED' | 'PAID' | 'RECONCILED'
type RevisionType = 'SUPPLEMENTARY' | 'REFORECAST'

export type FundingSourcePlan = {
  id: string
  code: string
  name: string
  sourceType: string
}

export type SupplierPlan = {
  id: string
  code: string
  name: string
  category: string
  homeLocationCode: string
  sourceStatus: SupplierScenarioStatus
  targetStatus: SupplierWorkflowStatus
  complianceStatus: 'COMPLIANT' | 'INCOMPLETE'
}

export type FundingAllocationScenarioPlan = {
  code: string
  budgetLineId: string
  submissionId: string
  fundingSourceId: string
  allocatedCents: number
  releaseCents: number
}

export type Ff3ScenarioPlan = {
  id: string
  code: string
  scenarioCode: string
  locationCode: string
  targetStatus: Ff3TargetStatus
  submissionId: string
  budgetLineId: string
  expenseLedgerId: string
  expenseCodeRegistryId: string
  chartOfAccountId: string
  departmentId: string
  sectionId: string
  costCentreId: string
  provinceId: string
  financeCode: string
  fundingSourceId: string
  supplierId: string
  requestCents: number
  releaseCents: number
}

export type Ff4ScenarioPlan = {
  id: string
  code: string
  scenarioCode: string
  targetStatus: Ff4TargetStatus
  ff3Id: string
  supplierId: string
  amountCents: number
}

export type RevisionScenarioPlan = {
  scenarioCode: string
  locationCode: string
  parentSubmissionId: string
  divisionId: string
  departmentId: string
  sectionId: string
  revisionType: RevisionType
  reason: string
  authorityReference: string | null
  requestedChangeCents: number
}

export type TransactionSeedPlan = {
  fundingSources: FundingSourcePlan[]
  suppliers: SupplierPlan[]
  fundingAllocations: FundingAllocationScenarioPlan[]
  ff3: Ff3ScenarioPlan[]
  ff4: Ff4ScenarioPlan[]
  revisions: RevisionScenarioPlan[]
  revisionActorPlan: {
    lineSupervisorId: string
    restoreDepartmentCode: string
    restoreSectionCode: string
    requiresTemporaryScopeAlignment: true
  }
}

const FF3_STATUS_MATRIX: readonly (readonly Ff3TargetStatus[])[] = [
  ['COMMITTED', 'COMMITTED', 'COMMITTED', 'COMMITTED'],
  ['COMMITTED', 'COMMITTED', 'COMMITTED', 'SUBMITTED'],
  ['COMMITTED', 'COMMITTED', 'RETURNED', 'REJECTED'],
  ['COMMITTED', 'COMMITTED', 'COMMITTED', 'SUBMITTED'],
  ['COMMITTED', 'COMMITTED', 'RETURNED', 'REJECTED'],
  ['COMMITTED', 'COMMITTED', 'SUBMITTED', 'RETURNED'],
  ['COMMITTED', 'COMMITTED', 'SUBMITTED', 'REJECTED'],
  ['COMMITTED', 'COMMITTED', 'RETURNED', 'REJECTED'],
] as const

function supplierTargetStatus(status: SupplierScenarioStatus): { workflow: SupplierWorkflowStatus; compliance: 'COMPLIANT' | 'INCOMPLETE' } {
  switch (status) {
    case 'APPROVED': return { workflow: 'APPROVED', compliance: 'COMPLIANT' }
    case 'VERIFIED': return { workflow: 'VERIFIED', compliance: 'COMPLIANT' }
    case 'PENDING': return { workflow: 'PENDING_VERIFICATION', compliance: 'COMPLIANT' }
    case 'SUSPENDED': return { workflow: 'SUSPENDED', compliance: 'COMPLIANT' }
    case 'REJECTED': return { workflow: 'REJECTED', compliance: 'COMPLIANT' }
    case 'INCOMPLETE': return { workflow: 'DRAFT', compliance: 'INCOMPLETE' }
  }
}

export function authorityTypeForFundingSource(sourceType: string): string {
  switch (sourceType) {
    case 'GOVERNMENT_RECURRENT':
    case 'GOVERNMENT_DEVELOPMENT':
      return 'GOVERNMENT_APPROPRIATION'
    case 'DEVELOPMENT_PARTNER':
      return 'DEVELOPMENT_PARTNER'
    case 'SPECIAL_PURPOSE':
      return 'PROJECT_FUNDING'
    case 'OTHER':
      return 'OTHER'
    default:
      throw new Error(`Unsupported funding source type for authority: ${sourceType}`)
  }
}

function centsFraction(value: number, numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid positive cents value ${value}`)
  return Math.max(1, Math.floor((value * numerator) / denominator))
}

export function buildTransactionSeedPlan(
  organisation: NationalMasterPlan,
  finance: FinanceMasterPlan,
  budgets: BudgetSeedPlan,
): TransactionSeedPlan {
  const fundingSources: FundingSourcePlan[] = FUNDING_SOURCES.map((source) => ({
    id: deterministicUuid(`funding-source:${source.code}`),
    code: source.code,
    name: source.name,
    sourceType: source.sourceType,
  }))

  const suppliers: SupplierPlan[] = SUPPLIER_SCENARIOS.map((supplier) => {
    const target = supplierTargetStatus(supplier.status)
    return {
      id: deterministicUuid(`supplier:${supplier.code}`),
      code: supplier.code,
      name: supplier.name,
      category: supplier.category,
      homeLocationCode: supplier.homeLocationCode,
      sourceStatus: supplier.status,
      targetStatus: target.workflow,
      complianceStatus: target.compliance,
    }
  })
  const approvedSuppliers = suppliers.filter((supplier) => supplier.targetStatus === 'APPROVED')
  if (approvedSuppliers.length === 0) throw new Error('At least one APPROVED UAT supplier is required')

  const submissionById = new Map(budgets.submissions.map((submission) => [submission.id, submission]))
  const contextByPostingId = new Map(finance.contexts.map((context) => [context.expenseCodeRegistryId, context]))
  const locationByCode = new Map(organisation.locations.map((location) => [location.code, location]))
  const divisionById = new Map(organisation.budgetDivisions.map((division) => [division.id, division]))
  const fundingAllocations: FundingAllocationScenarioPlan[] = []
  const ff3: Ff3ScenarioPlan[] = []

  let globalFf3Index = 0
  TRANSACTION_SCENARIOS.forEach((scenario, scenarioIndex) => {
    const candidates = budgets.lines
      .map((line) => ({ line, submission: submissionById.get(line.submissionId), context: contextByPostingId.get(line.expenseCodeRegistryId) }))
      .filter((row) => row.submission?.courtLocationCode === scenario.locationCode && scenario.financeCodes.includes(row.line.financeCode) && row.context)
      .sort((left, right) => `${left.line.financeCode}:${left.line.activityReference}`.localeCompare(`${right.line.financeCode}:${right.line.activityReference}`))

    if (candidates.length < 4) throw new Error(`Scenario ${scenario.code} requires four distinct budget lines; only ${candidates.length} are available`)
    const selected = candidates.slice(0, 4)
    const location = locationByCode.get(scenario.locationCode)
    if (!location) throw new Error(`Unknown transaction location ${scenario.locationCode}`)

    selected.forEach((row, localIndex) => {
      const submission = row.submission!
      const context = row.context!
      const fundingSource = fundingSources[globalFf3Index % fundingSources.length]
      const supplier = approvedSuppliers[globalFf3Index % approvedSuppliers.length]
      const releaseCents = centsFraction(row.line.annualCents, 60, 100)
      const requestCents = centsFraction(row.line.annualCents, 20, 100)
      const id = deterministicUuid(`ff3:${scenario.code}:${localIndex + 1}`)
      const code = `UAT-FF3-${String(globalFf3Index + 1).padStart(3, '0')}`
      ff3.push({
        id,
        code,
        scenarioCode: scenario.code,
        locationCode: scenario.locationCode,
        targetStatus: FF3_STATUS_MATRIX[scenarioIndex][localIndex],
        submissionId: submission.id,
        budgetLineId: row.line.id,
        expenseLedgerId: row.line.expenseLedgerId,
        expenseCodeRegistryId: row.line.expenseCodeRegistryId,
        chartOfAccountId: context.chartOfAccountId,
        departmentId: context.departmentId,
        sectionId: context.sectionId,
        costCentreId: context.costCentreId,
        provinceId: location.provinceId,
        financeCode: row.line.financeCode,
        fundingSourceId: fundingSource.id,
        supplierId: supplier.id,
        requestCents,
        releaseCents,
      })
      fundingAllocations.push({
        code: `UAT-FUND-${String(globalFf3Index + 1).padStart(3, '0')}`,
        budgetLineId: row.line.id,
        submissionId: submission.id,
        fundingSourceId: fundingSource.id,
        allocatedCents: row.line.annualCents,
        releaseCents,
      })
      globalFf3Index += 1
    })
  })

  const ff4: Ff4ScenarioPlan[] = []
  TRANSACTION_SCENARIOS.forEach((scenario, scenarioIndex) => {
    const committed = ff3.filter((row) => row.scenarioCode === scenario.code && row.targetStatus === 'COMMITTED').slice(0, 2)
    if (committed.length !== 2) throw new Error(`Scenario ${scenario.code} must provide two committed FF3 cases for FF4 coverage`)
    const targetStatus: Ff4TargetStatus = scenarioIndex < 2 ? 'SUBMITTED' : scenarioIndex < 4 ? 'APPROVED' : scenarioIndex < 6 ? 'PAID' : 'RECONCILED'
    committed.forEach((row, localIndex) => {
      ff4.push({
        id: deterministicUuid(`ff4:${scenario.code}:${localIndex + 1}`),
        code: `UAT-FF4-${String(ff4.length + 1).padStart(3, '0')}`,
        scenarioCode: scenario.code,
        targetStatus,
        ff3Id: row.id,
        supplierId: row.supplierId,
        amountCents: centsFraction(row.requestCents, 50, 100),
      })
    })
  })

  const revisions: RevisionScenarioPlan[] = TRANSACTION_SCENARIOS.map((scenario, index) => {
    const sourceFf3 = ff3.find((row) => row.scenarioCode === scenario.code)
    if (!sourceFf3) throw new Error(`Scenario ${scenario.code} has no revision source budget`)
    const submission = submissionById.get(sourceFf3.submissionId)
    const division = submission ? divisionById.get(submission.divisionId) : undefined
    if (!submission || !division) throw new Error(`Scenario ${scenario.code} has no valid parent budget division`)
    const revisionType: RevisionType = index % 2 === 0 ? 'SUPPLEMENTARY' : 'REFORECAST'
    return {
      scenarioCode: scenario.code,
      locationCode: scenario.locationCode,
      parentSubmissionId: submission.id,
      divisionId: division.id,
      departmentId: division.departmentId,
      sectionId: division.sectionId,
      revisionType,
      reason: `${DATASET_VERSION} ${revisionType.toLowerCase()} request for controlled post-activation workflow testing at ${scenario.locationCode}.`,
      authorityReference: revisionType === 'SUPPLEMENTARY' ? `UAT-SUP-2026-${String(index + 1).padStart(2, '0')}` : null,
      requestedChangeCents: 1_000_000 + index * 100_000,
    }
  })

  const lineSupervisor = RETAINED_USER_ASSIGNMENTS.find((assignment) => assignment.userId === TRANSACTION_ACTORS.lineSupervisor)
  if (!lineSupervisor) throw new Error('Retained Line Supervisor restoration mapping is missing')

  return {
    fundingSources,
    suppliers,
    fundingAllocations,
    ff3,
    ff4,
    revisions,
    revisionActorPlan: {
      lineSupervisorId: TRANSACTION_ACTORS.lineSupervisor,
      restoreDepartmentCode: lineSupervisor.departmentCode,
      restoreSectionCode: lineSupervisor.sectionCode,
      requiresTemporaryScopeAlignment: true,
    },
  }
}

function money(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Invalid monetary cents value ${cents}`)
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

async function registerEntity(client: Client, runId: string, tableName: string, entityId: string, businessCode: string, sourceReference: string): Promise<void> {
  await client.query(
    `insert into public.uat_seed_entities (run_id,table_name,entity_id,business_code,provenance,source_reference)
     values ($1,$2,$3,$4,'UAT',$5)
     on conflict (run_id,table_name,entity_id) do update set business_code=excluded.business_code,provenance='UAT',source_reference=excluded.source_reference`,
    [runId, tableName, entityId, businessCode, sourceReference],
  )
}

export async function seedFundingSources(client: Client, runId: string, plan: TransactionSeedPlan): Promise<void> {
  for (const source of plan.fundingSources) {
    await client.query(
      `insert into public.funding_sources (id,code,name,source_type,is_active)
       values ($1,$2,$3,$4,true)
       on conflict (id) do update set code=excluded.code,name=excluded.name,source_type=excluded.source_type,is_active=true`,
      [source.id, source.code, source.name, source.sourceType],
    )
    await registerEntity(client, runId, 'funding_sources', source.id, source.code, `${DATASET_VERSION} synthetic funding source`)
  }
}

export async function seedSuppliers(
  client: Client,
  runId: string,
  plan: TransactionSeedPlan,
  organisation: NationalMasterPlan,
): Promise<void> {
  const locationByCode = new Map(organisation.locations.map((location) => [location.code, location]))
  const primaryAdmin = await setActorContext(client, TRANSACTION_ACTORS.systemAdministrator)
  const categoryCodes = [...new Set(plan.suppliers.map((supplier) => supplier.category))].sort()
  const categoryIdByCode = new Map<string, string>()

  for (const [index, code] of categoryCodes.entries()) {
    const id = deterministicUuid(`supplier-category:${code}`)
    categoryIdByCode.set(code, id)
    await client.query(
      `insert into public.supplier_categories (id,code,name,description,is_active,sort_order)
       values ($1,$2,$3,$4,true,$5)
       on conflict (id) do update set code=excluded.code,name=excluded.name,description=excluded.description,is_active=true,sort_order=excluded.sort_order`,
      [id, `UAT-${code}`, `${code.replaceAll('_', ' ')} — UAT`, `${DATASET_VERSION} synthetic supplier category`, (index + 1) * 10],
    )
    await registerEntity(client, runId, 'supplier_categories', id, `UAT-${code}`, `${DATASET_VERSION} synthetic supplier category`)
  }

  for (const [index, supplier] of plan.suppliers.entries()) {
    const location = locationByCode.get(supplier.homeLocationCode)
    if (!location) throw new Error(`Supplier ${supplier.code} references unknown home location ${supplier.homeLocationCode}`)
    await client.query(
      `insert into public.suppliers (
         id,supplier_code,supplier_name,legal_name,trading_name,supplier_type,tin,company_registration_number,
         contact_person,primary_contact_name,phone,email,address,physical_address,postal_address,province_id,province,country,
         bank_name,bank_account_name,bank_account_number,is_active,created_by,status,compliance_status,notes,legacy_imported,supplier_mapping_required,updated_at
       ) values ($1,$2,$3,$3,$3,'COMPANY',$4,$5,$6,$6,$7,$8,$9,$9,$10,$11,$12,'Papua New Guinea',$13,$3,$14,true,$15,'DRAFT',$16,$17,false,false,now())`,
      [
        supplier.id, supplier.code, supplier.name, `TIN-UAT-${String(index + 1).padStart(3, '0')}`,
        `IPA-UAT-${String(index + 1).padStart(3, '0')}`, `UAT Contact ${index + 1}`, `+675 7000 ${String(index + 1).padStart(4, '0')}`,
        `uat-supplier-${String(index + 1).padStart(3, '0')}@example.test`, `${location.town} UAT business address`, `PO Box UAT-${index + 1}, ${location.town}`,
        location.provinceId, location.provinceCode, 'UAT Test Bank', `000UAT${String(index + 1).padStart(6, '0')}`,
        TRANSACTION_ACTORS.systemAdministrator, supplier.complianceStatus, `${DATASET_VERSION}; fictitious supplier for UAT only.`,
      ],
    )
    const categoryId = categoryIdByCode.get(supplier.category)
    if (!categoryId) throw new Error(`Supplier category ${supplier.category} is missing`)
    const assignmentId = deterministicUuid(`supplier-category-assignment:${supplier.code}:${supplier.category}`)
    await client.query(
      `insert into public.supplier_category_assignments (id,supplier_id,category_id,created_by)
       values ($1,$2,$3,$4) on conflict (id) do nothing`,
      [assignmentId, supplier.id, categoryId, TRANSACTION_ACTORS.systemAdministrator],
    )
    await registerEntity(client, runId, 'suppliers', supplier.id, supplier.code, `${DATASET_VERSION} fictitious supplier`)

    if (supplier.targetStatus === 'DRAFT') continue
    await client.query('select public.njss_transition_supplier($1,$2,$3,$4)', [supplier.id, 'SUBMIT', `${DATASET_VERSION} supplier submission`, primaryAdmin.email])
    if (supplier.targetStatus === 'PENDING_VERIFICATION') continue
    if (supplier.targetStatus === 'REJECTED') {
      const rejectingAdmin = await setActorContext(client, TRANSACTION_ACTORS.alternateSystemAdministrator)
      await client.query('select public.njss_transition_supplier($1,$2,$3,$4)', [supplier.id, 'REJECT', `${DATASET_VERSION} deliberate supplier rejection scenario`, rejectingAdmin.email])
      continue
    }
    await client.query('select public.njss_transition_supplier($1,$2,$3,$4)', [supplier.id, 'VERIFY', `${DATASET_VERSION} supplier verification`, primaryAdmin.email])
    if (supplier.targetStatus === 'VERIFIED') continue
    const approvingAdmin = await setActorContext(client, TRANSACTION_ACTORS.alternateSystemAdministrator)
    await client.query('select public.njss_transition_supplier($1,$2,$3,$4)', [supplier.id, 'APPROVE', `${DATASET_VERSION} supplier approval`, approvingAdmin.email])
    if (supplier.targetStatus === 'SUSPENDED') {
      await setActorContext(client, TRANSACTION_ACTORS.systemAdministrator)
      await client.query('select public.njss_transition_supplier($1,$2,$3,$4)', [supplier.id, 'SUSPEND', `${DATASET_VERSION} deliberate suspension scenario`, primaryAdmin.email])
    }
  }
}

type FundingRuntime = {
  budgetAllocationIdByLineId: Map<string, string>
  fundingAllocationIdByLineId: Map<string, string>
}

export async function seedFundingAndReleases(
  client: Client,
  runId: string,
  plan: TransactionSeedPlan,
): Promise<FundingRuntime> {
  const admin = await setActorContext(client, TRANSACTION_ACTORS.systemAdministrator)
  const amountBySource = new Map<string, number>()
  for (const item of plan.fundingAllocations) amountBySource.set(item.fundingSourceId, (amountBySource.get(item.fundingSourceId) ?? 0) + item.allocatedCents)
  const receiptBySource = new Map<string, string>()

  for (const source of plan.fundingSources) {
    const totalCents = amountBySource.get(source.id) ?? 0
    if (totalCents <= 0) throw new Error(`Funding source ${source.code} has no planned allocations`)
    const authorityResult = await client.query<{ id: string; authority_number: string | null }>(
      `select id,authority_number from public.njss_create_funding_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [2026, authorityTypeForFundingSource(source.sourceType), source.id, money(totalCents), '2026-01-01', '2026-12-31', 'NJSS UAT Funding Source', 'NJSS', `UAT-APP-${source.code}`, `UAT-WARRANT-${source.code}`, '2026-01-02', null, null, `${DATASET_VERSION} synthetic funding authority`, null, null, null, null, null, null, null, 'Unrestricted UAT funding authority', admin.email],
    )
    if (authorityResult.rowCount !== 1) throw new Error(`Funding authority creation failed for ${source.code}`)
    const authority = authorityResult.rows[0]
    for (const action of ['SUBMIT', 'VERIFY', 'APPROVE'] as const) {
      await client.query('select id from public.njss_transition_funding_authority($1,$2,$3,$4)', [authority.id, action, `${DATASET_VERSION} ${action.toLowerCase()}`, admin.email])
    }
    await registerEntity(client, runId, 'funding_authorities', authority.id, authority.authority_number ?? `AUTH:${source.code}`, `${DATASET_VERSION} synthetic funding authority`)

    const receiptResult = await client.query<{ id: string; receipt_number: string | null }>(
      `select id,receipt_number from public.njss_create_funding_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [authority.id, '2026-01-05', money(totalCents), 'NJSS UAT Funding Source', `UAT-IFMS-${source.code}`, `UAT-EXT-${source.code}`, `UAT-BANK-${source.code}`, `${DATASET_VERSION} synthetic funding receipt`, null, null, admin.email],
    )
    if (receiptResult.rowCount !== 1) throw new Error(`Funding receipt creation failed for ${source.code}`)
    const receipt = receiptResult.rows[0]
    for (const action of ['SUBMIT', 'VERIFY', 'APPROVE'] as const) {
      await client.query('select id from public.njss_transition_funding_receipt($1,$2,$3,$4)', [receipt.id, action, `${DATASET_VERSION} ${action.toLowerCase()}`, admin.email])
    }
    receiptBySource.set(source.id, receipt.id)
    await registerEntity(client, runId, 'funding_receipts', receipt.id, receipt.receipt_number ?? `RCPT:${source.code}`, `${DATASET_VERSION} synthetic funding receipt`)
  }

  const budgetAllocationIdByLineId = new Map<string, string>()
  const fundingAllocationIdByLineId = new Map<string, string>()
  for (const item of plan.fundingAllocations) {
    const budgetResult = await client.query<{ id: string }>(
      `select id from public.budget_allocations where source_budget_line_id=$1 and source_module='EXCEL_BUDGET' and is_active=true`,
      [item.budgetLineId],
    )
    if (budgetResult.rowCount !== 1) throw new Error(`Expected one active budget allocation for line ${item.budgetLineId}`)
    const budgetAllocationId = budgetResult.rows[0].id
    const receiptId = receiptBySource.get(item.fundingSourceId)
    if (!receiptId) throw new Error(`No approved receipt for funding source ${item.fundingSourceId}`)
    const allocationResult = await client.query<{ id: string; allocation_number: string | null }>(
      'select id,allocation_number from public.njss_allocate_funding($1,$2,$3,$4,$5,$6)',
      [receiptId, budgetAllocationId, money(item.allocatedCents), '2026-01-10', `${DATASET_VERSION} ${item.code}`, admin.email],
    )
    if (allocationResult.rowCount !== 1) throw new Error(`Funding allocation failed for ${item.code}`)
    const fundingAllocation = allocationResult.rows[0]
    await client.query('select id from public.njss_approve_funding_allocation($1,$2,$3)', [fundingAllocation.id, `${DATASET_VERSION} funding allocation approval`, admin.email])
    const releaseResult = await client.query<{ id: string; release_number: string | null }>(
      'select id,release_number from public.njss_create_budget_release($1,$2,$3,$4,$5,$6::jsonb,$7,$8)',
      [budgetAllocationId, 2026, 1, money(item.releaseCents), '2026-01-15', JSON.stringify([{ funding_allocation_id: fundingAllocation.id, amount: Number(money(item.releaseCents)) }]), `${DATASET_VERSION} controlled Q1 release`, admin.email],
    )
    if (releaseResult.rowCount !== 1) throw new Error(`Budget release failed for ${item.code}`)
    budgetAllocationIdByLineId.set(item.budgetLineId, budgetAllocationId)
    fundingAllocationIdByLineId.set(item.budgetLineId, fundingAllocation.id)
    await registerEntity(client, runId, 'funding_allocations', fundingAllocation.id, fundingAllocation.allocation_number ?? item.code, `${DATASET_VERSION} synthetic funding allocation`)
    await registerEntity(client, runId, 'quarterly_releases', releaseResult.rows[0].id, releaseResult.rows[0].release_number ?? `REL:${item.code}`, `${DATASET_VERSION} synthetic budget release`)
  }
  return { budgetAllocationIdByLineId, fundingAllocationIdByLineId }
}

export async function seedFf3Workflows(
  client: Client,
  runId: string,
  plan: TransactionSeedPlan,
  fundingRuntime: FundingRuntime,
): Promise<Map<string, string>> {
  const supplierById = new Map(plan.suppliers.map((supplier) => [supplier.id, supplier]))
  const commitmentByFf3 = new Map<string, string>()

  for (const row of plan.ff3) {
    const budgetAllocationId = fundingRuntime.budgetAllocationIdByLineId.get(row.budgetLineId)
    const supplier = supplierById.get(row.supplierId)
    if (!budgetAllocationId || !supplier) throw new Error(`FF3 ${row.code} is missing runtime budget/supplier data`)
    await setActorContext(client, TRANSACTION_ACTORS.requisitionOfficer)
    await client.query(
      `insert into public.ff3_headers (
         id,ff3_number,financial_year,request_date,requesting_officer_id,department_id,section_id,province_id,funding_source_id,
         purpose,justification,required_by_date,urgency_level,procurement_method,selected_supplier_name,supplier_selection_justification,
         status,total_estimated_amount,is_within_budget,created_by,cost_centre_id,expense_code_registry_id,budget_allocation_id,budget_mapping_status,selected_supplier_id
       ) values ($1,$2,2026,'2026-02-01',$3,$4,$5,$6,$7,$8,$9,'2026-03-31','NORMAL','UAT Controlled Test',$10,$11,'DRAFT',$12,true,$3,$13,$14,$15,'RESOLVED',$16)`,
      [row.id, row.code, TRANSACTION_ACTORS.requisitionOfficer, row.departmentId, row.sectionId, row.provinceId, row.fundingSourceId, `${DATASET_VERSION} ${row.scenarioCode} ${row.financeCode}`, `${DATASET_VERSION} controlled FF3 workflow scenario.`, supplier.name, 'Selected fictitious UAT supplier for controlled test workflow.', money(row.requestCents), row.costCentreId, row.expenseCodeRegistryId, budgetAllocationId, row.supplierId],
    )
    const itemId = deterministicUuid(`ff3-item:${row.id}:1`)
    await client.query(
      `insert into public.ff3_items (id,ff3_header_id,line_number,item_description,specifications,quantity,unit_of_measure,estimated_unit_price,total_amount,account_id)
       values ($1,$2,1,$3,$4,1,'EA',$5,$5,$6)`,
      [itemId, row.id, `${row.financeCode} UAT expenditure`, DATASET_VERSION, money(row.requestCents), row.chartOfAccountId],
    )
    const quotationId = deterministicUuid(`ff3-quotation:${row.id}:1`)
    await client.query(
      `insert into public.ff3_quotations (id,ff3_header_id,supplier_name,quotation_number,quotation_date,quotation_amount,is_selected,supplier_id,supplier_code_snapshot,supplier_registration_snapshot,legacy_imported,supplier_mapping_required)
       values ($1,$2,$3,$4,'2026-02-01',$5,true,$6,$7,$8,false,false)`,
      [quotationId, row.id, supplier.name, `UAT-Q-${row.code}`, money(row.requestCents), supplier.id, supplier.code, `IPA-${supplier.code}`],
    )
    await client.query('update public.ff3_headers set selected_quotation_id=$1 where id=$2', [quotationId, row.id])
    await registerEntity(client, runId, 'ff3_headers', row.id, row.code, `${DATASET_VERSION} ${row.targetStatus} FF3 scenario`)

    const requisitionActor = await setActorContext(client, TRANSACTION_ACTORS.requisitionOfficer)
    await client.query('select public.njss_transition_ff3($1,$2,$3,$4)', [row.id, 'SUBMIT', `${DATASET_VERSION} requisition submission`, requisitionActor.email])
    if (row.targetStatus === 'SUBMITTED') continue
    if (row.targetStatus === 'RETURNED') {
      const supervisor = await setActorContext(client, TRANSACTION_ACTORS.lineSupervisor)
      await client.query('select public.njss_transition_ff3($1,$2,$3,$4)', [row.id, 'RETURN', `${DATASET_VERSION} deliberate return scenario`, supervisor.email])
      continue
    }
    if (row.targetStatus === 'REJECTED') {
      const registrar = await setActorContext(client, TRANSACTION_ACTORS.registrar)
      await client.query('select public.njss_transition_ff3($1,$2,$3,$4)', [row.id, 'REJECT', `${DATASET_VERSION} deliberate rejection scenario`, registrar.email])
      continue
    }
    const supervisor = await setActorContext(client, TRANSACTION_ACTORS.lineSupervisor)
    await client.query('select public.njss_transition_ff3($1,$2,$3,$4)', [row.id, 'ENDORSE_SUPERVISOR', `${DATASET_VERSION} supervisor endorsement`, supervisor.email])
    await client.query('select public.njss_transition_ff3($1,$2,$3,$4)', [row.id, 'ENDORSE_SECTION_HEAD', `${DATASET_VERSION} section-head endorsement`, supervisor.email])
    const registrar = await setActorContext(client, TRANSACTION_ACTORS.registrar)
    await client.query('select public.njss_transition_ff3($1,$2,$3,$4)', [row.id, 'APPROVE', `${DATASET_VERSION} final FF3 approval`, registrar.email])
    const commitment = await client.query<{ id: string }>('select id from public.ff3_commitments where ff3_header_id=$1 and status<>\'CANCELLED\'', [row.id])
    if (commitment.rowCount !== 1) throw new Error(`Committed FF3 ${row.code} did not create exactly one commitment`)
    commitmentByFf3.set(row.id, commitment.rows[0].id)
    await registerEntity(client, runId, 'ff3_commitments', commitment.rows[0].id, `COM:${row.code}`, `${DATASET_VERSION} RPC-created commitment`)
  }
  return commitmentByFf3
}

export async function seedFf4Workflows(
  client: Client,
  runId: string,
  plan: TransactionSeedPlan,
  commitmentByFf3: Map<string, string>,
  fundingRuntime: FundingRuntime,
): Promise<void> {
  const ff3ById = new Map(plan.ff3.map((row) => [row.id, row]))
  const supplierById = new Map(plan.suppliers.map((supplier) => [supplier.id, supplier]))

  for (const row of plan.ff4) {
    const source = ff3ById.get(row.ff3Id)
    const commitmentId = commitmentByFf3.get(row.ff3Id)
    if (!source || !commitmentId) throw new Error(`FF4 ${row.code} lacks a committed FF3 runtime record`)
    const supplier = supplierById.get(row.supplierId)
    const budgetAllocationId = fundingRuntime.budgetAllocationIdByLineId.get(source.budgetLineId)
    if (!supplier || !budgetAllocationId) throw new Error(`FF4 ${row.code} lacks supplier or budget allocation`)
    await setActorContext(client, TRANSACTION_ACTORS.paymentOfficer)
    await client.query(
      `insert into public.ff4_headers (
         id,ff4_number,ff3_header_id,commitment_id,financial_year,payment_request_date,payee_type,payee_name,supplier_code,
         invoice_number,invoice_date,payment_description,gross_amount,tax_amount,deductions,net_amount,department_id,section_id,account_id,
         payment_method,status,created_by,supplier_id,budget_allocation_id,expense_code_registry_id,cost_centre_id,funding_source_id,payment_type,is_partial_payment
       ) values ($1,$2,$3,$4,2026,'2026-04-01','SUPPLIER',$5,$6,$7,'2026-03-31',$8,$9,0,0,$9,$10,$11,$12,'EFT','DRAFT',$13,$14,$15,$16,$17,$18,'COMMITMENT',true)`,
      [row.id, row.code, source.id, commitmentId, supplier.name, supplier.code, `UAT-INV-${row.code}`, `${DATASET_VERSION} payment for ${source.code}`, money(row.amountCents), source.departmentId, source.sectionId, source.chartOfAccountId, TRANSACTION_ACTORS.paymentOfficer, supplier.id, budgetAllocationId, source.expenseCodeRegistryId, source.costCentreId, source.fundingSourceId],
    )
    await registerEntity(client, runId, 'ff4_headers', row.id, row.code, `${DATASET_VERSION} ${row.targetStatus} FF4 scenario`)
    const paymentOfficer = await setActorContext(client, TRANSACTION_ACTORS.paymentOfficer)
    await client.query('select public.njss_transition_ff4($1,$2,$3,$4,$5,$6,$7,$8)', [row.id, 'SUBMIT', `${DATASET_VERSION} FF4 submission`, null, null, null, null, paymentOfficer.email])
    if (row.targetStatus === 'SUBMITTED') continue
    await client.query('select public.njss_transition_ff4($1,$2,$3,$4,$5,$6,$7,$8)', [row.id, 'VERIFY', `${DATASET_VERSION} FF4 verification`, null, null, null, null, paymentOfficer.email])
    const admin = await setActorContext(client, TRANSACTION_ACTORS.systemAdministrator)
    await client.query('select public.njss_transition_ff4($1,$2,$3,$4,$5,$6,$7,$8)', [row.id, 'APPROVE', `${DATASET_VERSION} FF4 approval`, null, null, null, null, admin.email])
    if (row.targetStatus === 'APPROVED') continue
    await setActorContext(client, TRANSACTION_ACTORS.paymentOfficer)
    await client.query('select public.njss_transition_ff4($1,$2,$3,$4,$5,$6,$7,$8)', [row.id, 'PROCESS', `${DATASET_VERSION} FF4 processing`, null, null, null, null, paymentOfficer.email])
    const paymentReference = `UAT-PAY-${row.code}`
    await client.query('select public.njss_transition_ff4($1,$2,$3,$4,$5,$6,$7,$8)', [row.id, 'MARK_PAID', `${DATASET_VERSION} payment posting`, paymentReference, '2026-04-15', 'EFT', null, paymentOfficer.email])
    if (row.targetStatus === 'PAID') continue
    await client.query('select public.njss_transition_ff4($1,$2,$3,$4,$5,$6,$7,$8)', [row.id, 'RECONCILE', `${DATASET_VERSION} payment reconciliation`, null, null, null, null, paymentOfficer.email])
  }
}

export async function seedRevisionRequests(
  client: Client,
  runId: string,
  plan: TransactionSeedPlan,
  organisation: NationalMasterPlan,
): Promise<void> {
  const supervisorId = plan.revisionActorPlan.lineSupervisorId
  const restoreDepartment = organisation.departments.find((department) => department.code === plan.revisionActorPlan.restoreDepartmentCode)
  const restoreSection = organisation.sections.find((section) => section.code === plan.revisionActorPlan.restoreSectionCode)
  if (!restoreDepartment || !restoreSection || restoreSection.departmentId !== restoreDepartment.id) throw new Error('Line Supervisor restoration target is invalid')

  for (const [index, revision] of plan.revisions.entries()) {
    await client.query('update public.users set department_id=$1,section_id=$2,updated_at=now() where id=$3', [revision.departmentId, revision.sectionId, supervisorId])
    const registrar = await setActorContext(client, index % 2 === 0 ? TRANSACTION_ACTORS.registrar : TRANSACTION_ACTORS.alternateRegistrar)
    const result = await client.query<{ result: { revision_id: string; revision_submission_id: string; revision_number: string } }>(
      `select public.njss_create_budget_revision_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result`,
      [revision.parentSubmissionId, revision.revisionType, revision.reason, revision.authorityReference, '2026-09-01', DATASET_VERSION, supervisorId, `${DATASET_VERSION} Line Supervisor to prepare controlled revision.`, money(revision.requestedChangeCents), registrar.email],
    )
    const created = result.rows[0]?.result
    if (!created?.revision_id || !created.revision_submission_id) throw new Error(`Revision creation failed for ${revision.scenarioCode}`)
    await registerEntity(client, runId, 'budget_revisions', created.revision_id, created.revision_number, `${DATASET_VERSION} post-activation revision request`)
    await registerEntity(client, runId, 'divisional_budget_submissions', created.revision_submission_id, `REV-SUB:${revision.scenarioCode}`, `${DATASET_VERSION} revision submission`)
  }

  await client.query('update public.users set department_id=$1,section_id=$2,updated_at=now() where id=$3', [restoreDepartment.id, restoreSection.id, supervisorId])
  const restored = await client.query<{ department_id: string; section_id: string }>('select department_id,section_id from public.users where id=$1', [supervisorId])
  if (restored.rowCount !== 1 || restored.rows[0].department_id !== restoreDepartment.id || restored.rows[0].section_id !== restoreSection.id) {
    throw new Error('Line Supervisor organisational assignment was not restored after revision seeding')
  }
}

export async function seedNationalTransactions(
  client: Client,
  runId: string,
  organisation: NationalMasterPlan,
  finance: FinanceMasterPlan,
  budgets: BudgetSeedPlan,
): Promise<TransactionSeedPlan> {
  const plan = buildTransactionSeedPlan(organisation, finance, budgets)
  await seedFundingSources(client, runId, plan)
  await seedSuppliers(client, runId, plan, organisation)
  const fundingRuntime = await seedFundingAndReleases(client, runId, plan)
  const commitmentByFf3 = await seedFf3Workflows(client, runId, plan, fundingRuntime)
  await seedFf4Workflows(client, runId, plan, commitmentByFf3, fundingRuntime)
  await seedRevisionRequests(client, runId, plan, organisation)
  return plan
}
