export type ExpenseCodeOption = {
  id: string
  full_expense_code: string
  section_id: string | null
  description: string | null
}

type ApprovedBudgetCode = {
  expense_code_registry_id: string | null
  full_expense_code: string | null
  section_id: string | null
  expense_description?: string | null
}

export type ExpenseLedgerDescription = {
  finance_code: string
  standard_description: string | null
  expense_code_registry_id?: string | null
}

type LookupContext = {
  departmentId?: string
  sectionId?: string
}

type ExpenseCodeContext = LookupContext & {
  costCentreId: string
  categoryId: string
  itemId: string
  financialYear: number
  description?: string
}

export function formatExpenseCodeLabel(code: Pick<ExpenseCodeOption, "full_expense_code" | "description">) {
  const description = code.description?.trim()
  return description ? `${code.full_expense_code} — ${description}` : code.full_expense_code
}

export function attachLedgerDescriptions(registryRows: ExpenseCodeOption[], ledgerRows: ExpenseLedgerDescription[]) {
  const ledgerByRegistryId = new Map(
    ledgerRows.filter((row) => row.expense_code_registry_id).map((row) => [String(row.expense_code_registry_id), row]),
  )
  const ledgerByFinanceCode = new Map(ledgerRows.map((row) => [row.finance_code.trim(), row]))

  return registryRows.map((row) => ({
    ...row,
    description: row.description?.trim()
      || ledgerByRegistryId.get(row.id)?.standard_description?.trim()
      || ledgerByFinanceCode.get(row.full_expense_code.trim())?.standard_description?.trim()
      || null,
  }))
}

export function buildApprovedExpenseCodes(
  approvedRows: ApprovedBudgetCode[],
  registryRows: ExpenseCodeOption[],
  ledgerRows: ExpenseLedgerDescription[] = [],
) {
  const registryById = new Map(attachLedgerDescriptions(registryRows, ledgerRows).map((row) => [row.id, row]))

  return approvedRows
    .filter((row) => row.expense_code_registry_id)
    .map((row) => {
      const id = String(row.expense_code_registry_id)
      return {
        id,
        full_expense_code: row.full_expense_code || registryById.get(id)?.full_expense_code || "",
        section_id: row.section_id || null,
        description: row.expense_description?.trim() || registryById.get(id)?.description || null,
      }
    })
}

export function buildMasterLookupPayload(table: string, form: Record<string, string>, context: LookupContext = {}) {
  const payload: Record<string, unknown> = {
    code: form.code?.trim(),
    name: form.name?.trim(),
    is_active: true,
  }

  if (table === "sections" || table === "cost_centres") {
    if (!context.departmentId) throw new Error("Select a department before adding this record.")
    payload.department_id = context.departmentId
  }

  if (table === "cost_centres") payload.section_id = context.sectionId || null
  if (table === "projects" && context.departmentId) payload.department_id = context.departmentId
  if (table === "funding_sources" && form.source_type?.trim()) payload.source_type = form.source_type.trim()

  return payload
}

export function buildExpenseCodePayload(context: ExpenseCodeContext) {
  if (!context.departmentId) throw new Error("Select a department before creating an expense code.")
  if (!context.costCentreId) throw new Error("Select a cost centre before creating an expense code.")
  if (!context.categoryId) throw new Error("Select an expense category before creating an expense code.")
  if (!context.itemId) throw new Error("Select an expense item before creating an expense code.")

  return {
    department_id: context.departmentId,
    section_id: context.sectionId || null,
    cost_centre_id: context.costCentreId,
    expense_category_id: context.categoryId,
    expense_item_id: context.itemId,
    financial_year: context.financialYear,
    description: context.description?.trim() || null,
    full_expense_code: "PENDING",
    is_active: true,
  }
}
