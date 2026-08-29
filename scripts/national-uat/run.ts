import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Client } from 'pg'
import { DATASET_VERSION, runIdFor } from './constants'
import { connectNjss, withTransaction } from './db'
import {
  assertRetainedUserShape,
  captureProtectedManifest,
  captureRebuildableForeignKeys,
  captureTableCounts,
  type ProtectedManifest,
  type TableCounts,
} from './preflight'
import { dryRunReset, executeReset } from './reset'
import { buildBudgetSeedPlan, seedAndActivateNationalBudgets } from './seed-budgets'
import { buildFinanceMasterPlan, seedFinanceMasters } from './seed-finance'
import { buildNationalMasterPlan, seedNationalOrganisation } from './seed-master'
import { buildTransactionSeedPlan, seedNationalTransactions } from './seed-transactions'
import {
  validateLiveDatabase,
  validateReplacementPlans,
  type ValidationReport,
} from './validate'

export const PHASE_ORDER = [
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
] as const

export type NationalUatPhase = (typeof PHASE_ORDER)[number]
type PhaseOutcome = 'STARTED' | 'COMPLETED' | 'FAILED'
type CliMode = '--preflight' | '--dry-run-reset' | '--execute-reset' | '--seed' | '--validate'
type SeedRunStatus =
  | 'PLANNED'
  | 'PREFLIGHT_PASSED'
  | 'RESET_IN_PROGRESS'
  | 'RESET_COMPLETED'
  | 'SEEDING'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ROLLED_BACK'

type PhaseEvent = {
  phase: NationalUatPhase
  outcome: PhaseOutcome
  at: string
  message?: string
}

type RunNotes = {
  datasetVersion: string
  runId: string
  phaseHistory: PhaseEvent[]
}

type SeedRunRow = {
  run_id: string
  dataset_version: string
  status: SeedRunStatus
  backup_id: string | null
  protected_manifest: ProtectedManifest
  pre_reset_counts: TableCounts
  post_reset_counts: TableCounts
  validation_results: ValidationReport | Record<string, never>
  notes: string | null
}

const VALIDATION_EVIDENCE_PATH = '/mnt/data/njss-national-uat-validation.json'
const MODES: readonly CliMode[] = ['--preflight', '--dry-run-reset', '--execute-reset', '--seed', '--validate']

function isoNow(): string {
  return new Date().toISOString()
}

function parseNotes(raw: string | null, runId: string): RunNotes {
  if (!raw?.trim()) return { datasetVersion: DATASET_VERSION, runId, phaseHistory: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<RunNotes>
    return {
      datasetVersion: parsed.datasetVersion ?? DATASET_VERSION,
      runId: parsed.runId ?? runId,
      phaseHistory: Array.isArray(parsed.phaseHistory) ? parsed.phaseHistory : [],
    }
  } catch {
    return { datasetVersion: DATASET_VERSION, runId, phaseHistory: [] }
  }
}

function phaseCompleted(notes: RunNotes, phase: NationalUatPhase): boolean {
  return notes.phaseHistory.some((event) => event.phase === phase && event.outcome === 'COMPLETED')
}

async function loadRun(client: Client, runId: string): Promise<SeedRunRow> {
  const result = await client.query<SeedRunRow>(
    `select run_id, dataset_version, status, backup_id,
            protected_manifest, pre_reset_counts, post_reset_counts,
            validation_results, notes
     from public.uat_seed_runs
     where run_id = $1`,
    [runId],
  )
  if (result.rowCount !== 1) throw new Error(`UAT seed run ${runId} does not exist. Run --preflight first.`)
  const row = result.rows[0]
  if (row.dataset_version !== DATASET_VERSION) {
    throw new Error(`UAT seed run ${runId} belongs to ${row.dataset_version}, not ${DATASET_VERSION}.`)
  }
  return row
}

async function ensureRun(client: Client, runId: string): Promise<SeedRunRow> {
  await client.query(
    `insert into public.uat_seed_runs (dataset_version, run_id, status, notes)
     values ($1, $2, 'PLANNED', $3)
     on conflict (run_id) do nothing`,
    [DATASET_VERSION, runId, JSON.stringify({ datasetVersion: DATASET_VERSION, runId, phaseHistory: [] })],
  )
  return loadRun(client, runId)
}

async function appendPhaseEvent(
  client: Client,
  runId: string,
  phase: NationalUatPhase,
  outcome: PhaseOutcome,
  message?: string,
): Promise<void> {
  const run = await loadRun(client, runId)
  const notes = parseNotes(run.notes, runId)
  notes.phaseHistory.push({ phase, outcome, at: isoNow(), ...(message ? { message } : {}) })
  await client.query(
    `update public.uat_seed_runs set notes = $2, updated_at = now() where run_id = $1`,
    [runId, JSON.stringify(notes)],
  )
}

async function setRunStatus(client: Client, runId: string, status: SeedRunStatus): Promise<void> {
  await client.query(
    `update public.uat_seed_runs set status = $2, updated_at = now() where run_id = $1`,
    [runId, status],
  )
}

async function markRunFailed(
  client: Client,
  runId: string,
  phase: NationalUatPhase,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  try {
    const run = await loadRun(client, runId)
    const notes = parseNotes(run.notes, runId)
    notes.phaseHistory.push({ phase, outcome: 'FAILED', at: isoNow(), message })
    await client.query(
      `update public.uat_seed_runs
       set status = 'FAILED', notes = $2, updated_at = now()
       where run_id = $1`,
      [runId, JSON.stringify(notes)],
    )
  } catch (persistError) {
    console.error(`Could not persist FAILED status for ${runId}:`, persistError)
  }
}

function buildReplacementPlans() {
  const organisation = buildNationalMasterPlan()
  const finance = buildFinanceMasterPlan(organisation)
  const budgets = buildBudgetSeedPlan(organisation, finance)
  const transactions = buildTransactionSeedPlan(organisation, finance, budgets)
  validateReplacementPlans(organisation, finance, budgets, transactions)
  return { organisation, finance, budgets, transactions }
}

async function requirePreflightPassed(client: Client, runId: string): Promise<SeedRunRow> {
  const run = await loadRun(client, runId)
  const notes = parseNotes(run.notes, runId)
  if (!phaseCompleted(notes, 'PREFLIGHT')) throw new Error(`Run ${runId} has not completed PREFLIGHT.`)
  if (!['PREFLIGHT_PASSED', 'FAILED'].includes(run.status)) {
    throw new Error(`Run ${runId} is in status ${run.status}; a preflight-stage run is required.`)
  }
  return run
}

async function requireDryRunPassed(client: Client, runId: string): Promise<SeedRunRow> {
  const run = await loadRun(client, runId)
  const notes = parseNotes(run.notes, runId)
  if (!phaseCompleted(notes, 'PREFLIGHT') || !phaseCompleted(notes, 'DRY_RUN_RESET')) {
    throw new Error(`Run ${runId} must complete PREFLIGHT and DRY_RUN_RESET before destructive reset.`)
  }
  if (phaseCompleted(notes, 'EXECUTE_RESET')) throw new Error(`Run ${runId} has already completed EXECUTE_RESET.`)
  return run
}

export async function requireResetCompletedForSeed(client: Client, runId: string): Promise<SeedRunRow> {
  const run = await loadRun(client, runId)
  const notes = parseNotes(run.notes, runId)
  if (run.status !== 'RESET_COMPLETED' || !phaseCompleted(notes, 'EXECUTE_RESET')) {
    throw new Error(`Refusing --seed for ${runId}: the same run ID must be RESET_COMPLETED first.`)
  }
  return run
}

async function requireSeedCompletedForValidation(client: Client, runId: string): Promise<SeedRunRow> {
  const run = await loadRun(client, runId)
  const notes = parseNotes(run.notes, runId)
  const required: NationalUatPhase[] = [
    'SEED_MASTER',
    'REMAP_USERS',
    'SEED_FINANCE',
    'SEED_BUDGETS_AND_ACTIVATE',
    'SEED_TRANSACTIONS',
  ]
  const missing = required.filter((phase) => !phaseCompleted(notes, phase))
  if (missing.length > 0) throw new Error(`Run ${runId} is missing seed phases: ${missing.join(', ')}`)
  if (!['SEEDING', 'FAILED'].includes(run.status)) {
    throw new Error(`Run ${runId} is in status ${run.status}; completed seeding is required before validation.`)
  }
  return run
}

function assertValidationReportPassed(report: ValidationReport): void {
  const failedPositive = report.positive.filter((result) => !result.passed)
  const failedNegative = report.negative.filter((result) => !result.passed)
  const reconciliationFailures = Object.entries(report.reconciliation)
    .filter(([, value]) => value !== null && value !== 0)
    .map(([key, value]) => `${key}=${value}`)
  if (failedPositive.length > 0 || failedNegative.length > 0 || reconciliationFailures.length > 0) {
    throw new Error(
      `National UAT validation failed: positive=${failedPositive.map((row) => row.id).join(',') || 'none'}; ` +
      `negative=${failedNegative.map((row) => row.id).join(',') || 'none'}; ` +
      `reconciliation=${reconciliationFailures.join(',') || 'none'}`,
    )
  }
  if (report.protectedManifestMatch !== true) throw new Error('National UAT protected-manifest reconciliation did not pass.')
  if (report.counts.usersActual !== 10 || report.counts.activeUsersActual !== 7 || report.counts.archivedUsersActual !== 3) {
    throw new Error('National UAT retained-user count validation did not pass.')
  }
}

export async function persistValidationResults(
  client: Client,
  runId: string,
  report: ValidationReport,
): Promise<void> {
  const run = await loadRun(client, runId)
  const notes = parseNotes(run.notes, runId)
  notes.phaseHistory.push({ phase: 'VALIDATE', outcome: 'COMPLETED', at: isoNow() })
  await client.query(
    `update public.uat_seed_runs
     set status = 'VALIDATING', validation_results = $2::jsonb, notes = $3, updated_at = now()
     where run_id = $1`,
    [runId, JSON.stringify(report), JSON.stringify(notes)],
  )
}

function writeValidationEvidence(runId: string, report: ValidationReport): void {
  mkdirSync(path.dirname(VALIDATION_EVIDENCE_PATH), { recursive: true })
  writeFileSync(
    VALIDATION_EVIDENCE_PATH,
    `${JSON.stringify({ datasetVersion: DATASET_VERSION, runId, generatedAt: isoNow(), validationResults: report }, null, 2)}\n`,
    'utf8',
  )
}

function parseCli(argv: readonly string[]): { mode: CliMode; runId: string } {
  const modes = argv.filter((value): value is CliMode => MODES.includes(value as CliMode))
  if (modes.length !== 1) throw new Error(`Specify exactly one mode: ${MODES.join(' | ')}`)
  const runIdIndex = argv.indexOf('--run-id')
  const runId = runIdIndex >= 0 ? argv[runIdIndex + 1] : runIdFor(new Date())
  if (!runId?.trim()) throw new Error('--run-id requires a non-empty value')
  return { mode: modes[0], runId: runId.trim() }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { mode, runId } = parseCli(argv)
  const client = await connectNjss()
  let currentPhase: NationalUatPhase = 'PREFLIGHT'

  try {
    switch (mode) {
      case '--preflight': {
        const existing = await ensureRun(client, runId)
        if (phaseCompleted(parseNotes(existing.notes, runId), 'EXECUTE_RESET')) {
          throw new Error(`Run ${runId} has already executed reset; use a new --run-id for a new rebuild.`)
        }
        currentPhase = 'PREFLIGHT'
        await appendPhaseEvent(client, runId, 'PREFLIGHT', 'STARTED')
        await assertRetainedUserShape(client)
        const protectedManifest = await captureProtectedManifest(client)
        const preResetCounts = await captureTableCounts(client)
        const foreignKeys = await captureRebuildableForeignKeys(client)
        const plans = buildReplacementPlans()
        const run = await loadRun(client, runId)
        const notes = parseNotes(run.notes, runId)
        notes.phaseHistory.push({
          phase: 'PREFLIGHT',
          outcome: 'COMPLETED',
          at: isoNow(),
          message: `Validated ${plans.organisation.locations.length} Court Locations, ${plans.finance.contexts.length} finance contexts and ${foreignKeys.length} rebuildable FK edges.`,
        })
        await client.query(
          `update public.uat_seed_runs
           set status = 'PREFLIGHT_PASSED', protected_manifest = $2::jsonb,
               pre_reset_counts = $3::jsonb, notes = $4, updated_at = now()
           where run_id = $1`,
          [runId, JSON.stringify(protectedManifest), JSON.stringify(preResetCounts), JSON.stringify(notes)],
        )
        console.log(`PREFLIGHT passed for ${runId}.`)
        break
      }

      case '--dry-run-reset': {
        await requirePreflightPassed(client, runId)
        currentPhase = 'BACKUP'
        await appendPhaseEvent(client, runId, 'BACKUP', 'STARTED')
        currentPhase = 'DRY_RUN_RESET'
        await appendPhaseEvent(client, runId, 'DRY_RUN_RESET', 'STARTED')
        const result = await dryRunReset(client)
        await client.query(
          `update public.uat_seed_runs
           set backup_id = $2, pre_reset_counts = $3::jsonb, updated_at = now()
           where run_id = $1`,
          [runId, result.backup.backupId, JSON.stringify(result.preResetCounts)],
        )
        await appendPhaseEvent(client, runId, 'BACKUP', 'COMPLETED', `Verified FULL backup ${result.backup.backupId}.`)
        await appendPhaseEvent(client, runId, 'DRY_RUN_RESET', 'COMPLETED', `Rollback-only purge validated ${result.purgeOrder.length} tables.`)
        console.log(`DRY_RUN_RESET passed for ${runId}; reset changes were rolled back.`)
        break
      }

      case '--execute-reset': {
        await requireDryRunPassed(client, runId)
        await setRunStatus(client, runId, 'RESET_IN_PROGRESS')
        currentPhase = 'BACKUP'
        await appendPhaseEvent(client, runId, 'BACKUP', 'STARTED', 'Re-verifying backup immediately before destructive reset.')
        currentPhase = 'EXECUTE_RESET'
        await appendPhaseEvent(client, runId, 'EXECUTE_RESET', 'STARTED')
        const result = await executeReset(client, process.argv)
        await appendPhaseEvent(client, runId, 'BACKUP', 'COMPLETED', `Re-verified FULL backup ${result.backup.backupId} before COMMIT.`)
        const run = await loadRun(client, runId)
        const notes = parseNotes(run.notes, runId)
        notes.phaseHistory.push({ phase: 'EXECUTE_RESET', outcome: 'COMPLETED', at: isoNow() })
        await client.query(
          `update public.uat_seed_runs
           set status = 'RESET_COMPLETED', backup_id = $2,
               protected_manifest = $3::jsonb, pre_reset_counts = $4::jsonb,
               post_reset_counts = $5::jsonb, notes = $6, updated_at = now()
           where run_id = $1`,
          [
            runId,
            result.backup.backupId,
            JSON.stringify(result.protectedBefore),
            JSON.stringify(result.preResetCounts),
            JSON.stringify(result.postResetCounts),
            JSON.stringify(notes),
          ],
        )
        console.log(`EXECUTE_RESET committed for ${runId}.`)
        break
      }

      case '--seed': {
        await requireResetCompletedForSeed(client, runId)
        await setRunStatus(client, runId, 'SEEDING')
        await withTransaction(client, async (transaction) => {
          currentPhase = 'SEED_MASTER'
          await appendPhaseEvent(transaction, runId, 'SEED_MASTER', 'STARTED')
          const organisation = await seedNationalOrganisation(transaction, runId)
          await appendPhaseEvent(transaction, runId, 'SEED_MASTER', 'COMPLETED', `${organisation.departments.length} Departments seeded.`)

          currentPhase = 'REMAP_USERS'
          await appendPhaseEvent(transaction, runId, 'REMAP_USERS', 'STARTED')
          await assertRetainedUserShape(transaction)
          await appendPhaseEvent(transaction, runId, 'REMAP_USERS', 'COMPLETED', 'Retained active users remapped by the national organisation seed.')

          currentPhase = 'SEED_FINANCE'
          await appendPhaseEvent(transaction, runId, 'SEED_FINANCE', 'STARTED')
          const finance = await seedFinanceMasters(transaction, runId, organisation)
          await appendPhaseEvent(transaction, runId, 'SEED_FINANCE', 'COMPLETED', `${finance.mappings.length} canonical finance mappings seeded.`)

          currentPhase = 'SEED_BUDGETS_AND_ACTIVATE'
          await appendPhaseEvent(transaction, runId, 'SEED_BUDGETS_AND_ACTIVATE', 'STARTED')
          const budgets = await seedAndActivateNationalBudgets(transaction, runId, organisation, finance)
          await appendPhaseEvent(transaction, runId, 'SEED_BUDGETS_AND_ACTIVATE', 'COMPLETED', `${budgets.submissions.length} FY2026 submissions seeded and activated.`)

          currentPhase = 'SEED_TRANSACTIONS'
          await appendPhaseEvent(transaction, runId, 'SEED_TRANSACTIONS', 'STARTED')
          const transactions = await seedNationalTransactions(transaction, runId, organisation, finance, budgets)
          await appendPhaseEvent(transaction, runId, 'SEED_TRANSACTIONS', 'COMPLETED', `${transactions.ff3.length} FF3 and ${transactions.ff4.length} FF4 scenarios seeded.`)
        })
        console.log(`SEED phases committed for ${runId}.`)
        break
      }

      case '--validate': {
        currentPhase = 'VALIDATE'
        const run = await requireSeedCompletedForValidation(client, runId)
        await appendPhaseEvent(client, runId, 'VALIDATE', 'STARTED')
        const { organisation, finance, budgets, transactions } = buildReplacementPlans()

        await client.query('BEGIN')
        let validationReport: ValidationReport
        try {
          const validationReport = await validateLiveDatabase(client, organisation, finance, budgets, transactions, {
            beforeProtectedManifest: run.protected_manifest,
          })
          await client.query('COMMIT')
          await persistValidationResults(client, runId, validationReport)
          writeValidationEvidence(runId, validationReport)
          assertValidationReportPassed(validationReport)
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined)
          throw error
        }
        console.log(`VALIDATE passed for ${runId}; evidence written to ${VALIDATION_EVIDENCE_PATH}.`)
        break
      }
    }
  } catch (error) {
    await markRunFailed(client, runId, currentPhase, error)
    throw error
  } finally {
    await client.end()
  }
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
