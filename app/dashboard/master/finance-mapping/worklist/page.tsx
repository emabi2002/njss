"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, ListChecks, Loader2, RefreshCw, Search, ShieldCheck } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import {
  getBudgetActivationMappingWorklist,
  type BudgetActivationMappingWorklistRow,
} from "@/lib/finance-posting-mapping"

function money(value: number | null | undefined) {
  return `K${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function statusClass(status: string) {
  if (status === "READY") return "bg-emerald-100 text-emerald-700"
  if (status.includes("INACTIVE")) return "bg-red-100 text-red-700"
  return "bg-amber-100 text-amber-700"
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function FinanceMappingWorklistPage() {
  const { roles, can } = useAuth()
  const isSystemAdministrator = roles.includes("System Administrator")
  const canManage = isSystemAdministrator && (can("masterdata.manage") || can("registry.manage") || can("all"))

  const [rows, setRows] = useState<BudgetActivationMappingWorklistRow[]>([])
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setRows(await getBudgetActivationMappingWorklist())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the approved-budget Finance mapping worklist.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const statuses = useMemo(() => Array.from(new Set(rows.map((row) => row.mapping_status))).sort(), [rows])
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (statusFilter !== "ALL" && row.mapping_status !== statusFilter) return false
      if (!needle) return true
      return [
        row.submission_number,
        row.division_code,
        row.division_name,
        row.cost_centre_code,
        row.cost_centre_name,
        row.finance_code,
        row.finance_description,
        row.finance_expense_category,
        row.legacy_posting_code,
        row.canonical_posting_code,
        row.chart_account_code,
        row.chart_account_name,
        statusLabel(row.mapping_status),
      ].some((value) => String(value || "").toLowerCase().includes(needle))
    })
  }, [rows, search, statusFilter])

  const ready = rows.filter((row) => row.mapping_status === "READY").length
  const outstanding = rows.length - ready
  const total = rows.reduce((sum, row) => sum + Number(row.annual_estimate || 0), 0)

  if (!canManage) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">Activation Mapping Worklist is restricted to the System Administrator.</div>
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#A97C12]"><ShieldCheck className="h-4 w-4" /> System Administration · Finance Master Data</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Activation Mapping Worklist</h1>
          <p className="mt-1 max-w-5xl text-sm text-slate-600">Every approved-budget Finance Code × Cost Centre context that must resolve before Registrar activation. The worklist does not guess Chart-of-Accounts classifications or change approved budget figures.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/master/finance-mapping" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Open Finance Mapping</Link>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
        </div>
      </div>

      {error && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4" /><span>{error}</span></div>}

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Required contexts" value={String(rows.length)} icon={<ListChecks className="h-5 w-5" />} />
        <Metric label="Ready" value={String(ready)} icon={<CheckCircle2 className="h-5 w-5" />} />
        <Metric label="Outstanding" value={String(outstanding)} icon={<AlertCircle className="h-5 w-5" />} />
        <Metric label="Approved value represented" value={money(total)} icon={<ShieldCheck className="h-5 w-5" />} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row">
            <label className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search submission, division, Finance Code, Cost Centre..." className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-png-red" /></label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="ALL">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>
          </div>
          <div className="text-xs text-slate-500">Showing {visibleRows.length} of {rows.length}</div>
        </div>

        {loading ? <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading mapping requirements...</div> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600"><tr>{["Submission","Division","Cost Centre","Finance Code","Finance Description","Legacy Posting","Canonical Posting","Chart of Accounts","Annual Estimate","Status"].map((label) => <th key={label} className="whitespace-nowrap px-3 py-3 font-semibold">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((row) => <tr key={row.budget_line_id} className="align-top hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-800">{row.submission_number}</td>
                  <td className="px-3 py-3"><div className="font-medium text-slate-800">{row.division_code}</div><div className="mt-0.5 max-w-52 text-slate-500">{row.division_name}</div></td>
                  <td className="px-3 py-3"><div className="font-mono font-medium text-slate-800">{row.cost_centre_code || "—"}</div><div className="mt-0.5 max-w-48 text-slate-500">{row.cost_centre_name || "—"}</div></td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono font-semibold text-slate-800">{row.finance_code}</td>
                  <td className="px-3 py-3"><div className="max-w-64 text-slate-700">{row.finance_description || "—"}</div><div className="mt-0.5 text-slate-400">{row.finance_expense_category || ""}</div></td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-slate-600">{row.legacy_posting_code || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-slate-700">{row.canonical_posting_code || "—"}</td>
                  <td className="px-3 py-3"><div className="font-mono font-medium text-slate-800">{row.chart_account_code || "—"}</div><div className="mt-0.5 max-w-48 text-slate-500">{row.chart_account_name || ""}</div></td>
                  <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-800">{money(row.annual_estimate)}</td>
                  <td className="whitespace-nowrap px-3 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusClass(row.mapping_status)}`}>{statusLabel(row.mapping_status)}</span></td>
                </tr>)}
                {!visibleRows.length && <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500">No mapping contexts match this filter.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-xl font-bold text-slate-900">{value}</div></div><div className="rounded-lg bg-slate-100 p-2 text-slate-600">{icon}</div></div></div>
}
