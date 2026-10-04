import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
assert.ok(existsSync('lib/rbac/dashboard-access.ts'), 'Dashboard must have a fail-closed access gate')
const { dashboardAccessState, readPasswordState } = await import('../lib/rbac/dashboard-access.ts')
const base = { loading: false, signedIn: true, accessReady: true, mustChangePassword: false, authorized: true, pathname: '/dashboard' }
for (const [change, expected] of [
  [{}, 'allowed'], [{ loading: true }, 'loading'], [{ signedIn: false }, 'login'],
  [{ accessReady: false }, 'loading'], [{ mustChangePassword: null }, 'loading'],
  [{ mustChangePassword: true }, 'password'], [{ authorized: false }, 'denied'],
  [{ authorized: false, pathname: '/dashboard/no-access' }, 'allowed'],
]) assert.equal(dashboardAccessState({ ...base, ...change }), expected)
assert.equal(await readPasswordState(async () => new Response(JSON.stringify({ mustChangePassword: false }))), false)
assert.equal(await readPasswordState(async () => new Response(JSON.stringify({ mustChangePassword: true }))), true)
assert.equal(await readPasswordState(async () => new Response('{}')), null)
assert.equal(await readPasswordState(async () => new Response('oops')), null)
assert.equal(await readPasswordState(async () => new Response('{}', { status: 500 })), null)
assert.equal(await readPasswordState(async () => { throw new Error('offline') }), null)
console.log('Dashboard access and password fail-closed runtime checks passed')
