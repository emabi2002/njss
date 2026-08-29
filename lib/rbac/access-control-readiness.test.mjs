import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const authContext = readFileSync(new URL('../../contexts/AuthContext.tsx', import.meta.url), 'utf8')
const usersPage = readFileSync(new URL('../../app/dashboard/users/page.tsx', import.meta.url), 'utf8')

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
  usersPage,
  /const \{[^}]*accessReady[^}]*\} = useAuth\(\)/s,
  'Access Control must consume the RBAC readiness signal.',
)

const readinessIndex = usersPage.indexOf('if (!accessReady')
const denialIndex = usersPage.indexOf('if (!canAny(')
assert.ok(readinessIndex >= 0, 'Access Control must render a loading state while RBAC access is unresolved.')
assert.ok(denialIndex >= 0, 'Access Control must retain its permission-denial guard.')
assert.ok(
  readinessIndex < denialIndex,
  'Access Control must wait for RBAC access to resolve before evaluating canAny(), otherwise administrators can be falsely denied.',
)

console.log('Access Control RBAC readiness regression checks passed.')
