import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const sql=readFileSync(new URL('../supabase/migrations/20261023000100_initial_monitoring.sql',import.meta.url),'utf8')
test('isolated agency baseline has no IFMS integration or shared tenant database',()=>{
  assert.match(sql,/create table public\.monitor_agency/)
  assert.doesNotMatch(sql,/create (table|view|function) (?:public\.)?(?:ifms_|integrat(?:ion|e)_)/i)
  assert.doesNotMatch(sql,/tenant_id\s+uuid/i)
})
test('requires RLS for every monitor table with role-scoped staff access',()=>{
  assert.match(sql,/enable row level security/i)
  assert.match(sql,/monitor_private\.current_role\(\) is not null/i)
  assert.match(sql,/actor_id = \(select auth\.uid\(\)\)/)
})
test('database functions enforce maker-checker and linked quantity limits',()=>{
  assert.match(sql,/Requester cannot approve their own requisition/i)
  assert.match(sql,/Recorded-by officer cannot verify own expense evidence/i)
  assert.match(sql,/Total purchase quantity exceeds approved requisition/i)
  assert.match(sql,/Receipt exceeds ordered quantity/i)
})
test('warnings have review outcomes and expense evidence must be verified separately',()=>{
  assert.match(sql,/JUSTIFIED_REPEAT/)
  assert.match(sql,/REVIEWED_REJECTED/)
  assert.match(sql,/monitor_verify_expense_evidence/)
  assert.match(sql,/monitor_private\.same_catalogue_item/)
})
test('evidence bucket is private and does not grant open downloads',()=>{
  assert.match(sql, /'monitor-evidence','monitor-evidence',false/)
  assert.doesNotMatch(sql,/create policy .*storage\.objects.*using\s*\(\s*true\s*\)/i)
})
test('server computes full-history reports for item, section, category and supplier',()=>{
  for (const name of ['item','section','category','supplier']) {
    assert.ok(sql.includes('create view public.monitor_report_spend_by_' + name))
  }
  assert.match(sql,/with \(security_invoker=true\)/i)
})
test('new agency starts without NJSS user, supplier or purchasing records',()=>{
  const seed=readFileSync(new URL('../supabase/seed.sql',import.meta.url),'utf8')
  assert.doesNotMatch(seed,/insert\s+into\s+(?:public\.)?\w+/i)
  assert.match(seed,/Intentionally blank/i)
})
