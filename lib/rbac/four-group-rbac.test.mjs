import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const types = read('lib/rbac/types.ts')
const scope = read('lib/rbac/scope.ts')
const adminTypes = read('app/dashboard/users/types.ts')

assert.match(types, /'SECTION_WIDE'/, 'DataScopeType must include SECTION_WIDE')
assert.match(scope, /case 'SECTION_WIDE':/, 'scope evaluator must handle SECTION_WIDE')
assert.match(scope, /record\.section_id === context\.sectionId/, 'SECTION_WIDE must compare record section to user section')
for (const role of ['Requisition Officer', 'Line Supervisor', 'Registrar', 'Payment/Reconciliation Officer']) {
  assert.ok(adminTypes.includes(`"${role}"`), `workflow order must include ${role}`)
}
for (const legacy of ['FF Requisition Officer', 'Line/Section Supervisor', 'FF4 Officer', 'Accounts Reconciliation Officer']) {
  assert.ok(!adminTypes.includes(`"${legacy}"`), `workflow order must not retain ${legacy}`)
}

const migrationPath = new URL('../../supabase/migrations/045_four_group_operational_rbac.sql', import.meta.url)
assert.ok(fs.existsSync(migrationPath), 'migration 045 must exist')
const migration = fs.readFileSync(migrationPath, 'utf8')
for (const role of ['Requisition Officer', 'Line Supervisor', 'Registrar', 'Payment/Reconciliation Officer', 'System Administrator']) {
  assert.ok(migration.includes(`'${role}'`), `migration must define ${role}`)
}
assert.match(migration, /'SECTION_WIDE'/, 'migration must configure SECTION_WIDE')
assert.match(migration, /'SYSTEM_WIDE'/, 'migration must configure SYSTEM_WIDE')
assert.match(migration, /FF Requisition Officer[\s\S]*Requisition Officer/, 'migration must map old requisition role')
assert.match(migration, /Line\/Section Supervisor[\s\S]*Line Supervisor/, 'migration must map old line supervisor role')
assert.match(migration, /FF4 Officer[\s\S]*Payment\/Reconciliation Officer/, 'migration must merge FF4 Officer')
assert.match(migration, /Accounts Reconciliation Officer[\s\S]*Payment\/Reconciliation Officer/, 'migration must merge reconciliation role')
assert.match(migration, /Line Supervisor[\s\S]*budget\.template\.create/, 'Line Supervisor must inherit budget creation')
assert.match(migration, /Registrar[\s\S]*budget\.template\.approve/, 'Registrar must inherit budget approval')
assert.match(migration, /Payment\/Reconciliation Officer[\s\S]*ff4\.reconcile/, 'Payment/Reconciliation Officer must reconcile')
assert.match(migration, /Requisition Officer[\s\S]*supplier\.create/, 'Requisition Officer must create suppliers')
assert.match(migration, /Line Supervisor[\s\S]*supplier\.create/, 'Line Supervisor must create suppliers')

console.log('four-group RBAC source checks passed')
