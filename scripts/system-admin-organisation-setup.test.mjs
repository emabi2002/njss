import fs from 'node:fs'
import assert from 'node:assert/strict'

const config = fs.readFileSync('lib/rbac/config.ts', 'utf8')
const layout = fs.readFileSync('app/dashboard/layout.tsx', 'utf8')
const migration = fs.readFileSync('supabase/migrations/20260917213000_system_admin_organisation_setup.sql', 'utf8')
const page = fs.readFileSync('app/dashboard/admin/organisation/page.tsx', 'utf8')

assert.equal(
  config.includes("code: 'systems_administration.organisation_setup'") &&
    config.includes("href: '/dashboard/admin/organisation'") &&
    config.includes("label: 'Organisation Setup'"),
  true,
  'RBAC config must expose Organisation Setup in the system administration menu',
)
assert.equal(
  config.includes("/^\\/dashboard\\/admin\\/organisation($|\\/)/") && config.includes("permissions: ['all']"),
  true,
  'Organisation Setup route must be explicitly restricted to full-system administrators',
)
assert.equal(
  layout.includes("permissions.includes('all')") || layout.includes('permissions.includes("all")'),
  true,
  'Dashboard navigation must recognise the full-system administrator permission',
)
assert.equal(
  layout.includes('HIDDEN_SUPPORT_MENU_CODES') && layout.includes('hasFullSystemAccess'),
  true,
  'System Administrator must not lose active support menus to the ordinary-user hidden-menu filter',
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
  migration.includes('systems_administration.organisation_setup') && migration.includes('/dashboard/admin/organisation'),
  true,
  'Migration must add the Organisation Setup navigation item',
)

console.log('System Administrator organisation setup contract checks passed')
