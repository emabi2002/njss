import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { NextRequest } from 'next/server'

let signedIn = true
let passwordState = false
let permissions = ['ff3.view', 'workflow.tasks.view']
const query = (data) => new Proxy({}, { get: (_, key) => key === 'then'
  ? (resolve) => Promise.resolve({ data, error: null }).then(resolve)
  : () => query(data) })
mock.module('@supabase/ssr', () => ({ createServerClient: (_url, _key, options) => {
  options.cookies.setAll([{ name: 'refreshed-session', value: 'test', options: { path: '/' } }], {})
  return {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'auth-user', email: 'test@example.com' } : null } }) },
    from: (table) => query(table === 'users' ? {
      id: 'user', auth_user_id: 'auth-user', must_change_password: passwordState,
      user_roles: [{ role: { id: 'role', name: 'Requisition Officer', data_scope_type: 'OWN_RECORDS' } }],
    } : table === 'role_permissions' ? permissions.map((permission) => ({ permission })) : []),
  }
} }))
const { guardDashboardRoute } = await import('../lib/rbac/server.ts')
const request = (path) => new NextRequest(`https://uat.example.com${path}`)
let response = await guardDashboardRoute(request('/dashboard'))
assert.equal(response.status, 307)
assert.equal(response.headers.get('location'), 'https://uat.example.com/dashboard/tasks')
assert.equal(response.cookies.get('refreshed-session')?.value, 'test', 'Landing redirects retain refreshed auth cookies')
response = await guardDashboardRoute(request('/dashboard/budget'))
assert.equal(response.headers.get('x-middleware-rewrite'), 'https://uat.example.com/dashboard/no-access', 'Forbidden deep links must remain denied')
assert.equal((await guardDashboardRoute(request('/dashboard/tasks'))).headers.get('location'), null)
passwordState = true
assert.equal((await guardDashboardRoute(request('/dashboard'))).headers.get('location'), 'https://uat.example.com/set-password')
passwordState = null
assert.equal((await guardDashboardRoute(request('/dashboard'))).status, 503)
passwordState = false
permissions = []
assert.equal((await guardDashboardRoute(request('/dashboard'))).headers.get('location'), 'https://uat.example.com/dashboard/no-access')
permissions = ['dashboard.view']
assert.equal((await guardDashboardRoute(request('/dashboard'))).headers.get('location'), null)
signedIn = false
assert.equal((await guardDashboardRoute(request('/dashboard'))).headers.get('location'), 'https://uat.example.com/login?redirect=%2Fdashboard')
console.log('Login landing, password gate, deep-link denial and auth-cookie runtime checks passed')
