"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Database,
  FileText,
  Gauge,
  HardDrive,
  HeartPulse,
  Loader2,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  UserCog,
  Users,
  Wrench,
} from "lucide-react"
import { PagePermissionGate } from "@/components/PermissionGate"
import { supabase } from "@/lib/supabase"

type LiveProviderCost = {
  id: string
  name: string
  provider: string
  category: string
  status: "connected" | "partial" | "not_configured" | "unavailable"
  source: "provider_api" | "configured_endpoint" | "connectivity_check" | "not_configured"
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

type CostRow = {
  id: string
  service_provider: string
  cost_category: string
  billing_month: string
  currency: string
  monthly_fixed_cost: number | null
  usage_cost: number | null
  other_cost: number | null
  total_cost: number | null
  invoice_reference: string | null
  payment_status: string
  notes: string | null
}

type BackupValidation = {
  valid: boolean
  status: string
  issues: string[]
  details?: Record<string, unknown>
  nextSteps?: string[]
}

type DataQualityResult = {
  generatedAt: string
  summary: Array<{ validation: string; issues: number; detail: string }>
  archiveCandidates: { longPendingFf3: number; unreconciledPayments: number; note: string }
  cleanupWizard: string[]
  safetyNotice: string
}

type Summary = {
  generatedAt: string
  health: {
    applicationStatus: string
    databaseConnectivity: string
    storageConnectivity: string
    environment: string
    applicationVersion: string
    commitSha: string
    latestDatabaseMigration: string
    lastHealthCheck: string
    supabaseProjectRef: string | null
    databaseError: string | null
    storageError: string | null
  }
  capacity: {
    databaseSizeBytes: number | null
    databaseGrowthPercent: number | string | null
    tableStats: Array<Record<string, unknown>>
    storageSizeBytes: number | null
    storageLast30DaysBytes: number | null
    storageFileCount: number | null
    storageCapacityPercent: number | null
    storageBuckets: Array<{ bucket: string; fileCount: number; sizeBytes: number; newestFileAt: string | null }>
    monthlyDataGrowth: { database: number | string | null; storageBytes: number | null }
  }
  users: {
    total: number
    active: number
    inactive: number
    disabled: number
    recentLogins: number
    inactive30: number
    inactive60: number
    inactive90: number
    failedLoginOrActivityIndicators: number
    inactivePrivilegedUsers: number
    byRole: Array<{ role: string; count: number }>
    recentUsers: Array<{ id: string; email: string; fullName: string | null; isActive: boolean; createdAt: string; lastLoginAt: string | null }>
  }
  transactions: {
    ff3: { today: number | null; month: number | null }
    commitments: { today: number | null; month: number | null }
    ff4: { today: number | null; month: number | null }
    payments: { today: number | null; month: number | null }
    reconciliations: { today: number | null; month: number | null }
    reports: { today: number | null; month: number | null }
    auditEvents: { today: number | null; month: number | null }
    requiringAttention: { longPendingFf3: number | null; longPendingFf4: number | null; unreconciledPayments: number | null; recentErrors: number | null }
  }
  costs: {
    categories: string[]
    currentMonth: number
    previousMonth: number
    percentageChange: number | null
    averageMonthlyCost: number
    projectedAnnualOperatingCost: number
    operationalBudget: number
    budgetVariance: number | null
    manualCurrentMonth: number
    manualPreviousMonth: number
    liveCurrentMonth: number
    livePreviousMonth: number
    baseCurrency: string
    liveTotalsByCurrency: Array<{ currency: string; currentMonth: number; previousMonth: number }>
    currencyRatesConfigured: string[]
    trend: Array<{ month: string; total: number }>
    liveProviders: LiveProviderCost[]
    rows: Array<CostRow>
  }
  alerts: {
    active: Array<{ code: string; severity: "info" | "warning" | "critical"; title: string; detail: string }>
    settings: Array<{ code: string; label: string; threshold_value: number | null; enabled: boolean; notes: string | null }>
  }
  housekeeping: {
    inactiveAccounts: number
    staleSessions: string | number
    orphanedUploads: number | null
    storageGrowthBytes30Days: number | null
    systemErrorsToReview: number | null
    backupStatus: string
    databaseGrowthPercent: number | string | null
    safeOpportunities: string[]
    protectedDataNotice: string
  }
}

type CostForm = {
  service_provider: string
  cost_category: string
  billing_month: string
  currency: string
  monthly_fixed_cost: string
  usage_cost: string
  other_cost: string
  invoice_reference: string
  payment_status: string
  notes: string
  operational_budget: string
}

type AlertEdit = {
  threshold_value: string
  enabled: boolean
  notes: string
}

const emptyCostForm: CostForm = {
  service_provider: "",
  cost_category: "Database",
  billing_month: new Date().toISOString().slice(0, 7),
  currency: "PGK",
  monthly_fixed_cost: "0",
  usage_cost: "0",
  other_cost: "0",
  invoice_reference: "",
  payment_status: "Pending",
  notes: "",
  operational_budget: "",
}

async function authHeaders(extra?: HeadersInit) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return {
    ...(extra || {}),
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

const fmtNumber = (value: number | null | undefined) => (value === null || value === undefined ? "Not Available" : new Intl.NumberFormat("en-GB").format(value))
const fmtMoney = (value: number | null | undefined, currency = "PGK") => (value === null || value === undefined ? "Not Available" : `${currency} ${new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`)
const fmtPercent = (value: number | string | null | undefined) => (typeof value === "number" ? `${value.toFixed(1)}%` : "Not Available")
const fmtBytes = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "Not Available"
  if (value < 1024) return `${value} B`
  const units = ["KB", "MB", "GB", "TB"]
  let n = value / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`
}
const fmtDate = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("en-GB") : "Not Available")

export default function OperationsDashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [form, setForm] = useState<CostForm>(emptyCostForm)
  const [alertEdits, setAlertEdits] = useState<Record<string, AlertEdit>>({})
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [backupStatus, setBackupStatus] = useState("")
  const [backupValidation, setBackupValidation] = useState<BackupValidation | null>(null)
  const [dataQuality, setDataQuality] = useState<DataQualityResult | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/operations/summary", { cache: "no-store", headers: await authHeaders() })
      if (!res.ok) throw new Error(`Operations summary request failed with status ${res.status}`)
      const data = (await res.json()) as Summary
      setSummary(data)
      setForm((current) => ({ ...current, operational_budget: data.costs.operationalBudget ? String(data.costs.operationalBudget) : current.operational_budget }))
      setAlertEdits(
        Object.fromEntries(
          data.alerts.settings.map((setting) => [
            setting.code,
            {
              threshold_value: setting.threshold_value === null ? "" : String(setting.threshold_value),
              enabled: setting.enabled,
              notes: setting.notes || "",
            },
          ]),
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load operations dashboard.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = window.setInterval(() => {
      load()
    }, 60000)
    return () => window.clearInterval(interval)
  }, [autoRefresh, load])

  const healthTone = summary?.health.databaseConnectivity === "Connected" && summary.health.storageConnectivity === "Connected" ? "good" : "warn"
  const priorityCards = useMemo(() => {
    if (!summary) return []
    return [
      { label: "Monthly Operating Cost", value: fmtMoney(summary.costs.currentMonth, summary.costs.baseCurrency), sub: `Live: ${fmtMoney(summary.costs.liveCurrentMonth, summary.costs.baseCurrency)} • Manual: ${fmtMoney(summary.costs.manualCurrentMonth, summary.costs.baseCurrency)}`, icon: ReceiptText, tone: "gold" },
      { label: "Storage Growth", value: fmtBytes(summary.capacity.storageLast30DaysBytes), sub: "Last 30 days", icon: HardDrive, tone: "slate" },
      { label: "Database Growth", value: fmtPercent(summary.capacity.databaseGrowthPercent), sub: `Size: ${fmtBytes(summary.capacity.databaseSizeBytes)}`, icon: Database, tone: "slate" },
      { label: "Active Users", value: fmtNumber(summary.users.active), sub: `${summary.users.inactive} inactive or disabled`, icon: Users, tone: "green" },
      { label: "Systems Health", value: healthTone === "good" ? "Operational" : "Attention Required", sub: `DB ${summary.health.databaseConnectivity} • Storage ${summary.health.storageConnectivity}`, icon: HeartPulse, tone: healthTone === "good" ? "green" : "red" },
      { label: "Recent Errors", value: fmtNumber(summary.transactions.requiringAttention.recentErrors), sub: "Last 7 days", icon: AlertTriangle, tone: (summary.transactions.requiringAttention.recentErrors || 0) > 0 ? "red" : "green" },
    ]
  }, [summary, healthTone])

  const saveCost = async () => {
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      const res = await fetch("/api/operations/costs", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          service_provider: form.service_provider,
          cost_category: form.cost_category,
          billing_month: form.billing_month,
          currency: form.currency,
          monthly_fixed_cost: Number(form.monthly_fixed_cost || 0),
          usage_cost: Number(form.usage_cost || 0),
          other_cost: Number(form.other_cost || 0),
          invoice_reference: form.invoice_reference || null,
          payment_status: form.payment_status,
          notes: form.notes || null,
          operational_budget: form.operational_budget ? Number(form.operational_budget) : undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || "Unable to save operating cost.")
      setSuccess("Operating cost entry saved and audit logged.")
      setForm({ ...emptyCostForm, operational_budget: form.operational_budget })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save operating cost.")
    } finally {
      setSaving(false)
    }
  }

  const saveAlertSetting = async (code: string) => {
    const edit = alertEdits[code]
    if (!edit) return
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      const res = await fetch("/api/operations/alerts", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          code,
          threshold_value: edit.threshold_value === "" ? null : Number(edit.threshold_value),
          enabled: edit.enabled,
          notes: edit.notes || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || "Unable to save alert setting.")
      setSuccess("Alert setting saved and audit logged.")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save alert setting.")
    } finally {
      setSaving(false)
    }
  }

  const createBackup = async () => {
    setSaving(true)
    setError("")
    setSuccess("")
    setBackupStatus("Creating portable NJSS backup package...")
    try {
      const res = await fetch("/api/operations/housekeeping/backup", { method: "POST", headers: await authHeaders() })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Backup request failed with status ${res.status}`)
      }
      const blob = await res.blob()
      const filename = res.headers.get("X-NJSS-Backup-Filename") || `NJSS_Backup_${new Date().toISOString().slice(0, 10)}.zip`
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      setBackupStatus(`Backup generated and downloaded: ${filename}`)
      setSuccess("Portable backup package generated. Store it only in an approved secure location.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create backup.")
      setBackupStatus("")
    } finally {
      setSaving(false)
    }
  }

  const validateBackup = async (file: File | null) => {
    if (!file) return
    setSaving(true)
    setError("")
    setSuccess("")
    setBackupValidation(null)
    try {
      const formData = new FormData()
      formData.append("backup", file)
      const res = await fetch("/api/operations/housekeeping/validate-backup", { method: "POST", headers: await authHeaders(), body: formData })
      const body = (await res.json()) as BackupValidation & { error?: string }
      if (!res.ok && body.error) throw new Error(body.error)
      setBackupValidation(body)
      setSuccess(body.valid ? "Backup validated. Review details before any restoration." : "Backup rejected during validation.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to validate backup.")
    } finally {
      setSaving(false)
    }
  }

  const runDataQualityScan = async () => {
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      const res = await fetch("/api/operations/housekeeping/data-quality", { cache: "no-store", headers: await authHeaders() })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || "Unable to run data quality scan.")
      setDataQuality(body as DataQualityResult)
      setSuccess("Data quality scan completed. Review issues before selecting any corrective action.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run data quality scan.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <PagePermissionGate any={["operations.view", "operations.manage", "settings.manage", "all"]} title="System Support & Operations">
      <div className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-[#111827] p-6 text-white shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#D4A62A]">
                <Gauge className="h-4 w-4" /> Phase 6 production support readiness
              </div>
              <h1 className="mt-4 text-3xl font-bold">Operations Dashboard</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                A restricted support dashboard for system health, capacity planning, user-access oversight, storage/database monitoring, operational costs, alerts and housekeeping. It does not alter financial workflows or expose secrets.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => setAutoRefresh((value) => !value)}
                className={`inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold ${autoRefresh ? "bg-green-500/20 text-green-100" : "bg-white/10 text-white hover:bg-white/15"}`}
              >
                <Activity className="h-4 w-4" /> {autoRefresh ? "Live refresh on" : "Live refresh off"}
              </button>
              <button onClick={load} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">
                <RefreshCw className="h-4 w-4" /> Refresh
              </button>
            </div>
          </div>
        </div>

        {error && <Notice tone="red" icon={<AlertCircle className="h-5 w-5" />} text={error} />}
        {success && <Notice tone="green" icon={<CheckCircle2 className="h-5 w-5" />} text={success} />}

        {backupStatus && <Notice tone="green" icon={<ShieldCheck className="h-5 w-5" />} text={backupStatus} />}

        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-24">
            <Loader2 className="h-8 w-8 animate-spin text-png-red" />
          </div>
        ) : summary ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {priorityCards.map((card) => (
                <PriorityCard key={card.label} {...card} />
              ))}
            </section>

            <section className="grid gap-4 xl:grid-cols-3">
              <Panel title="Systems Health" icon={<HeartPulse className="h-5 w-5 text-green-700" />} className="xl:col-span-1">
                <StatusRow label="Application" value={summary.health.applicationStatus} good={summary.health.applicationStatus === "Operational"} />
                <StatusRow label="Database" value={summary.health.databaseConnectivity} good={summary.health.databaseConnectivity === "Connected"} />
                <StatusRow label="Storage" value={summary.health.storageConnectivity} good={summary.health.storageConnectivity === "Connected"} />
                <KeyValue label="Environment" value={summary.health.environment} />
                <KeyValue label="Application version" value={summary.health.applicationVersion} />
                <KeyValue label="Git commit/version" value={summary.health.commitSha} mono />
                <KeyValue label="Latest database migration" value={summary.health.latestDatabaseMigration} />
                <KeyValue label="Last health check" value={fmtDate(summary.health.lastHealthCheck)} />
              </Panel>

              <Panel title="Capacity & Usage" icon={<TrendingUp className="h-5 w-5 text-png-red" />} className="xl:col-span-2">
                <div className="grid gap-3 md:grid-cols-3">
                  <Metric label="Database size" value={fmtBytes(summary.capacity.databaseSizeBytes)} />
                  <Metric label="Storage size" value={fmtBytes(summary.capacity.storageSizeBytes)} />
                  <Metric label="File count" value={fmtNumber(summary.capacity.storageFileCount)} />
                  <Metric label="Storage capacity" value={fmtPercent(summary.capacity.storageCapacityPercent)} />
                  <Metric label="Monthly storage growth" value={fmtBytes(summary.capacity.monthlyDataGrowth.storageBytes)} />
                  <Metric label="Monthly DB growth" value={fmtPercent(summary.capacity.monthlyDataGrowth.database)} />
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Bucket</th>
                          <th>Files</th>
                          <th>Size</th>
                          <th>Newest file</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.capacity.storageBuckets.length ? (
                          summary.capacity.storageBuckets.slice(0, 6).map((bucket) => (
                            <tr key={bucket.bucket} className="border-t border-slate-100">
                              <td className="px-3 py-2 font-medium text-slate-900">{bucket.bucket}</td>
                              <td>{fmtNumber(bucket.fileCount)}</td>
                              <td>{fmtBytes(bucket.sizeBytes)}</td>
                              <td>{fmtDate(bucket.newestFileAt)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4} className="px-3 py-3 text-slate-500">
                              Storage bucket statistics are Not Available.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Table</th>
                          <th>Rows</th>
                          <th>Total</th>
                          <th>Indexes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.capacity.tableStats.length ? (
                          summary.capacity.tableStats.slice(0, 8).map((table) => (
                            <tr key={String(table.table_name)} className="border-t border-slate-100">
                              <td className="px-3 py-2 font-medium text-slate-900">{String(table.table_name || "-")}</td>
                              <td>{fmtNumber(Number(table.estimated_rows || 0))}</td>
                              <td>{fmtBytes(Number(table.total_bytes || 0))}</td>
                              <td>{fmtBytes(Number(table.index_bytes || 0))}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4} className="px-3 py-3 text-slate-500">
                              Database table statistics are Not Available.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Panel>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <Panel title="Users" icon={<UserCog className="h-5 w-5 text-png-red" />}>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Metric label="Total" value={fmtNumber(summary.users.total)} />
                  <Metric label="Active" value={fmtNumber(summary.users.active)} />
                  <Metric label="Disabled" value={fmtNumber(summary.users.disabled)} />
                  <Metric label="Recent logins" value={fmtNumber(summary.users.recentLogins)} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Metric label="Inactive 30+ days" value={fmtNumber(summary.users.inactive30)} />
                  <Metric label="Inactive 60+ days" value={fmtNumber(summary.users.inactive60)} />
                  <Metric label="Inactive 90+ days" value={fmtNumber(summary.users.inactive90)} />
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-900">Users by role</p>
                  <div className="mt-2 space-y-2">
                    {summary.users.byRole.slice(0, 8).map((row) => (
                      <Bar key={row.role} label={row.role} value={row.count} max={Math.max(1, summary.users.total)} />
                    ))}
                  </div>
                </div>
                <Link href="/dashboard/users" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                  <Users className="h-4 w-4" /> Open controlled user administration
                </Link>
              </Panel>

              <Panel title="Transaction Monitoring" icon={<Activity className="h-5 w-5 text-png-red" />}>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="py-2">Area</th>
                        <th>Today</th>
                        <th>This month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["FF3", summary.transactions.ff3],
                        ["Commitments", summary.transactions.commitments],
                        ["FF4", summary.transactions.ff4],
                        ["Payments", summary.transactions.payments],
                        ["Reconciliations", summary.transactions.reconciliations],
                        ["Reports", summary.transactions.reports],
                        ["Audit events", summary.transactions.auditEvents],
                      ].map(([label, counts]) => {
                        const c = counts as { today: number | null; month: number | null }
                        return (
                          <tr key={label as string} className="border-t border-slate-100">
                            <td className="py-2 font-medium text-slate-900">{label as string}</td>
                            <td>{fmtNumber(c.today)}</td>
                            <td>{fmtNumber(c.month)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Attention label="Long-pending FF3" value={summary.transactions.requiringAttention.longPendingFf3} />
                  <Attention label="Long-pending FF4" value={summary.transactions.requiringAttention.longPendingFf4} />
                  <Attention label="Unreconciled payments" value={summary.transactions.requiringAttention.unreconciledPayments} />
                  <Attention label="Failed/error activity" value={summary.transactions.requiringAttention.recentErrors} />
                </div>
              </Panel>
            </section>

            <section className="grid gap-4 xl:grid-cols-3">
              <Panel title="Operating Costs" icon={<ReceiptText className="h-5 w-5 text-png-red" />} className="xl:col-span-2">
                <div className="grid gap-3 md:grid-cols-4">
                  <Metric label={`Current month (${summary.costs.baseCurrency})`} value={fmtMoney(summary.costs.currentMonth, summary.costs.baseCurrency)} />
                  <Metric label={`Previous month (${summary.costs.baseCurrency})`} value={fmtMoney(summary.costs.previousMonth, summary.costs.baseCurrency)} />
                  <Metric label="Change" value={fmtPercent(summary.costs.percentageChange)} />
                  <Metric label={`Projected annual (${summary.costs.baseCurrency})`} value={fmtMoney(summary.costs.projectedAnnualOperatingCost, summary.costs.baseCurrency)} />
                  <Metric label={`Live provider costs (${summary.costs.baseCurrency})`} value={fmtMoney(summary.costs.liveCurrentMonth, summary.costs.baseCurrency)} />
                  <Metric label={`Manual register (${summary.costs.baseCurrency})`} value={fmtMoney(summary.costs.manualCurrentMonth, summary.costs.baseCurrency)} />
                </div>

                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-[760px] w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Live provider</th>
                        <th>Category</th>
                        <th>Status</th>
                        <th>Source</th>
                        <th>Current month</th>
                        <th>Previous month</th>
                        <th>Usage</th>
                        <th>Last checked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.costs.liveProviders.length ? (
                        summary.costs.liveProviders.map((provider) => (
                          <tr key={provider.id} className="border-t border-slate-100 align-top">
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-900">{provider.name}</div>
                              <div className="mt-0.5 text-xs text-slate-500">{provider.notes}</div>
                              {provider.dashboardUrl && (
                                <a href={provider.dashboardUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-png-red hover:text-png-maroon">
                                  Open provider dashboard
                                </a>
                              )}
                            </td>
                            <td>{provider.category}</td>
                            <td>
                              <ProviderStatus status={provider.status} />
                            </td>
                            <td>{provider.source.replace(/_/g, " ")}</td>
                            <td className="font-semibold">{fmtMoney(provider.currentMonthCost, provider.currency)}</td>
                            <td>{fmtMoney(provider.previousMonthCost, provider.currency)}</td>
                            <td>{provider.usageLabel ? `${provider.usageLabel}: ${provider.usageValue ?? "Not Available"} ${provider.usageUnit || ""}` : "Not Available"}</td>
                            <td>{fmtDate(provider.lastCheckedAt)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={8} className="px-3 py-3 text-slate-500">
                            No live provider cost records are available.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Live provider totals are converted into {summary.costs.baseCurrency} only when server-side exchange rates are configured. Original provider currency values remain visible in the live provider table. Configured conversion currencies:{" "}
                  {summary.costs.currencyRatesConfigured.length ? summary.costs.currencyRatesConfigured.join(", ") : "none"}.
                </div>
                {summary.costs.liveTotalsByCurrency.length > 0 && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {summary.costs.liveTotalsByCurrency.map((item) => (
                      <Metric key={item.currency} label={`Live total ${item.currency}`} value={fmtMoney(item.currentMonth, item.currency)} />
                    ))}
                  </div>
                )}

                <div className="mt-4 flex h-44 items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  {summary.costs.trend.length ? (
                    summary.costs.trend.slice(-12).map((row) => {
                      const max = Math.max(...summary.costs.trend.map((item) => item.total), 1)
                      return (
                        <div key={row.month} className="flex flex-1 flex-col items-center gap-2">
                          <div className="w-full rounded-t bg-png-red" style={{ height: `${Math.max(8, (row.total / max) * 130)}px` }} />
                          <span className="text-[10px] text-slate-500">{row.month.slice(5)}</span>
                        </div>
                      )
                    })
                  ) : (
                    <p className="self-center text-sm text-slate-500">No cost trend yet. Add monthly support costs below.</p>
                  )}
                </div>

                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-[850px] w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Service/provider</th>
                        <th>Category</th>
                        <th>Month</th>
                        <th>Currency</th>
                        <th>Fixed</th>
                        <th>Usage</th>
                        <th>Other</th>
                        <th>Total</th>
                        <th>Status</th>
                        <th>Invoice/reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.costs.rows.length ? (
                        summary.costs.rows.slice(0, 10).map((row) => (
                          <tr key={row.id} className="border-t border-slate-100">
                            <td className="px-3 py-2 font-medium text-slate-900">{row.service_provider}</td>
                            <td>{row.cost_category}</td>
                            <td>{row.billing_month?.slice(0, 7)}</td>
                            <td>{row.currency}</td>
                            <td>{fmtMoney(row.monthly_fixed_cost, row.currency)}</td>
                            <td>{fmtMoney(row.usage_cost, row.currency)}</td>
                            <td>{fmtMoney(row.other_cost, row.currency)}</td>
                            <td className="font-semibold">{fmtMoney(row.total_cost, row.currency)}</td>
                            <td>{row.payment_status}</td>
                            <td>{row.invoice_reference || "-"}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={10} className="px-3 py-3 text-slate-500">
                            No operating cost records have been entered yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="Add Monthly Operating Cost" icon={<ReceiptText className="h-5 w-5 text-png-red" />}>
                <div className="space-y-3">
                  <Input label="Service/provider" value={form.service_provider} onChange={(v) => setForm({ ...form, service_provider: v })} />
                  <Select label="Cost category" value={form.cost_category} onChange={(v) => setForm({ ...form, cost_category: v })} options={summary.costs.categories} />
                  <Input label="Billing month" type="month" value={form.billing_month} onChange={(v) => setForm({ ...form, billing_month: v })} />
                  <div className="grid grid-cols-3 gap-2">
                    <Input label="Fixed" type="number" value={form.monthly_fixed_cost} onChange={(v) => setForm({ ...form, monthly_fixed_cost: v })} />
                    <Input label="Usage" type="number" value={form.usage_cost} onChange={(v) => setForm({ ...form, usage_cost: v })} />
                    <Input label="Other" type="number" value={form.other_cost} onChange={(v) => setForm({ ...form, other_cost: v })} />
                  </div>
                  <Input label="Invoice/reference" value={form.invoice_reference} onChange={(v) => setForm({ ...form, invoice_reference: v })} />
                  <Select label="Payment status" value={form.payment_status} onChange={(v) => setForm({ ...form, payment_status: v })} options={["Pending", "Approved", "Paid", "Disputed", "Not Applicable"]} />
                  <Input label="Operational monthly budget" type="number" value={form.operational_budget} onChange={(v) => setForm({ ...form, operational_budget: v })} />
                  <button onClick={saveCost} disabled={saving} className="w-full rounded-lg bg-png-red px-3 py-2 text-sm font-semibold text-white hover:bg-png-maroon disabled:opacity-60">
                    {saving ? "Saving..." : "Save cost entry"}
                  </button>
                </div>
              </Panel>
            </section>

            <section className="grid gap-4 xl:grid-cols-3">
              <Panel title="Systems Alert" icon={<Bell className="h-5 w-5 text-png-red" />}>
                <div className="space-y-3">
                  {summary.alerts.active.length ? (
                    summary.alerts.active.map((alert) => (
                      <div key={alert.code} className={`rounded-xl border p-3 text-sm ${alert.severity === "critical" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                        <p className="font-semibold">{alert.title}</p>
                        <p className="mt-1">{alert.detail}</p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">No active operational warnings.</div>
                  )}
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-900">Configured warnings</p>
                  <div className="mt-2 space-y-2">
                    {summary.alerts.settings.map((setting) => {
                      const edit = alertEdits[setting.code] || { threshold_value: "", enabled: setting.enabled, notes: setting.notes || "" }
                      return (
                        <div key={setting.code} className="rounded-lg bg-white px-3 py-2 text-xs">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-slate-700">{setting.label}</p>
                              <p className="mt-0.5 text-slate-500">{setting.notes || "No notes recorded."}</p>
                            </div>
                            <label className="flex items-center gap-1 text-slate-600">
                              <input
                                type="checkbox"
                                checked={edit.enabled}
                                onChange={(event) =>
                                  setAlertEdits((current) => ({
                                    ...current,
                                    [setting.code]: { ...edit, enabled: event.target.checked },
                                  }))
                                }
                              />
                              Enabled
                            </label>
                          </div>
                          <div className="mt-2 flex gap-2">
                            <input
                              type="number"
                              placeholder="Threshold"
                              value={edit.threshold_value}
                              onChange={(event) =>
                                setAlertEdits((current) => ({
                                  ...current,
                                  [setting.code]: { ...edit, threshold_value: event.target.value },
                                }))
                              }
                              className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs"
                            />
                            <button onClick={() => saveAlertSetting(setting.code)} disabled={saving} className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60">
                              Save
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </Panel>

              <Panel title="Housekeeping" icon={<Wrench className="h-5 w-5 text-png-red" />}>
                <KeyValue label="Inactive accounts" value={fmtNumber(summary.housekeeping.inactiveAccounts)} />
                <KeyValue label="Stale sessions" value={String(summary.housekeeping.staleSessions)} />
                <KeyValue label="Temporary/orphaned uploads" value={fmtNumber(summary.housekeeping.orphanedUploads)} />
                <KeyValue label="Backup status" value={summary.housekeeping.backupStatus} />
                <KeyValue label="Logs requiring review" value={fmtNumber(summary.housekeeping.systemErrorsToReview)} />
                <div className="mt-3 space-y-2">
                  {summary.housekeeping.safeOpportunities.map((item) => (
                    <div key={item} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      {item}
                    </div>
                  ))}
                </div>
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{summary.housekeeping.protectedDataNotice}</p>
              </Panel>

              <Panel title="System Information" icon={<ShieldCheck className="h-5 w-5 text-png-red" />}>
                <KeyValue label="Project ref" value={summary.health.supabaseProjectRef || "Not Available"} mono />
                <KeyValue label="Version" value={summary.health.applicationVersion} />
                <KeyValue label="Commit" value={summary.health.commitSha} mono />
                <KeyValue label="Generated" value={fmtDate(summary.generatedAt)} />
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Secrets, passwords, service-role keys, SMTP credentials, API tokens and database credentials are intentionally never displayed.
                </div>
                <Link href="/dashboard/system-info" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-png-red hover:text-png-maroon">
                  Open system information <FileText className="h-4 w-4" />
                </Link>
              </Panel>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <Panel title="Housekeeping Backup & Validation" icon={<ShieldCheck className="h-5 w-5 text-png-red" />}>
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">Backup package</h3>
                    <p className="mt-1 text-sm text-slate-600">Generate a portable backup package for secure offline storage and approved operational recovery procedures.</p>
                    <button onClick={createBackup} disabled={saving} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                      <ShieldCheck className="h-4 w-4" />
                      {saving ? "Processing..." : "Create backup"}
                    </button>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">Validate backup file</h3>
                    <p className="mt-1 text-sm text-slate-600">Upload a backup archive to verify integrity and suitability before restoration.</p>
                    <input
                      type="file"
                      accept=".zip,.tar,.gz,.tgz,.json,.sql"
                      onChange={(event) => validateBackup(event.target.files?.[0] || null)}
                      className="mt-3 block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
                    />
                  </div>

                  {backupValidation && (
                    <div className={`rounded-xl border p-4 ${backupValidation.valid ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                      <div className="flex items-center gap-2">
                        {backupValidation.valid ? <CheckCircle2 className="h-5 w-5 text-green-700" /> : <AlertTriangle className="h-5 w-5 text-red-700" />}
                        <p className={`text-sm font-semibold ${backupValidation.valid ? "text-green-800" : "text-red-800"}`}>{backupValidation.status}</p>
                      </div>
                      {backupValidation.issues.length > 0 && (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                          {backupValidation.issues.map((issue, index) => (
                            <li key={`${issue}-${index}`}>{issue}</li>
                          ))}
                        </ul>
                      )}
                      {backupValidation.nextSteps?.length ? (
                        <div className="mt-3">
                          <p className="text-xs font-semibold uppercase tracking-wide">Next steps</p>
                          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                            {backupValidation.nextSteps.map((step, index) => (
                              <li key={`${step}-${index}`}>{step}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </Panel>

              <Panel title="Data Quality & Cleanup" icon={<Database className="h-5 w-5 text-png-red" />}>
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">Scan for quality issues</p>
                    <p className="mt-1 text-sm text-slate-600">Run a housekeeping scan to identify records that may need review, archiving, or corrective cleanup.</p>
                    <button onClick={runDataQualityScan} disabled={saving} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                      <Activity className="h-4 w-4" />
                      {saving ? "Scanning..." : "Run data quality scan"}
                    </button>
                  </div>

                  {dataQuality && (
                    <div className="rounded-xl border border-slate-200 p-4">
                      <p className="text-sm font-semibold text-slate-900">Scan results</p>
                      <p className="mt-1 text-xs text-slate-500">Generated {fmtDate(dataQuality.generatedAt)}</p>
                      <div className="mt-3 space-y-2">
                        {dataQuality.summary.map((item) => (
                          <div key={item.validation} className="rounded-lg bg-slate-50 px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-slate-800">{item.validation}</p>
                              <p className="text-sm font-semibold text-slate-900">{fmtNumber(item.issues)}</p>
                            </div>
                            <p className="mt-1 text-xs text-slate-600">{item.detail}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <p className="font-semibold">Archive candidates</p>
                        <p className="mt-1">Long pending FF3: {fmtNumber(dataQuality.archiveCandidates.longPendingFf3)}</p>
                        <p>Unreconciled payments: {fmtNumber(dataQuality.archiveCandidates.unreconciledPayments)}</p>
                        <p className="mt-1 text-xs">{dataQuality.archiveCandidates.note}</p>
                      </div>
                      <div className="mt-3 space-y-2">
                        {dataQuality.cleanupWizard.map((step, index) => (
                          <div key={`${step}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            {step}
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">{dataQuality.safetyNotice}</p>
                    </div>
                  )}
                </div>
              </Panel>
            </section>
          </>
        ) : null}
      </div>
    </PagePermissionGate>
  )
}

function PriorityCard({ label, value, sub, icon: Icon, tone }: { label: string; value: string; sub: string; icon: typeof Gauge; tone: string }) {
  const colors: Record<string, string> = {
    gold: "border-[#D4A62A]/40 bg-[#FFF8E1] text-[#7A1F2B]",
    green: "border-green-200 bg-green-50 text-green-800",
    red: "border-red-200 bg-red-50 text-red-800",
    slate: "border-slate-200 bg-white text-slate-900",
  }
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${colors[tone] || colors.slate}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
          <p className="mt-2 text-2xl font-bold">{value}</p>
          <p className="mt-1 text-sm opacity-75">{sub}</p>
        </div>
        <div className="rounded-xl bg-white/70 p-3">
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  )
}

function Panel({ title, icon, children, className = "" }: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
    </div>
  )
}

function StatusRow({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="mb-2 flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${good ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"}`}>
        {good ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
        {value}
      </span>
    </div>
  )
}

function KeyValue({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="mb-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`break-all text-sm font-semibold text-slate-900 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  )
}

function Attention({ label, value }: { label: string; value: number | null }) {
  const active = (value || 0) > 0
  return (
    <div className={`rounded-xl border p-3 ${active ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
      <p className={`mt-1 text-xl font-bold ${active ? "text-amber-900" : "text-green-800"}`}>{fmtNumber(value)}</p>
    </div>
  )
}

function ProviderStatus({ status }: { status: LiveProviderCost["status"] }) {
  const tone = status === "connected" ? "bg-green-100 text-green-700" : status === "partial" ? "bg-amber-100 text-amber-800" : status === "unavailable" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
  const label = status === "not_configured" ? "Not configured" : status.charAt(0).toUpperCase() + status.slice(1)
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">{value}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-200">
        <div className="h-2 rounded-full bg-png-red" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} />
      </div>
    </div>
  )
}

function Notice({ tone, icon, text }: { tone: "red" | "green"; icon: React.ReactNode; text: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"}`}>
      {icon}
      <p>{text}</p>
    </div>
  )
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red" />
    </label>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red">
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}
