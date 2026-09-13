import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const authContext = readFileSync(new URL('../../contexts/AuthContext.tsx', import.meta.url), 'utf8')
const usersLayoutUrl = new URL('../../app/dashboard/users/layout.tsx', import.meta.url)
const usersLayout = existsSync(usersLayoutUrl) ? readFileSync(usersLayoutUrl, 'utf8') : ''

assert.match(
  authContext,
  /accessReady:\s*boolean/,
  'AuthContext must expose an explicit accessReady signal so permission checks do not run against the temporary empty RBAC state.',
)

assert.match(
  authContext,
  /const \[accessReady, setAccessReady\] = useState\(false\)/,
  'AuthContext must initialize RBAC access as not ready.',
)

assert.match(
  usersLayout,
  /accessReady/,
  'The Access Control route segment must consume the RBAC readiness signal.',
)

assert.match(
  usersLayout,
  /if \(!accessReady\)/,
  'The Access Control route segment must withhold the page while RBAC access is unresolved.',
)

assert.match(
  usersLayout,
  /return <>{children}<\/>/,
  'The Access Control route segment must render its page only after RBAC access is ready.',
)

console.log('Access Control RBAC readiness regression checks passed.')
