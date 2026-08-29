import type { Client } from 'pg'

export const PROTECTED_TABLES = [
  'users',
  'roles',
  'user_roles',
  'permissions',
  'role_permissions',
  'modules',
  'menu_items',
  'workflow_statuses',
  'report_categories',
  'report_definitions',
  'system_settings',
  'system_alert_settings',
  'system_backup_registry',
  'system_backup_change_log',
  'audit_logs',
  'rbac_data_scope_types',
  'role_data_scopes',
  'user_data_scopes',
  'user_permissions',
] as const

export const MUTABLE_PROTECTED_TABLES = new Set<string>([
  'system_backup_registry',
  'system_backup_change_log',
])

export const REBUILDABLE_TABLES = [
  'budget_activation_line_snapshots',
  'budget_activation_lines',
  'budget_activation_batches',
  'budget_release_funding_lines',
  'budget_revision_lines',
  'budget_revisions',
  'budget_workflow_history',
  'budget_line_attachments',
  'budget_monthly_allocations',
  'budget_import_staging',
  'budget_import_batches',
  'budget_consolidations',
  'commitment_transactions',
  'payment_transactions',
  'ff4_approvals',
  'ff4_attachments',
  'ff4_headers',
  'ff3_approvals',
  'ff3_attachments',
  'ff3_items',
  'ff3_quotations',
  'ff3_commitments',
  'ff3_headers',
  'quarterly_releases',
  'funding_allocations',
  'funding_receipts',
  'funding_authorities',
  'budget_allocations',
  'budget_division_ceilings',
  'budget_periods',
  'divisional_budget_lines',
  'divisional_budget_submissions',
  'annual_plan_lines',
  'annual_plan_headers',
  'supplier_category_assignments',
  'supplier_contacts',
  'supplier_documents',
  'supplier_followups',
  'supplier_status_history',
  'supplier_legacy_candidates',
  'suppliers',
  'supplier_document_requirements',
  'supplier_categories',
  'documents',
  'notifications',
  'finance_posting_mappings',
  'expense_code_registry',
  'expense_ledger',
  'category_expense_item_mappings',
  'expense_items',
  'expense_categories',
  'chart_of_accounts',
  'budget_reference_values',
  'budget_activity_templates',
  'activity_templates',
  'budget_expense_categories',
  'budget_classes',
  'budget_cycles',
  'budget_divisions',
  'cost_centres',
  'sections',
  'departments',
  'court_locations',
  'projects',
  'funding_sources',
  'financial_years',
  'payee_types',
  'payment_methods',
  'priority_levels',
  'procurement_methods',
  'units_of_measure',
  'urgency_levels',
  'provinces',
] as const

export type ManifestEntry = {
  count: number
  digest: string
}

export type ProtectedManifest = Record<string, ManifestEntry>
export type TableCounts = Record<string, number>

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`)
  return `"${identifier}"`
}

async function tableExists(client: Client, table: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `select exists (
       select 1
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1 and c.relkind in ('r','p')
     ) as exists`,
    [table],
  )
  return result.rows[0]?.exists === true
}

async function manifestForTable(client: Client, table: string): Promise<ManifestEntry> {
  const quoted = quoteIdentifier(table)
  const rowExpression = table === 'users'
    ? `jsonb_build_object(
        'id', id,
        'auth_user_id', auth_user_id,
        'employee_id', employee_id,
        'full_name', full_name,
        'email', email,
        'phone', phone,
        'position', position,
        'is_active', is_active,
        'must_change_password', must_change_password,
        'password_set_at', password_set_at,
        'password_changed_at', password_changed_at,
        'last_login_at', last_login_at,
        'invited_at', invited_at,
        'is_protected', is_protected,
        'archived_at', archived_at,
        'archived_by', archived_by,
        'archive_reason', archive_reason,
        'created_at', created_at
      )::text`
    : 'to_jsonb(t)::text'

  const sql = `
    select count(*)::int as count,
           coalesce(md5(string_agg(row_text, '' order by row_text)), md5('')) as digest
    from (
      select ${rowExpression} as row_text
      from public.${quoted} t
    ) rows
  `
  const result = await client.query<{ count: number; digest: string }>(sql)
  return { count: Number(result.rows[0]?.count ?? 0), digest: result.rows[0]?.digest ?? '' }
}

export async function captureProtectedManifest(client: Client): Promise<ProtectedManifest> {
  const manifest: ProtectedManifest = {}
  for (const table of PROTECTED_TABLES) {
    if (!(await tableExists(client, table))) throw new Error(`Protected table public.${table} is missing`)
    manifest[table] = await manifestForTable(client, table)
  }
  return manifest
}

export async function assertProtectedManifestEqual(
  before: ProtectedManifest,
  after: ProtectedManifest,
): Promise<void> {
  for (const table of PROTECTED_TABLES) {
    if (MUTABLE_PROTECTED_TABLES.has(table)) continue
    const left = before[table]
    const right = after[table]
    if (!left || !right || left.count !== right.count || left.digest !== right.digest) {
      throw new Error(`Protected table public.${table} changed during reset dry-run`) 
    }
  }
}

export async function captureTableCounts(
  client: Client,
  tables: readonly string[] = REBUILDABLE_TABLES,
): Promise<TableCounts> {
  const counts: TableCounts = {}
  for (const table of tables) {
    if (!(await tableExists(client, table))) throw new Error(`Required rebuildable table public.${table} is missing`)
    const quoted = quoteIdentifier(table)
    const result = await client.query<{ count: string }>(`select count(*)::text as count from public.${quoted}`)
    counts[table] = Number(result.rows[0]?.count ?? 0)
  }
  return counts
}

export async function assertRetainedUserShape(client: Client): Promise<void> {
  const result = await client.query<{
    total: string
    active: string
    archived: string
  }>(`
    select
      count(*)::text as total,
      count(*) filter (where is_active is true and archived_at is null)::text as active,
      count(*) filter (where archived_at is not null)::text as archived
    from public.users
  `)

  const row = result.rows[0]
  if (!row || Number(row.total) !== 10 || Number(row.active) !== 7 || Number(row.archived) !== 3) {
    throw new Error(
      `Retained-user preflight failed: expected 10 total / 7 active / 3 archived; got ${row?.total ?? '?'} / ${row?.active ?? '?'} / ${row?.archived ?? '?'}`,
    )
  }
}

export type ForeignKeyEdge = { childTable: string; parentTable: string }

export async function captureRebuildableForeignKeys(client: Client): Promise<ForeignKeyEdge[]> {
  const result = await client.query<{ child_table: string; parent_table: string }>(`
    select child.relname as child_table, parent.relname as parent_table
    from pg_constraint con
    join pg_class child on child.oid = con.conrelid
    join pg_namespace n on n.oid = child.relnamespace
    join pg_class parent on parent.oid = con.confrelid
    where con.contype = 'f'
      and n.nspname = 'public'
      and child.relname = any($1::text[])
      and parent.relname = any($1::text[])
    order by child.relname, parent.relname, con.conname
  `, [REBUILDABLE_TABLES])

  return result.rows.map((row) => ({ childTable: row.child_table, parentTable: row.parent_table }))
}

export type VerifiedBackup = {
  backupId: string
  createdAt: string
  fileName: string
  fileSizeBytes: number
  sha256: string
  tableCount: number
  recordCount: number
}

export async function assertFreshCompletedBackup(client: Client, maxAgeMinutes = 120): Promise<VerifiedBackup> {
  const result = await client.query<{
    backup_id: string
    created_at: Date
    file_name: string | null
    file_size_bytes: string | null
    sha256: string | null
    table_count: number | null
    record_count: string | null
  }>(`
    select backup_id, created_at, file_name, file_size_bytes::text, sha256, table_count, record_count::text
    from public.system_backup_registry
    where backup_type = 'FULL'
      and status = 'COMPLETED'
      and created_at >= now() - ($1::text || ' minutes')::interval
      and file_name is not null
      and coalesce(file_size_bytes, 0) > 0
      and sha256 is not null
      and coalesce(table_count, 0) > 0
      and coalesce(record_count, 0) > 0
    order by created_at desc
    limit 1
  `, [String(maxAgeMinutes)])

  const row = result.rows[0]
  if (!row || !row.file_name || !row.sha256) {
    throw new Error(`No verified completed FULL backup exists within the last ${maxAgeMinutes} minutes`)
  }

  return {
    backupId: row.backup_id,
    createdAt: row.created_at.toISOString(),
    fileName: row.file_name,
    fileSizeBytes: Number(row.file_size_bytes ?? 0),
    sha256: row.sha256,
    tableCount: Number(row.table_count ?? 0),
    recordCount: Number(row.record_count ?? 0),
  }
}

export async function probeFullSnapshot(client: Client): Promise<{ tableCount: number; totalRecords: number }> {
  const result = await client.query<{ table_count: string; total_records: string }>(`
    select
      (snapshot->>'tableCount')::text as table_count,
      (snapshot->>'totalRecords')::text as total_records
    from (select public.njss_backup_full_snapshot() as snapshot) s
  `)
  const row = result.rows[0]
  const tableCount = Number(row?.table_count ?? 0)
  const totalRecords = Number(row?.total_records ?? 0)
  if (tableCount <= 0 || totalRecords <= 0) throw new Error('njss_backup_full_snapshot returned an invalid empty snapshot')
  return { tableCount, totalRecords }
}
