import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const routePath = 'app/api/dashboard/route.ts'
const pagePath = 'app/dashboard/page.tsx'
const migrationPath = 'supabase/migrations/052_dashboard_scope_access.sql'

assert.equal(existsSync(routePath), true, 'Dashboard must have an authenticated server data endpoint')
const route = readFileSync(routePath, 'utf8')

assert.match(route, /getServerAccessContext/, 'Dashboard API must resolve the authenticated RBAC context on the server')
assert.match(route, /dashboard\.view/, 'Dashboard API must require dashboard.view or universal all access')
assert.match(route, /System Administrator/, 'System Administrator must receive national dashboard scope')
assert.match(route, /Registrar/, 'Registrar must receive national dashboard scope')
assert.match(route, /Line Supervisor/, 'Line Supervisor must receive section-scoped dashboard data')
assert.match(route, /context\.sectionId/, 'Supervisor scope must come from the authenticated user section assignment')
assert.match(route, /\.eq\(['"]section_id['"],\s*context\.sectionId\)/, 'Section-bearing financial queries must be explicitly filtered to the supervisor section')
assert.match(route, /v_authoritative_budget_position/, 'Financial summary must aggregate from section-bearing authoritative budget positions')
assert.match(route, /divisional_budget_submissions/, 'Budget preparation statistics must be scoped explicitly')
assert.match(route, /budget_divisions/, 'Supervisor budget submissions must be constrained through section-linked budget divisions')

const page = readFileSync(pagePath, 'utf8')
assert.match(page, /authFetch/, 'Dashboard client must use the authenticated server endpoint')
assert.match(page, /\/api\/dashboard\?financialYear=/, 'Dashboard client must request scoped dashboard data from the server')
assert.match(page, /Dashboard Scope:/, 'Dashboard must show the user the scope of the figures being displayed')
assert.doesNotMatch(page, /supabase\.from\(['"]v_management_financial_summary['"]\)/, 'Dashboard must not fetch the national management summary directly in the browser')

assert.equal(existsSync(migrationPath), true, 'Dashboard access-role migration must be versioned')
const migration = readFileSync(migrationPath, 'utf8')
assert.match(migration, /Payment\/Reconciliation Officer/, 'Migration must explicitly remove Dashboard from Payment/Reconciliation Officer')
assert.match(migration, /dashboard\.view/, 'Migration must manage dashboard.view permission')

console.log('Dashboard role and section scope contract passed')
