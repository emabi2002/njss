import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('app/api/reports/management/route.ts', 'utf8')
const page = readFileSync('app/dashboard/reports/management/page.tsx', 'utf8')
const scopeSource = readFileSync('lib/reports/management-scope.ts', 'utf8')
const preview = readFileSync('components/reports/ManagementReportPreview.tsx', 'utf8')
const position = { financial_year: 2026, annual_budget_cycle_id: 'cycle', division_budget_id: 'budget', division_id: 'hq', section_id: 's1', expense_ledger_id: 'l1', original_budget: 100, supplementary_adjustments: 20, reallocations_in: 5, reallocations_out: 10, current_approved_budget: 115, outstanding_commitments: 30, actual_expenditure: 25, available_budget: 60 }
let context = { permissions: ['reports.view'], mustChangePassword: false }
let scope = { mode: 'SYSTEM', label: 'Head Office', departmentId: null, sectionId: null }
let rpcArgs
let queries = []
const data = {
  annual_budget_cycles: [{ id: 'cycle', financial_year: 2026, status: 'ACTIVE' }],
  court_locations: [{ id: 'hq-location' }],
  departments: [{ id: 'hq', name: 'HQ Division', court_location_id: 'hq-location' }, { id: 'regional', name: 'Regional', court_location_id: 'region-location' }],
  sections: [{ id: 's1', department_id: 'hq', name: 'Section 1' }, { id: 's2', department_id: 'hq', name: 'Section 2' }],
  expense_ledger: [{ id: 'l1', ledger_number: '100', standard_description: 'Travel' }],
  ff3_headers: [{ id: 'real-ff3-id' }],
  v_ff3_ff4_transaction_trace: [{ ff3_number: 'FF3-1', ff4_number: 'FF4-1', ff3_amount: 30, payment_amount: 25 }],
}
const client = {
  from(table) {
    const query = { table, filters: [] }; queries.push(query)
    const chain = { then(resolve) { return Promise.resolve({ data: data[table] || [], error: null }).then(resolve) } }
    for (const method of ['select', 'eq', 'in', 'not', 'order']) chain[method] = (...args) => { query.filters.push([method, ...args]); return chain }
    return chain
  },
  async rpc(name, args) { assert.equal(name, 'get_current_budget_position'); rpcArgs = args; return { data: [position, { ...position, division_id: 'regional', available_budget: 999 }], error: null } },
}
const routeModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, {
  exports: routeModule.exports, module: routeModule, console,
  require(id) {
    if (id === 'next/server') return { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } }
    if (id.endsWith('/server')) return { getServerAccessContext: async () => context, hasAnyServerPermission: (value, permissions) => value?.mustChangePassword === false && permissions.some(permission => value.permissions.includes(permission) || value.permissions.includes('all')), createRequestSupabaseClient: () => client }
    if (id.endsWith('management-scope')) return { resolveManagementReportScope: async () => scope }
    throw Error(id)
  },
})
const run = query => routeModule.exports.GET({ nextUrl: new URL('https://example.test/api/reports/management?' + query) })
context = null; assert.equal((await run('')).status, 401)
context = { permissions: [] }; assert.equal((await run('')).status, 403)
context = { permissions: ['reports.view'], mustChangePassword: true }
assert.equal((await run('lookupsOnly=1')).status,403)
assert.equal((await run('report=ff3-ff4-transaction-trace')).status,403)
context.mustChangePassword = null
assert.equal((await run('lookupsOnly=1')).status,403)
context.mustChangePassword = false
assert.equal((await run('report=funding-source-financial-position')).status, 400)
assert.equal((await run('provinceId=province')).status, 400)
assert.equal((await run('departmentId=regional')).status, 400)
let result = await run('financialYear=2026')
assert.equal(result.body.rows[0].available_budget, 60, 'Out-of-HQ RPC rows cannot enter totals')
assert.equal(result.body.rows[0].current_approved_budget, 115)
assert.equal(result.body.lookups.departments.length, 1)
data.annual_budget_cycles = [{ id: 'prep', financial_year: 2027, status: 'PREPARATION' }, { id: 'cycle', financial_year: 2026, status: 'ACTIVE' }]
assert.equal((await run('lookupsOnly=1')).body.financialYear, 2026, 'Default year prefers an active cycle over newer preparation')
assert.equal((await run('financialYear=2027&lookupsOnly=1')).body.financialYear, 2027, 'An explicit year is preserved')
data.annual_budget_cycles = [{ id: 'prep', financial_year: 2027, status: 'PREPARATION' }]
const preparation = await run('')
assert.equal(preparation.body.financialYear, 2027, 'Latest existing cycle is used when no cycle is active')
assert.equal(preparation.body.rows.length, 0)
assert.equal(preparation.body.totals, undefined, 'Preparation does not fabricate zero approved totals')
assert.match(preparation.body.budgetNotice, /preparation/)
const missing = await run('financialYear=2025')
assert.equal(missing.body.budgetCycle, null)
assert.match(missing.body.budgetNotice, /No annual budget cycle/)
data.annual_budget_cycles = [{ id: 'cycle', financial_year: 2026, status: 'ACTIVE' }]

assert.deepEqual(Object.keys(result.body.totals).sort(), ['original_budget', 'supplementary_adjustments', 'reallocations_in', 'reallocations_out', 'current_approved_budget', 'outstanding_commitments', 'actual_expenditure', 'available_budget'].sort())
scope = { mode: 'SECTION', label: 'Section 1', departmentId: 'hq', sectionId: 's1' }
assert.equal((await run('sectionId=s2')).status, 403)
await run('financialYear=2026')
assert.equal(rpcArgs.p_division_id, 'hq'); assert.equal(rpcArgs.p_section_id, 's1')
queries = []
result = await run('report=ff3-ff4-transaction-trace&expenseLedgerId=l1')
assert.equal(result.body.rows[0].ff3Href, '/dashboard/ff3/FF3-1')
assert.equal(result.body.rows[0].ff4Href, '/dashboard/ff4/FF4-1')
assert.ok(queries.find(q => q.table === 'ff3_headers').filters.some(f => f[0] === 'eq' && f[1] === 'expense_ledger_id' && f[2] === 'l1'))
assert.ok(queries.find(q => q.table === 'v_ff3_ff4_transaction_trace').filters.some(f => f[0] === 'in' && f[1] === 'ff3_header_id' && f[2][0] === 'real-ff3-id'))
assert.doesNotMatch(source, /budget_allocation_id|v_authoritative_budget_position|serviceRole/)
assert.match(scopeSource, /HEADQUARTERS/)
assert.match(scopeSource, /eq\('is_active', true\)/)
assert.match(page, /authFetch/)
assert.match(page, /exportRows\(response\)/)
assert.match(page, /sectionLocked/)
assert.doesNotMatch(page, /All Provinces|funding-source-financial-position|cost-centre-financial-position/)
assert.match(preview, /Head Office Report/)
assert.match(preview, /Report Scope/)
console.log('Head Office management report authorization, canonical totals and posting trace tests passed')

assert.match(page, /if \(!financialYearEdited.current\) setFinancialYear\(payload.financialYear\)/)
assert.match(preview, /response.budgetNotice/)
