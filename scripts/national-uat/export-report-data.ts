import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Client } from 'pg'
import { ECONOMIC_CLASSES, FINANCE_CODES } from './catalog/finance'
import { COURT_LOCATIONS, PROVINCES } from './catalog/organisation'
import { DATASET_VERSION, runIdFor } from './constants'
import { connectNjss } from './db'
import { RETAINED_USER_ASSIGNMENTS } from './seed-master'

type PhaseEvent = {
  phase: string
  outcome: 'STARTED' | 'COMPLETED' | 'FAILED'
  at: string
  message?: string
}

type RunNotes = {
  datasetVersion: string
  runId: string
  phaseHistory: PhaseEvent[]
}

type RunMetadata = {
  id: string
  dataset_version: string
  run_id: string
  status: string
  backup_id: string | null
  protected_manifest: unknown
  pre_reset_counts: unknown
  post_reset_counts: unknown
  validation_results: Record<string, unknown>
  notes: string | null
  started_at: Date
  completed_at: Date | null
  created_at: Date
  updated_at: Date
}

const COUNT_TABLES = [
  'provinces',
  'court_locations',
  'departments',
  'sections',
  'cost_centres',
  'budget_divisions',
  'finance_posting_mappings',
  'divisional_budget_submissions',
  'divisional_budget_lines',
  'budget_monthly_allocations',
  'funding_sources',
  'suppliers',
  'ff3_headers',
  'ff4_headers',
  'budget_revisions',
] as const

function isoNow(): string {
  return new Date().toISOString()
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe SQL identifier ${identifier}`)
  return `"${identifier}"`
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

async function loadRunMetadata(client: Client, runId: string): Promise<RunMetadata> {
  const result = await client.query<RunMetadata>(
    `select id, dataset_version, run_id, status, backup_id, protected_manifest,
            pre_reset_counts, post_reset_counts, validation_results, notes,
            started_at, completed_at, created_at, updated_at
     from public.uat_seed_runs
     where run_id = $1`,
    [runId],
  )
  if (result.rowCount !== 1) throw new Error(`UAT seed run ${runId} does not exist`)
  const run = result.rows[0]
  if (run.dataset_version !== DATASET_VERSION) throw new Error(`Run ${runId} is not a ${DATASET_VERSION} run`)
  const notes = parseNotes(run.notes, runId)
  const validationComplete = notes.phaseHistory.some((event) => event.phase === 'VALIDATE' && event.outcome === 'COMPLETED')
  if (!validationComplete || !['VALIDATING', 'COMPLETED', 'FAILED'].includes(run.status)) {
    throw new Error(`Run ${runId} has not completed validation and cannot be exported`)
  }
  return run
}

async function loadBackup(client: Client, backupId: string | null) {
  if (!backupId) return null
  const result = await client.query(
    `select backup_id, backup_type, status, created_at, file_name,
            file_size_bytes, sha256, table_count, record_count
     from public.system_backup_registry
     where backup_id = $1`,
    [backupId],
  )
  return result.rows[0] ?? null
}

async function loadCounts(client: Client): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of COUNT_TABLES) {
    const result = await client.query<{ count: string }>(
      `select count(*)::text as count from public.${quoteIdentifier(table)}`,
    )
    counts[table] = Number(result.rows[0]?.count ?? 0)
  }
  return counts
}

async function loadUserMapping(client: Client) {
  const result = await client.query(`
    select
      u.id as user_id,
      u.full_name,
      u.email,
      u.is_active,
      u.archived_at,
      d.code as department_code,
      d.name as department_name,
      s.code as section_code,
      s.name as section_name,
      cl.code as court_location_code,
      cl.name as court_location_name,
      p.code as province_code,
      p.name as province_name
    from public.users u
    left join public.departments d on d.id = u.department_id
    left join public.sections s on s.id = u.section_id
    left join public.court_locations cl on cl.id = d.court_location_id
    left join public.provinces p on p.id = cl.province_id
    order by u.is_active desc, u.full_name, u.email
  `)
  return result.rows
}

async function loadProvenance(client: Client, runId: string) {
  const [entities, summary] = await Promise.all([
    client.query(
      `select table_name, entity_id, business_code, provenance, source_reference, created_at
       from public.uat_seed_entities
       where run_id = $1
       order by table_name, business_code nulls last, entity_id`,
      [runId],
    ),
    client.query<{ provenance: string; count: string }>(
      `select provenance, count(*)::text as count
       from public.uat_seed_entities
       where run_id = $1
       group by provenance
       order by provenance`,
      [runId],
    ),
  ])
  return {
    summary: Object.fromEntries(summary.rows.map((row) => [row.provenance, Number(row.count)])),
    entities: entities.rows,
  }
}

function financialTotalsFrom(validationResults: Record<string, unknown>): unknown {
  return validationResults.financialTotals ?? {}
}

export async function buildReportData(client: Client, runId: string) {
  const runMetadata = await loadRunMetadata(client, runId)
  const [backup, counts, userMapping, provenance] = await Promise.all([
    loadBackup(client, runMetadata.backup_id),
    loadCounts(client),
    loadUserMapping(client),
    loadProvenance(client, runId),
  ])
  const validationResults = runMetadata.validation_results ?? {}

  return {
    datasetVersion: DATASET_VERSION,
    generatedAt: isoNow(),
    runMetadata,
    backup,
    counts,
    financialTotals: financialTotalsFrom(validationResults),
    userMapping,
    provenance,
    validationResults,
    sourceCatalogue: {
      provinces: PROVINCES,
      courtLocations: COURT_LOCATIONS,
      economicClasses: ECONOMIC_CLASSES,
      financeCodes: FINANCE_CODES,
      retainedUserAssignmentPlan: RETAINED_USER_ASSIGNMENTS,
      classificationNote: 'OFFICIAL records are source-supported public catalogue facts. DERIVED and UAT records are test structures. Synthetic financial codes and values are not official IFMS codes or Judiciary appropriations.',
    },
  }
}

async function markExportComplete(client: Client, runId: string): Promise<void> {
  const run = await loadRunMetadata(client, runId)
  const notes = parseNotes(run.notes, runId)
  const at = isoNow()
  notes.phaseHistory.push({ phase: 'EXPORT_REPORT_DATA', outcome: 'COMPLETED', at })
  notes.phaseHistory.push({ phase: 'COMPLETE', outcome: 'COMPLETED', at })
  await client.query(
    `update public.uat_seed_runs
     set status = 'COMPLETED', completed_at = now(), notes = $2, updated_at = now()
     where run_id = $1`,
    [runId, JSON.stringify(notes)],
  )
}

async function markExportFailed(client: Client, runId: string, error: unknown): Promise<void> {
  try {
    const run = await loadRunMetadata(client, runId)
    const notes = parseNotes(run.notes, runId)
    notes.phaseHistory.push({
      phase: 'EXPORT_REPORT_DATA',
      outcome: 'FAILED',
      at: isoNow(),
      message: error instanceof Error ? error.message : String(error),
    })
    await client.query(
      `update public.uat_seed_runs
       set status = 'FAILED', notes = $2, updated_at = now()
       where run_id = $1`,
      [runId, JSON.stringify(notes)],
    )
  } catch (persistError) {
    console.error(`Could not persist export failure for ${runId}:`, persistError)
  }
}

function parseCli(argv: readonly string[]): { output: string; runId: string } {
  const outputIndex = argv.indexOf('--output')
  const output = outputIndex >= 0 ? argv[outputIndex + 1] : ''
  if (!output?.trim()) throw new Error('--output requires a destination JSON path')
  const runIdIndex = argv.indexOf('--run-id')
  const runId = runIdIndex >= 0 ? argv[runIdIndex + 1] : runIdFor(new Date())
  if (!runId?.trim()) throw new Error('--run-id requires a non-empty value')
  return { output: path.resolve(output), runId: runId.trim() }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { output, runId } = parseCli(argv)
  const client = await connectNjss()
  const temporaryOutput = `${output}.tmp`

  try {
    const initial = await buildReportData(client, runId)
    mkdirSync(path.dirname(output), { recursive: true })
    writeFileSync(temporaryOutput, `${JSON.stringify(initial, null, 2)}\n`, 'utf8')

    await markExportComplete(client, runId)
    const finalReport = await buildReportData(client, runId)
    writeFileSync(temporaryOutput, `${JSON.stringify(finalReport, null, 2)}\n`, 'utf8')
    renameSync(temporaryOutput, output)
    console.log(`National UAT report evidence exported to ${output}.`)
  } catch (error) {
    rmSync(temporaryOutput, { force: true })
    await markExportFailed(client, runId, error)
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
