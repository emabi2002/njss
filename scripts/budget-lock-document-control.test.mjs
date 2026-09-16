import fs from 'node:fs'
import assert from 'node:assert/strict'

const page = fs.readFileSync('app/dashboard/budget-template/page.tsx', 'utf8')

assert.equal(page.includes('OFFICIAL_APPROVED_BUDGET'), true, 'Official approved document type must be used')
assert.equal(page.includes('Registrar-signed'), true, 'UI must identify the Registrar-signed source record')
assert.equal(page.includes('Upload official approved budget'), true, 'Budget Officer needs an official document upload control')
assert.equal(page.includes('uploadPrivateFile'), true, 'Official budget evidence must use private storage')
assert.equal(page.includes('BUCKETS.BUDGET_DOCUMENTS'), true, 'Official budget evidence must use the budget document bucket')
assert.equal(page.includes('registerBudgetDocument'), true, 'Uploaded evidence must be registered in budget metadata')
assert.equal(page.includes('getSignedUrl'), true, 'Recorded budget documents must be opened through signed URLs')
assert.equal(page.includes('officialDocuments.length === 0'), true, 'Division lock must be guarded by official document presence')
assert.equal(page.includes('window.confirm'), true, 'Lock must explicitly warn that original figures become immutable')
assert.equal(page.includes('await loadDivision(detail.budget.id)'), true, 'Post-lock state must be reloaded from the database')

console.log('Budget lock and official-document control passed')
