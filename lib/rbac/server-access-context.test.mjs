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
  authContext,
  /authFetch\(["']\/api\/account\/access["']\)/,
  'AuthContext must load effective RBAC access from the authenticated server endpoint.',
)

console.log('Server-authoritative RBAC access-context regression checks passed.')
