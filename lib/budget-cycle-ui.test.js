import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

async function loadSubject() {
  try {
    return await import("./budget-cycle-ui.ts")
  } catch {
    return {}
  }
}

const cycles = [
  { id: "cycle-2026", budget_year: 2026, cycle_type: "ANNUAL", name: "FY2026 Annual Divisional Budget", department_ceiling: 6000000 },
  { id: "cycle-zero", budget_year: 2027, cycle_type: "ANNUAL", name: "FY2027 Annual Divisional Budget", department_ceiling: 0 },
]

test("detects an existing budget cycle regardless of cycle-type case and whitespace", async () => {
  const subject = await loadSubject()
  expect(typeof subject.findDuplicateBudgetCycle).toBe("function")
  expect(subject.findDuplicateBudgetCycle(cycles, 2026, " annual ")?.id).toBe("cycle-2026")
})

test("selecting a budget cycle also returns its default ceiling", async () => {
  const subject = await loadSubject()
  expect(typeof subject.selectBudgetCycle).toBe("function")
  expect(subject.selectBudgetCycle(cycles, "cycle-2026")).toEqual({ cycle_id: "cycle-2026", budget_ceiling: "6000000" })
  expect(subject.selectBudgetCycle(cycles, "cycle-zero")).toEqual({ cycle_id: "cycle-zero", budget_ceiling: "0" })
})

test("budget preparation exposes an administrator quick-add control instead of an always-open form", async () => {
  const source = await readFile(new URL("../app/dashboard/budget-template/page.tsx", import.meta.url), "utf8")
  expect(source).toContain("const [showCycleForm, setShowCycleForm] = useState(false)")
  expect(source).toContain('aria-label={showCycleForm ? "Close add budget cycle form" : "Add budget cycle"}')
  expect(source).toContain("{canAdmin && showCycleForm && (")
  expect(source).toContain("onChange={(e) => selectCycle(e.target.value)}")
})
