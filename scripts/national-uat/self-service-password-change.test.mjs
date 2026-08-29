import fs from 'node:fs'
import assert from 'node:assert/strict'

const routePath = 'app/api/account/password/route.ts'
const edgePath = 'supabase/functions/njss-self-password/index.ts'

assert.ok(fs.existsSync(routePath), `password endpoint missing: ${routePath}`)
assert.ok(fs.existsSync(edgePath), `self-service password Edge Function missing: ${edgePath}`)

const route = fs.readFileSync(routePath, 'utf8')
const edge = fs.readFileSync(edgePath, 'utf8')

// Netlify is only a JWT-preserving proxy. It must not require or expose the
// Supabase service-role secret for an ordinary user's first-login password change.
assert.doesNotMatch(route, /createAdminClient/, 'self-service password route must not require createAdminClient')
assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/, 'Netlify self-service password route must not depend on service-role configuration')
assert.doesNotMatch(route, /auth\.admin\.updateUserById/, 'Netlify self-service password route must not use admin.updateUserById')
assert.match(route, /functions\/v1\/njss-self-password/, 'password route must proxy to the dedicated self-service Edge Function')
assert.match(route, /Authorization:\s*authorization/, 'password route must forward the caller JWT unchanged')
assert.match(route, /apikey:\s*supabaseAnonKey/, 'password route must call the Edge Function with the public anon key')

// The Edge Function independently verifies the caller and never accepts a target
// user id. The JWT identity is the only identity allowed to change.
assert.match(edge, /authorization/i, 'Edge Function must require an Authorization bearer token')
assert.match(edge, /admin\.auth\.getUser\(token\)/, 'Edge Function must independently verify the caller JWT')
assert.doesNotMatch(edge, /body\.userId/, 'self-service Edge Function must not accept a target user id')
assert.match(edge, /\.eq\(["']auth_user_id["'],\s*authUser\.id\)/, 'Edge Function must load the NJSS profile by the verified auth user id')
assert.match(edge, /must_change_password/, 'Edge Function must verify and clear the forced-change state')

// Password mutation itself must use Supabase Auth's normal self-service endpoint
// with the caller JWT, not admin.updateUserById.
assert.match(edge, /\/auth\/v1\/user/, 'Edge Function must call the Supabase self-service Auth user endpoint')
assert.match(edge, /method:\s*["']PUT["']/, 'self-service Auth password update must use PUT')
assert.match(edge, /Authorization:\s*authorization/, 'Auth password update must use the caller bearer token')
assert.match(edge, /apikey:\s*anonKey/, 'Auth password update must use the public anon key')
assert.doesNotMatch(edge, /auth\.admin\.updateUserById/, 'self-service Edge Function must not use admin.updateUserById for password mutation')

// After Auth succeeds, service-role authority may update only the already-resolved
// caller profile because public.users is intentionally client-immutable under RLS.
assert.match(edge, /\.update\(\{[\s\S]*must_change_password:\s*false[\s\S]*password_changed_at:/, 'Edge Function must clear forced-change state and record password_changed_at')
assert.match(edge, /\.eq\(["']id["'],\s*profile\.id\)/, 'profile update must target only the verified caller profile')
assert.match(edge, /PASSWORD_CHANGED/, 'Edge Function must append a password-changed audit event')
assert.match(edge, /self_service/, 'password audit metadata must identify self-service')
assert.doesNotMatch(edge, /users\.manage/, 'self-service password change must not require user-administration permission')

console.log('JWT-protected self-service first-login password change contract checks passed')
