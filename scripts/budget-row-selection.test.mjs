import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('app/dashboard/budget-template/page.tsx', 'utf8')

assert.equal(source.includes('const [selectedRows, setSelectedRows]'), true, 'Budget grid must keep a multi-row checkbox selection state')
assert.equal(source.includes('aria-label="Select all budget rows"'), true, 'Line-number header must provide a select-all checkbox')
assert.equal(source.includes('aria-label={`Select budget row ${row.line_number}`}'), true, 'Each budget row must provide its own checkbox')
assert.equal(source.includes('Delete Selected Rows'), true, 'Delete action must clearly target selected rows')
assert.equal(source.includes('selectedRows.length === 0'), true, 'Delete action must be disabled/guarded when no rows are checked')
assert.match(
  source,
  /const rowsToDelete = gridRows\.filter\(\(item\) => selectedRows\.includes\(item\.clientId\)[^\n]*\)/,
  'Delete handler must resolve rows from the checked-row selection state',
)
assert.equal(source.includes('!isProtectedRevisionRow(item)'), true, 'Revision baseline rows must be excluded from checkbox deletion')
assert.equal(source.includes('for (const row of savedRows)'), true, 'Saved checked rows must be deleted individually through the existing database path')
assert.equal(source.includes('setSelectedRows([])'), true, 'Selection must clear after deletion or reload')
assert.equal(source.includes('selectedRows.includes(row.clientId)'), true, 'Row checkbox state must reflect the multi-selection state')

console.log('Budget checkbox multi-row selection regression checks passed')
