import assert from 'node:assert/strict'
import { ROUTE_PERMISSIONS } from '../lib/rbac/config.ts'
for (const pathname of ['/dashboard/admin/operations','/dashboard/admin/operations/costs','/dashboard/admin/operations/transactions']) {
 const required = ROUTE_PERMISSIONS.find(row => row.pattern.test(pathname)).permissions
 assert.equal(required.includes('dashboard.view'), false, `${pathname} must not permit ordinary dashboard viewers`)
 assert.equal(required.includes('operations.view'), true)
}
console.log('Operations route permission runtime checks passed')

for (const [pathname, permission] of [
 ['/dashboard/budget-template', 'budget.capture'],
 ['/dashboard/budget-template', 'budget.registrar.approve'],
 ['/dashboard/admin/organisation', 'users.manage'],
 ['/dashboard/notifications', 'dashboard.view'],
 ['/dashboard/reports/ai', 'reports.ai.use'],
]) {
 const required = ROUTE_PERMISSIONS.find(row => row.pattern.test(pathname))?.permissions || []
 assert.equal(required.includes(permission), true, `${pathname} must admit its actual business permission`)
 if (pathname === '/dashboard/reports/ai') assert.equal(required.includes('reports.view'), false)
}
