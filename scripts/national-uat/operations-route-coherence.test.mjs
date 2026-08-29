import fs from 'node:fs'
import assert from 'node:assert/strict'

const configPath = 'lib/rbac/config.ts'
const operationsPagePath = 'app/dashboard/admin/operations/page.tsx'

for (const path of [configPath, operationsPagePath]) {
  assert.ok(fs.existsSync(path), `operations authorization source missing: ${path}`)
}

const config = fs.readFileSync(configPath, 'utf8')
const operationsPage = fs.readFileSync(operationsPagePath, 'utf8')

// Transaction Monitor is intentionally exposed by the live menu to audit.view users,
// so its direct route must carry that same permission before the broader operations rule.
const transactionRule = config.match(/\{\s*pattern:\s*\/\^\\\/dashboard\\\/admin\\\/operations\\\/transactions\$\/[^}]*permissions:\s*\[([^\]]+)\]/)
assert.ok(transactionRule, 'route map must define an explicit Transaction Monitor rule')
assert.match(transactionRule[1], /'audit\.view'/, 'Transaction Monitor route must accept audit.view')

const broadRule = config.match(/\{\s*pattern:\s*\/\^\\\/dashboard\\\/admin\\\/operations\(\$\|\\\/\)\/[^}]*permissions:\s*\[([^\]]+)\]/)
assert.ok(broadRule, 'route map must retain a broader System Operations rule')
assert.doesNotMatch(broadRule[1], /'dashboard\.view'/, 'ordinary dashboard.view must not grant System Operations access')
assert.match(broadRule[1], /'operations\.view'/, 'System Operations must accept operations.view')
assert.match(broadRule[1], /'operations\.manage'/, 'System Operations must accept operations.manage')
assert.match(broadRule[1], /'settings\.manage'/, 'System Operations must accept settings.manage')

// Page-level authorization must mirror the route distinction as defense in depth.
assert.match(operationsPage, /usePathname/, 'operations page must know which operations section is being rendered')
assert.match(operationsPage, /pathname\.endsWith\(["']\/transactions["']\)/, 'operations page must identify Transaction Monitor')
assert.match(operationsPage, /audit\.view/, 'Transaction Monitor page gate must accept audit.view')
assert.doesNotMatch(
  operationsPage,
  /PagePermissionGate\s+any=\{\[\s*["']dashboard\.view["']/,
  'operations page must not use dashboard.view as a blanket authorization',
)

console.log('operations menu/route authorization coherence checks passed')
