import assert from "node:assert/strict"
import test from "node:test"

let lookups = {}

try {
  lookups = await import("../lib/ff3-lookups.ts")
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error
}

test("expense-code labels include their identifying description", () => {
  assert.equal(typeof lookups.formatExpenseCodeLabel, "function", "The FF3 expense-code formatter is not implemented")
  assert.equal(
    lookups.formatExpenseCodeLabel({ full_expense_code: "FIN-ACC-TRAVEL-AIR", description: "Domestic Air Travel" }),
    "FIN-ACC-TRAVEL-AIR — Domestic Air Travel",
  )
})

test("expense-code labels do not append an empty description", () => {
  assert.equal(typeof lookups.formatExpenseCodeLabel, "function", "The FF3 expense-code formatter is not implemented")
  assert.equal(lookups.formatExpenseCodeLabel({ full_expense_code: "FIN-ACC-GEN", description: null }), "FIN-ACC-GEN")
})

test("approved budget codes retain their descriptions from the budget view", () => {
  assert.equal(typeof lookups.buildApprovedExpenseCodes, "function", "Approved expense-code normalization is not implemented")
  assert.deepEqual(
    lookups.buildApprovedExpenseCodes(
      [{ expense_code_registry_id: "code-1", full_expense_code: "FIN-AIR", section_id: "section-1", expense_description: "Airfares" }],
      [],
    ),
    [{ id: "code-1", full_expense_code: "FIN-AIR", section_id: "section-1", description: "Airfares" }],
  )
})

test("approved budget codes fall back to the registry description when the ledger description is missing", () => {
  assert.equal(typeof lookups.buildApprovedExpenseCodes, "function", "Approved expense-code normalization is not implemented")
  assert.deepEqual(
    lookups.buildApprovedExpenseCodes(
      [{ expense_code_registry_id: "code-1", full_expense_code: "FIN-AIR", section_id: null, expense_description: null }],
      [{ id: "code-1", full_expense_code: "FIN-AIR", section_id: null, description: "Domestic flights" }],
    ),
    [{ id: "code-1", full_expense_code: "FIN-AIR", section_id: null, description: "Domestic flights" }],
  )
})

test("numeric approved expense codes recover their description from the authoritative finance ledger", () => {
  assert.deepEqual(
    lookups.buildApprovedExpenseCodes(
      [{ expense_code_registry_id: "code-5110", full_expense_code: "5110", section_id: null, expense_description: null }],
      [{ id: "code-5110", full_expense_code: "5110", section_id: null, description: null }],
      [{ finance_code: "5110", standard_description: "Salaries and wages", expense_code_registry_id: null }],
    ),
    [{ id: "code-5110", full_expense_code: "5110", section_id: null, description: "Salaries and wages" }],
  )
})

test("registry-only dropdown options recover matching finance-ledger descriptions", () => {
  assert.equal(typeof lookups.attachLedgerDescriptions, "function", "Registry expense-code descriptions are not enriched from the finance ledger")
  assert.deepEqual(
    lookups.attachLedgerDescriptions(
      [{ id: "code-5210", full_expense_code: "5210", section_id: "section-1", description: null }],
      [{ finance_code: "5210", standard_description: "Domestic travel", expense_code_registry_id: null }],
    ),
    [{ id: "code-5210", full_expense_code: "5210", section_id: "section-1", description: "Domestic travel" }],
  )
})

test("blank registry descriptions do not hide the finance-ledger description", () => {
  assert.deepEqual(
    lookups.attachLedgerDescriptions(
      [{ id: "code-5220", full_expense_code: "5220", section_id: null, description: "   " }],
      [{ finance_code: "5220", standard_description: "International travel", expense_code_registry_id: null }],
    ),
    [{ id: "code-5220", full_expense_code: "5220", section_id: null, description: "International travel" }],
  )
})

test("blank budget-view descriptions fall back to the registered description", () => {
  assert.deepEqual(
    lookups.buildApprovedExpenseCodes(
      [{ expense_code_registry_id: "code-5310", full_expense_code: "5310", section_id: null, expense_description: "  " }],
      [{ id: "code-5310", full_expense_code: "5310", section_id: null, description: "Office supplies and stationery" }],
    ),
    [{ id: "code-5310", full_expense_code: "5310", section_id: null, description: "Office supplies and stationery" }],
  )
})

test("new sections are attached to the selected department", () => {
  assert.equal(typeof lookups.buildMasterLookupPayload, "function", "FF3 lookup payload construction is not implemented")
  assert.deepEqual(
    lookups.buildMasterLookupPayload("sections", { code: "EXEC", name: "Executive Office" }, { departmentId: "department-1" }),
    { code: "EXEC", name: "Executive Office", department_id: "department-1", is_active: true },
  )
})

test("new cost centres retain both selected organisational relationships", () => {
  assert.equal(typeof lookups.buildMasterLookupPayload, "function", "FF3 lookup payload construction is not implemented")
  assert.deepEqual(
    lookups.buildMasterLookupPayload("cost_centres", { code: "EXEC", name: "Executive Cost Centre" }, { departmentId: "department-1", sectionId: "section-1" }),
    { code: "EXEC", name: "Executive Cost Centre", department_id: "department-1", section_id: "section-1", is_active: true },
  )
})

test("new expense-code payloads preserve the controlled hierarchy and financial year", () => {
  assert.equal(typeof lookups.buildExpenseCodePayload, "function", "Controlled expense-code creation is not implemented")
  assert.deepEqual(
    lookups.buildExpenseCodePayload({
      departmentId: "department-1",
      sectionId: "section-1",
      costCentreId: "cost-centre-1",
      categoryId: "category-1",
      itemId: "item-1",
      financialYear: 2026,
      description: "Domestic Air Travel",
    }),
    {
      department_id: "department-1",
      section_id: "section-1",
      cost_centre_id: "cost-centre-1",
      expense_category_id: "category-1",
      expense_item_id: "item-1",
      financial_year: 2026,
      description: "Domestic Air Travel",
      full_expense_code: "PENDING",
      is_active: true,
    },
  )
})

test("expense-code creation rejects an incomplete controlled hierarchy", () => {
  assert.equal(typeof lookups.buildExpenseCodePayload, "function", "Controlled expense-code creation is not implemented")
  assert.throws(
    () => lookups.buildExpenseCodePayload({ departmentId: "department-1", costCentreId: "", categoryId: "category-1", itemId: "item-1", financialYear: 2026 }),
    /cost centre/i,
  )
})
