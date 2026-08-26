import fs from 'node:fs'
import assert from 'node:assert/strict'

const migrationPath = 'supabase/migrations/050_master_data_cleanup.sql'
const pagePath = 'app/dashboard/master/page.tsx'

assert.ok(fs.existsSync(migrationPath), 'migration 050 must exist')

const migration = fs.readFileSync(migrationPath, 'utf8')
const page = fs.readFileSync(pagePath, 'utf8')

assert.match(migration, /UPDATE\s+cost_centres[\s\S]*is_active\s*=\s*false/i, 'legacy cloned cost centres must be deactivated')
assert.match(migration, /UPDATE\s+expense_code_registry[\s\S]*is_active\s*=\s*false/i, 'incomplete legacy posting codes must be deactivated')
assert.match(migration, /department_id\s+IS\s+NULL/i, 'posting-code cleanup must target incomplete organisational mapping')
assert.match(migration, /cost_centre_id\s+IS\s+NULL/i, 'posting-code cleanup must target incomplete cost-centre mapping')

for (const label of [
  'Organisational Sections',
  'Financial Cost Centres',
  'Expense Categories',
  'Expense / Posting Codes',
  'Activity Templates',
  'Funding Sources',
  'Chart of Accounts',
  'Priority Levels',
]) {
  assert.ok(page.includes(`label: "${label}"`), `missing clear tab label: ${label}`)
}

assert.ok(page.includes('Organisational Section = where the officer belongs'), 'page must explain organisational section')
assert.ok(page.includes('Financial Cost Centre = where expenditure is charged'), 'page must explain cost centre')
assert.ok(page.includes('Chart of Accounts = what type of expenditure it is'), 'page must explain chart of accounts')
assert.ok(page.includes('Expense / Posting Code = the valid combined financial coding'), 'page must explain posting code')

console.log('Master-data cleanup regression checks passed.')
