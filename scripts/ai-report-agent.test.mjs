import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("AI report API keeps user-scoped RLS and never uses admin/service-role execution", () => {
  const route = read("app/api/reports/agent/route.ts")
  const execute = read("reporting-agent/execute.ts")

  assert.match(route, /authorization/i)
  assert.match(execute, /getUserScopedClient/)
  assert.match(execute, /exec_report_sql/)
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|getAdminClient/)
  assert.doesNotMatch(execute, /SUPABASE_SERVICE_ROLE_KEY|getAdminClient/)
})

test("SQL safety guard explicitly rejects mutation and multi-statement output", () => {
  const guard = read("reporting-agent/guard.ts")

  assert.match(guard, /INSERT/i)
  assert.match(guard, /UPDATE/i)
  assert.match(guard, /DELETE/i)
  assert.match(guard, /DROP/i)
  assert.match(guard, /ALTER/i)
  assert.match(guard, /CREATE/i)
  assert.match(guard, /multiple|single statement|semicolon/i)
  assert.match(guard, /LIMIT/i)
})

test("Reports workspace mounts the natural-language AI report panel", () => {
  const page = read("app/dashboard/reports/page.tsx")
  const panel = read("components/reports/AiReportPanel.tsx")

  assert.match(page, /AiReportPanel/)
  assert.match(panel, /authFetch/)
  assert.match(panel, /\/api\/reports\/agent/)
  assert.match(panel, /textarea/)
  assert.match(panel, /Generated SQL/i)
  assert.match(panel, /narrative/)
  assert.match(panel, /rowCount/)
})

test("agent exposes the handoff response contract", () => {
  const types = read("reporting-agent/types.ts")

  for (const field of ["sql", "category", "tables", "narrative", "chart", "rows", "rowCount", "truncated", "ms"]) {
    assert.match(types, new RegExp(`\\b${field}\\b`))
  }
})
