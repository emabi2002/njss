import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('app/dashboard/budget-template/page.tsx', 'utf8')

assert.equal(source.includes('section-budget-grid'), true, 'Annual Budget must use the Section/Ledger amount grid')
assert.equal(source.includes('selectedRows'), false, 'Legacy checkbox row-selection state must be removed')
assert.equal(source.includes('Select all budget rows'), false, 'Legacy select-all control must be removed')
assert.equal(source.includes('Delete Selected Rows'), false, 'Budget Officer should zero a ledger amount rather than run legacy multi-row deletion')
assert.equal(source.includes('originalAmount'), true, 'Draft persistence must operate on the approved annual amount')
assert.equal(source.includes('dirtyKeys'), true, 'Draft save should persist only edited Section/Ledger cells')

console.log('Simplified Budget grid regression checks passed')
