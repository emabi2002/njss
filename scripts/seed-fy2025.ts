/**
 * NJSS FREMS — FY2025 demo data seed (idempotent).
 *
 * Populates the planning → budget → release → commitment → payment chain so the
 * Budget Control tabs and Dashboard widgets render with realistic data:
 *   expense codes → confirmed annual plans → budget allocations →
 *   quarterly releases → FF3 commitments → FF4 payments → consolidations.
 *
 * Re-running first removes anything it previously created (tagged 'SEED FY2025').
 *
 * Run with: bun scripts/seed-fy2025.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

function loadEnv() {
  const p = path.join(process.cwd(), '.env.local')
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}
loadEnv()

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
const FY = 2025
const NOW = new Date().toISOString()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const must = <T,>(r: { data: T; error: any }, ctx: string): T => { if (r.error) throw new Error(`${ctx}: ${r.error.message}`); return r.data }
const round = (n: number) => Math.round(n)

// Which sections get plans, and which expense categories each plans for.
const PLANS = [
  { cc: 'ACC',   cats: ['TRAVEL', 'SUPPLY'],   budgets: [120000, 80000] },
  { cc: 'PROC',  cats: ['SUPPLY', 'SERVICES'], budgets: [150000, 90000] },
  { cc: 'NCREG', cats: ['TRAVEL', 'MAINTAIN'], budgets: [110000, 60000] },
  { cc: 'SCREG', cats: ['TRAVEL', 'UTILITY'],  budgets: [90000, 50000] },
  { cc: 'REC',   cats: ['SUPPLY', 'TRAINING'], budgets: [70000, 65000] },
]

async function cleanup() {
  // FF4 (+ txns + audit)
  const ff4s = (await sb.from('ff4_headers').select('id, ff4_number').like('payment_description', 'SEED FY2025%')).data || []
  for (const f of ff4s) {
    await sb.from('payment_transactions').delete().eq('ff4_header_id', f.id)
    await sb.from('audit_logs').delete().eq('entity_type', 'FF4').eq('entity_reference', f.ff4_number)
    await sb.from('ff4_headers').delete().eq('id', f.id)
  }
  // FF3 (+ commitments + audit)
  const ff3s = (await sb.from('ff3_headers').select('id, ff3_number').like('purpose', 'SEED FY2025%')).data || []
  for (const h of ff3s) {
    const coms = (await sb.from('ff3_commitments').select('id, commitment_number').eq('ff3_header_id', h.id)).data || []
    for (const c of coms) {
      await sb.from('payment_transactions').delete().eq('commitment_id', c.id)
      await sb.from('audit_logs').delete().eq('entity_type', 'COMMITMENT').eq('entity_reference', c.commitment_number)
      await sb.from('ff3_commitments').delete().eq('id', c.id)
    }
    await sb.from('audit_logs').delete().eq('entity_type', 'FF3').eq('entity_reference', h.ff3_number)
    await sb.from('ff3_headers').delete().eq('id', h.id)
  }
  // Plans → their lines' allocations (releases cascade with allocation) → plan
  const plans = (await sb.from('annual_plan_headers').select('id, plan_number').like('plan_title', 'SEED FY2025%')).data || []
  for (const p of plans) {
    const lineIds = ((await sb.from('annual_plan_lines').select('id').eq('plan_header_id', p.id)).data || []).map((l) => l.id)
    if (lineIds.length) await sb.from('budget_allocations').delete().in('annual_plan_line_id', lineIds)
    await sb.from('audit_logs').delete().eq('entity_type', 'ANNUAL_PLAN').eq('entity_reference', p.plan_number)
    await sb.from('annual_plan_headers').delete().eq('id', p.id)
  }
  // Seeded expense codes (+ audit)
  const codes = (await sb.from('expense_code_registry').select('id, full_expense_code').like('description', 'SEED FY2025%')).data || []
  for (const c of codes) {
    await sb.from('budget_allocations').delete().eq('expense_code_registry_id', c.id)
    await sb.from('audit_logs').delete().eq('entity_type', 'EXPENSE_CODE').eq('entity_reference', c.full_expense_code)
    await sb.from('expense_code_registry').delete().eq('id', c.id)
  }
  console.log(`   cleaned: ${plans.length} plan(s), ${codes.length} code(s), ${ff3s.length} ff3, ${ff4s.length} ff4`)
}

// One-time purge of pre-planning artifacts so the demo is fully coded:
//  - leftover 'E2E TEST%' requisitions from the original e2e-test.ts
//  - original seed.sql direct allocations that have no expense code / plan line
async function purgeLegacy() {
  // E2E TEST artifacts (FF3 + FF4 + commitments + txns + audit)
  const e2eFF3 = (await sb.from('ff3_headers').select('id, ff3_number').like('purpose', 'E2E TEST%')).data || []
  for (const h of e2eFF3) {
    const ff4s = (await sb.from('ff4_headers').select('id, ff4_number').eq('ff3_header_id', h.id)).data || []
    for (const f of ff4s) {
      await sb.from('payment_transactions').delete().eq('ff4_header_id', f.id)
      await sb.from('audit_logs').delete().eq('entity_type', 'FF4').eq('entity_reference', f.ff4_number)
      await sb.from('ff4_headers').delete().eq('id', f.id)
    }
    const coms = (await sb.from('ff3_commitments').select('id, commitment_number').eq('ff3_header_id', h.id)).data || []
    for (const c of coms) {
      await sb.from('payment_transactions').delete().eq('commitment_id', c.id)
      await sb.from('audit_logs').delete().eq('entity_type', 'COMMITMENT').eq('entity_reference', c.commitment_number)
      await sb.from('ff3_commitments').delete().eq('id', c.id)
    }
    await sb.from('audit_logs').delete().eq('entity_type', 'FF3').eq('entity_reference', h.ff3_number)
    await sb.from('ff3_headers').delete().eq('id', h.id)
  }

  // Original direct allocations (no code, no plan line) — delete those with no commitments (releases cascade)
  const legacy = (await sb.from('budget_allocations').select('id')
    .eq('financial_year', FY).is('expense_code_registry_id', null).is('annual_plan_line_id', null)).data || []
  let removed = 0
  for (const a of legacy) {
    const used = (await sb.from('ff3_commitments').select('id').eq('budget_allocation_id', a.id).limit(1)).data || []
    if (used.length === 0) { await sb.from('budget_allocations').delete().eq('id', a.id); removed++ }
  }
  if (e2eFF3.length || removed) console.log(`   purged legacy: ${e2eFF3.length} E2E requisition(s), ${removed} uncoded allocation(s)`)
}

async function main() {
  console.log('\n🌱 SEEDING FY2025 DEMO DATA\n' + '='.repeat(60))
  console.log('\n0) Clean previous seed + purge legacy artifacts')
  await cleanup()
  await purgeLegacy()

  // Resolve master data
  const ccs = must(await sb.from('cost_centres').select('id, code, section_id, department_id').eq('is_active', true), 'cost centres')
  const secs = must(await sb.from('sections').select('id, name, department_id').eq('is_active', true), 'sections')
  const cats = must(await sb.from('expense_categories').select('id, code').eq('is_active', true), 'categories')
  const items = must(await sb.from('expense_items').select('id, code, expense_category_id').eq('is_active', true), 'items')
  const account = must(await sb.from('chart_of_accounts').select('id').eq('is_active', true).limit(1).single(), 'account')

  const ccByCode = new Map(ccs.map((c) => [c.code, c]))
  const secById = new Map(secs.map((s) => [s.id, s]))
  const catByCode = new Map(cats.map((c) => [c.code, c]))
  const firstItemFor = (catId: string) => items.find((i) => i.expense_category_id === catId)

  let codeCount = 0, planCount = 0, allocCount = 0, releaseCount = 0, comCount = 0, payCount = 0
  const deptsConfirmed = new Set<string>()

  console.log('\n1) Create expense codes, plans, allocations, releases')
  for (const cfg of PLANS) {
    const cc = ccByCode.get(cfg.cc)
    if (!cc) { console.log(`   ⚠ cost centre ${cfg.cc} not found, skipping`); continue }
    const sec = secById.get(cc.section_id)
    const deptId = cc.department_id || sec?.department_id
    deptsConfirmed.add(deptId)

    // Plan header (directly budget-confirmed for the demo)
    const planNumber = `AP-${FY}-S${String(planCount + 1).padStart(3, '0')}`
    const plan = must(await sb.from('annual_plan_headers').insert({
      plan_number: planNumber, financial_year: FY, department_id: deptId, section_id: cc.section_id,
      cost_centre_id: cc.id, plan_title: `SEED FY2025 — ${sec?.name || cfg.cc} Plan`, status: 'BUDGET_CONFIRMED',
      submitted_at: NOW, reviewed_at: NOW, approved_at: NOW, registrar_authorized_at: NOW, budget_confirmed_at: NOW,
    }).select().single(), 'plan')
    planCount++

    for (let i = 0; i < cfg.cats.length; i++) {
      const cat = catByCode.get(cfg.cats[i])
      if (!cat) continue
      const item = firstItemFor(cat.id)
      if (!item) continue
      const approved = cfg.budgets[i]

      // Expense code (trigger builds DEPT-CC-CAT-ITEM)
      const code = must(await sb.from('expense_code_registry').insert({
        financial_year: FY, department_id: deptId, section_id: cc.section_id, cost_centre_id: cc.id,
        expense_category_id: cat.id, expense_item_id: item.id, description: 'SEED FY2025 budget code', full_expense_code: 'PENDING',
      }).select().single(), 'expense code')
      codeCount++

      // Plan line (quarterly split adding to the approved total)
      const q1 = round(approved * 0.4), q2 = round(approved * 0.3), q3 = round(approved * 0.2), q4 = approved - q1 - q2 - q3
      const line = must(await sb.from('annual_plan_lines').insert({
        plan_header_id: plan.id, line_number: i + 1, activity_description: `${cfg.cats[i]} activities`,
        item_description: `${cfg.cats[i]} activities`, expense_code_registry_id: code.id, cost_centre_id: cc.id,
        quantity: 1, unit_cost: approved, q1_amount: q1, q2_amount: q2, q3_amount: q3, q4_amount: q4,
      }).select().single(), 'line')

      // Budget allocation (confirm-to-budget)
      const alloc = must(await sb.from('budget_allocations').insert({
        financial_year: FY, department_id: deptId, section_id: cc.section_id, cost_centre_id: cc.id,
        expense_code_registry_id: code.id, account_id: account.id, annual_plan_line_id: line.id,
        original_budget: approved, is_active: true,
      }).select().single(), 'allocation')
      allocCount++

      // Quarterly releases — Q1 50% + Q2 30% = 80% of approved
      const rel1 = round(approved * 0.5), rel2 = round(approved * 0.3)
      must(await sb.from('quarterly_releases').insert([
        { budget_allocation_id: alloc.id, financial_year: FY, quarter: 1, released_amount: rel1, release_date: `${FY}-01-15` },
        { budget_allocation_id: alloc.id, financial_year: FY, quarter: 2, released_amount: rel2, release_date: `${FY}-04-15` },
      ]).select(), 'releases')
      releaseCount += 2

      // Commitment + part-payment on the FIRST code of each plan (for committed/actual demo data)
      if (i === 0) {
        const released = rel1 + rel2
        const committedAmt = round(released * 0.35)
        const ff3 = must(await sb.from('ff3_headers').insert({
          financial_year: FY, department_id: deptId, section_id: cc.section_id, cost_centre_id: cc.id, expense_code_registry_id: code.id,
          purpose: `SEED FY2025 — ${code.full_expense_code} requisition`, justification: 'Seeded demo requisition',
          urgency_level: 'MEDIUM', procurement_method: 'QUOTATION', status: 'APPROVED', total_estimated_amount: committedAmt,
          is_within_budget: true, approved_date: NOW,
        }).select().single(), 'ff3')
        const com = must(await sb.from('ff3_commitments').insert({
          ff3_header_id: ff3.id, budget_allocation_id: alloc.id, financial_year: FY,
          commitment_date: `${FY}-05-01`, committed_amount: committedAmt, paid_amount: 0, status: 'ACTIVE',
        }).select().single(), 'commitment')
        comCount++

        // Pay roughly half → actual expenditure
        const payAmt = round(committedAmt * 0.5)
        const ff4 = must(await sb.from('ff4_headers').insert({
          financial_year: FY, ff3_header_id: ff3.id, commitment_id: com.id, payee_type: 'SUPPLIER',
          payee_name: 'Demo Supplier Ltd', payment_description: 'SEED FY2025 payment', gross_amount: payAmt,
          tax_amount: 0, deductions: 0, payment_method: 'EFT', status: 'PAID',
          payment_date: `${FY}-05-20`, paid_date: NOW, external_payment_reference: `EFT-SEED-${payCount + 1}`,
        }).select().single(), 'ff4')
        must(await sb.from('ff3_commitments').update({ paid_amount: payAmt, status: payAmt >= committedAmt ? 'FULLY_PAID' : 'PARTIALLY_PAID' }).eq('id', com.id).select(), 'update com')
        must(await sb.from('payment_transactions').insert({
          ff4_header_id: ff4.id, commitment_id: com.id, transaction_date: `${FY}-05-20`, transaction_type: 'PAYMENT',
          amount: payAmt, payment_reference: ff4.external_payment_reference, reconciled: false,
        }).select(), 'txn')
        payCount++
      }
    }
  }

  console.log(`   codes=${codeCount} plans=${planCount} allocations=${allocCount} releases=${releaseCount} commitments=${comCount} payments=${payCount}`)

  // Consolidate every department that received confirmed plans
  console.log('\n2) Consolidate department budgets')
  for (const deptId of deptsConfirmed) {
    const dplans = (await sb.from('annual_plan_headers').select('id, section_id, total_planned_budget, status')
      .eq('financial_year', FY).eq('department_id', deptId).in('status', ['AUTHORIZED_BY_REGISTRAR', 'BUDGET_CONFIRMED'])).data || []
    const total = dplans.reduce((s, p) => s + (p.total_planned_budget || 0), 0)
    must(await sb.from('budget_consolidations').upsert({
      financial_year: FY, department_id: deptId, status: 'CONSOLIDATED', total_amount: total,
      section_count: new Set(dplans.map((p) => p.section_id)).size, plan_count: dplans.length, consolidated_at: NOW,
    }, { onConflict: 'financial_year,department_id' }).select(), 'consolidation')
  }
  console.log(`   consolidated ${deptsConfirmed.size} department(s)`)

  // Summary from the live view
  console.log('\n3) Verify via v_budget_by_code')
  const view = (await sb.from('v_budget_by_code').select('*').eq('financial_year', FY)).data || []
  const sum = (k: string) => view.reduce((s, r) => s + (Number((r as Record<string, unknown>)[k]) || 0), 0)
  console.log(`   coded rows=${view.filter((r) => r.full_expense_code).length}`)
  console.log(`   approved=K${sum('revised_budget').toLocaleString()} released=K${sum('released_amount').toLocaleString()} committed=K${sum('committed_amount').toLocaleString()} actual=K${sum('actual_expenditure').toLocaleString()}`)

  console.log('\n' + '='.repeat(60))
  console.log('✅ FY2025 demo data seeded. Open Budget Control & Dashboard to view.')
  console.log('='.repeat(60) + '\n')
}

main().catch((e) => { console.error('💥', e.message); process.exit(1) })
