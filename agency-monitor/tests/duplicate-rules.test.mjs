import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeItem, tokenSimilarity, rankDuplicateCandidates } from '../src/duplicate-rules.mjs'

test('standardizes punctuation, casing and spacing', () => {
  assert.equal(normalizeItem('  HP--LaserJet   Cartridge  '), 'hp laserjet cartridge')
})
test('prefers exact stock codes despite different descriptions', () => {
  const result = rankDuplicateCandidates({code:'C-04',name:'Print cartridge'}, [{code:'c 04',name:'Toner, black'}])
  assert.equal(result[0].score, 1)
})
test('identifies similar wording while ignoring unrelated items', () => {
  const result = rankDuplicateCandidates({name:'A4 copy paper box'}, [{name:'A4 copy paper'}, {name:'Generator engine oil'}])
  assert.equal(result.length, 1)
  assert.ok(result[0].score >= .55)
  assert.equal(tokenSimilarity('A4 copy paper','engine oil'), 0)
})
test('never labels similarity as proven duplicated expenditure', () => {
  assert.equal(rankDuplicateCandidates({name:'A4 paper'}, [{name:'A4 paper'}])[0].reviewRequired, true)
})
