import assert from 'node:assert/strict'
import { groupLedgers, sumCategoryAmounts } from '../lib/division-budget-ledger-groups.ts'

const ledgers = [
  { id:'a', finance_code:'MASTER-TRAVEL', standard_description:'Travel', is_posting:false, is_active:true, parent_ledger_id:null, sort_order:20 },
  { id:'b', finance_code:'221-01', standard_description:'Airfares', is_posting:true, is_active:true, parent_ledger_id:'a', sort_order:1 },
  { id:'c', finance_code:'221-02', standard_description:'Accommodation', is_posting:true, is_active:true, parent_ledger_id:'a', sort_order:2 },
  { id:'d', finance_code:'M-CONSTRUCTION', standard_description:'Construction', is_posting:false, is_active:true, parent_ledger_id:null, sort_order:30 },
  { id:'e', finance_code:'OLD-01', standard_description:'Legacy posting', is_posting:true, is_active:true, parent_ledger_id:null, sort_order:99 },
]
assert.deepEqual(groupLedgers(ledgers).map(g => [g.category.finance_code, g.children.map(l => l.finance_code)]),
  [['MASTER-TRAVEL',['221-01','221-02']],['M-CONSTRUCTION',[]],['UNMAPPED',['OLD-01']]])
const amounts = { 'section-1:b':'100', 'section-2:b':'200', 'section-2:c':'50' }
assert.equal(sumCategoryAmounts(groupLedgers(ledgers)[0], ['section-1','section-2'], amounts), 350)
assert.equal(sumCategoryAmounts(groupLedgers(ledgers)[0], ['section-1'], amounts), 100)
console.log('Ledger category grouping and multi-section totals passed')
