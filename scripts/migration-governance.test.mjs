import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname, '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const baselinePath = path.join(root, 'docs', 'governance', 'NJSS_MIGRATION_REPOSITORY_BASELINE.json')
const appliedPath = path.join(root, 'docs', 'governance', 'NJSS_SUPABASE_APPLIED_MIGRATIONS.json')
const policyPath = path.join(root, 'docs', 'governance', 'NJSS_MIGRATION_GOVERNANCE.md')

for (const required of [baselinePath, appliedPath, policyPath]) {
  assert.ok(fs.existsSync(required), `required migration-governance artifact missing: ${path.relative(root, required)}`)
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const applied = JSON.parse(fs.readFileSync(appliedPath, 'utf8'))
const policy = fs.readFileSync(policyPath, 'utf8')

assert.equal(baseline.schemaVersion, 1)
assert.equal(baseline.repository, 'emabi2002/njss')
assert.equal(baseline.baselineMainSha, '6781ddf43c958a2095f9a48e2bfec85b9296be7e')
assert.ok(Array.isArray(baseline.historicalMigrations) && baseline.historicalMigrations.length > 60)
assert.deepEqual(
  baseline.allowedLegacyDuplicatePrefixes,
  { '003': 2, '052': 2, '064': 2 },
  'only the three known historical duplicate numeric prefixes may remain',
)
assert.deepEqual(
  baseline.allowedLegacyNonstandardPrefixes,
  ['0625_budget_activation_queue_view_reset.sql'],
)

const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
const historicalNames = new Set(baseline.historicalMigrations.map((entry) => entry.name))

for (const entry of baseline.historicalMigrations) {
  assert.ok(files.includes(entry.name), `historical migration disappeared: ${entry.name}`)
  assert.match(entry.gitBlobSha, /^[0-9a-f]{40}$/i, `historical migration must retain a Git blob checksum: ${entry.name}`)
}

for (const name of files) {
  if (historicalNames.has(name)) continue
  assert.match(
    name,
    /^\d{14}_[a-z0-9][a-z0-9_]*\.sql$/,
    `new migration must use YYYYMMDDHHMMSS_description.sql naming: ${name}`,
  )
}

const duplicateCounts = new Map()
for (const name of files) {
  const match = name.match(/^(\d{3})_/)
  if (!match) continue
  duplicateCounts.set(match[1], (duplicateCounts.get(match[1]) || 0) + 1)
}
for (const [prefix, count] of duplicateCounts) {
  if (count <= 1) continue
  assert.equal(
    baseline.allowedLegacyDuplicatePrefixes[prefix],
    count,
    `unexpected duplicate legacy migration prefix ${prefix}`,
  )
}

assert.equal(applied.projectId, 'qzsmmalfeinoagvronpb')
assert.equal(applied.projectName, 'NJSS System')
assert.ok(Array.isArray(applied.migrations) && applied.migrations.length >= 90)
assert.equal(applied.migrations[0].version, '20260826072440')
assert.equal(applied.migrations.at(-1).version, '20260830060930')

for (let i = 1; i < applied.migrations.length; i += 1) {
  assert.ok(
    applied.migrations[i - 1].version < applied.migrations[i].version,
    `live applied migration snapshot must be strictly ordered at index ${i}`,
  )
}

for (const requiredPhrase of [
  'Do not rename or rewrite historical migrations',
  'production migration requires separate explicit approval',
  'repository baseline checksum',
  'live applied migration ledger',
  'schema drift',
]) {
  assert.ok(policy.includes(requiredPhrase), `migration governance policy missing phrase: ${requiredPhrase}`)
}

console.log('migration governance regression checks passed')
