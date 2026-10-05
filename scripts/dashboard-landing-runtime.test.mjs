import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

assert.ok(existsSync('lib/rbac/dashboard-landing.ts'), 'Login must resolve a workspace the user may open')
const { getDashboardLandingPath } = await import('../lib/rbac/dashboard-landing.ts')
const requisition = ['ff3.view', 'ff3.create', 'workflow.tasks.view', 'reports.view']
assert.equal(getDashboardLandingPath(requisition), '/dashboard/tasks')
assert.equal(getDashboardLandingPath(['ff3.create']), '/dashboard/ff3')
assert.equal(getDashboardLandingPath(['ff4.view']), '/dashboard/ff4')
assert.equal(getDashboardLandingPath(['budget.capture']), '/dashboard/budget-template')
assert.equal(getDashboardLandingPath(['users.manage']), '/dashboard/users')
assert.equal(getDashboardLandingPath(['reports.view']), '/dashboard/reports/management')
assert.equal(getDashboardLandingPath(['dashboard.view', ...requisition]), '/dashboard')
assert.equal(getDashboardLandingPath(['all']), '/dashboard')
assert.equal(getDashboardLandingPath([]), '/dashboard/no-access')
assert.equal(getDashboardLandingPath(['unknown.permission']), '/dashboard/no-access')
assert.equal(requisition.includes('dashboard.view'), false, 'Landing selection must not grant permissions')
console.log('Role-aware dashboard landing runtime checks passed')
