import fs from 'node:fs'
import assert from 'node:assert/strict'

const edge = fs.readFileSync('supabase/functions/njss-admin-users/index.ts', 'utf8')
const proxy = fs.readFileSync('app/api/admin/users/write/route.ts', 'utf8')
const authFetch = fs.readFileSync('lib/auth-fetch.ts', 'utf8')

for (const action of ['CREATE', 'UPDATE', 'SET_ACTIVE', 'RESET_PASSWORD', 'ARCHIVE', 'RESTORE', 'DELETE']) {
  assert.match(edge, new RegExp(`case ["']${action}["']`), `Edge Function must handle ${action}`)
}

assert.match(edge, /users\.manage/, 'Edge Function must enforce users.manage')
assert.match(edge, /njss_user_activity_summary/, 'Delete must check historical activity')
assert.match(edge, /can_hard_delete/, 'Delete must preserve archive-vs-delete rule')
assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/, 'Privileged writes must use Supabase service role inside Edge runtime')
assert.match(edge, /System Administrator/, 'Protected administrator rules must be enforced')
assert.match(edge, /Requisition Officer/, 'Four-group role model must be enforced')
assert.match(edge, /Line Supervisor/, 'Four-group role model must be enforced')
assert.match(edge, /Payment\/Reconciliation Officer/, 'Four-group role model must be enforced')

assert.match(proxy, /functions\/v1\/njss-admin-users/, 'Next write proxy must call the user administration Edge Function')
assert.match(proxy, /Authorization: authorization/, 'Next write proxy must forward the caller bearer token')
assert.match(proxy, /apikey: supabaseAnonKey/, 'Next write proxy must identify the Supabase project with the anon key')

assert.match(authFetch, /\/api\/admin\/users\/write/, 'User mutations must route to the secure write proxy')
assert.match(authFetch, /method !== 'GET'/, 'User-register reads must remain on the read API')

console.log('User CRUD Edge routing regression checks passed.')
