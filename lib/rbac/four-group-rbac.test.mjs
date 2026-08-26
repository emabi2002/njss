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

const securityPath = new URL('../../supabase/migrations/046_four_group_report_scope_security.sql', import.meta.url)
assert.ok(fs.existsSync(securityPath), 'migration 046 must harden report scoping')
const security = fs.readFileSync(securityPath, 'utf8')
assert.match(security, /s\.scope_type = 'SECTION_WIDE'[\s\S]*p_section_id = v_section_id/, 'database scope helper must enforce SECTION_WIDE')
assert.match(security, /CREATE OR REPLACE VIEW v_report_catalogue[\s\S]*d\.required_permission[\s\S]*fn_current_user_has_permission\(d\.required_permission\)/, 'report catalogue must enforce each report permission')
assert.ok(!/audit_logs_select_authorized[\s\S]{0,900}reports\.view/.test(security), 'generic reports.view must not unlock audit logs')
assert.match(security, /funding_authorities_select_four_group[\s\S]*funding\.view/, 'central funding authorities must require funding permission')
assert.match(security, /funding_receipts_select_four_group[\s\S]*funding\.view/, 'central funding receipts must require funding permission')
assert.match(security, /funding_allocations_select_four_group[\s\S]*fn_current_user_data_scope_allows\(department_id, section_id, created_by/, 'funding allocations must respect organisational scope')
assert.match(security, /Registrar[\s\S]*funding\.view/, 'Registrar must receive organisation-wide funding visibility')

const membershipPath = new URL('../../supabase/migrations/047_four_group_membership_guards.sql', import.meta.url)
assert.ok(fs.existsSync(membershipPath), 'migration 047 must enforce group membership prerequisites')
const membership = fs.readFileSync(membershipPath, 'utf8')
assert.match(membership, /Requisition Officer[\s\S]*Line Supervisor[\s\S]*section_id/, 'section-scoped groups must require section_id')
assert.match(membership, /BEFORE INSERT OR UPDATE ON user_roles/, 'group assignment must be guarded in database')
assert.match(membership, /BEFORE UPDATE OF section_id ON users/, 'section removal must be guarded for section-scoped users')

const groupsPath = new URL('../../lib/rbac/groups.ts', import.meta.url)
assert.ok(fs.existsSync(groupsPath), 'canonical RBAC group helper must exist')
const groups = fs.readFileSync(groupsPath, 'utf8')
for (const role of ['Requisition Officer', 'Line Supervisor', 'Registrar', 'Payment/Reconciliation Officer']) {
  assert.ok(groups.includes(`'${role}'`), `group helper must define ${role}`)
}
assert.match(groups, /isSectionScopedBusinessGroup/, 'group helper must identify section-scoped groups')
assert.match(groups, /isControlledBusinessGroup/, 'group helper must identify controlled groups')

const config = read('lib/rbac/config.ts')
assert.match(config, /ff4\.reconcile/, 'runtime permission catalogue must include ff4.reconcile')

const ff4Route = read('app/api/workflows/ff4/route.ts')
assert.match(ff4Route, /RECONCILE:\s*\['ff4\.reconcile'\]/, 'FF4 reconciliation must require the dedicated reconcile permission')

const usersRoute = read('app/api/admin/users/route.ts')
assert.ok(!usersRoute.includes('five controlled business roles'), 'user API must not retain five-role wording')
assert.match(usersRoute, /isControlledBusinessGroup/, 'user API must restrict assignment to canonical groups')
assert.match(usersRoute, /isSectionScopedBusinessGroup/, 'user API must enforce section-scoped group rules')
assert.match(usersRoute, /must be assigned to a section/, 'section-scoped users must require a section')

console.log('four-group RBAC source checks passed')
