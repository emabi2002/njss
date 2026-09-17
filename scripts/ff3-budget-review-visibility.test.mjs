import assert from 'node:assert/strict'
import fs from 'node:fs'

const path = 'app/dashboard/ff3/[ff3_number]/layout.tsx'
assert.ok(fs.existsSync(path), 'FF3 review budget-control layout must exist')
const source = fs.readFileSync(path, 'utf8')

for (const needle of [
  'Workflow:',
  'Budget:',
  'Current Approved',
  'Available',
  'This FF3 Request',
  'Shortfall',
  'INSUFFICIENT BUDGET – COMMITMENT BLOCKED',
  'Registrar-approved reallocation',
  'POSTING_MAPPING_REQUIRED',
  'NO_ACTIVE_BUDGET',
]) {
  assert.ok(source.includes(needle), `FF3 review layout must show ${needle}`)
}

console.log('FF3 review budget visibility contract: ok')
