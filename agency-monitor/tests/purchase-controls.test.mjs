import test from 'node:test'
import assert from 'node:assert/strict'
import {validateLinkedPurchase,validateGoodsReceipt,mayVerifyEvidence} from '../src/purchase-controls.mjs'
test('prevents multiple purchases exceeding approval',()=>{
  assert.equal(validateLinkedPurchase({approvedQuantity:10,orderedQuantity:8,requestedQuantity:3}).allowed,false)
  assert.equal(validateLinkedPurchase({approvedQuantity:10,orderedQuantity:8,requestedQuantity:2}).allowed,true)
})
test('rejects invalid purchasing quantities',()=>{
  assert.equal(validateLinkedPurchase({approvedQuantity:10,orderedQuantity:0,requestedQuantity:-1}).allowed,false)
  assert.throws(()=>validateLinkedPurchase({approvedQuantity:10,orderedQuantity:0,requestedQuantity:NaN}),/numeric/)
})
test('prevents over-receipt but allows partial deliveries',()=>{
  assert.equal(validateGoodsReceipt({orderedQuantity:12,receivedSoFar:8,newReceipt:4}),true)
  assert.equal(validateGoodsReceipt({orderedQuantity:12,receivedSoFar:8,newReceipt:5}),false)
})
test('requires a second officer to verify evidence',()=>{
  assert.equal(mayVerifyEvidence({verifierId:'a',recorderId:'a',status:'REPORTED',reason:'verified items'}),false)
  assert.equal(mayVerifyEvidence({verifierId:'b',recorderId:'a',status:'REPORTED',reason:'verified items'}),true)
  assert.equal(mayVerifyEvidence({verifierId:'b',recorderId:'a',status:'VERIFIED',reason:'verified items'}),false)
})
