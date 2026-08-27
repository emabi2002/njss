import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('app/dashboard/budget-template/page.tsx', 'utf8')

assert.equal(source.includes('const [divisionSearch, setDivisionSearch]'), false, 'Budget Preparation should not keep a separate division search state')
assert.equal(source.includes('placeholder="Search division"'), false, 'Budget Preparation should not render the redundant Search division input')
assert.equal(source.includes('filteredDivisions'), false, 'Budget Preparation should use authorised divisions directly')
assert.equal(source.includes('<option value="">Select active division from database</option>'), true, 'The real division selector must remain')
assert.equal(source.includes('assignedDivisions.map((division)'), true, 'The division selector must list authorised divisions directly')

console.log('Budget division selector regression checks passed')
