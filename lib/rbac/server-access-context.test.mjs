import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const routeUrl = new URL('../../app/api/account/access/route.ts', import.meta.url)
assert.ok(
  existsSync(routeUrl),
  'An authenticated /api/account/access endpoint must expose the server-authoritative RBAC context.',
)

const route = readFileSync(routeUrl, 'utf8')
const authContext = readFileSync(new URL('../../contexts/AuthContext.tsx', import.meta.url), 'utf8')

assert.match(
  route,
  /getServerAccessContext\(request\)/,
  'The account access endpoint must resolve the caller through getServerAccessContext().',
)
assert.match(
  route,
  /permissions\s*:\s*context\.permissions/,
  'The account access endpoint must return the server-authoritative effective permissions.',
)
assert.match(
  route,
  /menus\s*:/,
  'The account access endpoint must return the caller\'s authorised navigation menus.',
)
assert.match(
  route,
  /modules\s*:/,
  'The account access endpoint must return active RBAC modules for navigation grouping.',
)
assert.match(
  authContext,
  /authFetch\(["']\/api\/account\/access["']\)/,
  'AuthContext must load effective RBAC access from the authenticated server endpoint.',
)
assert.match(
  authContext,
  /setMenus\(access\.menus\s*\|\|\s*\[\]\)/,
  'AuthContext must populate navigation from the server-authoritative access response.',
)
assert.match(
  authContext,
  /setModules\(access\.modules\s*\|\|\s*\[\]\)/,
  'AuthContext must populate modules from the server-authoritative access response.',
)
assert.doesNotMatch(
  authContext,
  /loadRbacNavigation\(permissions\)\.then\(setMenus\)/,
  'AuthContext must not rebuild navigation through the browser-side Supabase RBAC loader.',
)
assert.doesNotMatch(
  authContext,
  /loadRbacModules\(\)\.then\(setModules\)/,
  'AuthContext must not rebuild modules through the browser-side Supabase RBAC loader.',
)

console.log('Server-authoritative RBAC access-context regression checks passed.')
