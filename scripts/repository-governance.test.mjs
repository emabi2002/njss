import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = new URL('../', import.meta.url)
const ci = fs.readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8')
const releaseDoc = new URL('docs/governance/NJSS_RELEASE_GOVERNANCE.md', root)

assert.match(
  ci,
  /\npermissions:\s*\n\s+contents:\s*read\b/,
  'CI must declare least-privilege contents: read',
)

assert.match(
  ci,
  /\nconcurrency:\s*\n[\s\S]*cancel-in-progress:\s*true\b/,
  'CI must cancel superseded branch/PR runs',
)

assert.match(
  ci,
  /pull_request:\s*\n\s+branches:\s*\[main\]/,
  'CI pull_request validation must target main',
)

assert.ok(
  fs.existsSync(releaseDoc),
  'authoritative NJSS release governance document must exist',
)

const governance = fs.readFileSync(releaseDoc, 'utf8')

for (const requirement of [
  'Merge approval does not authorize production deployment',
  'Production database migration requires separate explicit approval',
  'approved source commit SHA',
  'deployed commit SHA',
  'rollback',
]) {
  assert.ok(
    governance.includes(requirement),
    `missing release-governance requirement: ${requirement}`,
  )
}

console.log('repository governance regression checks passed')
