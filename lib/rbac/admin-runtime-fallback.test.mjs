import fs from 'node:fs'
import assert from 'node:assert/strict'

const admin = fs.readFileSync(new URL('./admin.ts', import.meta.url), 'utf8')
const session = fs.readFileSync(new URL('../../app/api/account/session/route.ts', import.meta.url), 'utf8')
const password = fs.readFileSync(new URL('../../app/api/account/password/route.ts', import.meta.url), 'utf8')

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

// Privileged writes must still retain the explicit service-role path.
assert.match(password.slice(password.indexOf('export async function POST')), /createAdminClient\(/)
assert.match(admin, /SUPABASE_SERVICE_ROLE_KEY/)

console.log('Admin runtime fallback regression checks passed.')
