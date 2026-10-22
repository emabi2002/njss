import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeItem,tokenSimilarity,rankDuplicateCandidates} from '../src/duplicate-rules.mjs'
test('normalizes punctuation and case',()=>{
 assert.equal(normalizeItem(' HP--LaserJet  Cartridge '),'hp laserjet cartridge')
})
test('matches stock codes',()=>{
 const r=rankDuplicateCandidates({code:'C-04',name:'Print cartridge'},[{code:'c 04',name:'Toner black'}])
 assert.equal(r[0].score,1)
})
test('matches similar descriptions without unrelated goods',()=>{
 const r=rankDuplicateCandidates({name:'A4 copy paper box'},[{name:'A4 copy paper'},{name:'Engine oil'}])
 assert.equal(r.length,1)
 assert.ok(r[0].score>=.55)
 assert.equal(tokenSimilarity('A4 paper','engine oil'),0)
})
test('similarity is a warning, not evidence of waste',()=>{
 assert.equal(rankDuplicateCandidates({name:'Paper' },[{name:'Paper'}])[0].reviewRequired,true)
})
