import fs from 'node:fs'
import assert from 'node:assert/strict'

const authPath = 'lib/auth.ts'
const recoveryPath = 'app/auth/reset-password/page.tsx'

assert.ok(fs.existsSync(authPath), `auth helper missing: ${authPath}`)
assert.ok(fs.existsSync(recoveryPath), `password recovery page missing: ${recoveryPath}`)

const auth = fs.readFileSync(authPath, 'utf8')
const recovery = fs.readFileSync(recoveryPath, 'utf8')

assert.match(auth, /resetPasswordForEmail\(email,\s*\{[\s\S]*redirectTo:\s*`\$\{window\.location\.origin\}\/auth\/reset-password`/, 'forgot-password email must return to the NJSS recovery route')
assert.match(recovery, /validatePassword/, 'recovery page must enforce the shared NJSS password policy')
assert.match(recovery, /supabase\.auth\.getSession\(\)/, 'recovery page must require the recovery session established by Supabase Auth')
assert.match(recovery, /supabase\.auth\.onAuthStateChange/, 'recovery page must observe the PASSWORD_RECOVERY authentication event')
assert.match(recovery, /PASSWORD_RECOVERY/, 'recovery page must recognize Supabase password-recovery state')
assert.match(recovery, /supabase\.auth\.updateUser\(\s*\{\s*password\s*:/s, 'recovery page must update only the authenticated recovery user password')
assert.match(recovery, /supabase\.auth\.signOut\(\)/, 'recovery page must terminate the temporary recovery session after success')
assert.doesNotMatch(recovery, /createAdminClient|serviceRole|SUPABASE_SERVICE_ROLE_KEY/, 'browser recovery must never depend on service-role authority')

console.log('password recovery route contract checks passed')
