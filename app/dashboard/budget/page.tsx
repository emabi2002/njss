"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Wallet, TrendingUp, DollarSign, FileText, Loader2, Layers, Hash, Building2, Play, CheckCircle2, AlertCircle, Download, RefreshCw } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts"
import { getBudgetByCode, getConsolidations, consolidateDepartmentBudget, getDepartments } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"
import { exportToCSV, exportToPDF, rowsToPdfTable } from "@/lib/export"

type CodeRow = {
  financial_year: number
  department_id: string | null
  department_name: string | null
  section_id: string | null
  section_name: string | null
  cost_centre_id: string | null
  cost_centre_code: string | null
  cost_centre_name: string | null
  expense_code_registry_id: string | null
  full_expense_code: string | null
  revised_budget: number
  committed_amount: number
  actual_expenditure: number
}

type Consolidation = {
  id: string
  financial_year: number
  status: string
  total_amount: number
  section_count: number
  plan_count: number
  consolidated_at: string | null
  department: { code: string; name: string } | null
}

type Dept = { id: string; code: string; name: string }
type Tab = "code" | "centre" | "consolidation"

const CHART_COLORS = ["#8a1420", "#4c0f16", "#d4af37", "#a8324a", "#b8860b", "#6b1420"]

export default function BudgetControlPage() {
  const { can } = useAuth()
  const [tab, setTab] = useState<Tab>("code")
  const [year, setYear] = useState(2025)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<CodeRow[]>([])
  const [consolidations, setConsolidations] = useState<Consolidation[]>([])
  const [depts, setDepts] = useState<Dept[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [codeData, consData, deptData] = await Promise.all([
        getBudgetByCode(year),
        getConsolidations(year),
        getDepartments(),
      ])
      setRows((codeData || []) as unknown as CodeRow[])
      setConsolidations((consData || []) as unknown as Consolidation[])
      setDepts((deptData || []) as unknown as Dept[])
    } catch (err) {
      console.error("Error loading budget data:", err)
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
  }, [fetchData])

  const totals = useMemo(() => {
    const revised = rows.reduce((s, r) => s + (r.revised_budget || 0), 0)
    const committed = rows.reduce((s, r) => s + (r.committed_amount || 0), 0)
    const actual = rows.reduce((s, r) => s + (r.actual_expenditure || 0), 0)
    return { revised, committed, actual, available: revised - committed - actual }
  }, [rows])

  // Roll-up by cost centre
  const byCentre = useMemo(() => {
    const map = new Map<string, { label: string; revised: number; committed: number; actual: number }>()
    for (const r of rows) {
      const key = r.cost_centre_code || r.section_name || "Unassigned"
      const label = r.cost_centre_code ? `${r.cost_centre_code} — ${r.cost_centre_name}` : r.section_name || "Unassigned"
      const e = map.get(key) || { label, revised: 0, committed: 0, actual: 0 }
      e.revised += r.revised_budget || 0
      e.committed += r.committed_amount || 0
      e.actual += r.actual_expenditure || 0
      map.set(key, e)
    }
    return Array.from(map.values()).sort((a, b) => b.revised - a.revised)
  }, [rows])

  const chartData = useMemo(
    () => byCentre.slice(0, 8).map((c) => ({ name: c.label.split(" — ")[0], available: c.revised - c.committed - c.actual, used: c.committed + c.actual })),
    [byCentre]
  )

  const exportCurrent = (format: "csv" | "pdf") => {
    const stamp = new Date().toISOString().split("T")[0]
    if (tab === "code") {
      const records = rows.map((r) => ({
        "Expense Code": r.full_expense_code || "-", Department: r.department_name || "-",
        "Cost Centre": r.cost_centre_code || "-", "Approved (K)": r.revised_budget || 0,
        "Committed (K)": r.committed_amount || 0, "Actual (K)": r.actual_expenditure || 0,
        "Available (K)": (r.revised_budget || 0) - (r.committed_amount || 0) - (r.actual_expenditure || 0),
      }))
      if (records.length === 0) return
      if (format === "csv") exportToCSV(`budget_by_code_${stamp}`, records)
      else { const { columns, rows: r } = rowsToPdfTable(records); exportToPDF({ title: "Budget by Expense Code", subtitle: `FY${year}`, columns, rows: r, filename: `budget_by_code_${stamp}` }) }
    } else if (tab === "centre") {
      const records = byCentre.map((c) => ({ "Cost Centre": c.label, "Approved (K)": c.revised, "Committed (K)": c.committed, "Actual (K)": c.actual, "Available (K)": c.revised - c.committed - c.actual }))
      if (records.length === 0) return
      if (format === "csv") exportToCSV(`budget_by_cost_centre_${stamp}`, records)
      else { const { columns, rows: r } = rowsToPdfTable(records); exportToPDF({ title: "Budget by Cost Centre", subtitle: `FY${year}`, columns, rows: r, filename: `budget_by_cost_centre_${stamp}` }) }
    } else {
      const records = consolidations.map((c) => ({ Department: c.department?.name || "-", Status: c.status, Sections: c.section_count, Plans: c.plan_count, "Total (K)": c.total_amount }))
      if (records.length === 0) return
      if (format === "csv") exportToCSV(`consolidations_${stamp}`, records)
      else { const { columns, rows: r } = rowsToPdfTable(records); exportToPDF({ title: "Budget Consolidations", subtitle: `FY${year}`, columns, rows: r, filename: `consolidations_${stamp}` }) }
    }
  }

  const TABS: { key: Tab; label: string; icon: typeof Hash }[] = [
    { key: "code", label: "By Expense Code", icon: Hash },
    { key: "centre", label: "By Cost Centre", icon: Layers },
    { key: "consolidation", label: "Consolidation", icon: Building2 },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Wallet className="h-7 w-7 text-png-red" /> Budget Control
          </h1>
          <p className="text-slate-600 mt-1">Approved budget, commitments &amp; actual expenditure by code, cost centre and department</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value))}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red">
            {[2024, 2025, 2026].map((y) => <option key={y} value={y}>FY{y}</option>)}
          </select>
          <button onClick={() => fetchData()} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50" title="Refresh">
            <RefreshCw className="h-4 w-4 text-slate-600" />
          </button>
          <button onClick={() => exportCurrent("csv")} className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2">
            <Download className="h-4 w-4" /> CSV
          </button>
          <button onClick={() => exportCurrent("pdf")} className="px-3 py-2 bg-png-red text-white rounded-lg text-sm font-medium hover:bg-png-maroon flex items-center gap-2">
            <Download className="h-4 w-4" /> PDF
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard title="Approved Budget" value={totals.revised} subtitle="Confirmed allocations" icon={<Wallet className="h-6 w-6" />} tone="maroon" />
        <SummaryCard title="Committed" value={totals.committed} subtitle="Outstanding commitments" icon={<FileText className="h-6 w-6" />} tone="gold" />
        <SummaryCard title="Actual Expenditure" value={totals.actual} subtitle="Paid to date" icon={<DollarSign className="h-6 w-6" />} tone="red" />
        <SummaryCard title="Available Balance" value={totals.available} subtitle="Ready to commit" icon={<TrendingUp className="h-6 w-6" />} tone="green" />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${tab === t.key ? "bg-png-red/10 text-png-red border border-png-gold/40" : "text-slate-600 hover:bg-slate-100 border border-transparent"}`}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div>
      ) : tab === "code" ? (
        <ByCodeTable rows={rows} />
      ) : tab === "centre" ? (
        <ByCentreView byCentre={byCentre} chartData={chartData} />
      ) : (
        <ConsolidationView year={year} depts={depts} consolidations={consolidations} canRun={can("consolidation.run")} onChanged={fetchData} />
      )}
    </div>
  )
}

function ByCodeTable({ rows }: { rows: CodeRow[] }) {
  if (rows.length === 0) return <EmptyState message="No confirmed budget allocations yet. Confirm an annual plan to populate budget codes." />
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Expense Code</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Department</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Cost Centre</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Approved</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Committed</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Actual</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Available</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Used %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => {
              const avail = (r.revised_budget || 0) - (r.committed_amount || 0) - (r.actual_expenditure || 0)
              const used = r.revised_budget ? ((r.committed_amount + r.actual_expenditure) / r.revised_budget) * 100 : 0
              return (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><span className="font-mono text-sm text-png-red font-medium">{r.full_expense_code || "—"}</span></td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.department_name || "-"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.cost_centre_code ? `${r.cost_centre_code}` : "-"}</td>
                  <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">K {(r.revised_budget || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-png-maroon text-right">K {(r.committed_amount || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-png-red text-right">K {(r.actual_expenditure || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold"><span className={avail >= 0 ? "text-green-700" : "text-red-600"}>K {avail.toLocaleString()}</span></td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${used > 80 ? "bg-red-100 text-red-700" : used > 60 ? "bg-png-gold/25 text-png-maroon" : "bg-green-100 text-green-700"}`}>{used.toFixed(0)}%</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ByCentreView({ byCentre, chartData }: { byCentre: { label: string; revised: number; committed: number; actual: number }[]; chartData: { name: string; available: number; used: number }[] }) {
  if (byCentre.length === 0) return <EmptyState message="No cost-centre budgets yet." />
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Available vs Used by Cost Centre</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" tickFormatter={(v) => `K${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => `K ${Number(v).toLocaleString()}`} />
              <Bar dataKey="used" name="Committed + Actual" stackId="a" fill="#8a1420" radius={[0, 0, 0, 0]} />
              <Bar dataKey="available" name="Available" stackId="a" fill="#d4af37" radius={[4, 4, 0, 0]}>
                {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Cost Centre</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Approved</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Committed</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Actual</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Available</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byCentre.map((c, i) => {
                const avail = c.revised - c.committed - c.actual
                return (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{c.label}</td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right">K {c.revised.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-png-maroon text-right">K {c.committed.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-png-red text-right">K {c.actual.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold"><span className={avail >= 0 ? "text-green-700" : "text-red-600"}>K {avail.toLocaleString()}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ConsolidationView({ year, depts, consolidations, canRun, onChanged }: {
  year: number; depts: Dept[]; consolidations: Consolidation[]; canRun: boolean; onChanged: () => void
}) {
  const [deptId, setDeptId] = useState("")
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const run = async () => {
    if (!deptId) return
    setRunning(true); setMsg(null)
    try {
      const res = await consolidateDepartmentBudget(year, deptId)
      setMsg({ type: "ok", text: `Consolidated ${depts.find((d) => d.id === deptId)?.name}: K ${(res?.total_amount || 0).toLocaleString()} across ${res?.plan_count || 0} plan(s).` })
      onChanged()
    } catch (err: unknown) {
      setMsg({ type: "err", text: err instanceof Error ? err.message : "Consolidation failed." })
    } finally {
      setRunning(false)
    }
  }

  const grandTotal = consolidations.reduce((s, c) => s + (c.total_amount || 0), 0)

  return (
    <div className="space-y-6">
      {canRun && (
        <div className="bg-white rounded-lg border border-png-gold/40 p-5">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-1"><Building2 className="h-4 w-4 text-png-gold" /> Run Department Consolidation</h3>
          <p className="text-xs text-slate-500 mb-4">Roll up all authorized &amp; budget-confirmed section plans for a department into a consolidated budget for FY{year}.</p>
          {msg && (
            <div className={`mb-3 rounded-lg p-2.5 text-sm flex items-center gap-2 ${msg.type === "ok" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
              {msg.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {msg.text}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs font-medium text-slate-500 mb-1">Department</label>
              <select value={deptId} onChange={(e) => setDeptId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red">
                <option value="">Select department...</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
              </select>
            </div>
            <button onClick={run} disabled={!deptId || running}
              className="px-4 py-2 bg-png-red text-white rounded-lg text-sm font-medium hover:bg-png-maroon disabled:opacity-50 flex items-center gap-2">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run Consolidation
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Consolidated Department Budgets — FY{year}</h2>
          <span className="text-sm text-slate-600">Total: <span className="font-bold text-png-red">K {grandTotal.toLocaleString()}</span></span>
        </div>
        {consolidations.length === 0 ? (
          <EmptyState message="No consolidations yet. Run a department roll-up above." bordered={false} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Department</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Sections</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Plans</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Total Budget</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Consolidated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {consolidations.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-900">{c.department?.name || "-"}</div>
                      <div className="text-xs text-slate-400 font-mono">{c.department?.code}</div>
                    </td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-600 text-white">{c.status}</span></td>
                    <td className="px-4 py-3 text-sm text-slate-700 text-right">{c.section_count}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 text-right">{c.plan_count}</td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900 text-right">K {(c.total_amount || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{c.consolidated_at ? new Date(c.consolidated_at).toLocaleDateString("en-GB") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ message, bordered = true }: { message: string; bordered?: boolean }) {
  return (
    <div className={`text-center py-16 text-slate-500 ${bordered ? "bg-white rounded-lg border border-slate-200" : ""}`}>
      <Layers className="h-12 w-12 mx-auto text-slate-300 mb-3" />
      <p className="text-sm max-w-md mx-auto">{message}</p>
    </div>
  )
}

function SummaryCard({ title, value, subtitle, icon, tone }: {
  title: string; value: number; subtitle: string; icon: React.ReactNode; tone: "maroon" | "gold" | "red" | "green"
}) {
  const toneClasses = {
    maroon: "bg-png-maroon/10 text-png-maroon",
    gold: "bg-png-gold/20 text-png-maroon",
    red: "bg-png-red/10 text-png-red",
    green: "bg-green-100 text-green-700",
  }
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg ${toneClasses[tone]}`}>{icon}</div>
      </div>
      <h3 className="text-xs font-medium text-slate-600 uppercase tracking-wide">{title}</h3>
      <p className="text-2xl font-bold text-slate-900 mt-1">K {value.toLocaleString()}</p>
      <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
    </div>
  )
}
