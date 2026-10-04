import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const source = fs.readFileSync('lib/supabase.ts', 'utf8')
const start = source.indexOf('export function readServerServiceRoleKey(')
assert.ok(start >= 0, 'Server credential lookup must handle the verified legacy deployment variable')
const body = source.slice(start, source.indexOf('\nexport function createServerSupabaseClient', start))
const compiled = ts.transpileModule(body.replace('export function', 'function'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function resolve(env, browser = false) {
  return vm.runInNewContext(`${compiled}; readServerServiceRoleKey()`, { process: { env }, ...(browser ? { window: {} } : {}) })
}
assert.equal(resolve({ SUPABASE_SERVICE_ROLE_KEY: ' canonical ', SUPBASE_SERVICE_ROLE_KEY: 'legacy' }), 'canonical')
assert.equal(resolve({ SUPBASE_SERVICE_ROLE_KEY: ' legacy ' }), 'legacy')
assert.equal(resolve({ SUPABASE_SERVICE_ROLE_KEY: ' ', SUPBASE_SERVICE_ROLE_KEY: ' legacy ' }), 'legacy')
assert.throws(() => resolve({}), /SUPABASE_SERVICE_ROLE_KEY/)
assert.throws(() => resolve({ SUPABASE_SERVICE_ROLE_KEY: 'server-only' }, true), /server/)
const config = fs.readFileSync('next.config.ts', 'utf8')
const js = ts.transpileModule(config, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const context = { exports: {}, process: { env: { COMMIT_REF: 'verified-git-sha', NEXT_PUBLIC_COMMIT_SHA: 'stale-value', SUPBASE_SERVICE_ROLE_KEY: 'server-only' } }, Date }
vm.runInNewContext(js, context)
assert.equal(context.exports.default.env.NEXT_PUBLIC_COMMIT_SHA, 'verified-git-sha')
assert.deepEqual(Object.keys(context.exports.default.env).sort(), ['NEXT_PUBLIC_BUILD_TIME', 'NEXT_PUBLIC_COMMIT_SHA'])
assert.equal(JSON.stringify(context.exports.default.env).includes('server-only'), false)
console.log('Server credential precedence/browser denial and public build metadata checks passed')
