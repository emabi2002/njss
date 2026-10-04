type DashboardAccessInput = {
  loading: boolean
  signedIn: boolean
  accessReady: boolean
  mustChangePassword: boolean | null
  authorized: boolean
  pathname: string
}

export function dashboardAccessState(input: DashboardAccessInput) {
  if (input.loading) return 'loading'
  if (!input.signedIn) return 'login'
  if (input.mustChangePassword === true) return 'password'
  if (!input.accessReady || input.mustChangePassword === null) return 'loading'
  if (input.pathname === '/dashboard/no-access') return 'allowed'
  return input.authorized ? 'allowed' : 'denied'
}

export async function readPasswordState(fetchState: () => Promise<Response>): Promise<boolean | null> {
  try {
    const response = await fetchState()
    if (!response.ok) return null
    const body = await response.json()
    return typeof body.mustChangePassword === 'boolean' ? body.mustChangePassword : null
  } catch {
    return null
  }
}

/** Routine events for an established identity must not remount unsaved forms. */
export function shouldReloadAuthSession(previousId: string | null, nextId: string | null, event: string) {
  if (nextId === null || previousId !== nextId) return true
  return !['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)
}
