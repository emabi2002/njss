import assert from 'node:assert/strict'
const { visibleDashboardNavigation } = await import('../lib/rbac/dashboard-navigation.ts')
const menus = [
  { code: 'budget.control', sort_order: 30 },
  { code: 'budget.adjustments', parent_code: 'budget.control', sort_order: 22 },
  { code: 'finance.ff3.new', parent_code: 'finance.ff3', sort_order: 51 },
  { code: 'systems_administration.info', sort_order: 50 },
]
assert.deepEqual(visibleDashboardNavigation(menus, new Set(['systems_administration.info'])).map(x => x.code), ['budget.adjustments', 'budget.control'])
assert.equal(visibleDashboardNavigation(menus.filter(x => x.code !== 'budget.adjustments'), new Set()).some(x => x.code === 'budget.adjustments'), false, 'Navigation must not invent a menu the server did not authorize')
console.log('Budget Adjustments navigation runtime checks passed')
