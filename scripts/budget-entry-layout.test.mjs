import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('app/dashboard/budget-template/page.tsx', 'utf8')

assert.equal(source.includes('data-testid="head-office-budget-dashboard"'), true, 'Annual Budget must start with the Head Office year/division dashboard')
assert.equal(source.includes('data-testid="section-budget-grid"'), true, 'Annual Budget must provide a full-width Section/Ledger amount workspace')
assert.equal(source.includes('data-testid="budget-document-panel"'), true, 'Official documentary evidence must be visible in the workspace')
assert.equal(source.includes('xl:grid-cols-[360px_1fr]'), false, 'Annual Budget must not reserve the legacy fixed left sidebar')
assert.equal(source.includes('Financial Year'), true)
assert.equal(source.includes('Division'), true)
assert.equal(source.includes('Approved Amount'), true)
assert.equal(source.includes('Budget ceiling'), false)
assert.equal(source.includes('Submission reference'), false)
assert.equal(source.includes('Create Draft'), false)
assert.equal(source.includes('Existing budget sheet'), false)
assert.equal(source.includes('overflow-x-auto'), true, 'The ledger grid must remain horizontally usable')

console.log('Simplified annual-budget layout regression checks passed')
