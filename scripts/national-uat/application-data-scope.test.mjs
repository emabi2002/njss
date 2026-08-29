import fs from 'node:fs'
import assert from 'node:assert/strict'

const clientPath = 'lib/rbac/client.ts'
const scopePath = 'lib/rbac/scope.ts'
const typesPath = 'lib/rbac/types.ts'

for (const path of [clientPath, scopePath, typesPath]) {
  assert.ok(fs.existsSync(path), `RBAC scope source missing: ${path}`)
}

const client = fs.readFileSync(clientPath, 'utf8')
const scope = fs.readFileSync(scopePath, 'utf8')
const types = fs.readFileSync(typesPath, 'utf8')

// SECTION_WIDE is a first-class data scope and the server/client-facing evaluators
// must agree on its semantics: same section, regardless of who created the record.
assert.match(types, /\|\s*'SECTION_WIDE'/, 'SECTION_WIDE must remain a supported scope type')
assert.match(scope, /case 'SECTION_WIDE':[\s\S]*record\.section_id[\s\S]*context\.sectionId/, 'canonical scope evaluator must support SECTION_WIDE')
assert.match(client, /case 'SECTION_WIDE':/, 'client record evaluator must explicitly support SECTION_WIDE')
assert.match(
  client,
  /case 'SECTION_WIDE':[\s\S]{0,220}record\.section_id\s*===\s*context\.sectionId/,
  'SECTION_WIDE client access must match records by the user section rather than creator identity',
)

// The fallback remains OWN_RECORDS only when no broader configured scope applies.
assert.match(client, /case 'OWN_RECORDS':[\s\S]*record\.created_by\s*===\s*context\.userId/, 'OWN_RECORDS fallback must remain intact')

console.log('application SECTION_WIDE data-scope contract checks passed')
