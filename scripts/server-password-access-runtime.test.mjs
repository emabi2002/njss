import assert from 'node:assert/strict'
import { hasServerPermission, hasAnyServerPermission } from '../lib/rbac/server.ts'
const context = { userId: 'test', email: 'test@example.com', name: 'Test', roles: [], roleNames: [], scopes: [], permissions: ['all'] }
for (const state of [undefined, null, true]) {
 assert.equal(hasServerPermission({ ...context, mustChangePassword: state }, 'ff3.approve'), false, 'Incomplete password setup must not authorize a server operation')
 assert.equal(hasAnyServerPermission({ ...context, mustChangePassword: state }, ['ff3.approve']), false)
}
assert.equal(hasServerPermission({ ...context, mustChangePassword: false }, 'ff3.approve'), true)
assert.equal(hasAnyServerPermission({ ...context, mustChangePassword: false }, ['ff3.approve']), true)
assert.equal(hasAnyServerPermission(null, ['ff3.approve']), false)
console.log('First-login server permission runtime checks passed')
