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
console.log('four-group RBAC source checks passed')
