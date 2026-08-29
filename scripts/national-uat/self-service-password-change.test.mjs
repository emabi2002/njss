import fs from 'node:fs'
import assert from 'node:assert/strict'

const routePath = 'app/api/account/password/route.ts'
const migrationPath = 'supabase/migrations/069_self_service_password_change.sql'

assert.ok(fs.existsSync(routePath), `password endpoint missing: ${routePath}`)
assert.ok(fs.existsSync(migrationPath), `self-service password migration missing: ${migrationPath}`)

const route = fs.readFileSync(routePath, 'utf8')
const migration = fs.readFileSync(migrationPath, 'utf8')

// A signed-in user must change only their own Supabase Auth password with their
// own session. Self-service password changes must not depend on the privileged
// service-role administrator client used for administrator-initiated resets.
assert.match(route, /createRequestSupabaseClient/, 'password endpoint must create a caller-scoped Supabase client')
assert.match(route, /\.auth\.updateUser\(\s*\{\s*password\s*\}/s, 'password endpoint must update the signed-in user through auth.updateUser')
assert.doesNotMatch(route, /createAdminClient/, 'self-service password change must not require createAdminClient')
assert.doesNotMatch(route, /auth\.admin\.updateUserById/, 'self-service password change must not use admin.updateUserById')
assert.match(route, /\.rpc\(\s*['"]njss_complete_own_password_change['"]/, 'password endpoint must clear forced-change state through the narrow self-service RPC')

// The database operation is intentionally parameterless: auth.uid() is the only
// target selector, so a caller cannot choose another NJSS user record.
assert.match(migration, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.njss_complete_own_password_change\s*\(\s*\)/i, 'migration must create parameterless self-service completion RPC')
assert.match(migration, /SECURITY\s+DEFINER/i, 'completion RPC must be SECURITY DEFINER so it can update the otherwise immutable users table')
assert.match(migration, /auth\.uid\(\)\s+IS\s+NULL/i, 'completion RPC must reject unauthenticated callers')
assert.match(migration, /WHERE\s+auth_user_id\s*=\s*auth\.uid\(\)/i, 'completion RPC must target only the caller auth_user_id')
assert.match(migration, /must_change_password\s*=\s*false/i, 'completion RPC must clear must_change_password')
assert.match(migration, /password_changed_at\s*=\s*(?:NOW\(\)|CURRENT_TIMESTAMP)/i, 'completion RPC must record password_changed_at')
assert.match(migration, /GET\s+DIAGNOSTICS[\s\S]*ROW_COUNT/i, 'completion RPC must assert exactly one linked profile was updated')
assert.match(migration, /PASSWORD_CHANGED/, 'completion RPC must append a password-changed audit event')
assert.match(migration, /self_service/, 'completion audit metadata must identify self-service')

// PostgreSQL grants EXECUTE to PUBLIC by default unless explicitly revoked.
// This security-definer function must only be callable by authenticated users.
assert.match(migration, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.njss_complete_own_password_change\s*\(\s*\)\s+FROM\s+PUBLIC/i, 'completion RPC must revoke default PUBLIC execute')
assert.match(migration, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.njss_complete_own_password_change\s*\(\s*\)\s+FROM\s+anon/i, 'completion RPC must explicitly deny anon')
assert.match(migration, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.njss_complete_own_password_change\s*\(\s*\)\s+TO\s+authenticated/i, 'completion RPC must allow authenticated callers')

console.log('self-service first-login password change contract checks passed')
