import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('lib/storage.ts', 'utf8')

assert.equal(source.includes("BUDGET_DOCUMENTS: 'njss-budget-documents'"), true, 'Budget document bucket constant must exist')
assert.equal(source.includes('export async function uploadPrivateFile'), true, 'Private upload helper must exist')
assert.match(source, /uploadPrivateFile[\s\S]*\.from\(bucket\)[\s\S]*\.upload\(/, 'Private helper must upload to Supabase Storage')

const privateStart = source.indexOf('export async function uploadPrivateFile')
assert.ok(privateStart >= 0, 'Private upload helper must be extractable')
const nextExport = source.indexOf('\nexport ', privateStart + 1)
const privateBody = source.slice(privateStart, nextExport > privateStart ? nextExport : source.length)
assert.equal(privateBody.includes('getPublicUrl'), false, 'Private budget uploads must never create public URLs')
assert.equal(source.includes('getSignedUrl'), true, 'Private files must remain retrievable through signed URLs')

console.log('Budget document private-storage contract passed')
