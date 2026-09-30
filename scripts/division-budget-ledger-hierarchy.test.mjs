import fs from 'node:fs'
import assert from 'node:assert/strict'

const sql = fs.readFileSync('supabase/migrations/20260930150000_division_budget_ledger_hierarchy.sql', 'utf8')
assert.match(sql, /ADD COLUMN IF NOT EXISTS sort_order integer/i)
assert.match(sql, /M-TRAVEL-DOM/)
for (const heading of ['M-FURNITURE','M-PLANT','M-CONSTRUCTION','M-SUBSTANTIAL','M-MOTOR-VEHICLE','M-ICT-PROJECT']) {
  assert.ok(sql.includes(heading), `${heading} from the submitted divisional example must be represented`)
}
assert.match(sql, /parent_ledger_id\s*=\s*p\.id/i)
assert.match(sql, /is_posting\s*=\s*false/i)
assert.match(sql, /DIVISION_WIDE/i)
assert.match(sql, /exactly one Division-wide section/i)
assert.match(sql, /SELECT d\.id, d\.code \|\| '-DIV'/i)
assert.match(sql, /CHECK\s*\(NOT\s*\(is_posting\s*=\s*false\s+AND\s+parent_ledger_id\s+IS\s+NOT\s+NULL\)\)/i)
console.log('Division ledger hierarchy contract passed')
