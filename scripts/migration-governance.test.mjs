import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationDir = path.join(root, 'supabase', 'migrations')
const ledgerPath = path.join(root, 'docs', 'governance', 'NJSS_MIGRATION_LEDGER.md')

const files = fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()
const legacyShortNumberPattern = /^(\d{3,4})_/u
const timestampPattern = /^\d{14}_[a-z0-9_]+\.sql$/u
const allowedLegacyCollisions = new Set(['003', '052', '064'])

const prefixes = new Map()
for (const file of files) {
  const match = file.match(legacyShortNumberPattern)
  if (!match) continue
  const prefix = match[1]
  const existing = prefixes.get(prefix) || []
  existing.push(file)
  prefixes.set(prefix, existing)
}

const collisions = [...prefixes.entries()].filter(([, names]) => names.length > 1)
assert.deepEqual(
  collisions.map(([prefix]) => prefix).sort(),
  [...allowedLegacyCollisions].sort(),
  'only the documented historical migration prefix collisions may exist',
)

for (const [prefix, names] of collisions) {
  assert.ok(allowedLegacyCollisions.has(prefix), `unexpected duplicate legacy migration prefix ${prefix}: ${names.join(', ')}`)
}

const timestampFiles = files.filter((file) => /^\d{14}_/u.test(file))
for (const file of timestampFiles) {
  assert.match(file, timestampPattern, `timestamp migration has invalid filename: ${file}`)
}

const timestampVersionFiles = new Map()
for (const file of timestampFiles) {
  const version = file.slice(0, 14)
  const existing = timestampVersionFiles.get(version) || []
  existing.push(file)
  timestampVersionFiles.set(version, existing)
}
const duplicateTimestampVersions = [...timestampVersionFiles.entries()]
  .filter(([, names]) => names.length > 1)
  .map(([version, names]) => `${version}: ${names.join(', ')}`)
assert.deepEqual(
  duplicateTimestampVersions,
  [],
  `timestamp migration versions must be unique: ${duplicateTimestampVersions.join('; ')}`,
)

assert.ok(fs.existsSync(ledgerPath), 'authoritative NJSS migration ledger must exist')
const ledger = fs.readFileSync(ledgerPath, 'utf8')
for (const required of [
  'qzsmmalfeinoagvronpb',
  '003_notifications_and_audit.sql',
  '003_notifications_only.sql',
  '052_budget_revision_workflow.sql',
  '052_dashboard_scope_access.sql',
  '064_budget_activation_finance_mapping_worklist.sql',
  '064_budget_activation_mapping_worklist.sql',
  '20260830060930',
  'Future migration naming rule',
]) {
  assert.ok(ledger.includes(required), `migration ledger missing required evidence: ${required}`)
}

console.log('migration governance regression checks passed')
