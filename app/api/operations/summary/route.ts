import { NextResponse, type NextRequest } from 'next/server'
import packageJson from '@/package.json'
import { createRequestSupabaseClient, requirePermission } from '@/lib/rbac/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { loadLiveProviderCosts, type LiveCostProviderResult } from '@/lib/operations/live-costs'

const ADMIN_PERMISSIONS = ['dashboard.view', 'operations.view', 'operations.manage', 'settings.manage', 'users.manage', 'audit.view', 'all']
const PENDING_FF3 = ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD', 'RETURNED']
const PENDING_FF4 = ['SUBMITTED', 'VERIFIED', 'APPROVED', 'PROCESSED']

type CountResult = { count: number | null; error: { message: string } | null }
type CountQuery = PromiseLike<CountResult> & {
  gte: (column: string, value: unknown) => CountQuery
  lt: (column: string, value: unknown) => CountQuery
  eq: (column: string, value: unknown) => CountQuery
  in: (column: string, value: unknown[]) => CountQuery
  or: (filters: string) => CountQuery
  is: (column: string, value: unknown) => CountQuery
}
type StorageObjectRow = { bucket_id: string | null; name: string | null; metadata: Record<string, unknown> | null; created_at: string | null }
type AlertSetting = { code: string; label: string; threshold_value: number | null; enabled: boolean; notes: string | null }

function monthStart(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function previousMonthStart() {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return monthStart(d)
}

function daysAgo(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

function firstDayOfThisMonthIso() {
  return new Date(monthStart()).toISOString()
}

function safeProjectRef() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    if (!url) return null
    return new URL(url).hostname.split('.')[0] || null
  } catch {
    return null
  }
}

function numberFromMetadata(metadata: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value)
  }
  return 0
}

function parseCurrencyRates(baseCurrency: string) {
  const rates: Record<string, number> = { [baseCurrency]: 1 }
  const raw = process.env.OPERATIONS_CURRENCY_RATES?.trim()
  if (!raw) return rates
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const [currency, value] of Object.entries(parsed)) {
      const rate = Number(value)
      if (currency && Number.isFinite(rate) && rate > 0) rates[currency.toUpperCase()] = rate
    }
  } catch {
    // Invalid conversion configuration should not break the dashboard.
  }
  return rates
}

function convertToBaseOrNull(amount: number | null | undefined, currency: string | null | undefined, rates: Record<string, number>, baseCurrency: string) {
  if (amount === null || amount === undefined) return null
  const normalized = (currency || baseCurrency).toUpperCase()
  const rate = rates[normalized]
  if (!rate) return null
  return amount * rate
}

function sumKnownProviderCosts(providers: LiveCostProviderResult[], selector: 'currentMonthCost' | 'previousMonthCost', rates: Record<string, number>, baseCurrency: string) {
  let total = 0
  let known = 0
  for (const provider of providers) {
    const converted = convertToBaseOrNull(provider[selector], provider.currency, rates, baseCurrency)
    if (converted !== null) {
      total += converted
      known += 1
    }
  }
  return { total: known > 0 ? total : null, known }
}

function projectedMonthEndCost(currentCost: number | null, now = new Date()) {
  if (currentCost === null) return null
  const elapsed = Math.max(1, now.getDate())
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return (currentCost / elapsed) * daysInMonth
}

async function count(query: PromiseLike<CountResult>) {
  const result = await query
  if (result.error) return null
  return result.count || 0
}

async function safeTableCount(supabase: ReturnType<typeof createServerSupabaseClient>, table: string, apply?: (q: CountQuery) => CountQuery) {
  try {
    let query = supabase.from(table).select('*', { count: 'exact', head: true }) as unknown as CountQuery
    if (apply) query = apply(query)
    return await count(query)
  } catch {
    return null
  }
}

async function loadDbStats(request: NextRequest) {
  try {
    const response = NextResponse.next()
    const userSupabase = createRequestSupabaseClient(request, response)
    const { data, error } = await userSupabase.rpc('fn_system_admin_database_stats')
    if (error) return null
    return data as { database_size_bytes?: number; table_stats?: Array<Record<string, unknown>>; latest_migration?: string | null } | null
  } catch {
    return null
  }
}

async function loadSetting(supabase: ReturnType<typeof createServerSupabaseClient>, key: string) {
  try {
    const { data } = await supabase.from('system_settings').select('setting_value').eq('setting_key', key).maybeSingle()
    return (data?.setting_value || null) as Record<string, unknown> | null
  } catch {
    return null
  }
}

async function loadStorage(supabase: ReturnType<typeof createServerSupabaseClient>) {
  try {
    const bucketsResult = await supabase.storage.listBuckets()
    const buckets = bucketsResult.data || []
    const { data: objects } = await supabase
      .schema('storage')
      .from('objects')
      .select('bucket_id, name, metadata, created_at')
      .limit(10000)

    const rows = (objects || []) as StorageObjectRow[]
    const byBucket = new Map<string, { bucket: string; fileCount: number; sizeBytes: number; newestFileAt: string | null }>()
    for (const bucket of buckets) byBucket.set(bucket.name, { bucket: bucket.name, fileCount: 0, sizeBytes: 0, newestFileAt: null })
    for (const row of rows) {
      const bucket = row.bucket_id || 'Uncategorised'
      const current = byBucket.get(bucket) || { bucket, fileCount: 0, sizeBytes: 0, newestFileAt: null }
      current.fileCount += 1
      current.sizeBytes += numberFromMetadata(row.metadata, ['size', 'contentLength', 'content-length'])
      if (row.created_at && (!current.newestFileAt || new Date(row.created_at) > new Date(current.newestFileAt))) current.newestFileAt = row.created_at
      byBucket.set(bucket, current)
    }

    const totalSizeBytes = Array.from(byBucket.values()).reduce((sum, bucket) => sum + bucket.sizeBytes, 0)
    const fileCount = Array.from(byBucket.values()).reduce((sum, bucket) => sum + bucket.fileCount, 0)
    const last30SizeBytes = rows
      .filter((row) => row.created_at && new Date(row.created_at) >= new Date(daysAgo(30)))
      .reduce((sum, row) => sum + numberFromMetadata(row.metadata, ['size', 'contentLength', 'content-length']), 0)

    return {
      connected: !bucketsResult.error,
      totalSizeBytes,
      fileCount,
      last30SizeBytes,
      buckets: Array.from(byBucket.values()).sort((a, b) => b.sizeBytes - a.sizeBytes),
      error: bucketsResult.error?.message || null,
    }
  } catch (error) {
    return {
      connected: false,
      totalSizeBytes: null,
      fileCount: null,
      last30SizeBytes: null,
      buckets: [],
      error: error instanceof Error ? error.message : 'Storage metrics unavailable',
    }
  }
}

async function recordProviderSyncSnapshot(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  provider: LiveCostProviderResult,
  baseCurrency: string,
  rates: Record<string, number>,
  context: { userId?: string | null; email?: string | null },
) {
  try {
    const startedAt = new Date().toISOString()
    const baseAmount = convertToBaseOrNull(provider.currentMonthCost, provider.currency, rates, baseCurrency)
    const exchangeRate = provider.currentMonthCost && baseAmount !== null ? baseAmount / provider.currentMonthCost : null
    const { error } = await supabase.from('operations_cost_provider_snapshots').insert({
      provider_id: provider.id,
      provider_name: provider.name,
      service_name: provider.provider,
      cost_category: provider.category,
      billing_period: provider.billingPeriod,
      usage_label: provider.usageLabel,
      usage_value: provider.usageValue === null || provider.usageValue === undefined ? null : String(provider.usageValue),
      usage_unit: provider.usageUnit,
      native_currency: provider.currency,
      native_amount: provider.currentMonthCost,
      base_currency: baseCurrency,
      base_amount: baseAmount,
      exchange_rate: exchangeRate,
      exchange_rate_source: exchangeRate ? 'OPERATIONS_CURRENCY_RATES' : null,
      exchange_rate_checked_at: exchangeRate ? new Date().toISOString() : null,
      api_status: provider.status,
      billing_status: provider.currentMonthCost === null ? 'BILLING_DATA_UNAVAILABLE' : 'API_REPORTED',
      data_source: provider.source,
      estimated: provider.source !== 'provider_api' && provider.source !== 'configured_endpoint',
      last_synchronised_at: provider.lastCheckedAt,
      raw_metadata: { notes: provider.notes, dashboardUrl: provider.dashboardUrl },
    })
    await supabase.from('operations_provider_sync_logs').insert({
      provider_id: provider.id,
      provider_name: provider.name,
      api_service: provider.source,
      sync_started_at: startedAt,
      sync_completed_at: new Date().toISOString(),
      records_retrieved: provider.currentMonthCost === null ? 0 : 1,
      billing_period: provider.billingPeriod,
      success: provider.status === 'connected' || provider.status === 'partial',
      error_message: provider.status === 'unavailable' ? provider.notes : null,
      initiated_by: context.userId || null,
      initiated_by_email: context.email || null,
    })
    if (error) throw error
  } catch {
    // Snapshot/audit persistence must not break the operations dashboard response.
  }
}

function buildAlerts(input: {
  settings: AlertSetting[]
  storagePercent: number | null
  dbGrowthPercent: number | null
  backupStatus: string | null
  recentErrorCount: number
  currentCost: number
  averageCost: number
  inactivePrivilegedUsers: number
  liveProviderCosts: LiveCostProviderResult[]
}) {
  const setting = (code: string, fallback: number | null, enabled = true) => {
    const row = input.settings.find((s) => s.code === code)
    return { enabled: row?.enabled ?? enabled, threshold: row?.threshold_value ?? fallback, label: row?.label || code }
  }
  const alerts: Array<{ code: string; severity: 'info' | 'warning' | 'critical'; title: string; detail: string }> = []
  const storage70 = setting('storage_warning_70', 70)
  const storage85 = setting('storage_critical_85', 85)
  if (input.storagePercent !== null && storage85.enabled && storage85.threshold !== null && input.storagePercent >= storage85.threshold) {
    alerts.push({ code: 'storage_critical_85', severity: 'critical', title: 'Storage usage is high', detail: `Storage usage is approximately ${input.storagePercent.toFixed(1)}%.` })
  } else if (input.storagePercent !== null && storage70.enabled && storage70.threshold !== null && input.storagePercent >= storage70.threshold) {
    alerts.push({ code: 'storage_warning_70', severity: 'warning', title: 'Storage usage is approaching capacity', detail: `Storage usage is approximately ${input.storagePercent.toFixed(1)}%.` })
  }

  const dbGrowth = setting('database_growth_threshold', 20)
  if (input.dbGrowthPercent !== null && dbGrowth.enabled && dbGrowth.threshold !== null && input.dbGrowthPercent > dbGrowth.threshold) {
    alerts.push({ code: 'database_growth_threshold', severity: 'warning', title: 'Database growth exceeds threshold', detail: `Database growth is ${input.dbGrowthPercent.toFixed(1)}% for the configured period.` })
  }

  const backup = setting('backup_not_confirmed', null)
  if (backup.enabled && input.backupStatus && input.backupStatus !== 'CONFIRMED') {
    alerts.push({ code: 'backup_not_confirmed', severity: 'warning', title: 'Backup not confirmed', detail: `Current backup status is ${input.backupStatus}.` })
  }

  const errors = setting('abnormal_error_activity', 10)
  if (errors.enabled && errors.threshold !== null && input.recentErrorCount > errors.threshold) {
    alerts.push({ code: 'abnormal_error_activity', severity: 'warning', title: 'Abnormal error activity', detail: `${input.recentErrorCount} recent error or access-denied events were found.` })
  }

  const highCost = setting('high_monthly_cost', null)
  const costThreshold = highCost.threshold || (input.averageCost > 0 ? input.averageCost * 1.5 : null)
  if (highCost.enabled && costThreshold !== null && input.currentCost > costThreshold) {
    alerts.push({ code: 'high_monthly_cost', severity: 'warning', title: 'Monthly operating cost is unusually high', detail: `Current monthly cost is above the configured threshold.` })
  }

  const inactivePrivileged = setting('inactive_privileged_account', 1)
  if (inactivePrivileged.enabled && inactivePrivileged.threshold !== null && input.inactivePrivilegedUsers >= inactivePrivileged.threshold) {
    alerts.push({ code: 'inactive_privileged_account', severity: 'critical', title: 'Inactive privileged account requires review', detail: `${input.inactivePrivilegedUsers} privileged account(s) appear inactive for 30+ days.` })
  }

  const liveUnavailable = setting('live_cost_provider_unavailable', 1)
  const unavailableProviders = input.liveProviderCosts.filter((provider) => provider.status === 'unavailable')
  if (liveUnavailable.enabled && unavailableProviders.length > 0) {
    alerts.push({ code: 'live_cost_provider_unavailable', severity: 'warning', title: 'Provider billing API unavailable', detail: `${unavailableProviders.map((provider) => provider.name).join(', ')} could not be reached.` })
  }

  const liveNotConfigured = setting('live_cost_provider_not_configured', 1)
  const notConfiguredProviders = input.liveProviderCosts.filter((provider) => provider.status === 'not_configured')
  if (liveNotConfigured.enabled && notConfiguredProviders.length > 0) {
    alerts.push({ code: 'live_cost_provider_not_configured', severity: 'info', title: 'Provider billing API not configured', detail: `${notConfiguredProviders.map((provider) => provider.name).join(', ')} need server-side connector configuration before provider costs can be displayed.` })
  }

  const liveCostChange = setting('live_cost_monthly_change_threshold', 25)
  const changedProviders = input.liveProviderCosts.filter((provider) => typeof provider.percentageChange === 'number' && liveCostChange.threshold !== null && Math.abs(provider.percentageChange) > liveCostChange.threshold)
  if (liveCostChange.enabled && changedProviders.length > 0) {
    alerts.push({ code: 'live_cost_monthly_change_threshold', severity: 'warning', title: 'Provider API cost changed materially', detail: `${changedProviders.map((provider) => provider.name).join(', ')} exceeded the configured month-on-month cost threshold.` })
  }

  return alerts
}

function limitedSummary(now = new Date(), error: string | null = null) {
  return NextResponse.json({
    generatedAt: now.toISOString(),
    health: {
      applicationStatus: error ? 'Limited Operations View' : 'Operational',
      databaseConnectivity: error ? 'Limited' : 'Connected',
      storageConnectivity: 'Not Available',
      environment: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || 'unknown',
      applicationVersion: process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version || 'Not Available',
      commitSha: process.env.NEXT_PUBLIC_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'Not Available',
      latestDatabaseMigration: 'Not Available',
      lastHealthCheck: now.toISOString(),
      supabaseProjectRef: safeProjectRef(),
      databaseError: error,
      storageError: error,
    },
    capacity: { databaseSizeBytes: null, databaseGrowthPercent: null, tableStats: [], storageSizeBytes: null, storageLast30DaysBytes: null, storageFileCount: null, storageCapacityPercent: null, storageBuckets: [], monthlyDataGrowth: { database: 'Not Available', storageBytes: null } },
    users: { total: 0, active: 0, inactive: 0, disabled: 0, recentLogins: 0, inactive30: 0, inactive60: 0, inactive90: 0, failedLoginOrActivityIndicators: 0, inactivePrivilegedUsers: 0, byRole: [], recentUsers: [] },
    transactions: { ff3: { today: null, month: null }, commitments: { today: null, month: null }, ff4: { today: null, month: null }, payments: { today: null, month: null }, reconciliations: { today: null, month: null }, reports: { today: null, month: null }, auditEvents: { today: null, month: null }, requiringAttention: { longPendingFf3: null, longPendingFf4: null, unreconciledPayments: null, recentErrors: null } },
    costs: { currentMonth: null, previousMonth: null, projectedMonthEndCost: null, percentageChange: null, averageMonthlyCost: null, projectedAnnualOperatingCost: null, baseCurrency: (process.env.OPERATIONS_BASE_CURRENCY || 'PGK').trim().toUpperCase(), liveTotalsByCurrency: [], currencyRatesConfigured: [], trend: [], liveProviders: [], totalProviders: 0, providersWithCurrentCost: 0, unavailableProviders: [], allProvidersSynced: false, lastSyncedAt: null, dataAvailabilityLabel: 'Billing Data Unavailable' },
    alerts: { active: error ? [{ code: 'operations_limited_access', severity: 'info', title: 'Limited operations dashboard', detail: error }] : [], settings: [] },
    housekeeping: { inactiveAccounts: 0, staleSessions: 'Not Available', orphanedUploads: null, storageGrowthBytes30Days: null, systemErrorsToReview: null, backupStatus: 'Not Available', databaseGrowthPercent: null, safeOpportunities: [], protectedDataNotice: 'Operations metrics are limited until the database grants and environment configuration are available.' },
  })
}

export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, ADMIN_PERMISSIONS)
  if (guard.response) return guard.response

  let supabase: ReturnType<typeof createServerSupabaseClient>
  try {
    supabase = createServerSupabaseClient()
  } catch (error) {
    const response = NextResponse.next()
    supabase = createRequestSupabaseClient(request, response) as unknown as ReturnType<typeof createServerSupabaseClient>
    const message = error instanceof Error ? error.message : 'Service role client unavailable; using limited user-session metrics.'
    if (!guard.context?.permissions.includes('all') && !guard.context?.permissions.includes('operations.view') && !guard.context?.permissions.includes('operations.manage')) {
      return limitedSummary(new Date(), message)
    }
  }

  const now = new Date()
  const thisMonth = monthStart(now)
  const prevMonth = previousMonthStart()
  const thisMonthIso = firstDayOfThisMonthIso()
  const todayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const baseCurrency = (process.env.OPERATIONS_BASE_CURRENCY || 'PGK').trim().toUpperCase()
  const currencyRates = parseCurrencyRates(baseCurrency)

  const liveProviderCostsPromise = loadLiveProviderCosts()

  const [dbPing, dbStats, storage, backupSetting, migrationSetting] = await Promise.all([
    supabase.from('system_settings').select('setting_key').limit(1),
    loadDbStats(request),
    loadStorage(supabase),
    loadSetting(supabase, 'operations_backup_status'),
    loadSetting(supabase, 'latest_database_migration'),
  ])

  const [usersRes, userRolesRes, loginLogsRes, alertSettingsRes] = await Promise.all([
    supabase.from('users').select('id, email, full_name, is_active, created_at'),
    supabase.from('user_roles').select('user_id, role:roles(name, is_active)').limit(10000),
    supabase.from('audit_logs').select('user_id, user_email, action, created_at').eq('action', 'LOGIN').order('created_at', { ascending: false }).limit(10000),
    supabase.from('system_alert_settings').select('code, label, threshold_value, enabled, notes').order('code'),
  ])

  const liveProviderCosts = await liveProviderCostsPromise
  await Promise.all(liveProviderCosts.map((provider) => recordProviderSyncSnapshot(supabase, provider, baseCurrency, currencyRates, { userId: guard.context?.userId, email: guard.context?.email })))

  const userRows = (usersRes.data || []) as Array<{ id: string; email: string; full_name: string | null; is_active: boolean | null; created_at: string }>
  const roleRows = (userRolesRes.data || []) as unknown as Array<{ user_id: string; role: { name: string | null; is_active?: boolean | null } | null }>
  const loginRows = (loginLogsRes.data || []) as Array<{ user_id: string | null; user_email: string | null; created_at: string }>
  const alertSettings = ((alertSettingsRes.data || []) as AlertSetting[]).length ? (alertSettingsRes.data || []) as AlertSetting[] : []

  const lastLoginByUser = new Map<string, string>()
  for (const login of loginRows) {
    const userId = login.user_id || userRows.find((user) => user.email === login.user_email)?.id
    if (userId && !lastLoginByUser.has(userId)) lastLoginByUser.set(userId, login.created_at)
  }

  const byRole = new Map<string, number>()
  const privilegedUserIds = new Set<string>()
  for (const row of roleRows) {
    const roleName = row.role?.name || 'Unassigned'
    byRole.set(roleName, (byRole.get(roleName) || 0) + 1)
    if (/admin|administrator|system|super/i.test(roleName)) privilegedUserIds.add(row.user_id)
  }

  const inactiveFor = (days: number) =>
    userRows.filter((user) => {
      const lastLogin = lastLoginByUser.get(user.id)
      if (!lastLogin) return new Date(user.created_at) < new Date(daysAgo(days))
      return new Date(lastLogin) < new Date(daysAgo(days))
    }).length

  const inactivePrivilegedUsers = userRows.filter((user) => {
    if (!privilegedUserIds.has(user.id)) return false
    const lastLogin = lastLoginByUser.get(user.id)
    return !lastLogin || new Date(lastLogin) < new Date(daysAgo(30))
  }).length

  const transactionCounts = await Promise.all([
    safeTableCount(supabase, 'ff3_headers', (q) => q.gte('created_at', todayIso)),
    safeTableCount(supabase, 'ff3_headers', (q) => q.gte('created_at', thisMonthIso)),
    safeTableCount(supabase, 'ff3_commitments', (q) => q.gte('created_at', todayIso)),
    safeTableCount(supabase, 'ff3_commitments', (q) => q.gte('created_at', thisMonthIso)),
    safeTableCount(supabase, 'ff4_headers', (q) => q.gte('created_at', todayIso)),
    safeTableCount(supabase, 'ff4_headers', (q) => q.gte('created_at', thisMonthIso)),
    safeTableCount(supabase, 'payment_transactions', (q) => q.gte('created_at', todayIso)),
    safeTableCount(supabase, 'payment_transactions', (q) => q.gte('created_at', thisMonthIso)),
    safeTableCount(supabase, 'ff4_headers', (q) => q.eq('status', 'RECONCILED').gte('reconciled_date', todayIso)),
    safeTableCount(supabase, 'ff4_headers', (q) => q.eq('status', 'RECONCILED').gte('reconciled_date', thisMonthIso)),
    safeTableCount(supabase, 'audit_logs', (q) => q.gte('created_at', todayIso)),
    safeTableCount(supabase, 'audit_logs', (q) => q.gte('created_at', thisMonthIso)),
    safeTableCount(supabase, 'audit_logs', (q) => q.eq('entity_type', 'REPORT').gte('created_at', todayIso)),
    safeTableCount(supabase, 'audit_logs', (q) => q.eq('entity_type', 'REPORT').gte('created_at', thisMonthIso)),
  ])

  const [longPendingFf3, longPendingFf4, unreconciledPayments, recentErrors, failedActivity, orphanedDocuments] = await Promise.all([
    safeTableCount(supabase, 'ff3_headers', (q) => q.in('status', PENDING_FF3).lt('updated_at', daysAgo(7))),
    safeTableCount(supabase, 'ff4_headers', (q) => q.in('status', PENDING_FF4).lt('updated_at', daysAgo(7))),
    safeTableCount(supabase, 'payment_transactions', (q) => q.eq('reconciled', false)),
    safeTableCount(supabase, 'audit_logs', (q) => q.or('action.ilike.%FAIL%,action.ilike.%ERROR%,action.eq.ACCESS_DENIED,action.eq.UNAUTHORIZED_ACCESS_ATTEMPT').gte('created_at', daysAgo(7))),
    safeTableCount(supabase, 'audit_logs', (q) => q.or('action.ilike.%LOGIN_FAILED%,action.eq.ACCESS_DENIED,action.eq.UNAUTHORIZED_ACCESS_ATTEMPT').gte('created_at', daysAgo(30))),
    safeTableCount(supabase, 'documents', (q) => q.is('reference_id', null)),
  ])

  const currentProviderCosts = sumKnownProviderCosts(liveProviderCosts, 'currentMonthCost', currencyRates, baseCurrency)
  const previousProviderCosts = sumKnownProviderCosts(liveProviderCosts, 'previousMonthCost', currencyRates, baseCurrency)
  const currentCost = currentProviderCosts.total
  const previousCost = previousProviderCosts.total
  const totalProviders = liveProviderCosts.length
  const unavailableProviders = liveProviderCosts.filter((provider) => provider.currentMonthCost === null)
  const providersWithCurrentCost = currentProviderCosts.known
  const lastSyncedAt =
    liveProviderCosts
      .map((provider) => provider.lastCheckedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null
  const liveTotalsByCurrency = Array.from(
    liveProviderCosts
      .filter((provider) => provider.currentMonthCost !== null || provider.previousMonthCost !== null)
      .reduce((map, provider) => {
        const current = map.get(provider.currency) || { currency: provider.currency, currentMonth: 0, previousMonth: 0 }
        current.currentMonth += provider.currentMonthCost || 0
        current.previousMonth += provider.previousMonthCost || 0
        map.set(provider.currency, current)
        return map
      }, new Map<string, { currency: string; currentMonth: number; previousMonth: number }>())
      .values()
  )

  const monthlyTotals = new Map<string, number>()
  if (currentCost !== null) monthlyTotals.set(thisMonth.slice(0, 7), currentCost)
  if (previousCost !== null) monthlyTotals.set(prevMonth.slice(0, 7), previousCost)

  const costTrend = Array.from(monthlyTotals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }))
  const averageMonthlyCost = costTrend.length ? costTrend.reduce((sum, row) => sum + row.total, 0) / costTrend.length : null

  const dbSizeBytes = Number(dbStats?.database_size_bytes || 0) || null
  const dbGrowthPercent = null
  const storagePercent = null

  const alerts = buildAlerts({
    settings: alertSettings,
    storagePercent,
    dbGrowthPercent,
    backupStatus: typeof backupSetting?.status === 'string' ? backupSetting.status : null,
    recentErrorCount: recentErrors || 0,
    currentCost: currentCost || 0,
    averageCost: averageMonthlyCost || 0,
    inactivePrivilegedUsers,
    liveProviderCosts,
  })

  return NextResponse.json({
    generatedAt: now.toISOString(),
    health: {
      applicationStatus: 'Operational',
      databaseConnectivity: dbPing.error ? 'Unavailable' : 'Connected',
      storageConnectivity: storage.connected ? 'Connected' : 'Unavailable',
      environment: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || 'unknown',
      applicationVersion: process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version || 'Not Available',
      commitSha: process.env.NEXT_PUBLIC_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'Not Available',
      latestDatabaseMigration: (migrationSetting?.name as string | undefined) || dbStats?.latest_migration || 'Not Available',
      lastHealthCheck: now.toISOString(),
      supabaseProjectRef: safeProjectRef(),
      databaseError: dbPing.error?.message || null,
      storageError: storage.error,
    },
    capacity: {
      databaseSizeBytes: dbSizeBytes,
      databaseGrowthPercent: dbGrowthPercent,
      tableStats: dbStats?.table_stats || [],
      storageSizeBytes: storage.totalSizeBytes,
      storageLast30DaysBytes: storage.last30SizeBytes,
      storageFileCount: storage.fileCount,
      storageCapacityPercent: storagePercent,
      storageBuckets: storage.buckets,
      monthlyDataGrowth: {
        database: dbGrowthPercent === null ? 'Not Available' : dbGrowthPercent,
        storageBytes: storage.last30SizeBytes,
      },
    },
    users: {
      total: userRows.length,
      active: userRows.filter((user) => user.is_active !== false).length,
      inactive: userRows.filter((user) => user.is_active === false).length,
      disabled: userRows.filter((user) => user.is_active === false).length,
      recentLogins: loginRows.filter((row) => new Date(row.created_at) >= new Date(daysAgo(7))).length,
      inactive30: inactiveFor(30),
      inactive60: inactiveFor(60),
      inactive90: inactiveFor(90),
      failedLoginOrActivityIndicators: failedActivity || 0,
      inactivePrivilegedUsers,
      byRole: Array.from(byRole.entries()).map(([role, countValue]) => ({ role, count: countValue })).sort((a, b) => b.count - a.count),
      recentUsers: userRows
        .slice(0, 20)
        .map((user) => ({
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          isActive: user.is_active !== false,
          createdAt: user.created_at,
          lastLoginAt: lastLoginByUser.get(user.id) || null,
        })),
    },
    transactions: {
      ff3: { today: transactionCounts[0], month: transactionCounts[1] },
      commitments: { today: transactionCounts[2], month: transactionCounts[3] },
      ff4: { today: transactionCounts[4], month: transactionCounts[5] },
      payments: { today: transactionCounts[6], month: transactionCounts[7] },
      reconciliations: { today: transactionCounts[8], month: transactionCounts[9] },
      auditEvents: { today: transactionCounts[10], month: transactionCounts[11] },
      reports: { today: transactionCounts[12], month: transactionCounts[13] },
      requiringAttention: {
        longPendingFf3,
        longPendingFf4,
        unreconciledPayments,
        recentErrors,
      },
    },
    costs: {
      baseCurrency,
      currentMonth: currentCost,
      previousMonth: previousCost,
      projectedMonthEndCost: projectedMonthEndCost(currentCost, now),
      projectedAnnualOperatingCost: averageMonthlyCost === null ? null : averageMonthlyCost * 12,
      percentageChange: previousCost && currentCost !== null ? ((currentCost - previousCost) / previousCost) * 100 : null,
      averageMonthlyCost,
      liveTotalsByCurrency,
      liveProviders: liveProviderCosts,
      totalProviders,
      providersWithCurrentCost,
      unavailableProviders: unavailableProviders.map((provider) => ({ id: provider.id, name: provider.name, status: provider.status, notes: provider.notes })),
      allProvidersSynced: totalProviders > 0 && providersWithCurrentCost === totalProviders,
      lastSyncedAt,
      dataAvailabilityLabel:
        totalProviders === 0
          ? 'No provider integrations configured'
          : providersWithCurrentCost === totalProviders
            ? `All ${totalProviders} providers synchronised`
            : `${providersWithCurrentCost} of ${totalProviders} cost sources available • ${totalProviders - providersWithCurrentCost} awaiting API data`,
      trend: costTrend,
      currencyRatesConfigured: Object.keys(currencyRates).filter((currency) => currency !== baseCurrency),
    },
    alerts: {
      active: alerts,
      settings: alertSettings,
    },
    housekeeping: {
      inactiveAccounts: userRows.filter((user) => user.is_active === false).length,
      staleSessions: 'Not Available',
      orphanedUploads: orphanedDocuments,
      storageGrowthBytes30Days: storage.last30SizeBytes,
      systemErrorsToReview: recentErrors,
      backupStatus: typeof backupSetting?.status === 'string' ? backupSetting.status : 'Not Available',
      databaseGrowthPercent: dbGrowthPercent,
      safeOpportunities: [
        'Review inactive or unassigned accounts before disabling access.',
        'Confirm backup status and record the confirmation date.',
        'Review orphaned upload records before removing any files from storage.',
        'Archive exported support reports outside the application if policy requires it.',
      ],
      protectedDataNotice: 'Financial documents, payment records, commitments and audit records are not eligible for arbitrary deletion from this dashboard.',
    },
  })
}
