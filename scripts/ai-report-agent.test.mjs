import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("AI report API keeps user-scoped RLS and requires dedicated AI access", () => {
  const route = read("app/api/reports/agent/route.ts")
  const execute = read("reporting-agent/execute.ts")

  assert.match(route, /getServerAccessContext/)
  assert.match(route, /reports\.ai\.use/)
  assert.doesNotMatch(route, /required_permissions:\s*\[\"reports\.view\"\]/)
  assert.match(execute, /createRequestSupabaseClient/)
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
  assert.match(guard, /ALLOWED_REPORT_TABLES/)
})

test("Reports module exposes a selectively authorized natural-language AI report workspace", () => {
  const page = read("app/dashboard/reports/ai/page.tsx")
  const panel = read("components/reports/AiReportPanel.tsx")
  const migration = read("supabase/migrations/20260911090000_ai_reporting_agent_navigation.sql")

  assert.match(page, /AiReportPanel/)
  assert.match(panel, /authFetch/)
  assert.match(panel, /\/api\/reports\/agent/)
  assert.match(panel, /textarea/)
  assert.match(panel, /Generated SQL/i)
  assert.match(panel, /narrative/)
  assert.match(panel, /rowCount/)
  assert.match(panel, /CSV/)
  assert.match(migration, /\/dashboard\/reports\/ai/)
  assert.match(migration, /reports\.ai\.use/)
  assert.match(migration, /AI Reporting User/)
  assert.match(migration, /role_permissions/)
})

test("agent exposes the handoff response contract", () => {
  const types = read("reporting-agent/types.ts")

  for (const field of ["sql", "category", "tables", "narrative", "chart", "rows", "rowCount", "truncated", "ms"]) {
    assert.match(types, new RegExp(`\\b${field}\\b`))
  }
})

test("model adapter targets the configured Ollama OpenAI-compatible endpoint without adding a privileged data path", () => {
  const model = read("reporting-agent/model.ts")

  assert.match(model, /OLLAMA_BASE_URL/)
  assert.match(model, /REPORT_MODEL/)
  assert.match(model, /chat\/completions/)
  assert.doesNotMatch(model, /SUPABASE_SERVICE_ROLE_KEY|getAdminClient/)
})

test("live smoke harness exercises the deployed authenticated AI report endpoint", () => {
  const smoke = read("scripts/ai-report-agent-smoke.mjs")

  assert.match(smoke, /NJSS_BASE_URL/)
  assert.match(smoke, /NJSS_ACCESS_TOKEN/)
  assert.match(smoke, /\/api\/reports\/agent/)
  assert.match(smoke, /Authorization/)
  assert.match(smoke, /Bearer/)
  for (const field of ["sql", "category", "tables", "narrative", "rows", "rowCount", "truncated", "ms"]) {
    assert.match(smoke, new RegExp(`\\b${field}\\b`))
  }
})
