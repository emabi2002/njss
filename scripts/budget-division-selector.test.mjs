import fs from 'node:fs'
import assert from 'node:assert/strict'

const page = fs.readFileSync('app/dashboard/budget-template/page.tsx', 'utf8')
const css = fs.readFileSync('app/globals.css', 'utf8')

assert.equal(page.includes('placeholder="Search division"'), true, 'The existing division filter is the row being suppressed')
assert.equal(page.includes('<option value="">Select active division from database</option>'), true, 'The real division selector must remain')
assert.equal(css.includes('div:has(> input[placeholder="Search division"])'), true, 'The redundant division search row must be hidden')
assert.equal(css.includes('display: none !important'), true, 'The redundant division search row must not be visible')

console.log('Budget division selector regression checks passed')
