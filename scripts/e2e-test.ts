/**
 * CRMS end-to-end workflow test (uses the anon key, exactly like the app in testing mode).
 * Mirrors the operations performed by lib/api.ts + the FF3/FF4 forms.
 * Run with: bun scripts/e2e-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

function loadEnv() {
  const p = path.join(process.cwd(), '.env.local')
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/\\\$/g, '$')
  }
}
loadEnv()

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
const FY = 2025
let pass = 0, fail = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) { console.log(`   ✅ ${label}${detail ? ' — ' + detail : ''}`); pass++ }
  else { console.log(`   ❌ ${label}${detail ? ' — ' + detail : ''}`); fail++ }
}
const must = <T,>(r: { data: T; error: any }, ctx: string): T => {
  if (r.error) throw new Error(`${ctx}: ${r.error.message}`)
  return r.data
}

async function budgetSummary() {
  // Mirror the dashboard: count ALL commitments; exclude only CANCELLED from "committed".
  const { data: releases } = await supabase.from('quarterly_releases').select('released_amount').eq('financial_year', FY)
  const { data: commitments } = await supabase.from('ff3_commitments').select('committed_amount, paid_amount, status').eq('financial_year', FY)
  const released = releases?.reduce((s, r) => s + (r.released_amount || 0), 0) || 0
  const committed = commitments?.reduce((s, c) => s + (c.status === 'CANCELLED' ? 0 : (c.committed_amount || 0) - (c.paid_amount || 0)), 0) || 0
  const spent = commitments?.reduce((s, c) => s + (c.paid_amount || 0), 0) || 0
  return { released, committed, spent, available: released - committed - spent }
}

async function cleanupPrior() {
  const old = (await supabase.from('ff3_headers').select('id, ff3_number').like('purpose', 'E2E TEST%')).data || []
  for (const h of old) {
    const ff4s = (await supabase.from('ff4_headers').select('id, ff4_number').eq('ff3_header_id', h.id)).data || []
    for (const f of ff4s) {
      await supabase.from('payment_transactions').delete().eq('ff4_header_id', f.id)
      await supabase.from('audit_logs').delete().eq('entity_type', 'FF4').eq('entity_reference', f.ff4_number)
      await supabase.from('ff4_headers').delete().eq('id', f.id)
    }
    const coms = (await supabase.from('ff3_commitments').select('id, commitment_number').eq('ff3_header_id', h.id)).data || []
    for (const c of coms) {
      await supabase.from('payment_transactions').delete().eq('commitment_id', c.id)
      await supabase.from('audit_logs').delete().eq('entity_type', 'COMMITMENT').eq('entity_reference', c.commitment_number)
      await supabase.from('ff3_commitments').delete().eq('id', c.id)
    }
    await supabase.from('audit_logs').delete().eq('entity_type', 'FF3').eq('entity_reference', h.ff3_number)
    await supabase.from('ff3_headers').delete().eq('id', h.id) // cascades items/quotations/approvals
  }
  if (old.length) console.log(`   (cleaned ${old.length} prior E2E cycle(s))`)
}

async function main() {
  console.log('\n🧪 CRMS END-TO-END WORKFLOW TEST\n' + '='.repeat(60))

  // Resolve master data
  const dept = must(await supabase.from('departments').select('id').eq('code', 'FIN').single(), 'dept')
  const sec = must(await supabase.from('sections').select('id').eq('code', 'ACC').single(), 'section')
  await cleanupPrior()
  const before = await budgetSummary()
  console.log(`\n💰 Budget BEFORE: released=K${before.released} committed=K${before.committed} spent=K${before.spent} available=K${before.available}`)

  // ---------- 1. CREATE FF3 (DRAFT -> SUBMIT) ----------
  console.log('\n1) Create FF3 (draft) with items + 3 quotations, then submit')
  const total = 5000
  const header = must(await supabase.from('ff3_headers').insert({
    financial_year: FY, department_id: dept.id, section_id: sec.id,
    purpose: 'E2E TEST — office supplies', justification: 'Automated workflow test',
    urgency_level: 'MEDIUM', procurement_method: 'QUOTATION', status: 'DRAFT',
    total_estimated_amount: total, is_within_budget: true,
  }).select().single(), 'create ff3')
  check('FF3 number auto-generated', /^FF3-2025-\d{5}$/.test(header.ff3_number), header.ff3_number)

  must(await supabase.from('ff3_items').insert([
    { ff3_header_id: header.id, line_number: 1, item_description: 'A4 Paper', quantity: 5, estimated_unit_price: 1000, unit_of_measure: 'Box' },
  ]).select(), 'items')
  const items = must(await supabase.from('ff3_items').select('total_amount').eq('ff3_header_id', header.id), 'read items')
  check('Item total_amount generated (5 x 1000)', items[0].total_amount == 5000, `K${items[0].total_amount}`)

  must(await supabase.from('ff3_quotations').insert([
    { ff3_header_id: header.id, supplier_name: 'Supplier A', quotation_amount: 5200, is_selected: false },
    { ff3_header_id: header.id, supplier_name: 'Supplier B', quotation_amount: 5000, is_selected: true },
    { ff3_header_id: header.id, supplier_name: 'Supplier C', quotation_amount: 5400, is_selected: false },
  ]).select(), 'quotations')
  const quots = must(await supabase.from('ff3_quotations').select('id').eq('ff3_header_id', header.id), 'read quots')
  check('3 quotations attached', quots.length === 3, `${quots.length} quotes`)

  // Submit the draft (DRAFT -> SUBMITTED) — exercises the SUBMIT audit
  must(await supabase.from('ff3_headers').update({ status: 'SUBMITTED', submitted_date: new Date().toISOString() }).eq('id', header.id).select().single(), 'submit ff3')

  // ---------- 2. APPROVAL WORKFLOW ----------
  console.log('\n2) FF3 approval chain: supervisor -> section head -> approve')
  const endorse = async (action: string, status: string, dateField: string) => {
    must(await supabase.from('ff3_headers').update({ status, [dateField]: new Date().toISOString() }).eq('id', header.id).select().single(), action)
    must(await supabase.from('ff3_approvals').insert({ ff3_header_id: header.id, approval_level: action, action_taken: 'ENDORSED', comments: `${action} (e2e)` }).select(), action + ' record')
  }
  await endorse('ENDORSE_SUPERVISOR', 'ENDORSED_SUPERVISOR', 'supervisor_endorsed_date')
  await endorse('ENDORSE_SECTION_HEAD', 'ENDORSED_SECTION_HEAD', 'section_head_endorsed_date')

  // Approve + create commitment (mirrors approveFF3)
  must(await supabase.from('ff3_headers').update({ status: 'APPROVED', approved_date: new Date().toISOString() }).eq('id', header.id).select().single(), 'approve')
  must(await supabase.from('ff3_approvals').insert({ ff3_header_id: header.id, approval_level: 'APPROVE', action_taken: 'APPROVED' }).select(), 'approve record')
  const alloc = (await supabase.from('budget_allocations').select('id').eq('financial_year', FY).eq('department_id', dept.id).eq('section_id', sec.id).limit(1).maybeSingle()).data
  const commitment = must(await supabase.from('ff3_commitments').insert({
    ff3_header_id: header.id, budget_allocation_id: alloc?.id || null, financial_year: FY,
    commitment_date: new Date().toISOString().split('T')[0], committed_amount: total, paid_amount: 0, status: 'ACTIVE',
  }).select().single(), 'commitment')
  check('Commitment created on approval', !!commitment.commitment_number, commitment.commitment_number)
  check('Commitment linked to budget allocation', !!commitment.budget_allocation_id)
  check('Commitment remaining_balance = committed', commitment.remaining_balance == total, `K${commitment.remaining_balance}`)

  // ---------- 3. CREATE FF4 ----------
  console.log('\n3) Create FF4 from approved FF3, submit')
  const ff4 = must(await supabase.from('ff4_headers').insert({
    financial_year: FY, ff3_header_id: header.id, commitment_id: commitment.id,
    payee_type: 'SUPPLIER', payee_name: 'Supplier B', payment_description: 'E2E payment',
    gross_amount: 5000, tax_amount: 0, deductions: 0, payment_method: 'EFT',
    status: 'SUBMITTED', submitted_date: new Date().toISOString(),
  }).select().single(), 'create ff4')
  check('FF4 number auto-generated', /^FF4-2025-\d{5}$/.test(ff4.ff4_number), ff4.ff4_number)
  check('FF4 net_amount generated (gross - tax - ded)', ff4.net_amount == 5000, `K${ff4.net_amount}`)

  // ---------- 4. FF4 WORKFLOW ----------
  console.log('\n4) FF4 workflow: verify -> approve -> process -> pay -> reconcile')
  must(await supabase.from('ff4_headers').update({ status: 'VERIFIED', verified_date: new Date().toISOString() }).eq('id', ff4.id).select().single(), 'verify')
  must(await supabase.from('ff4_headers').update({ status: 'APPROVED', approved_date: new Date().toISOString() }).eq('id', ff4.id).select().single(), 'approve ff4')
  must(await supabase.from('ff4_headers').update({ status: 'PROCESSED' }).eq('id', ff4.id).select().single(), 'process')

  // mark paid (with balance guard) — mirrors approveFF4
  const remaining = (commitment.committed_amount || 0) - (commitment.paid_amount || 0)
  check('Payment within commitment balance (guard)', (ff4.net_amount || 0) <= remaining + 0.001, `net K${ff4.net_amount} <= rem K${remaining}`)
  const paidHeader = must(await supabase.from('ff4_headers').update({ status: 'PAID', payment_date: new Date().toISOString().split('T')[0], paid_date: new Date().toISOString(), external_payment_reference: 'EFT-E2E-0001' }).eq('id', ff4.id).select().single(), 'pay')
  const newPaid = (commitment.paid_amount || 0) + (paidHeader.net_amount || 0)
  const comStatus = newPaid >= (commitment.committed_amount || 0) ? 'FULLY_PAID' : 'PARTIALLY_PAID'
  must(await supabase.from('ff3_commitments').update({ paid_amount: newPaid, status: comStatus }).eq('id', commitment.id).select().single(), 'update commitment')
  must(await supabase.from('payment_transactions').insert({ ff4_header_id: ff4.id, commitment_id: commitment.id, transaction_date: new Date().toISOString().split('T')[0], transaction_type: 'PAYMENT', amount: paidHeader.net_amount, payment_reference: 'EFT-E2E-0001', reconciled: false }).select(), 'payment txn')

  const updatedCom = must(await supabase.from('ff3_commitments').select('*').eq('id', commitment.id).single(), 'read commitment')
  check('Commitment marked FULLY_PAID', updatedCom.status === 'FULLY_PAID', updatedCom.status)
  check('Commitment remaining_balance = 0', updatedCom.remaining_balance == 0, `K${updatedCom.remaining_balance}`)

  must(await supabase.from('ff4_headers').update({ status: 'RECONCILED', reconciled_date: new Date().toISOString() }).eq('id', ff4.id).select().single(), 'reconcile')
  must(await supabase.from('payment_transactions').update({ reconciled: true }).eq('ff4_header_id', ff4.id).select(), 'reconcile txn')
  const finalFF4 = must(await supabase.from('ff4_headers').select('status').eq('id', ff4.id).single(), 'read ff4')
  check('FF4 reconciled', finalFF4.status === 'RECONCILED', finalFF4.status)

  // ---------- 5. AUDIT LOG ----------
  console.log('\n5) Audit log verification (DB triggers)')
  const ff3Audit = must(await supabase.from('audit_logs').select('action').eq('entity_type', 'FF3').eq('entity_reference', header.ff3_number), 'ff3 audit')
  const ff4Audit = must(await supabase.from('audit_logs').select('action').eq('entity_type', 'FF4').eq('entity_reference', ff4.ff4_number), 'ff4 audit')
  const comAudit = must(await supabase.from('audit_logs').select('action').eq('entity_type', 'COMMITMENT').eq('entity_reference', commitment.commitment_number), 'com audit')
  const ff3Actions = ff3Audit.map((a: any) => a.action)
  const ff4Actions = ff4Audit.map((a: any) => a.action)
  check('FF3 audit has CREATE+SUBMIT+ENDORSE+APPROVE', ['CREATE', 'SUBMIT', 'ENDORSE', 'APPROVE'].every(a => ff3Actions.includes(a)), ff3Actions.join(','))
  check('FF4 audit has CREATE+VERIFY+APPROVE+PROCESS+PAYMENT+RECONCILE', ['CREATE', 'VERIFY', 'APPROVE', 'PROCESS', 'PAYMENT', 'RECONCILE'].every(a => ff4Actions.includes(a)), ff4Actions.join(','))
  check('Commitment audit has CREATE + UPDATE', comAudit.length >= 2, comAudit.map((a: any) => a.action).join(','))

  // ---------- 6. DASHBOARD FIGURES ----------
  console.log('\n6) Dashboard figures after cycle')
  const after = await budgetSummary()
  console.log(`   Budget AFTER: released=K${after.released} committed=K${after.committed} spent=K${after.spent} available=K${after.available}`)
  check('Spent increased by K5000', after.spent - before.spent === 5000, `Δ K${after.spent - before.spent}`)
  check('Available decreased by K5000', before.available - after.available === 5000, `Δ K${before.available - after.available}`)

  console.log('\n' + '='.repeat(60))
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  console.log(`Demo records left in DB: ${header.ff3_number}, ${ff4.ff4_number}, ${commitment.commitment_number}`)
  console.log('='.repeat(60) + '\n')
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('💥', e.message); process.exit(1) })
