import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = ts.transpileModule(readFileSync('app/api/dashboard/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
let cycleStatus = 'PREPARATION'
let cycleYear = 2026
const context = { mustChangePassword: false, permissions: ['dashboard.view'], roleNames: ['Registrar'], scopes: [{ scope_type: 'SYSTEM_WIDE' }], userId: 'user' }
const fixtures = {
  departments: [{ id: 'hq', name: 'Head Office Division' }], sections: [{ id: 'section', name: 'Section', department_id: 'hq' }],
  division_budgets: [{ id: 'draft', status: 'DRAFT', division_id: 'hq', lines: [{ section_id: 'section', original_amount: 999 }] }],
  ff3_headers: [{ ff3_number: 'FF3', status: 'SUBMITTED', section_id: 'section', total_estimated_amount: 75, created_at: new Date().toISOString() }],
  ff4_headers: [{ status: 'PAID', section_id: 'section' }],
}
const query = (data) => new Proxy({}, { get: (_, key) => key === 'then' ? (resolve) => Promise.resolve({ data, error: null }).then(resolve) : () => query(data) })
const client = { from: (table) => query(table === 'annual_budget_cycles' ? [{ id: 'cycle', financial_year: cycleYear, status: cycleStatus }] : fixtures[table]), rpc: (name, args) => {
  assert.equal(name, 'get_current_budget_position'); assert.equal(args.p_financial_year, cycleYear)
  return query([{ division_id: 'hq', section_id: 'section', original_budget: 100, supplementary_adjustments: 20, reallocations_in: 5, reallocations_out: 5, current_approved_budget: 120, outstanding_commitments: 30, actual_expenditure: 40, available_budget: 50 }, { division_id: 'outside-hq', section_id: 'elsewhere', current_approved_budget: 10000 }])
} }
const routeModule = { exports: {} }
vm.runInNewContext(source, { exports: routeModule.exports, module: routeModule, console, require: (name) => {
  if (name === 'next/server') return { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } }
  if (name === '@/lib/rbac/server') return { getServerAccessContext: async () => context, createRequestSupabaseClient: () => client, hasServerPermission: (ctx, permission) => ctx.mustChangePassword === false && ctx.permissions.includes(permission) }
  if (name === '@/lib/rbac/scope') return { isRecordInScope: (_, row) => row.section_id === 'section' }
  throw new Error(name)
} })
const request = { nextUrl: { searchParams: new URLSearchParams('financialYear=2026') } }
let response = await routeModule.exports.GET(request)
assert.equal(response.status, 200)
assert.equal(response.body.summary.approvedBudget, 0, 'Preparation must not be shown as approved funds')
assert.equal(response.body.budgetPrepStats.draftOriginalValue, 999)
assert.equal(response.body.ff3Stats.pending, 1)
cycleStatus = 'ACTIVE'
response = await routeModule.exports.GET(request)
assert.equal(response.body.summary.approvedBudget, 120, 'Only Head Office positions belong in total')
assert.equal(response.body.summary.availableBalance, 50)
assert.equal(response.body.summary.approvedBudget - response.body.summary.outstandingCommitments - response.body.summary.actualExpenditure, response.body.summary.availableBalance)
cycleYear = 2027
response = await routeModule.exports.GET({ nextUrl: { searchParams: new URLSearchParams() } })
assert.equal(response.body.financialYear, 2027, 'Default year must resolve an existing annual budget cycle')
context.mustChangePassword = true
assert.equal((await routeModule.exports.GET(request)).status, 403)
console.log('Annual dashboard activation, balance, preparation and access tests passed')
