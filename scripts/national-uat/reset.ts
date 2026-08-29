import type { Client } from 'pg'
import {
  PROTECTED_TABLES,
  REBUILDABLE_TABLES,
  MUTABLE_PROTECTED_TABLES,
  captureProtectedManifest,
  assertProtectedManifestEqual,
  captureTableCounts,
  assertRetainedUserShape,
  captureRebuildableForeignKeys,
  assertFreshCompletedBackup,
  probeFullSnapshot,
  type ForeignKeyEdge,
  type ProtectedManifest,
  type TableCounts,
  type VerifiedBackup,
} from './preflight'

export { PROTECTED_TABLES, REBUILDABLE_TABLES, MUTABLE_PROTECTED_TABLES }

export const NULLABLE_CYCLE_DETACHMENTS = [
  { table: 'expense_ledger', column: 'expense_code_registry_id' },
  { table: 'ff3_headers', column: 'selected_quotation_id' },
] as const

const DETACHED_FK_EDGES = new Set([
  'expense_ledger->expense_code_registry',
  'ff3_headers->ff3_quotations',
])

const SCOPED_SECTION_GUARD_TRIGGER = 'trg_users_keep_section_for_scoped_group'

type ResetTransactionHook = (client: Client) => Promise<void>

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`)
  return `"${identifier}"`
}

export function topologicalPurgeOrder(
  tables: readonly string[],
  edges: readonly ForeignKeyEdge[],
): string[] {
  const tableSet = new Set(tables)
  const indegree = new Map<string, number>()
  const parentsByChild = new Map<string, Set<string>>()

  for (const table of tables) {
    indegree.set(table, 0)
    parentsByChild.set(table, new Set())
  }

  for (const edge of edges) {
    if (!tableSet.has(edge.childTable) || !tableSet.has(edge.parentTable)) continue
    if (edge.childTable === edge.parentTable) continue
    const parents = parentsByChild.get(edge.childTable)
    if (!parents || parents.has(edge.parentTable)) continue
    parents.add(edge.parentTable)
    indegree.set(edge.parentTable, (indegree.get(edge.parentTable) ?? 0) + 1)
  }

  const ready = [...tables].filter((table) => (indegree.get(table) ?? 0) === 0).sort()
  const order: string[] = []

  while (ready.length > 0) {
    const table = ready.shift()!
    order.push(table)
    for (const parent of parentsByChild.get(table) ?? []) {
      const next = (indegree.get(parent) ?? 0) - 1
      indegree.set(parent, next)
      if (next === 0) {
        ready.push(parent)
        ready.sort()
      }
    }
  }

  if (order.length !== tableSet.size) {
    const unresolved = [...tableSet].filter((table) => !order.includes(table)).sort()
    throw new Error(`Foreign-key cycle remains in rebuildable purge graph: ${unresolved.join(', ')}`)
  }

  return order
}

export async function buildPurgeOrder(client: Client): Promise<string[]> {
  const edges = (await captureRebuildableForeignKeys(client)).filter((edge) => {
    if (edge.childTable === edge.parentTable) return false
    return !DETACHED_FK_EDGES.has(`${edge.childTable}->${edge.parentTable}`)
  })
  return topologicalPurgeOrder(REBUILDABLE_TABLES, edges)
}

async function setScopedSectionGuard(client: Client, enabled: boolean): Promise<void> {
  const action = enabled ? 'ENABLE TRIGGER' : 'DISABLE TRIGGER'
  await client.query(`ALTER TABLE public.users ${action} ${SCOPED_SECTION_GUARD_TRIGGER}`)
}

async function enableResetMaintenanceContexts(client: Client): Promise<void> {
  // These are the database's existing sanctioned workflow-maintenance contexts.
  // is_local=true confines them to the current reset transaction and prevents
  // approved-budget/revision immutability guards from blocking an authorised purge.
  await client.query(
    `select set_config('njss.budget_workflow', 'on', true),
            set_config('njss.budget_revision_workflow', 'on', true)`,
  )
}

async function detachRetainedUsers(client: Client): Promise<void> {
  await client.query('UPDATE public.users SET department_id = NULL, section_id = NULL WHERE department_id IS NOT NULL OR section_id IS NOT NULL')
}

async function detachNullableCycles(client: Client): Promise<void> {
  for (const detachment of NULLABLE_CYCLE_DETACHMENTS) {
    const table = quoteIdentifier(detachment.table)
    const column = quoteIdentifier(detachment.column)
    await client.query(`UPDATE public.${table} SET ${column} = NULL WHERE ${column} IS NOT NULL`)
  }
}

function assertAllRebuildableCountsZero(counts: TableCounts): void {
  const nonZero = Object.entries(counts)
    .filter(([, count]) => count !== 0)
    .map(([table, count]) => `${table}=${count}`)
  if (nonZero.length > 0) throw new Error(`Reset left rebuildable rows behind: ${nonZero.join(', ')}`)
}

async function assertActiveRetainedUsersMapped(client: Client): Promise<void> {
  const result = await client.query<{ unmapped: string }>(
    `select count(*)::text as unmapped
     from public.users
     where is_active is true
       and archived_at is null
       and (department_id is null or section_id is null)`,
  )
  const unmapped = Number(result.rows[0]?.unmapped ?? '0')
  if (unmapped !== 0) {
    throw new Error(`Atomic retained-user remap left ${unmapped} active user(s) without Department/Section assignment`)
  }
}

async function deleteRebuildableRows(client: Client, order: readonly string[]): Promise<void> {
  for (const table of order) {
    if (!(REBUILDABLE_TABLES as readonly string[]).includes(table)) {
      throw new Error(`Refusing delete outside rebuild allowlist: public.${table}`)
    }
    const quoted = quoteIdentifier(table)
    await client.query(`DELETE FROM public.${quoted}`)
  }
}

type ResetCoreResult = {
  purgeOrder: string[]
  preResetCounts: TableCounts
  postResetCounts: TableCounts
  protectedBefore: ProtectedManifest
  protectedAfter: ProtectedManifest
}

async function runResetCore(
  client: Client,
  afterResetBeforeCommit?: ResetTransactionHook,
): Promise<ResetCoreResult> {
  await assertRetainedUserShape(client)
  const protectedBefore = await captureProtectedManifest(client)
  const preResetCounts = await captureTableCounts(client)
  const purgeOrder = await buildPurgeOrder(client)
  let scopedGuardDisabled = false

  try {
    await enableResetMaintenanceContexts(client)

    // The scoped-role guard correctly prevents Requisition Officers and Line Supervisors
    // from being committed without a Section. During a national organisational replacement,
    // the old Section FKs must be detached before those Section rows can be deleted. The guard
    // is therefore suspended only inside this reset transaction and restored before COMMIT.
    await setScopedSectionGuard(client, false)
    scopedGuardDisabled = true

    await detachRetainedUsers(client)
    await detachNullableCycles(client)
    await deleteRebuildableRows(client, purgeOrder)

    const postResetCounts = await captureTableCounts(client)
    assertAllRebuildableCountsZero(postResetCounts)
    await assertRetainedUserShape(client)

    if (afterResetBeforeCommit) {
      await afterResetBeforeCommit(client)
      await assertRetainedUserShape(client)
      await assertActiveRetainedUsersMapped(client)
    }

    await setScopedSectionGuard(client, true)
    scopedGuardDisabled = false

    const protectedAfter = await captureProtectedManifest(client)
    await assertProtectedManifestEqual(protectedBefore, protectedAfter)

    return { purgeOrder, preResetCounts, postResetCounts, protectedBefore, protectedAfter }
  } finally {
    if (scopedGuardDisabled) {
      // If a SQL statement has already aborted the transaction this may fail; the caller's
      // ROLLBACK still restores the transactional ALTER TABLE automatically.
      await setScopedSectionGuard(client, true).catch(() => undefined)
    }
  }
}

export type ResetResult = ResetCoreResult & {
  mode: 'DRY_RUN' | 'COMMITTED'
  backup: VerifiedBackup
  snapshotProbe: { tableCount: number; totalRecords: number }
}

async function verifyBackupGates(client: Client): Promise<{
  backup: VerifiedBackup
  snapshotProbe: { tableCount: number; totalRecords: number }
}> {
  const backup = await assertFreshCompletedBackup(client)
  // This function probe independently proves the established logical snapshot mechanism
  // is still able to enumerate the current database before the reset transaction begins.
  const snapshotProbe = await probeFullSnapshot(client) // public.njss_backup_full_snapshot
  return { backup, snapshotProbe }
}

export async function dryRunReset(
  client: Client,
  afterResetBeforeRollback?: ResetTransactionHook,
): Promise<ResetResult> {
  const { backup, snapshotProbe } = await verifyBackupGates(client)
  await client.query('BEGIN')
  try {
    const result = await runResetCore(client, afterResetBeforeRollback)
    await client.query('ROLLBACK')
    return { ...result, mode: 'DRY_RUN', backup, snapshotProbe }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

export function assertExecuteResetFlag(argv: readonly string[] = process.argv): void {
  if (!argv.includes('--execute-reset')) {
    throw new Error('Refusing destructive reset: the explicit --execute-reset flag is required')
  }
}

export async function executeReset(
  client: Client,
  argv: readonly string[] = process.argv,
  afterResetBeforeCommit?: ResetTransactionHook,
): Promise<ResetResult> {
  assertExecuteResetFlag(argv)
  if (!afterResetBeforeCommit) {
    throw new Error('Refusing committed reset without an atomic retained-user remap')
  }
  const { backup, snapshotProbe } = await verifyBackupGates(client)

  await client.query('BEGIN')
  try {
    const result = await runResetCore(client, afterResetBeforeCommit)
    await client.query('COMMIT')
    return { ...result, mode: 'COMMITTED', backup, snapshotProbe }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}
