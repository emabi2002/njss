import type { Client } from 'pg'
import { DATASET_VERSION } from './constants'
import { deterministicUuid } from './deterministic-id'
import { ECONOMIC_CLASSES, FINANCE_CODES, type FinanceCodeSeed } from './catalog/finance'
import { TRANSACTION_SCENARIOS } from './catalog/scenarios'
import type { NationalMasterPlan } from './seed-master'

export type FinanceMasterPlan = {
  financialYear: number
  budgetClasses: BudgetClassPlan[]
  budgetExpenseCategories: BudgetExpenseCategoryPlan[]
  chartOfAccounts: ChartOfAccountPlan[]
  expenseCategories: ExpenseCategoryPlan[]
  expenseItems: ExpenseItemPlan[]
  ledgers: LedgerPlan[]
  contexts: FinanceContextPlan[]
  postingCodes: PostingCodePlan[]
  mappings: FinanceMappingPlan[]
}

type BudgetClassPlan = {
  id: string
  code: string
  name: string
  description: string
  sortOrder: number
  provenance: 'OFFICIAL'
  sourceReference: string
}

type BudgetExpenseCategoryPlan = BudgetClassPlan

type ChartOfAccountPlan = {
  id: string
  accountCode: string
  accountName: string
  accountType: 'EXPENSE'
  provenance: 'UAT'
}

type ExpenseCategoryPlan = {
  id: string
  code: string
  name: string
  parentEconomicCode: string
  provenance: 'UAT'
}

type ExpenseItemPlan = {
  id: string
  expenseCategoryId: string
  code: string
  name: string
  defaultUnit: string
  financeCode: string
  provenance: 'UAT'
}

type LedgerPlan = {
  id: string
  ledgerNumber: string
  financeCode: string
  standardDescription: string
  budgetClass: string
  expenseCategory: string
  budgetClassId: string
  budgetExpenseCategoryId: string
  parentEconomicCode: string
  monthlyProfile: FinanceCodeSeed['monthlyProfile']
  applicableFunctions: FinanceCodeSeed['applicableFunctions']
  provenance: 'UAT'
}

export type FinanceContextPlan = {
  code: string
  financialYear: number
  courtLocationCode: string
  departmentId: string
  departmentCode: string
  sectionId: string
  costCentreId: string
  costCentreCode: string
  financeCode: string
  expenseLedgerId: string
  expenseCodeRegistryId: string
  chartOfAccountId: string
}

type PostingCodePlan = {
  id: string
  financialYear: number
  departmentId: string
  sectionId: string
  costCentreId: string
  expenseCategoryId: string
  expenseItemId: string
  fullExpenseCode: string
  description: string
  expenseLedgerId: string
  chartOfAccountId: string
  provenance: 'UAT'
}

export type FinanceMappingPlan = {
  id: string
  financialYear: number
  expenseLedgerId: string
  expenseCodeRegistryId: string
  chartOfAccountId: string
  costCentreId: string
  departmentId: string
  sectionId: string
  mappingNotes: string
  provenance: 'UAT'
}

function isApplicable(financeCode: FinanceCodeSeed, functionCode: string): boolean {
  return financeCode.applicableFunctions === 'ALL' || financeCode.applicableFunctions.includes(functionCode)
}

function itemCode(financeCode: string): string {
  return `I${financeCode.replace(/[^0-9A-Z]/gi, '')}`.toUpperCase()
}

function contextKey(costCentreCode: string, financeCode: string): string {
  return `${costCentreCode}|${financeCode}`
}

function chooseBaseCodes(functionCode: string): FinanceCodeSeed[] {
  const officeSupplies = FINANCE_CODES.find((item) => item.code === '223-01')
  if (!officeSupplies) throw new Error('Required base UAT finance code 223-01 is missing')
  const secondary = FINANCE_CODES.find((item) => item.code !== officeSupplies.code && isApplicable(item, functionCode))
  if (!secondary) throw new Error(`No secondary UAT finance code is applicable to function ${functionCode}`)
  return [officeSupplies, secondary]
}

export function buildFinanceMasterPlan(organisation: NationalMasterPlan): FinanceMasterPlan {
  const financialYear = 2026

  const budgetClasses: BudgetClassPlan[] = ECONOMIC_CLASSES.map((economic, index) => ({
    id: deterministicUuid(`budget-class:${economic.code}`),
    code: economic.code,
    name: economic.name,
    description: `${economic.name}. Source-aligned parent classification used by ${DATASET_VERSION}.`,
    sortOrder: (index + 1) * 10,
    provenance: economic.provenance,
    sourceReference: economic.sourceReference,
  }))

  const budgetExpenseCategories: BudgetExpenseCategoryPlan[] = ECONOMIC_CLASSES.map((economic, index) => ({
    id: deterministicUuid(`budget-expense-category:${economic.code}`),
    code: economic.code,
    name: economic.name,
    description: `${economic.name}. Parent expense category for synthetic UAT posting codes.`,
    sortOrder: (index + 1) * 10,
    provenance: economic.provenance,
    sourceReference: economic.sourceReference,
  }))

  const chartOfAccounts: ChartOfAccountPlan[] = ECONOMIC_CLASSES.map((economic) => ({
    id: deterministicUuid(`coa:UAT-${economic.code}`),
    accountCode: `UAT-${economic.code}`,
    accountName: `${economic.name} — UAT`,
    accountType: 'EXPENSE',
    provenance: 'UAT',
  }))

  const expenseCategories: ExpenseCategoryPlan[] = ECONOMIC_CLASSES.map((economic) => ({
    id: deterministicUuid(`expense-category:EC${economic.code}`),
    code: `EC${economic.code}`,
    name: `${economic.name} — UAT`,
    parentEconomicCode: economic.code,
    provenance: 'UAT',
  }))

  const economicByCode = new Map(ECONOMIC_CLASSES.map((economic) => [economic.code, economic]))
  const budgetClassByCode = new Map(budgetClasses.map((item) => [item.code, item]))
  const budgetCategoryByCode = new Map(budgetExpenseCategories.map((item) => [item.code, item]))
  const coaByEconomicCode = new Map(ECONOMIC_CLASSES.map((economic) => [economic.code, chartOfAccounts.find((item) => item.accountCode === `UAT-${economic.code}`)!]))
  const expenseCategoryByEconomicCode = new Map(expenseCategories.map((item) => [item.parentEconomicCode, item]))

  const expenseItems: ExpenseItemPlan[] = FINANCE_CODES.map((financeCode) => {
    const category = expenseCategoryByEconomicCode.get(financeCode.parentCode)
    if (!category) throw new Error(`Finance code ${financeCode.code} references unknown economic class ${financeCode.parentCode}`)
    return {
      id: deterministicUuid(`expense-item:${financeCode.code}`),
      expenseCategoryId: category.id,
      code: itemCode(financeCode.code),
      name: financeCode.name,
      defaultUnit: 'EA',
      financeCode: financeCode.code,
      provenance: 'UAT',
    }
  })

  const expenseItemByFinanceCode = new Map(expenseItems.map((item) => [item.financeCode, item]))
  const ledgers: LedgerPlan[] = FINANCE_CODES.map((financeCode, index) => {
    const economic = economicByCode.get(financeCode.parentCode)
    const budgetClass = budgetClassByCode.get(financeCode.parentCode)
    const budgetCategory = budgetCategoryByCode.get(financeCode.parentCode)
    if (!economic || !budgetClass || !budgetCategory) throw new Error(`Finance code ${financeCode.code} has incomplete parent classification`)
    return {
      id: deterministicUuid(`expense-ledger:${financeCode.code}`),
      ledgerNumber: `UAT-LDG-${financeCode.code}`,
      financeCode: financeCode.code,
      standardDescription: financeCode.name,
      budgetClass: economic.name,
      expenseCategory: economic.name,
      budgetClassId: budgetClass.id,
      budgetExpenseCategoryId: budgetCategory.id,
      parentEconomicCode: financeCode.parentCode,
      monthlyProfile: financeCode.monthlyProfile,
      applicableFunctions: financeCode.applicableFunctions,
      provenance: 'UAT',
    }
  })
  const ledgerByFinanceCode = new Map(ledgers.map((ledger) => [ledger.financeCode, ledger]))

  const departmentById = new Map(organisation.departments.map((department) => [department.id, department]))
  const costCentreByDepartmentId = new Map(organisation.costCentres.map((costCentre) => [costCentre.departmentId, costCentre]))
  const contextsByKey = new Map<string, FinanceContextPlan>()

  function addContext(departmentId: string, financeCodeValue: string): void {
    const department = departmentById.get(departmentId)
    const costCentre = costCentreByDepartmentId.get(departmentId)
    const financeCode = FINANCE_CODES.find((item) => item.code === financeCodeValue)
    const ledger = ledgerByFinanceCode.get(financeCodeValue)
    if (!department || !costCentre || !financeCode || !ledger) throw new Error(`Cannot build finance context for department ${departmentId} / ${financeCodeValue}`)
    if (!isApplicable(financeCode, department.functionCode)) {
      throw new Error(`Finance code ${financeCodeValue} is not applicable to ${department.code} (${department.functionCode})`)
    }
    const account = coaByEconomicCode.get(financeCode.parentCode)
    if (!account) throw new Error(`No CoA for finance code ${financeCodeValue}`)
    const key = contextKey(costCentre.code, financeCodeValue)
    if (contextsByKey.has(key)) return
    contextsByKey.set(key, {
      code: `${costCentre.code}:${financeCodeValue}`,
      financialYear,
      courtLocationCode: department.courtLocationCode,
      departmentId: department.id,
      departmentCode: department.code,
      sectionId: costCentre.sectionId,
      costCentreId: costCentre.id,
      costCentreCode: costCentre.code,
      financeCode: financeCodeValue,
      expenseLedgerId: ledger.id,
      expenseCodeRegistryId: deterministicUuid(`posting-code:${financialYear}:${costCentre.code}:${financeCodeValue}`),
      chartOfAccountId: account.id,
    })
  }

  for (const department of organisation.departments) {
    for (const financeCode of chooseBaseCodes(department.functionCode)) addContext(department.id, financeCode.code)
  }

  for (const scenario of TRANSACTION_SCENARIOS) {
    const candidateDepartments = organisation.departments.filter((department) => department.courtLocationCode === scenario.locationCode)
    if (candidateDepartments.length === 0) throw new Error(`Scenario ${scenario.code} references unknown location ${scenario.locationCode}`)
    for (const financeCodeValue of scenario.financeCodes) {
      const financeCode = FINANCE_CODES.find((item) => item.code === financeCodeValue)
      if (!financeCode) throw new Error(`Scenario ${scenario.code} references unknown finance code ${financeCodeValue}`)
      const department = candidateDepartments.find((candidate) => isApplicable(financeCode, candidate.functionCode))
      if (!department) throw new Error(`Scenario ${scenario.code} has no applicable department for finance code ${financeCodeValue}`)
      addContext(department.id, financeCodeValue)
    }
  }

  const contexts = [...contextsByKey.values()].sort((left, right) => left.code.localeCompare(right.code))
  const postingCodes: PostingCodePlan[] = contexts.map((context) => {
    const ledger = ledgerByFinanceCode.get(context.financeCode)!
    const financeCode = FINANCE_CODES.find((item) => item.code === context.financeCode)!
    const category = expenseCategoryByEconomicCode.get(financeCode.parentCode)!
    const item = expenseItemByFinanceCode.get(context.financeCode)!
    return {
      id: context.expenseCodeRegistryId,
      financialYear,
      departmentId: context.departmentId,
      sectionId: context.sectionId,
      costCentreId: context.costCentreId,
      expenseCategoryId: category.id,
      expenseItemId: item.id,
      fullExpenseCode: `UAT26-${context.costCentreCode}-${context.financeCode}`,
      description: `${ledger.standardDescription} | ${context.costCentreCode} | ${DATASET_VERSION}`,
      expenseLedgerId: ledger.id,
      chartOfAccountId: context.chartOfAccountId,
      provenance: 'UAT',
    }
  })

  const mappings: FinanceMappingPlan[] = contexts.map((context) => ({
    id: deterministicUuid(`finance-mapping:${financialYear}:${context.costCentreCode}:${context.financeCode}`),
    financialYear,
    expenseLedgerId: context.expenseLedgerId,
    expenseCodeRegistryId: context.expenseCodeRegistryId,
    chartOfAccountId: context.chartOfAccountId,
    costCentreId: context.costCentreId,
    departmentId: context.departmentId,
    sectionId: context.sectionId,
    mappingNotes: `${DATASET_VERSION} | UAT generated mapping | ${context.costCentreCode} | ${context.financeCode}`,
    provenance: 'UAT',
  }))

  return {
    financialYear,
    budgetClasses,
    budgetExpenseCategories,
    chartOfAccounts,
    expenseCategories,
    expenseItems,
    ledgers,
    contexts,
    postingCodes,
    mappings,
  }
}

type ProvenanceEntity = {
  tableName: string
  entityId: string
  businessCode: string
  provenance: 'OFFICIAL' | 'DERIVED' | 'UAT'
  sourceReference: string
}

function provenanceEntities(plan: FinanceMasterPlan): ProvenanceEntity[] {
  return [
    ...plan.budgetClasses.map((item) => ({ tableName: 'budget_classes', entityId: item.id, businessCode: item.code, provenance: item.provenance, sourceReference: item.sourceReference })),
    ...plan.budgetExpenseCategories.map((item) => ({ tableName: 'budget_expense_categories', entityId: item.id, businessCode: item.code, provenance: item.provenance, sourceReference: item.sourceReference })),
    ...plan.chartOfAccounts.map((item) => ({ tableName: 'chart_of_accounts', entityId: item.id, businessCode: item.accountCode, provenance: item.provenance, sourceReference: `${DATASET_VERSION} synthetic Chart of Accounts` })),
    ...plan.expenseCategories.map((item) => ({ tableName: 'expense_categories', entityId: item.id, businessCode: item.code, provenance: item.provenance, sourceReference: `${DATASET_VERSION} synthetic expense category` })),
    ...plan.expenseItems.map((item) => ({ tableName: 'expense_items', entityId: item.id, businessCode: item.code, provenance: item.provenance, sourceReference: `${DATASET_VERSION} synthetic expense item` })),
    ...plan.ledgers.map((item) => ({ tableName: 'expense_ledger', entityId: item.id, businessCode: item.financeCode, provenance: item.provenance, sourceReference: `${DATASET_VERSION} synthetic Finance Code` })),
    ...plan.postingCodes.map((item) => ({ tableName: 'expense_code_registry', entityId: item.id, businessCode: item.fullExpenseCode, provenance: item.provenance, sourceReference: `${DATASET_VERSION} synthetic Posting Code` })),
  ]
}

async function registerEntity(client: Client, runId: string, entity: ProvenanceEntity): Promise<void> {
  await client.query(
    `insert into public.uat_seed_entities (run_id, table_name, entity_id, business_code, provenance, source_reference)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (run_id, table_name, entity_id) do update set
       business_code = excluded.business_code,
       provenance = excluded.provenance,
       source_reference = excluded.source_reference`,
    [runId, entity.tableName, entity.entityId, entity.businessCode, entity.provenance, entity.sourceReference],
  )
}

export async function seedFinanceMasters(
  client: Client,
  runId: string,
  organisation: NationalMasterPlan,
): Promise<FinanceMasterPlan> {
  const plan = buildFinanceMasterPlan(organisation)

  for (const item of plan.budgetClasses) {
    await client.query(
      `insert into public.budget_classes (id, code, name, description, is_active, sort_order, updated_at)
       values ($1, $2, $3, $4, true, $5, now())
       on conflict (id) do update set code=excluded.code, name=excluded.name, description=excluded.description, is_active=true, sort_order=excluded.sort_order, updated_at=now()`,
      [item.id, item.code, item.name, item.description, item.sortOrder],
    )
  }

  for (const item of plan.budgetExpenseCategories) {
    await client.query(
      `insert into public.budget_expense_categories (id, code, name, description, is_active, sort_order, updated_at)
       values ($1, $2, $3, $4, true, $5, now())
       on conflict (id) do update set code=excluded.code, name=excluded.name, description=excluded.description, is_active=true, sort_order=excluded.sort_order, updated_at=now()`,
      [item.id, item.code, item.name, item.description, item.sortOrder],
    )
  }

  for (const item of plan.chartOfAccounts) {
    await client.query(
      `insert into public.chart_of_accounts (id, account_code, account_name, account_type, is_open_head, is_active)
       values ($1, $2, $3, $4, false, true)
       on conflict (id) do update set account_code=excluded.account_code, account_name=excluded.account_name, account_type=excluded.account_type, is_open_head=false, is_active=true`,
      [item.id, item.accountCode, item.accountName, item.accountType],
    )
  }

  for (const item of plan.expenseCategories) {
    await client.query(
      `insert into public.expense_categories (id, code, name, is_active)
       values ($1, $2, $3, true)
       on conflict (id) do update set code=excluded.code, name=excluded.name, is_active=true`,
      [item.id, item.code, item.name],
    )
  }

  for (const item of plan.expenseItems) {
    await client.query(
      `insert into public.expense_items (id, expense_category_id, code, name, default_unit, is_active, updated_at)
       values ($1, $2, $3, $4, $5, true, now())
       on conflict (id) do update set expense_category_id=excluded.expense_category_id, code=excluded.code, name=excluded.name, default_unit=excluded.default_unit, is_active=true, updated_at=now()`,
      [item.id, item.expenseCategoryId, item.code, item.name, item.defaultUnit],
    )
  }

  for (const item of plan.ledgers) {
    await client.query(
      `insert into public.expense_ledger (
         id, ledger_number, finance_code, standard_description, budget_class, expense_category,
         is_posting, is_active, source_description, correction_notes, sort_order,
         expense_code_registry_id, budget_class_id, budget_expense_category_id, updated_at
       ) values ($1,$2,$3,$4,$5,$6,true,true,$7,$8,$9,null,$10,$11,now())
       on conflict (id) do update set
         ledger_number=excluded.ledger_number,
         finance_code=excluded.finance_code,
         standard_description=excluded.standard_description,
         budget_class=excluded.budget_class,
         expense_category=excluded.expense_category,
         is_posting=true,
         is_active=true,
         source_description=excluded.source_description,
         correction_notes=excluded.correction_notes,
         sort_order=excluded.sort_order,
         expense_code_registry_id=null,
         budget_class_id=excluded.budget_class_id,
         budget_expense_category_id=excluded.budget_expense_category_id,
         updated_at=now()`,
      [item.id, item.ledgerNumber, item.financeCode, item.standardDescription, item.budgetClass, item.expenseCategory, `${DATASET_VERSION} synthetic finance master`, 'Synthetic UAT Finance Code; not an official NJSS posting code.', plan.ledgers.indexOf(item) + 1, item.budgetClassId, item.budgetExpenseCategoryId],
    )
  }

  for (const item of plan.postingCodes) {
    await client.query(
      `insert into public.expense_code_registry (
         id, financial_year, department_id, section_id, cost_centre_id,
         expense_category_id, expense_item_id, full_expense_code, description,
         is_active, expense_ledger_id, chart_of_account_id, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,now())
       on conflict (id) do update set
         financial_year=excluded.financial_year,
         department_id=excluded.department_id,
         section_id=excluded.section_id,
         cost_centre_id=excluded.cost_centre_id,
         expense_category_id=excluded.expense_category_id,
         expense_item_id=excluded.expense_item_id,
         full_expense_code=excluded.full_expense_code,
         description=excluded.description,
         is_active=true,
         expense_ledger_id=excluded.expense_ledger_id,
         chart_of_account_id=excluded.chart_of_account_id,
         updated_at=now()`,
      [item.id, item.financialYear, item.departmentId, item.sectionId, item.costCentreId, item.expenseCategoryId, item.expenseItemId, item.fullExpenseCode, item.description, item.expenseLedgerId, item.chartOfAccountId],
    )
  }

  for (const entity of provenanceEntities(plan)) await registerEntity(client, runId, entity)
  return plan
}

export async function applyCanonicalFinanceMappings(
  client: Client,
  runId: string,
  plan: FinanceMasterPlan,
): Promise<void> {
  for (const mapping of plan.mappings) {
    const result = await client.query<{ id: string }>(
      `select id from public.njss_upsert_finance_posting_mapping($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [mapping.id, mapping.financialYear, mapping.expenseLedgerId, mapping.expenseCodeRegistryId, mapping.chartOfAccountId, mapping.costCentreId, mapping.departmentId, mapping.sectionId, mapping.mappingNotes],
    )
    if (result.rowCount !== 1 || result.rows[0]?.id !== mapping.id) {
      throw new Error(`Canonical finance mapping RPC did not return expected mapping ${mapping.id}`)
    }
    await registerEntity(client, runId, {
      tableName: 'finance_posting_mappings',
      entityId: mapping.id,
      businessCode: `${mapping.financialYear}:${mapping.costCentreId}:${mapping.expenseLedgerId}`,
      provenance: mapping.provenance,
      sourceReference: mapping.mappingNotes,
    })
  }
}
