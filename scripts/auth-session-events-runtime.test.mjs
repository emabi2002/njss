import assert from 'node:assert/strict'
const { shouldReloadAuthSession } = await import('../lib/rbac/dashboard-access.ts')
let identity = null
let resets = 0
function receive(event, nextIdentity) {
  if (shouldReloadAuthSession(identity, nextIdentity, event)) {
    resets++
    identity = nextIdentity
  }
}
receive('INITIAL_SESSION', 'user-a')
assert.equal(resets, 1)
for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION']) receive(event, 'user-a')
assert.equal(resets, 1, 'Routine same-user events must preserve established access and mounted forms')
receive('SIGNED_IN', 'user-b')
assert.equal(resets, 2, 'Identity changes must restart authorization')
receive('USER_UPDATED', 'user-b')
assert.equal(resets, 3, 'Account updates must recheck password/access state')
receive('SIGNED_OUT', null)
assert.equal(resets, 4, 'Sign-out must clear established access')
console.log('Auth session event transition checks passed')
