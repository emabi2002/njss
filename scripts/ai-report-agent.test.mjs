import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("AI report API and page route require dedicated AI access while keeping user-scoped RLS", () => {
  const route = read("app/api/reports/agent/route.ts")
  const server = read("lib/rbac/server.ts")
  const execute = read("reporting-agent/execute.ts")

  assert.match(route, /getServerAccessContext/)
  assert.match(route, /reports\.ai\.use/)
  assert.doesNotMatch(route, /required_permissions:\s*\[\"reports\.view\"\]/)
  assert.match(server, /dashboard\\\/reports\\\/ai/)
  assert.match(server, /reports\.ai\.use/)
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

// Execute the reporting policy without a model or database connection.
const { createRequire } = await import("node:module")
const { runInNewContext } = await import("node:vm")
const require = createRequire(import.meta.url)
const ts = require("typescript")
const policyModules = new Map()
function loadPolicy(name) {
  if (policyModules.has(name)) return policyModules.get(name)
  const module = { exports: {} }
  policyModules.set(name, module.exports)
  const source = ts.transpileModule(read(`reporting-agent/${name}.ts`), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(source, {
    module, exports: module.exports,
    require: (path) => loadPolicy(path.replace(/^\.\//, "")),
  })
  return module.exports
}

test("AI refuses retired budget and funding requests even when mixed with operational categories", () => {
  const { assertSupportedReportQuestion } = loadPolicy("domain")
  for (const question of [
    "Show annual budget", "FF3 commitments against approved budget",
    "Show payments and available balance", "Funding receipt totals",
    "Supplier allocations", "Quarterly releases", "Management financial position", "Show remaining balances",
  ]) {
    assert.throws(() => assertSupportedReportQuestion(question), (error) =>
      error.status === 410 && error.message.includes("/dashboard/reports"))
  }
  for (const question of ["List FF3 commitments", "Show FF4 payments", "Supplier compliance", "Audit activity"]) {
    assert.doesNotThrow(() => assertSupportedReportQuestion(question))
  }
  const agent = read("reporting-agent/agent.ts")
  assert.ok(agent.indexOf("assertSupportedReportQuestion(question)") < agent.indexOf("await generateReportSql"))
})

test("SQL guard excludes retired financial relations and retains operational traces", () => {
  const { guardReportSql } = loadPolicy("guard")
  const { getSchemaForCategory } = loadPolicy("schema.generated")
  for (const table of [
    "budget_cycles", "divisional_budget_submissions", "divisional_budget_lines",
    "budget_allocations", "budget_monthly_allocations", "budget_revisions",
    "budget_revision_lines", "budget_periods", "budget_division_ceilings",
    "budget_release_funding_lines", "funding_authorities", "funding_receipts",
    "funding_allocations", "quarterly_releases", "budget_divisions",
  ]) {
    assert.throws(() => guardReportSql(`SELECT id FROM ${table}`), /outside the reporting allow-list/)
  }
  for (const category of ["management", "commitment", "expenditure", "supplier", "audit"]) {
    const schema = getSchemaForCategory(category)
    assert.doesNotMatch(schema, /(?:budget_allocations|funding_authorities|funding_receipts|quarterly_releases)\(/)
  }
  assert.throws(() => getSchemaForCategory("budget"), (error) => error.status === 410)
  assert.throws(() => getSchemaForCategory("funding"), (error) => error.status === 410)
  assert.doesNotThrow(() => guardReportSql("SELECT ff3_number FROM ff3_headers"))
  assert.doesNotThrow(() => guardReportSql("SELECT transaction_date, amount FROM payment_transactions"))
})
