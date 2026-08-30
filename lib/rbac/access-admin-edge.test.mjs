import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const routePath = 'app/api/admin/access/route.ts'
const edgePath = 'supabase/functions/njss-admin-access/index.ts'

const route = readFileSync(routePath, 'utf8')

assert.match(route, /functions\/v1\/njss-admin-access/, 'Access Control POST must route through njss-admin-access Edge Function')
assert.match(route, /Authorization:\s*authorization/, 'Access Control proxy must forward the caller bearer token unchanged')
assert.match(route, /apikey:\s*supabaseAnonKey/, 'Access Control proxy must authenticate the Edge request with the anon key')

assert.equal(existsSync(edgePath), true, 'njss-admin-access Edge Function source must exist in the repository')
const edge = readFileSync(edgePath, 'utf8')

for (const action of [
  'UPDATE_ROLE',
  'SET_ROLE_PERMISSIONS',
  'TOGGLE_ROLE_PERMISSION',
  'GRANT_USER_PERMISSION',
  'REVOKE_USER_PERMISSION',
  'SAVE_MODULE',
  'DELETE_MODULE',
  'SAVE_MENU',
  'DELETE_MENU',
  'SAVE_ROLE_SCOPE',
  'SAVE_USER_SCOPE',
  'REVOKE_USER_SCOPE',
]) {
  assert.ok(edge.includes(action), `Edge Function must implement ${action}`)
}

assert.match(edge, /admin\.auth\.getUser\(token\)/, 'Edge Function must independently verify the caller JWT')
assert.match(edge, /permissions\.includes\(['"]all['"]\)/, 'System Administrator all permission must authorise access-control actions')
assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/, 'Privileged writes must remain server-side behind service-role authority')

console.log('Access Control privileged Edge routing contract passed')
