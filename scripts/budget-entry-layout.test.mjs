import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('app/dashboard/budget-template/page.tsx', 'utf8')

assert.equal(source.includes('data-testid="budget-entry-setup"'), true, 'Budget setup controls must be presented in a dedicated full-width top workspace')
assert.equal(source.includes('data-testid="budget-submission-selector"'), true, 'Existing budget sheets must be selectable from the horizontal top workspace')
assert.equal(source.includes('data-testid="budget-sheet-workspace"'), true, 'Budget spreadsheet must have a dedicated full-width workspace')
assert.equal(source.includes('xl:grid-cols-[360px_1fr]'), false, 'Budget preparation must not reserve a fixed 360px left sidebar beside the spreadsheet')
assert.equal(source.includes('Budget cycle'), true, 'Top budget setup must retain the Budget cycle control')
assert.equal(source.includes('Division / cost centre'), true, 'Top budget setup must retain Division / cost centre')
assert.equal(source.includes('Budget ceiling'), true, 'Top budget setup must retain Budget ceiling')
assert.equal(source.includes('Submission reference'), true, 'Top budget setup must retain Submission reference')
assert.equal(source.includes('Create Draft'), true, 'Top budget setup must retain Create Draft')
assert.equal(source.includes('Existing budget sheet'), true, 'Top workspace must expose a compact existing budget sheet selector')
assert.match(source, /data-testid="budget-sheet-workspace"[^>]*className="[^"]*w-full/, 'Spreadsheet workspace must explicitly use the full available width')
assert.equal(source.includes('min-h-[calc(100vh-360px)]'), true, 'Budget spreadsheet viewport must reserve substantial vertical working space')
assert.equal(source.includes('overflow-x-auto'), true, 'Wide budget columns must remain horizontally scrollable')

console.log('Budget entry full-width layout regression checks passed')
