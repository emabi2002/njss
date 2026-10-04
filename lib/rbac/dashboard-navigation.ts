import type { RbacMenuItem } from './types'

/** The adjustments workspace has no parent-screen link and needs its own sidebar entry. */
export function visibleDashboardNavigation(menus: RbacMenuItem[], hiddenCodes: ReadonlySet<string>) {
  return menus
    .filter(item => (!item.parent_code || item.code === 'budget.adjustments') && !hiddenCodes.has(item.code))
    .sort((a, b) => a.sort_order - b.sort_order)
}
