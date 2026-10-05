import fs from 'node:fs'
import assert from 'node:assert/strict'
const read = path => fs.readFileSync(path, 'utf8')
for (const path of ['app/api/workflows/budget/route.ts', 'app/api/budget-activation/route.ts']) {
  const source = read(path)
  assert.match(source, /status: 410/, `${path} must reject retired writes`)
  assert.doesNotMatch(source, /\.rpc\(/, `${path} must never execute a legacy mutation`)
}
for (const [path, target] of [
  ['app/dashboard/budget/revisions/page.tsx', '/dashboard/budget/adjustments'],
  ['app/dashboard/budget/funding/page.tsx', '/dashboard/budget'],
  ['app/dashboard/plans/page.tsx', '/dashboard/budget-template'],
  ['app/dashboard/master/finance-mapping/worklist/page.tsx', '/dashboard/master/finance-mapping'],
]) {
  assert.ok(read(path).includes(`redirect('${target}')`), `${path} must redirect to the supported workspace`)
}
for (const path of ['app/dashboard/budget-template/BudgetRevisionDialog.tsx', 'app/dashboard/budget-template/BudgetRevisionPanel.tsx']) {
  assert.equal(fs.existsSync(path), false, 'unused legacy components must be removed')
}
assert.doesNotMatch(read('app/dashboard/ff3/[ff3_number]/page.tsx'), /v_authoritative_budget_position|financialPosition\.released_amount|financialPosition\.funded_amount/)
console.log('Legacy budget routes and writes retired')
