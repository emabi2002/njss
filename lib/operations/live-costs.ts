export type LiveCostProviderResult = {
  id: string
  name: string
  provider: string
  category: string
  status: 'connected' | 'partial' | 'not_configured' | 'unavailable'
  source: 'provider_api' | 'configured_endpoint' | 'connectivity_check' | 'not_configured'
  currency: string
  currentMonthCost: number | null
  previousMonthCost: number | null
  percentageChange: number | null
  billingPeriod: string | null
  usageLabel: string | null
  usageValue: number | string | null
  usageUnit: string | null
  invoiceReference: string | null
  lastCheckedAt: string
  notes: string
  dashboardUrl: string | null
}

type FeedConfig = {
  id: string
  name: string
  provider?: string
  category?: string
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
  authTokenEnv?: string
  authHeader?: string
  authScheme?: string
  currentMonthCostPath?: string
  previousMonthCostPath?: string
  currencyPath?: string
  billingPeriodPath?: string
  usageLabelPath?: string
  usageValuePath?: string
  usageUnitPath?: string
  invoiceReferencePath?: string
  dashboardUrl?: string
  notes?: string
  amountMultiplier?: number
}

type BuiltInProvider = {
  id: string
  name: string
  provider: string
  category: string
  endpointEnv: string
  tokenEnv: string
  fallbackTokenEnv?: string
  amountPathEnv: string
  previousAmountPathEnv: string
  currencyPathEnv: string
  defaultCurrency: string
  fallbackCheckUrl?: string | null
  fallbackTokenEnvForCheck?: string
  dashboardUrlEnv?: string
  notesWhenNotConfigured: string
}

const DEFAULT_TIMEOUT_MS = 8000

function env(name: string) {
  const value = process.env[name]
  return value?.trim() || ''
}

function asNumber(value: unknown, multiplier = 1) {
  if (typeof value === 'number' && Number.isFinite(value)) return value * multiplier
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(parsed)) return parsed * multiplier
  }
  return null
}

function getPath(source: unknown, path?: string) {
  if (!path) return undefined
  return path.split('.').reduce<unknown>((current, part) => {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) return current[Number(part)]
    if (typeof current === 'object') return (current as Record<string, unknown>)[part]
    return undefined
  }, source)
}

function pct(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

function safeError(error: unknown) {
  const raw = error instanceof Error ? error.message : 'Provider request failed'
  return raw.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]').slice(0, 180)
}

async function fetchJson(config: FeedConfig) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  try {
    const headers: Record<string, string> = { Accept: 'application/json', ...(config.headers || {}) }
    const token = config.authTokenEnv ? env(config.authTokenEnv) : ''
    if (token) headers[config.authHeader || 'Authorization'] = `${config.authScheme || 'Bearer'} ${token}`
    const res = await fetch(config.url, {
      method: config.method || 'GET',
      headers,
      body: config.body ? JSON.stringify(config.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    })
    const contentType = res.headers.get('content-type') || ''
    const body = contentType.includes('json') ? await res.json() : await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return body
  } finally {
    clearTimeout(timeout)
  }
}

function resultBase(input: Pick<LiveCostProviderResult, 'id' | 'name' | 'provider' | 'category'>): LiveCostProviderResult {
  return {
    ...input,
    status: 'not_configured',
    source: 'not_configured',
    currency: 'PGK',
    currentMonthCost: null,
    previousMonthCost: null,
    percentageChange: null,
    billingPeriod: null,
    usageLabel: null,
    usageValue: null,
    usageUnit: null,
    invoiceReference: null,
    lastCheckedAt: new Date().toISOString(),
    notes: 'Not Available',
    dashboardUrl: null,
  }
}

function parseFeedResult(config: FeedConfig, data: unknown, source: LiveCostProviderResult['source']): LiveCostProviderResult {
  const multiplier = config.amountMultiplier ?? 1
  const current = asNumber(getPath(data, config.currentMonthCostPath || 'currentMonthCost'), multiplier)
  const previous = asNumber(getPath(data, config.previousMonthCostPath || 'previousMonthCost'), multiplier)
  const currencyValue = getPath(data, config.currencyPath || 'currency')
  const usageValue = getPath(data, config.usageValuePath)
  return {
    ...resultBase({
      id: config.id,
      name: config.name,
      provider: config.provider || config.name,
      category: config.category || 'Other',
    }),
    status: current === null ? 'partial' : 'connected',
    source,
    currency: typeof currencyValue === 'string' && currencyValue.trim() ? currencyValue : 'PGK',
    currentMonthCost: current,
    previousMonthCost: previous,
    percentageChange: pct(current, previous),
    billingPeriod: String(getPath(data, config.billingPeriodPath || 'billingPeriod') || new Date().toISOString().slice(0, 7)),
    usageLabel: config.usageLabelPath ? String(getPath(data, config.usageLabelPath) || '') || null : null,
    usageValue: typeof usageValue === 'number' || typeof usageValue === 'string' ? usageValue : null,
    usageUnit: config.usageUnitPath ? String(getPath(data, config.usageUnitPath) || '') || null : null,
    invoiceReference: config.invoiceReferencePath ? String(getPath(data, config.invoiceReferencePath) || '') || null : null,
    notes: config.notes || (current === null ? 'Connected, but this endpoint did not expose a current-month cost value.' : 'Live provider cost retrieved online.'),
    dashboardUrl: config.dashboardUrl || null,
  }
}

async function loadFeed(config: FeedConfig, source: LiveCostProviderResult['source'] = 'configured_endpoint') {
  try {
    if (config.authTokenEnv && !env(config.authTokenEnv)) {
      return {
        ...resultBase({ id: config.id, name: config.name, provider: config.provider || config.name, category: config.category || 'Other' }),
        notes: `Not configured. Server variable ${config.authTokenEnv} is missing.`,
        dashboardUrl: config.dashboardUrl || null,
      }
    }
    const data = await fetchJson(config)
    return parseFeedResult(config, data, source)
  } catch (error) {
    return {
      ...resultBase({ id: config.id, name: config.name, provider: config.provider || config.name, category: config.category || 'Other' }),
      status: 'unavailable' as const,
      source,
      notes: safeError(error),
      dashboardUrl: config.dashboardUrl || null,
    }
  }
}

function projectRef() {
  try {
    return new URL(env('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0]
  } catch {
    return ''
  }
}

function builtInProviders(): BuiltInProvider[] {
  const ref = projectRef()
  const accountSlug = env('NETLIFY_ACCOUNT_SLUG') || env('NETLIFY_TEAM_SLUG')
  return [
    {
      id: 'supabase',
      name: 'Supabase',
      provider: 'Supabase',
      category: 'Database',
      endpointEnv: 'SUPABASE_COST_ENDPOINT',
      tokenEnv: 'SUPABASE_COST_TOKEN',
      fallbackTokenEnv: 'SUPABASE_ACCESS_TOKEN',
      amountPathEnv: 'SUPABASE_COST_CURRENT_PATH',
      previousAmountPathEnv: 'SUPABASE_COST_PREVIOUS_PATH',
      currencyPathEnv: 'SUPABASE_COST_CURRENCY_PATH',
      defaultCurrency: 'USD',
      fallbackCheckUrl: ref ? `https://api.supabase.com/v1/projects/${ref}` : null,
      fallbackTokenEnvForCheck: 'SUPABASE_ACCESS_TOKEN',
      dashboardUrlEnv: 'SUPABASE_DASHBOARD_URL',
      notesWhenNotConfigured: 'Live Supabase cost requires a server-side SUPABASE_COST_ENDPOINT or a Management API token for connectivity checks. If the provider does not expose billing totals through API, keep recording invoice values in the manual register.',
    },
    {
      id: 'netlify',
      name: 'Netlify',
      provider: 'Netlify',
      category: 'Hosting',
      endpointEnv: 'NETLIFY_COST_ENDPOINT',
      tokenEnv: 'NETLIFY_COST_TOKEN',
      fallbackTokenEnv: 'NETLIFY_AUTH_TOKEN',
      amountPathEnv: 'NETLIFY_COST_CURRENT_PATH',
      previousAmountPathEnv: 'NETLIFY_COST_PREVIOUS_PATH',
      currencyPathEnv: 'NETLIFY_COST_CURRENCY_PATH',
      defaultCurrency: 'USD',
      fallbackCheckUrl: accountSlug ? `https://api.netlify.com/api/v1/accounts/${accountSlug}` : null,
      fallbackTokenEnvForCheck: 'NETLIFY_AUTH_TOKEN',
      dashboardUrlEnv: 'NETLIFY_DASHBOARD_URL',
      notesWhenNotConfigured: 'Live Netlify cost requires a server-side NETLIFY_COST_ENDPOINT or Netlify account token for connectivity checks. Billing totals may need an approved billing export/API endpoint from Netlify.',
    },
  ]
}

async function loadBuiltInProvider(provider: BuiltInProvider) {
  const endpoint = env(provider.endpointEnv)
  const tokenEnv = env(provider.tokenEnv) ? provider.tokenEnv : provider.fallbackTokenEnv
  const dashboardUrl = env(provider.dashboardUrlEnv || '') || null
  if (endpoint) {
    return loadFeed({
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      category: provider.category,
      url: endpoint,
      authTokenEnv: tokenEnv,
      currentMonthCostPath: env(provider.amountPathEnv) || 'currentMonthCost',
      previousMonthCostPath: env(provider.previousAmountPathEnv) || 'previousMonthCost',
      currencyPath: env(provider.currencyPathEnv) || 'currency',
      dashboardUrl: dashboardUrl || undefined,
      notes: 'Live provider costing endpoint configured server-side.',
    }, 'provider_api')
  }

  if (provider.fallbackCheckUrl && provider.fallbackTokenEnvForCheck && env(provider.fallbackTokenEnvForCheck)) {
    try {
      await fetchJson({
        id: provider.id,
        name: provider.name,
        provider: provider.provider,
        category: provider.category,
        url: provider.fallbackCheckUrl,
        authTokenEnv: provider.fallbackTokenEnvForCheck,
      })
      return {
        ...resultBase({ id: provider.id, name: provider.name, provider: provider.provider, category: provider.category }),
        status: 'partial' as const,
        source: 'connectivity_check' as const,
        currency: provider.defaultCurrency,
        notes: 'Provider API connectivity is live, but no billing/cost endpoint is configured for current-month charges.',
        dashboardUrl,
      }
    } catch (error) {
      return {
        ...resultBase({ id: provider.id, name: provider.name, provider: provider.provider, category: provider.category }),
        status: 'unavailable' as const,
        source: 'connectivity_check' as const,
        currency: provider.defaultCurrency,
        notes: safeError(error),
        dashboardUrl,
      }
    }
  }

  return {
    ...resultBase({ id: provider.id, name: provider.name, provider: provider.provider, category: provider.category }),
    currency: provider.defaultCurrency,
    notes: provider.notesWhenNotConfigured,
    dashboardUrl,
  }
}

function customFeeds() {
  const raw = env('OPERATIONS_LIVE_COST_FEEDS')
  if (!raw) return [] as FeedConfig[]
  try {
    const parsed = JSON.parse(raw) as FeedConfig[]
    return Array.isArray(parsed)
      ? parsed.filter((feed) => Boolean(feed.id && feed.name && feed.url))
      : []
  } catch {
    return []
  }
}

export async function loadLiveProviderCosts(): Promise<LiveCostProviderResult[]> {
  const builtIns = await Promise.all(builtInProviders().map(loadBuiltInProvider))
  const custom = await Promise.all(customFeeds().map((feed) => loadFeed(feed, 'configured_endpoint')))
  return [...builtIns, ...custom]
}

export function sumLiveCosts(providers: LiveCostProviderResult[], selector: 'currentMonthCost' | 'previousMonthCost') {
  return providers.reduce((sum, provider) => sum + (provider[selector] || 0), 0)
}
