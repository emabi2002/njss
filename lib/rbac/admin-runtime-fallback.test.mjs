import fs from 'node:fs'
import assert from 'node:assert/strict'

const admin = fs.readFileSync(new URL('./admin.ts', import.meta.url), 'utf8')
const session = fs.readFileSync(new URL('../../app/api/account/session/route.ts', import.meta.url), 'utf8')
const password = fs.readFileSync(new URL('../../app/api/account/password/route.ts', import.meta.url), 'utf8')
const adminUsersEdge = fs.readFileSync(new URL('../../supabase/functions/njss-admin-users/index.ts', import.meta.url), 'utf8')

assert.match(admin, /tryCreateAdminClient\(\) \|\| createRequestSupabaseClient\(request\)/)
assert.match(admin, /export async function authorizeAdminRead/)
assert.match(session, /tryCreateAdminClient/)
assert.match(session, /recordAudit\(requestClient/)

const passwordGet = password.slice(
  password.indexOf('export async function GET'),
  password.indexOf('export async function POST'),
)
assert.match(passwordGet, /createRequestSupabaseClient\(request\)/)
assert.doesNotMatch(passwordGet, /createAdminClient\(/)

// Administrator-initiated user writes retain explicit service-role authority in
// the permission-checking Supabase Edge Function. Ordinary self-service password
// changes must not depend on the Netlify runtime holding that credential.
assert.match(admin, /SUPABASE_SERVICE_ROLE_KEY/)
assert.match(adminUsersEdge, /SUPABASE_SERVICE_ROLE_KEY/)
assert.match(adminUsersEdge, /auth\.admin\.updateUserById/)

const passwordPost = password.slice(password.indexOf('export async function POST'))
assert.doesNotMatch(passwordPost, /createAdminClient\(/)
assert.doesNotMatch(passwordPost, /SUPABASE_SERVICE_ROLE_KEY/)
assert.match(passwordPost, /functions\/v1\/njss-self-password/)
assert.match(passwordPost, /Authorization:\s*authorization/)

console.log('Admin runtime fallback and self-service separation checks passed.')
