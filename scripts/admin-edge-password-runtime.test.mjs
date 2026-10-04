import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'

for (const [slug, name, end] of [
  ['njss-admin-users', 'authorize', 'async function audit('],
  ['njss-admin-access', 'resolveActor', 'function can('],
  ['njss-database-backup', 'authorize', 'async function audit('],
]) {
  const path = `supabase/functions/${slug}/index.ts`
  const source = process.env.TEST_BASELINE === 'true' ? execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' }) : readFileSync(path, 'utf8')
  const start = source.indexOf(`async function ${name}(`)
  assert.ok(start >= 0)
  const body = source.slice(start, source.indexOf(end, start))
  const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const fn = vm.runInNewContext(`${compiled}; ${name}`, {
    Response, Set,
    ALLOWED_PERMISSIONS: new Set(['operations.manage', 'settings.manage', 'all']),
    json: (body, status) => new Response(JSON.stringify(body), { status }),
    fail: (error, status) => new Response(JSON.stringify({ error }), { status }),
  })
  for (const passwordState of [true, null, undefined, false]) {
    const queried = []
    const selected = []
    const profile = { id: 'app-user', email: 'test@example.org', full_name: 'Test', is_active: true, must_change_password: passwordState }
    const admin = {
      auth: { getUser: async () => ({ data: { user: { id: 'auth-user', email: profile.email } }, error: null }) },
      from(table) {
        queried.push(table)
        const result = { data: table === 'users' ? profile : table === 'user_roles' ? [{ role_id: 'role' }] : [{ permission: 'all' }], error: null }
        const chain = {
          select(columns) { selected.push(columns); return chain },
          or() { return chain }, eq() { return chain }, in() { return chain }, limit() { return chain },
          maybeSingle: async () => result,
          then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) },
        }
        return chain
      },
    }
    const result = name === 'authorize'
      ? await fn(new Request('https://example.org', { headers: { authorization: 'Bearer test' } }), admin)
      : await fn(admin, 'test')
    assert.ok(selected[0].includes('must_change_password'), `${slug} must load the authoritative flag`)
    if (passwordState === false) {
      assert.equal(result.userId, 'app-user', `${slug} should allow a completed-password administrator`)
    } else {
      assert.equal(name === 'authorize' ? result.status : result, name === 'authorize' ? 403 : null, `${slug} must deny ${passwordState}`)
      assert.deepEqual(queried, ['users'], 'Denied actors must stop before resolving privileged roles/actions')
    }
  }
}
console.log('Privileged Edge authorizers deny first-login/unknown password state')
