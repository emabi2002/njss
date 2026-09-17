import fs from 'node:fs'
import assert from 'node:assert/strict'

const pagePath = 'app/dashboard/admin/organisation/page.tsx'
const migrationPath = 'supabase/migrations/20260918070000_organisation_setup_admin_menu.sql'
const accessRoute = fs.readFileSync('app/api/account/access/route.ts', 'utf8')

assert.ok(fs.existsSync(pagePath), 'Organisation Setup page must exist')
assert.ok(fs.existsSync(migrationPath), 'Organisation Setup menu migration must exist')

const page = fs.readFileSync(pagePath, 'utf8')
const migration = fs.readFileSync(migrationPath, 'utf8')

assert.match(page, /Organisation Setup/)
assert.match(page, /Divisions/)
assert.match(page, /Sections \/ Units/)
assert.match(page, /departments/)
assert.match(page, /sections/)
assert.match(page, /masterdata\.manage/)
assert.match(page, /can\("all"\)/)

assert.match(migration, /Organisation Setup/)
assert.match(migration, /\/dashboard\/admin\/organisation/)
assert.match(migration, /system\.organisation_setup/)
assert.match(migration, /masterdata\.manage/)
assert.match(migration, /users\.manage/)

assert.match(accessRoute, /permissions\.includes\('all'\)/, 'System-wide all permission must continue to bypass menu permission filters')

console.log('Organisation Setup administrator contract passed')
