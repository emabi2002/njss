import { ROUTE_PERMISSIONS } from './config'

const LANDING_ROUTES = [
  '/dashboard',
  '/dashboard/tasks',
  '/dashboard/ff3',
  '/dashboard/ff4',
  '/dashboard/budget-template',
  '/dashboard/budget',
  '/dashboard/commitments',
  '/dashboard/reports/management',
  '/dashboard/suppliers',
  '/dashboard/users',
  '/dashboard/master',
  '/dashboard/admin/operations',
  '/dashboard/audit-log',
  '/dashboard/settings',
  '/dashboard/reports/ai',
]

/** Select an existing authorized workspace without widening the user's access. */
export function getDashboardLandingPath(permissions: readonly string[]) {
  return LANDING_ROUTES.find((pathname) => {
    const required = ROUTE_PERMISSIONS.find((route) => route.pattern.test(pathname))?.permissions
    return !!required?.length && (permissions.includes('all') || required.some((permission) => permissions.includes(permission)))
  }) || '/dashboard/no-access'
}
