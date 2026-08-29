import fs from 'node:fs'
import assert from 'node:assert/strict'

const routeGuardPath = 'app/dashboard/template.tsx'
const authContextPath = 'contexts/AuthContext.tsx'
const configPath = 'lib/rbac/config.ts'
const clientPath = 'lib/rbac/client.ts'
const noAccessPath = 'app/dashboard/no-access/page.tsx'
const ff3ListPath = 'app/dashboard/ff3/page.tsx'
const ff3DetailPath = 'app/dashboard/ff3/[ff3_number]/page.tsx'
const ff4ListPath = 'app/dashboard/ff4/page.tsx'
const ff4DetailPath = 'app/dashboard/ff4/[ff4_number]/page.tsx'

for (const path of [authContextPath, configPath, clientPath, noAccessPath, ff3ListPath, ff3DetailPath, ff4ListPath, ff4DetailPath]) {
  assert.ok(fs.existsSync(path), `UAT readiness source missing: ${path}`)
}
assert.ok(fs.existsSync(routeGuardPath), 'dashboard route-authorization template must exist')

const routeGuard = fs.readFileSync(routeGuardPath, 'utf8')
const authContext = fs.readFileSync(authContextPath, 'utf8')
const config = fs.readFileSync(configPath, 'utf8')
const client = fs.readFileSync(clientPath, 'utf8')
const noAccess = fs.readFileSync(noAccessPath, 'utf8')
const ff3List = fs.readFileSync(ff3ListPath, 'utf8')
const ff3Detail = fs.readFileSync(ff3DetailPath, 'utf8')
const ff4List = fs.readFileSync(ff4ListPath, 'utf8')
const ff4Detail = fs.readFileSync(ff4DetailPath, 'utf8')

// The RBAC layer must remain fail-closed for unmapped dashboard routes.
assert.match(client, /pathname\.startsWith\('\/dashboard'\)\s*\?\s*\['__deny_unmapped_route__'\]/, 'unmapped dashboard routes must fail closed')
assert.match(client, /export function canAccessRoute\(/, 'RBAC route authorization helper must remain available')

// The no-access landing route must itself be reachable by any authenticated user,
// otherwise fail-closed routing would loop forever.
assert.match(client, /pathname\s*===\s*['"]\/dashboard\/no-access['"][^\n]*return\s*\[\s*\]/, 'RBAC route resolver must explicitly allow no-access')
assert.match(noAccess, /AccessDenied/, 'no-access route must render the standard access-denied UI')

// Auth must expose an explicit readiness boundary so route authorization never runs
// against the temporary session profile before database-backed permissions are loaded.
assert.match(authContext, /accessReady:\s*boolean/, 'auth context must expose RBAC access readiness')
assert.match(authContext, /const \[accessReady,\s*setAccessReady\]\s*=\s*useState\(false\)/, 'RBAC access readiness must start false')
assert.match(authContext, /setAccessReady\(false\)/, 'RBAC access loading must explicitly reset readiness')
assert.match(authContext, /setAccessReady\(true\)/, 'RBAC access loading must explicitly mark completion')

// The dashboard segment template must enforce route permissions in addition to menu
// filtering, but only after the effective database-backed RBAC context is ready.
assert.match(routeGuard, /canAccessRoute/, 'dashboard route guard must use canAccessRoute')
assert.match(routeGuard, /permissions/, 'dashboard route guard must use effective RBAC permissions')
assert.match(routeGuard, /accessReady/, 'dashboard route guard must wait for RBAC access readiness')
assert.match(routeGuard, /pathname\s*!==\s*["']\/dashboard\/no-access["']/, 'route guard must exempt the no-access landing page')
assert.match(routeGuard, /!canAccessRoute\(permissions,\s*pathname\)/, 'dashboard route guard must deny unauthorized direct URLs')
assert.match(routeGuard, /router\.replace\(["']\/dashboard\/no-access["']\)/, 'unauthorized dashboard routes must redirect to no-access')

// Core role workflows must remain gated by action permissions in the UI.
assert.match(ff3List, /can\(['"]ff3\.create['"]\)/, 'FF3 creation must be permission-gated')
assert.match(ff3Detail, /can\(['"]ff3\.endorse['"]\)/, 'FF3 endorsement must be permission-gated')
assert.match(ff3Detail, /can\(['"]ff3\.approve['"]\)/, 'FF3 approval must be permission-gated')
assert.match(ff4List, /can\(['"]ff4\.create['"]\)/, 'FF4 creation must be permission-gated')
assert.match(ff4Detail, /can\(['"]ff4\.verify['"]\)/, 'FF4 verification must be permission-gated')
assert.match(ff4Detail, /can\(['"]ff4\.approve['"]\)/, 'FF4 approval must be permission-gated')
assert.match(ff4Detail, /can\(['"]ff4\.process['"]\)/, 'FF4 processing/payment must be permission-gated')

// Core UAT routes must stay explicitly mapped rather than relying on fallback behavior.
for (const routeToken of [
  '/^\\/dashboard\\/ff3\\/new$/',
  '/^\\/dashboard\\/ff3($|\\/)/',
  '/^\\/dashboard\\/ff4\\/new$/',
  '/^\\/dashboard\\/ff4($|\\/)/',
  '/^\\/dashboard\\/budget($|\\/)/',
  '/^\\/dashboard\\/reports($|\\/)/',
]) {
  assert.ok(config.includes(routeToken), `UAT route map missing explicit route: ${routeToken}`)
}

console.log('application UAT readiness contract checks passed')
