/**
 * NJSS FREMS — Planning-to-Payment END-TO-END test.
 *
 * Exercises the FULL new cycle (mirrors lib/api.ts + the planning/budget UI):
 *   expense code registry → annual plan → submit/review/approve/authorize
 *   → confirm-to-budget → department consolidation → budget availability
 *   → FF3 commitment → FF4 payment → v_budget_by_code reporting.
 *
 * Fully ISOLATED: creates its own throw-away department/section/cost-centre/
 * category/item so it never touches real data, then cleans everything up.
 *
 * Run with: bun scripts/e2e-planning-test.ts
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const must = <T,>(r: { data: T; error: any }, ctx: string): T => {
  if (r.error) throw new Error(`${ctx}: ${r.error.message}`)
  return r.data
}

// Throw-away master-data codes (unique, easy to identify + clean up)
const C = { dept: 'ZE2E', sec: 'ZE2ES', cc: 'ZE2ECC', cat: 'ZE2EC', item: 'IT' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ids: Record<string, any> = {}

async function cleanup(verbose = true) {
  // Reverse dependency order
  // 1. FF4 + payments + audit
  const ff4s = (await supabase.from('ff4_headers').select('id, ff4_number').like('payment_description', 'E2E-PLAN%')).data || []
  for (const f of ff4s) {
    await supabase.from('payment_transactions').delete().eq('ff4_header_id', f.id)
    await supabase.from('audit_logs').delete().eq('entity_type', 'FF4').eq('entity_reference', f.ff4_number)
    await supabase.from('ff4_headers').delete().eq('id', f.id)
  }
  // 2. FF3 + commitments + audit
  const ff3s = (await supabase.from('ff3_headers').select('id, ff3_number').like('purpose', 'E2E-PLAN%')).data || []
  for (const h of ff3s) {
    const coms = (await supabase.from('ff3_commitments').select('id, commitment_number').eq('ff3_header_id', h.id)).data || []
    for (const c of coms) {
      await supabase.from('payment_transactions').delete().eq('commitment_id', c.id)
      await supabase.from('audit_logs').delete().eq('entity_type', 'COMMITMENT').eq('entity_reference', c.commitment_number)
      await supabase.from('ff3_commitments').delete().eq('id', c.id)
    }
    await supabase.from('audit_logs').delete().eq('entity_type', 'FF3').eq('entity_reference', h.ff3_number)
    await supabase.from('ff3_headers').delete().eq('id', h.id)
  }
  // 3. Plans (+ lines cascade) + budget allocations + consolidations + audit
  const plans = (await supabase.from('annual_plan_headers').select('id, plan_number').like('plan_title', 'E2E-PLAN%')).data || []
  for (const p of plans) {
    await supabase.from('budget_allocations').delete().in('annual_plan_line_id',
      ((await supabase.from('annual_plan_lines').select('id').eq('plan_header_id', p.id)).data || []).map((l) => l.id))
    await supabase.from('audit_logs').delete().eq('entity_type', 'ANNUAL_PLAN').eq('entity_reference', p.plan_number)
    await supabase.from('annual_plan_headers').delete().eq('id', p.id)
  }
  // 4. Expense code registry (+ audit) — by description marker
  const codes = (await supabase.from('expense_code_registry').select('id, full_expense_code').like('description', 'E2E-PLAN%')).data || []
  for (const c of codes) {
    await supabase.from('budget_allocations').delete().eq('expense_code_registry_id', c.id)
    await supabase.from('audit_logs').delete().eq('entity_type', 'EXPENSE_CODE').eq('entity_reference', c.full_expense_code)
    await supabase.from('expense_code_registry').delete().eq('id', c.id)
  }
  // 5. Consolidation must go BEFORE the department (FK department_id)
  const testDeptId = ids.deptId || (await supabase.from('departments').select('id').eq('code', C.dept).maybeSingle()).data?.id
  if (testDeptId) await supabase.from('budget_consolidations').delete().eq('department_id', testDeptId)
  // 6. Throw-away master data (children before parents)
  await supabase.from('expense_items').delete().eq('code', C.item).in('expense_category_id',
    ((await supabase.from('expense_categories').select('id').eq('code', C.cat)).data || []).map((r) => r.id))
  await supabase.from('cost_centres').delete().eq('code', C.cc)
  await supabase.from('expense_categories').delete().eq('code', C.cat)
  await supabase.from('sections').delete().eq('code', C.sec)
  await supabase.from('departments').delete().eq('code', C.dept)
  if (verbose && (ff4s.length || ff3s.length || plans.length || codes.length)) {
    console.log(`   (cleaned prior: ${plans.length} plan(s), ${ff3s.length} ff3, ${ff4s.length} ff4, ${codes.length} code(s))`)
  }
}

async function main() {
  console.log('\n🧪 NJSS PLANNING → PAYMENT END-TO-END TEST\n' + '='.repeat(64))

  // Resolve the test department id (if a prior run left it) for consolidation cleanup
  ids.deptId = (await supabase.from('departments').select('id').eq('code', C.dept).maybeSingle()).data?.id
  await cleanup()

  // ---------- 0. SET UP ISOLATED MASTER DATA ----------
  console.log('\n0) Create isolated master data (dept, section, cost centre, category, item)')
  const dept = must(await supabase.from('departments').insert({ code: C.dept, name: 'E2E Test Department' }).select().single(), 'dept')
  ids.deptId = dept.id
  const sec = must(await supabase.from('sections').insert({ code: C.sec, name: 'E2E Test Section', department_id: dept.id }).select().single(), 'section')
  const cc = must(await supabase.from('cost_centres').insert({ code: C.cc, name: 'E2E Test Cost Centre', department_id: dept.id, section_id: sec.id }).select().single(), 'cost centre')
  const cat = must(await supabase.from('expense_categories').insert({ code: C.cat, name: 'E2E Test Category' }).select().single(), 'category')
  const item = must(await supabase.from('expense_items').insert({ expense_category_id: cat.id, code: C.item, name: 'E2E Test Item', default_unit: 'unit' }).select().single(), 'item')
  check('Master data created', !!(dept.id && sec.id && cc.id && cat.id && item.id))

  // ---------- 1. EXPENSE CODE REGISTRY (trigger generates DEPT-CC-CAT-ITEM) ----------
  console.log('\n1) Build expense code (auto DEPT-CC-CAT-ITEM)')
  const code = must(await supabase.from('expense_code_registry').insert({
    financial_year: FY, department_id: dept.id, section_id: sec.id, cost_centre_id: cc.id,
    expense_category_id: cat.id, expense_item_id: item.id, description: 'E2E-PLAN test code', full_expense_code: 'PENDING',
  }).select().single(), 'expense code')
  const expected = `${C.dept}-${C.cc}-${C.cat}-${C.item}`
  check('Full expense code generated by trigger', code.full_expense_code === expected, code.full_expense_code)

  // ---------- 2. ANNUAL PLAN (DRAFT) + line (qty x unit cost) ----------
  console.log('\n2) Create annual plan with one activity line (10 x K500)')
  const planNumber = `AP-${FY}-E2E${Date.now().toString().slice(-5)}`
  const plan = must(await supabase.from('annual_plan_headers').insert({
    plan_number: planNumber, financial_year: FY, department_id: dept.id, section_id: sec.id,
    cost_centre_id: cc.id, plan_title: 'E2E-PLAN annual plan', status: 'DRAFT',
  }).select().single(), 'plan')
  check('Plan number set', !!plan.plan_number, plan.plan_number)

  must(await supabase.from('annual_plan_lines').insert({
    plan_header_id: plan.id, line_number: 1, activity_description: 'E2E activity', item_description: 'E2E activity',
    expense_code_registry_id: code.id, cost_centre_id: cc.id, quantity: 10, unit_cost: 500,
    q1_amount: 5000, q2_amount: 0, q3_amount: 0, q4_amount: 0,
  }).select(), 'plan line')
  const line = must(await supabase.from('annual_plan_lines').select('id, total_amount').eq('plan_header_id', plan.id).single(), 'read line')
  ids.lineId = line.id
  check('Line total_amount generated (5000)', Number(line.total_amount) === 5000, `K${line.total_amount}`)

  const planAfterLine = must(await supabase.from('annual_plan_headers').select('total_planned_budget').eq('id', plan.id).single(), 'plan total')
  check('Plan total recalc trigger (5000)', Number(planAfterLine.total_planned_budget) === 5000, `K${planAfterLine.total_planned_budget}`)

  // ---------- 3. PLAN WORKFLOW: submit → review → approve → authorize → confirm ----------
  console.log('\n3) Plan workflow: submit → review → approve(dept) → authorize(registrar) → confirm-budget')
  const setStatus = async (status: string, field?: string) =>
    must(await supabase.from('annual_plan_headers').update({ status, ...(field ? { [field]: new Date().toISOString() } : {}) }).eq('id', plan.id).select().single(), status)
  await setStatus('SUBMITTED', 'submitted_at')
  await setStatus('REVIEWED', 'reviewed_at')
  await setStatus('APPROVED_BY_DEPARTMENT', 'approved_at')
  await setStatus('AUTHORIZED_BY_REGISTRAR', 'registrar_authorized_at')
  await setStatus('BUDGET_CONFIRMED', 'budget_confirmed_at')

  // confirmPlanToBudget (mirror): materialise lines into budget_allocations
  const fallbackAccount = (await supabase.from('chart_of_accounts').select('id').eq('is_active', true).limit(1).maybeSingle()).data
  must(await supabase.from('budget_allocations').insert({
    financial_year: FY, department_id: dept.id, section_id: sec.id, cost_centre_id: cc.id,
    expense_code_registry_id: code.id, account_id: fallbackAccount?.id, annual_plan_line_id: line.id,
    original_budget: 5000, is_active: true,
  }).select(), 'budget allocation')
  const alloc = must(await supabase.from('budget_allocations').select('id, revised_budget').eq('annual_plan_line_id', line.id).single(), 'read allocation')
  ids.allocId = alloc.id
  check('Budget allocation created from plan (revised 5000)', Number(alloc.revised_budget) === 5000, `K${alloc.revised_budget}`)

  // ---------- 4. DEPARTMENT CONSOLIDATION ----------
  console.log('\n4) Consolidate department budget')
  const plansForDept = (await supabase.from('annual_plan_headers').select('id, section_id, total_planned_budget, status')
    .eq('financial_year', FY).eq('department_id', dept.id).in('status', ['AUTHORIZED_BY_REGISTRAR', 'BUDGET_CONFIRMED'])).data || []
  const consTotal = plansForDept.reduce((s, p) => s + (p.total_planned_budget || 0), 0)
  const cons = must(await supabase.from('budget_consolidations').upsert({
    financial_year: FY, department_id: dept.id, status: 'CONSOLIDATED', total_amount: consTotal,
    section_count: new Set(plansForDept.map((p) => p.section_id)).size, plan_count: plansForDept.length,
    consolidated_at: new Date().toISOString(),
  }, { onConflict: 'financial_year,department_id' }).select().single(), 'consolidation')
  check('Consolidation total = plan value (5000)', Number(cons.total_amount) === 5000, `K${cons.total_amount}`)
  check('Consolidation plan_count = 1', cons.plan_count === 1, `${cons.plan_count}`)

  // ---------- 5. BUDGET AVAILABILITY (checkBudgetAvailability mirror) ----------
  console.log('\n5) Budget availability for the expense code')
  const availFor = async () => {
    const allocs = (await supabase.from('budget_allocations').select('id, revised_budget').eq('financial_year', FY).eq('is_active', true).eq('expense_code_registry_id', code.id)).data || []
    const revised = allocs.reduce((s, a) => s + (a.revised_budget || 0), 0)
    const allocIds = allocs.map((a) => a.id)
    let committed = 0, spent = 0
    if (allocIds.length) {
      const coms = (await supabase.from('ff3_commitments').select('committed_amount, paid_amount, status').in('budget_allocation_id', allocIds)).data || []
      committed = coms.reduce((s, c) => s + (c.status === 'CANCELLED' ? 0 : (c.committed_amount || 0) - (c.paid_amount || 0)), 0)
      spent = coms.reduce((s, c) => s + (c.paid_amount || 0), 0)
    }
    return { revised, committed, spent, available: revised - committed - spent }
  }
  const a0 = await availFor()
  check('Availability: revised 5000, available 5000', a0.revised === 5000 && a0.available === 5000, `rev K${a0.revised} avail K${a0.available}`)

  // ---------- 6. FF3 against the expense code → APPROVE → commitment ----------
  console.log('\n6) FF3 (K3000) approved → commitment linked to the budget code')
  const ff3 = must(await supabase.from('ff3_headers').insert({
    financial_year: FY, department_id: dept.id, section_id: sec.id, cost_centre_id: cc.id, expense_code_registry_id: code.id,
    purpose: 'E2E-PLAN requisition', justification: 'planning e2e', urgency_level: 'MEDIUM', procurement_method: 'QUOTATION',
    status: 'APPROVED', total_estimated_amount: 3000, is_within_budget: true, approved_date: new Date().toISOString(),
  }).select().single(), 'ff3')
  const commitment = must(await supabase.from('ff3_commitments').insert({
    ff3_header_id: ff3.id, budget_allocation_id: alloc.id, financial_year: FY,
    commitment_date: new Date().toISOString().split('T')[0], committed_amount: 3000, paid_amount: 0, status: 'ACTIVE',
  }).select().single(), 'commitment')
  check('Commitment created (K3000)', Number(commitment.committed_amount) === 3000, commitment.commitment_number)

  const a1 = await availFor()
  check('After commit: committed 3000, available 2000', a1.committed === 3000 && a1.available === 2000, `com K${a1.committed} avail K${a1.available}`)

  // v_budget_by_code reflects the commitment
  const v1 = must(await supabase.from('v_budget_by_code').select('*').eq('financial_year', FY).eq('expense_code_registry_id', code.id).single(), 'v_budget_by_code')
  check('View: revised 5000 / committed 3000', Number(v1.revised_budget) === 5000 && Number(v1.committed_amount) === 3000, `rev K${v1.revised_budget} com K${v1.committed_amount}`)

  // ---------- 7. FF4 pays the commitment in full ----------
  console.log('\n7) FF4 (K3000) verify → approve → process → pay; commitment FULLY_PAID')
  const ff4 = must(await supabase.from('ff4_headers').insert({
    financial_year: FY, ff3_header_id: ff3.id, commitment_id: commitment.id, payee_type: 'SUPPLIER',
    payee_name: 'E2E Supplier', payment_description: 'E2E-PLAN payment', gross_amount: 3000, tax_amount: 0, deductions: 0,
    payment_method: 'EFT', status: 'SUBMITTED', submitted_date: new Date().toISOString(),
  }).select().single(), 'ff4')
  check('FF4 net_amount generated (3000)', Number(ff4.net_amount) === 3000, `K${ff4.net_amount}`)

  for (const [status, field] of [['VERIFIED', 'verified_date'], ['APPROVED', 'approved_date'], ['PROCESSED', '']] as const) {
    must(await supabase.from('ff4_headers').update({ status, ...(field ? { [field]: new Date().toISOString() } : {}) }).eq('id', ff4.id).select().single(), status)
  }
  const paid = must(await supabase.from('ff4_headers').update({ status: 'PAID', payment_date: new Date().toISOString().split('T')[0], paid_date: new Date().toISOString(), external_payment_reference: 'EFT-E2E-PLAN' }).eq('id', ff4.id).select().single(), 'pay')
  must(await supabase.from('ff3_commitments').update({ paid_amount: paid.net_amount, status: 'FULLY_PAID' }).eq('id', commitment.id).select(), 'update commitment')
  must(await supabase.from('payment_transactions').insert({ ff4_header_id: ff4.id, commitment_id: commitment.id, transaction_date: new Date().toISOString().split('T')[0], transaction_type: 'PAYMENT', amount: paid.net_amount, payment_reference: 'EFT-E2E-PLAN', reconciled: false }).select(), 'payment txn')

  const a2 = await availFor()
  check('After pay: committed 0, spent 3000, available 2000', a2.committed === 0 && a2.spent === 3000 && a2.available === 2000, `com K${a2.committed} spent K${a2.spent} avail K${a2.available}`)

  const v2 = must(await supabase.from('v_budget_by_code').select('*').eq('financial_year', FY).eq('expense_code_registry_id', code.id).single(), 'v_budget_by_code 2')
  check('View: actual 3000 / committed 0', Number(v2.actual_expenditure) === 3000 && Number(v2.committed_amount) === 0, `act K${v2.actual_expenditure} com K${v2.committed_amount}`)

  // ---------- 8. AUDIT TRAIL across the planning cycle ----------
  console.log('\n8) Audit trail (DB triggers across the planning cycle)')
  const planAudit = (await supabase.from('audit_logs').select('action').eq('entity_type', 'ANNUAL_PLAN').eq('entity_reference', plan.plan_number)).data || []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const planActions = planAudit.map((a: any) => a.action)
  check('Plan audit has SUBMIT+REVIEW+APPROVE+AUTHORIZE+CONFIRM_BUDGET',
    ['SUBMIT', 'REVIEW', 'APPROVE', 'AUTHORIZE', 'CONFIRM_BUDGET'].every((x) => planActions.includes(x)), planActions.join(','))
  const codeAudit = (await supabase.from('audit_logs').select('action').eq('entity_type', 'EXPENSE_CODE').eq('entity_reference', code.full_expense_code)).data || []
  check('Expense code audit has CREATE', codeAudit.some((a) => a.action === 'CREATE'))

  // ---------- 9. CLEAN UP ----------
  console.log('\n9) Clean up all test data')
  await cleanup(false)
  const leftPlans = (await supabase.from('annual_plan_headers').select('id').like('plan_title', 'E2E-PLAN%')).data || []
  const leftDept = (await supabase.from('departments').select('id').eq('code', C.dept)).data || []
  const leftCons = ids.deptId ? ((await supabase.from('budget_consolidations').select('id').eq('department_id', ids.deptId)).data || []) : []
  check('No test plans left', leftPlans.length === 0)
  check('No test department left', leftDept.length === 0)
  check('No test consolidation left', leftCons.length === 0)

  console.log('\n' + '='.repeat(64))
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  console.log('='.repeat(64) + '\n')
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('💥', e.message)
  try { await cleanup(false) } catch { /* ignore */ }
  process.exit(1)
})
