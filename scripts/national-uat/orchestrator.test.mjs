import fs from 'node:fs'
import assert from 'node:assert/strict'

const runPath = 'scripts/national-uat/run.ts'
const exportPath = 'scripts/national-uat/export-report-data.ts'
const ciPath = '.github/workflows/ci.yml'

assert.ok(fs.existsSync(runPath), 'Task 12 orchestrator must exist')
assert.ok(fs.existsSync(exportPath), 'Task 12 evidence exporter must exist')

const run = fs.readFileSync(runPath, 'utf8')
const exporter = fs.readFileSync(exportPath, 'utf8')
const ci = fs.readFileSync(ciPath, 'utf8')

for (const flag of ['--preflight', '--dry-run-reset', '--execute-reset', '--seed', '--validate']) {
  assert.ok(run.includes(flag), `orchestrator missing CLI flag ${flag}`)
}

const expectedPhases = [
  'PREFLIGHT',
  'BACKUP',
  'DRY_RUN_RESET',
  'EXECUTE_RESET',
  'SEED_MASTER',
  'REMAP_USERS',
  'SEED_FINANCE',
  'SEED_BUDGETS_AND_ACTIVATE',
  'SEED_TRANSACTIONS',
  'VALIDATE',
  'EXPORT_REPORT_DATA',
  'COMPLETE',
]
for (const phase of expectedPhases) {
  assert.ok(run.includes(`'${phase}'`) || run.includes(`\"${phase}\"`), `orchestrator missing phase ${phase}`)
}

assert.match(
  run,
  /case\s+['"]--execute-reset['"][\s\S]*?executeReset\s*\(/,
  'destructive reset must only be entered from the explicit --execute-reset mode',
)
assert.match(
  run,
  /requireResetCompletedForSeed[\s\S]*?RESET_COMPLETED/,
  '--seed must require RESET_COMPLETED for the same run ID',
)
assert.match(
  run,
  /case\s+['"]--seed['"][\s\S]*?requireResetCompletedForSeed[\s\S]*?seedNationalOrganisation[\s\S]*?seedFinanceMasters[\s\S]*?seedAndActivateNationalBudgets[\s\S]*?seedNationalTransactions/,
  '--seed must run the approved master, finance, budget and transaction sequence after its reset gate',
)

const validationCall = run.indexOf('const validationReport = await validateLiveDatabase')
const validationPersist = run.indexOf('await persistValidationResults')
assert.ok(validationCall >= 0, '--validate must execute validateLiveDatabase')
assert.ok(validationPersist > validationCall, 'uat_seed_runs validation results must only be persisted after all validation stages finish')

assert.match(run, /status\s*=\s*['"]FAILED['"]|['"]FAILED['"]/i, 'phase failures must persist FAILED status')
assert.match(run, /phaseHistory|phase_history|phases/, 'orchestrator must persist detailed phase/timestamp history')
assert.match(run, /njss-national-uat-validation\.json/, 'validation must emit the runtime validation evidence file')

for (const token of [
  '--output',
  'runMetadata',
  'backup',
  'counts',
  'financialTotals',
  'userMapping',
  'provenance',
  'validationResults',
  'uat_seed_entities',
  'system_backup_registry',
]) {
  assert.ok(exporter.includes(token), `evidence exporter missing ${token}`)
}
assert.match(exporter, /NJSS-NATIONAL-UAT-2026-V1|DATASET_VERSION/, 'evidence export must identify the dataset version')
assert.match(exporter, /writeFileSync|writeFile/, 'evidence exporter must write the requested JSON output')

assert.ok(ci.includes('National UAT orchestrator contract checks'), 'CI must expose the Task 12 orchestrator check explicitly')
assert.ok(ci.includes('scripts/national-uat/orchestrator.test.mjs'), 'CI must execute the Task 12 orchestrator contract test')

console.log('national UAT orchestrator contract checks passed')
