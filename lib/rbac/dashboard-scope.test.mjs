import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const routePath = 'app/api/dashboard/route.ts'
const pagePath = 'app/dashboard/page.tsx'
const migrationPath = 'supabase/migrations/052_dashboard_scope_access.sql'

assert.equal(existsSync(routePath), true, 'Dashboard must have an authenticated server data endpoint')
const route = readFileSync(routePath, 'utf8')

assert.match(route, /getServerAccessContext/, 'Dashboard API must resolve the authenticated RBAC context on the server')
assert.match(route, /dashboard\.view/, 'Dashboard API must require dashboard.view or universal all access')
assert.match(route, /System Administrator/, 'System Administrator must receive Head Office dashboard scope')
assert.match(route, /Registrar/, 'Registrar must receive Head Office dashboard scope')
assert.match(route, /Line Supervisor/, 'Line Supervisor must receive section-scoped dashboard data')
assert.match(route, /context\.sectionId/, 'Supervisor scope must come from the authenticated user section assignment')
assert.match(route, /hasServerPermission\(context, 'dashboard\.view'\)/, 'Dashboard must enforce password and permission guards')
assert.match(route, /court_location\.location_type', 'HEADQUARTERS'/, 'Dashboard must resolve Head Office divisions explicitly')
assert.match(route, /get_current_budget_position/, 'Dashboard must use the secured annual budget RPC')
assert.match(route, /cycle\?\.status === 'ACTIVE'/, 'Preparation cycles must not produce approved positions')
assert.match(route, /division_budgets/, 'Preparation must use current division budgets')
assert.match(route, /PENDING_REGISTRAR_APPROVAL/, 'Preparation must use the Registrar workflow')
assert.match(route, /isRecordInScope\(context/, 'FF3 and FF4 must retain authenticated record scope checks')
assert.match(route, /\.in\('section_id', sectionIds\)/, 'Workflow queries must be constrained to Head Office sections')
assert.match(route, /draftOriginalValue/, 'Draft amounts must have an explicitly preparation-only field')
assert.doesNotMatch(route, /v_authoritative_budget_position|quarterly_releases|divisional_budget_submissions|createService/, 'Dashboard must not access legacy funding or privileged unscoped clients')

const page = readFileSync(pagePath, 'utf8')
assert.match(page, /authFetch/, 'Dashboard client must use the authenticated server endpoint')
assert.match(page, /\/api\/dashboard\?financialYear=/, 'Dashboard client must request scoped dashboard data from the server')
assert.match(page, /Dashboard Scope:/, 'Dashboard must show the user the scope of the figures being displayed')
assert.doesNotMatch(page, /supabase\.from\(['"]v_management_financial_summary['"]\)/, 'Dashboard must not fetch the national management summary directly in the browser')

assert.equal(existsSync(migrationPath), true, 'Dashboard access-role migration must be versioned')
const migration = readFileSync(migrationPath, 'utf8')
assert.match(migration, /Payment\/Reconciliation Officer/, 'Migration must explicitly remove Dashboard from Payment/Reconciliation Officer')
assert.match(migration, /dashboard\.view/, 'Migration must manage dashboard.view permission')

assert.doesNotMatch(page, /Funded Amount|Released Amount|National View|Total Approved Budget/, 'Dashboard must not present obsolete funds or draft totals as approval')
console.log('Head Office annual dashboard scope contract passed')
