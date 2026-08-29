import fs from 'node:fs'
import assert from 'node:assert/strict'

const layoutPath = 'app/dashboard/layout.tsx'
const configPath = 'lib/rbac/config.ts'
const clientPath = 'lib/rbac/client.ts'
const ff3ListPath = 'app/dashboard/ff3/page.tsx'
const ff3DetailPath = 'app/dashboard/ff3/[ff3_number]/page.tsx'
const ff4ListPath = 'app/dashboard/ff4/page.tsx'
const ff4DetailPath = 'app/dashboard/ff4/[ff4_number]/page.tsx'

for (const path of [layoutPath, configPath, clientPath, ff3ListPath, ff3DetailPath, ff4ListPath, ff4DetailPath]) {
  assert.ok(fs.existsSync(path), `UAT readiness source missing: ${path}`)
}

const layout = fs.readFileSync(layoutPath, 'utf8')
const config = fs.readFileSync(configPath, 'utf8')
const client = fs.readFileSync(clientPath, 'utf8')
const ff3List = fs.readFileSync(ff3ListPath, 'utf8')
const ff3Detail = fs.readFileSync(ff3DetailPath, 'utf8')
const ff4List = fs.readFileSync(ff4ListPath, 'utf8')
const ff4Detail = fs.readFileSync(ff4DetailPath, 'utf8')

// The RBAC layer must remain fail-closed for unmapped dashboard routes.
assert.match(client, /pathname\.startsWith\('\/dashboard'\)\s*\?\s*\['__deny_unmapped_route__'\]/, 'unmapped dashboard routes must fail closed')
assert.match(client, /export function canAccessRoute\(/, 'RBAC route authorization helper must remain available')

// The no-access landing route must itself be reachable by any authenticated user,
// otherwise fail-closed routing would loop forever.
assert.match(
  config,
  /pattern:\s*\/\^\\\/dashboard\\\/no-access\$\/[^\n]*permissions:\s*\[\s*\]/,
  'RBAC route map must explicitly allow the authenticated no-access landing page',
)

// Dashboard layout must enforce route permissions in addition to menu filtering.
assert.match(layout, /canAccessRoute/, 'dashboard layout must import/use canAccessRoute')
assert.match(layout, /permissions/, 'dashboard layout must use effective RBAC permissions')
assert.match(layout, /pathname\s*!==\s*["']\/dashboard\/no-access["']/, 'route guard must exempt the no-access landing page')
assert.match(layout, /!canAccessRoute\(permissions,\s*pathname\)/, 'dashboard layout must deny unauthorized direct URLs')
assert.match(layout, /router\.replace\(["']\/dashboard\/no-access["']\)/, 'unauthorized dashboard routes must redirect to no-access')

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
