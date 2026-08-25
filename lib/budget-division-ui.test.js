import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

async function loadSubject() {
  try {
    return await import("./budget-division-ui.ts")
  } catch {
    return {}
  }
}

const divisions = [
  { id: "division-acc", code: "ACC", name: "Accounts Section", cost_centre_code: "CC-01", cost_centre_name: "Accounts" },
  { id: "division-hr", code: "HR", name: "Human Resources", cost_centre_code: null, cost_centre_name: null },
]

test("detects an existing division code regardless of case and whitespace", async () => {
  const subject = await loadSubject()
  expect(typeof subject.findDuplicateBudgetDivision).toBe("function")
  expect(subject.findDuplicateBudgetDivision(divisions, " acc ")?.id).toBe("division-acc")
})

test("budget preparation exposes an administrator division quick-add control", async () => {
  const source = await readFile(new URL("../app/dashboard/budget-template/page.tsx", import.meta.url), "utf8")
  expect(source).toContain("const [showDivisionForm, setShowDivisionForm] = useState(false)")
  expect(source).toContain('aria-label={showDivisionForm ? "Close add division form" : "Add division / cost centre"}')
  expect(source).toContain("{canAdmin && showDivisionForm && (")
  expect(source).toContain("onClick={addDivision}")
})
