import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')
const config = read('lib/rbac/config.ts')

for (const permission of [
  'budget.revision.view',
  'budget.revision.create',
  'budget.revision.edit',
  'budget.revision.submit',
  'budget.revision.review',
  'budget.revision.approve',
  'budget.revision.reject',
  'budget.revision.return',
  'budget.revision.report',
]) {
  assert.ok(config.includes(permission), `missing ${permission}`)
}

assert.ok(
  fs.existsSync('supabase/migrations/051_budget_revision_reforecast_schema.sql'),
  'migration 051 must exist',
)

console.log('budget revision and reforecast regression checks passed')
