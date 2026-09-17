import fs from 'node:fs'
import assert from 'node:assert/strict'

const config = fs.readFileSync('lib/rbac/config.ts', 'utf8')
const accessRoute = fs.readFileSync('app/api/account/access/route.ts', 'utf8')
const serverRbac = fs.readFileSync('lib/rbac/server.ts', 'utf8')
const migration = fs.readFileSync('supabase/migrations/20260917213000_system_admin_organisation_setup.sql', 'utf8')
const page = fs.readFileSync('app/dashboard/master/organisation/page.tsx', 'utf8')

assert.equal(
  accessRoute.includes("permissions.includes('all')"),
  true,
  'Database-driven navigation must expose all permitted menu items to a full-system administrator',
)
assert.equal(
  serverRbac.includes("context.permissions.includes('all')"),
  true,
  'Server authorization must treat the all permission as full-system access',
)
assert.equal(
  config.includes("/^\\/dashboard\\/master($|\\/)/") && config.includes("'masterdata.manage', 'registry.manage'"),
  true,
  'Organisation Setup must inherit the protected master-data route family',
)

assert.equal(page.includes('Organisation Setup'), true, 'Organisation Setup page must have a clear title')
assert.equal(page.includes('Divisions'), true, 'Organisation Setup must expose Division maintenance')
assert.equal(page.includes('Sections / Units'), true, 'Organisation Setup must expose Section / Unit maintenance')
assert.equal(page.includes('.from("departments")') || page.includes(".from('departments')"), true, 'Division maintenance must use the existing departments master table')
assert.equal(page.includes('.from("sections")') || page.includes(".from('sections')"), true, 'Section maintenance must use the existing sections master table')
assert.equal(page.includes("can('all')") || page.includes('can("all")'), true, 'Organisation Setup editing must require full-system access')
assert.equal(page.includes('department_id'), true, 'Each Section / Unit must be attached to a parent Division')
assert.equal(page.includes('is_active'), true, 'Divisions and Sections must support activation/deactivation')

assert.equal(
  migration.includes("System Administrator") && migration.includes("'all'") && migration.includes('SYSTEM_WIDE'),
  true,
  'Migration must explicitly preserve System Administrator full-system permission and data scope',
)
assert.equal(
  migration.includes('systems_administration.organisation_setup') && migration.includes('/dashboard/master/organisation'),
  true,
  'Migration must add the Organisation Setup navigation item under System Operations',
)
assert.equal(
  migration.includes("ARRAY['all']::text[]"),
  true,
  'Organisation Setup menu must be explicitly visible to the full-system administrator permission',
)

console.log('System Administrator organisation setup contract checks passed')
