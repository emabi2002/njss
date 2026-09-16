import fs from 'node:fs'
import assert from 'node:assert/strict'

const page = fs.readFileSync('app/dashboard/budget-template/page.tsx', 'utf8')

assert.equal(page.includes('data-testid="division-budget-selector"'), true, 'Annual Budget must expose one clear Division selector')
assert.equal(page.includes('Select Division'), true, 'Division selector must use clear Head Office wording')
assert.equal(page.includes('placeholder="Search division"'), false, 'The superseded duplicate Division search row must be removed')
assert.equal(page.includes('Division / cost centre'), false, 'Annual Budget must not expose legacy cost-centre selection')
assert.equal(page.includes('filteredSections'), true, 'Section rows must resolve from the selected Division')

console.log('Simplified Budget Division selector regression checks passed')
