import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const expectFile = (path) => {
  const url = new URL(`../../${path}`, import.meta.url)
  assert.ok(fs.existsSync(url), `${path} must exist`)
  return fs.readFileSync(url, 'utf8')
}

const types = read('lib/rbac/types.ts')
const scope = read('lib/rbac/scope.ts')
const adminTypes = read('app/dashboard/users/types.ts')
const groups = expectFile('lib/rbac/groups.ts')
const config = read('lib/rbac/config.ts')
const ff4Route = read('app/api/workflows/ff4/route.ts')
const workflowTasks = read('app/api/workflow/tasks/route.ts')
const migration45 = expectFile('supabase/migrations/045_four_group_operational_rbac.sql')
const migration46 = expectFile('supabase/migrations/046_four_group_report_scope_security.sql')
const migration47 = expectFile('supabase/migrations/047_four_group_membership_guards.sql')
const migration48 = expectFile('supabase/migrations/048_four_group_live_drift_and_section_cleanup.sql')
const ff4ApprovalMigration = expectFile('supabase/migrations/20260904010000_ff4_registrar_approval_authority.sql')

assert.match(types, /'SECTION_WIDE'/)
assert.match(scope, /case 'SECTION_WIDE':/)
assert.match(scope, /record\.section_id === context\.sectionId/)

for (const role of ['Requisition Officer', 'Line Supervisor', 'Registrar', 'Payment/Reconciliation Officer']) {
  assert.ok(adminTypes.includes(`"${role}"`), `missing workflow group ${role}`)
  assert.ok(groups.includes(`'${role}'`), `missing canonical group ${role}`)
  assert.ok(migration45.includes(`'${role}'`), `missing migration role ${role}`)
}

for (const legacy of ['FF Requisition Officer', 'Line/Section Supervisor', 'FF4 Officer', 'Accounts Reconciliation Officer']) {
  assert.ok(!adminTypes.includes(`"${legacy}"`), `legacy role remains active in UI ordering: ${legacy}`)
}

assert.match(migration45, /Line Supervisor[\s\S]*budget\.template\.create/)
assert.match(migration45, /Registrar[\s\S]*budget\.template\.approve/)
assert.match(migration45, /Payment\/Reconciliation Officer[\s\S]*ff4\.reconcile/)
assert.match(migration45, /Requisition Officer[\s\S]*supplier\.create/)
assert.match(migration45, /Line Supervisor[\s\S]*supplier\.create/)

assert.match(migration46, /s\.scope_type = 'SECTION_WIDE'[\s\S]*p_section_id = v_section_id/)
assert.match(migration46, /CREATE OR REPLACE VIEW v_report_catalogue[\s\S]*fn_current_user_has_permission\(d\.required_permission\)/)
assert.ok(!/audit_logs_select_authorized[\s\S]{0,900}reports\.view/.test(migration46))
assert.match(migration46, /funding_allocations_select_four_group[\s\S]*fn_current_user_data_scope_allows\(department_id, section_id, created_by/)
assert.match(migration46, /Registrar[\s\S]*funding\.view/)

assert.match(migration47, /Requisition Officer[\s\S]*Line Supervisor[\s\S]*section_id/)
assert.match(migration47, /BEFORE INSERT OR UPDATE ON user_roles/)
assert.match(migration47, /BEFORE UPDATE OF section_id ON users/)

assert.match(migration48, /CREATE OR REPLACE FUNCTION njss_set_role_permissions/)
assert.match(migration48, /HAVING count\(\*\) = 1/)
assert.match(migration48, /USER_ROLE_QUARANTINED/)
assert.match(migration48, /DELETE FROM user_roles/)

assert.match(groups, /isControlledBusinessGroup/)
assert.match(groups, /isSectionScopedBusinessGroup/)
assert.match(config, /ff4\.reconcile/)
assert.match(ff4Route, /RECONCILE:\s*\['ff4\.reconcile'\]/)

// NJSS-HARD-09/24: FF4 approval belongs to the existing Registrar business role.
assert.match(
  workflowTasks,
  /VERIFIED:[\s\S]*requiredPermission:\s*'ff4\.approve'[\s\S]*responsibleRole:\s*'Registrar'/,
  'VERIFIED FF4 tasks must route approval to Registrar',
)
assert.ok(
  !workflowTasks.includes("responsibleRole: 'Authorised Approver'"),
  'undefined Authorised Approver role must not remain in workflow tasks',
)
assert.match(
  ff4ApprovalMigration,
  /Registrar[\s\S]*ff4\.approve/,
  'additive migration must grant ff4.approve to Registrar',
)
assert.match(
  ff4ApprovalMigration,
  /Payment\/Reconciliation Officer[\s\S]*ff4\.approve[\s\S]*(DELETE|is_allowed\s*=\s*false)/i,
  'migration must prevent payment officer from holding FF4 approval authority',
)

console.log('four-group RBAC regression checks passed')
