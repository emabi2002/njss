import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('app/dashboard/budget/funding/page.tsx', 'utf8')
const api = readFileSync('lib/api.ts', 'utf8')

test('Funding Source lookup exposes a governed inline add action', () => {
  assert.match(page, /addTitle="Add funding source"/)
  assert.match(page, /Create Funding Source/)
  assert.match(api, /export async function createFundingSource\(/)
})

test('transaction lookups route users to their upstream creation workflows', () => {
  assert.match(page, /addTitle="Create funding authority"/)
  assert.match(page, /addTitle="Create funding receipt"/)
  assert.match(page, /addTitle="Create approved budget line"/)
  assert.match(page, /router\.push\("\/dashboard\/budget-template"\)/)
})

test('Authority Type stays a controlled fixed list without an add action', () => {
  const marker = 'label="Type"'
  const start = page.indexOf(marker)
  assert.notEqual(start, -1, 'Authority Type select should exist')
  const end = page.indexOf('/>', start)
  const typeSelect = page.slice(start, end + 2)
  assert.doesNotMatch(typeSelect, /addTitle=/)
  assert.doesNotMatch(typeSelect, /onAdd=/)
})
