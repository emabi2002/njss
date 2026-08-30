import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const routePath = 'app/api/reports/management/route.ts'
const scopePath = 'lib/reports/management-scope.ts'
const previewPath = 'components/reports/ManagementReportPreview.tsx'
const reportsPagePath = 'app/dashboard/reports/management/page.tsx'

assert.equal(existsSync(routePath), true, 'Management reporting API route must exist')
assert.equal(existsSync(scopePath), true, 'Management reporting scope resolver must exist')
assert.equal(existsSync(previewPath), true, 'Management report preview component must exist')
assert.equal(existsSync(reportsPagePath), true, 'Dedicated management reporting workspace must exist')

const route = readFileSync(routePath, 'utf8')
const scope = readFileSync(scopePath, 'utf8')
const preview = readFileSync(previewPath, 'utf8')
const page = readFileSync(reportsPagePath, 'utf8')

assert.match(route, /getServerAccessContext/, 'Management reports must authenticate through server RBAC context')
assert.match(route, /reports\.view/, 'Management reports must require reports.view or equivalent')
assert.match(route, /budget\.report\.view/, 'Budget management reports may honour budget.report.view')
assert.match(route, /v_authoritative_budget_position/, 'Summary must aggregate authoritative budget position after scope is applied')
assert.match(route, /v_ff3_ff4_transaction_trace/, 'Transaction drill-down must use the authoritative FF3 to FF4 trace')
assert.match(route, /section_id/, 'Management report queries must explicitly enforce section scope')
assert.match(route, /department-financial-position/, 'Department drill-down must be implemented')
assert.match(route, /section-financial-position/, 'Section drill-down must be implemented')
assert.match(route, /cost-centre-financial-position/, 'Cost-centre drill-down must be implemented')
assert.match(route, /expense-code-financial-position/, 'Expense-code drill-down must be implemented')
assert.match(route, /ff3-ff4-transaction-trace/, 'Transaction trace drill-down must be implemented')
assert.match(route, /drilldown/, 'Server response rows must carry drill-down metadata')
assert.match(route, /ff3Href/, 'Transaction trace must expose FF3 detail links')
assert.match(route, /ff4Href/, 'Transaction trace must expose FF4 detail links')

assert.match(scope, /SYSTEM_WIDE/, 'System-wide reporting scope must be recognised')
assert.match(scope, /SECTION/, 'Section reporting scope must be supported')
assert.match(scope, /sectionId/, 'Section assignment must be part of scope enforcement')

assert.match(page, /authFetch/, 'Management preview must use authenticated fetch rather than direct browser queries')
assert.match(page, /Run Report/, 'Management workspace must expose an on-screen Run Report action')
assert.match(page, /exportToExcel/, 'Management exports must use the already-authorised preview dataset')
assert.match(preview, /Drill Down/, 'Preview rows must expose Drill Down actions')
assert.match(preview, /Report Scope/, 'Preview must visibly display the effective report scope')
assert.match(preview, /Open FF3/, 'Transaction trace must allow opening FF3')
assert.match(preview, /Open FF4/, 'Transaction trace must allow opening FF4')

console.log('Management reporting and drill-down contract passed')
