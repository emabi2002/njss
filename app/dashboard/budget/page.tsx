"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Wallet, TrendingUp, DollarSign, FileText, Loader2, Layers, Hash, Building2, Play, CheckCircle2, AlertCircle, Download, RefreshCw, Banknote, History } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts"
import { getBudgetByCode, getBudgetRevisionHistoryReport, getConsolidations, consolidateDepartmentBudget, getDepartments, getReleases, getAllocationsForRelease, createQuarterlyRelease } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"
import { supabase } from "@/lib/supabase"
import { exportToCSV, exportToPDF, rowsToPdfTable } from "@/lib/export"

type CodeRow = {
  financial_year: number
  budget_allocation_id?: string
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
  original_budget?: number
  supplemental_budget?: number
  revision_adjustment?: number
  current_revised_budget?: number
  budget_available?: number
  released_available?: number
  approved_budget?: number
  funded_amount?: number
  released_amount: number
  pending_amount?: number
  committed_amount: number
  outstanding_commitment?: number
  actual_expenditure: number
  available_amount?: number
  unfunded_amount?: number
  unreleased_funding?: number
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

type ReleaseRow = {
  id: string
  quarter: number
  release_number: string | null
  release_date: string
  released_amount: number
  revised_budget: number
  department_name: string | null
  cost_centre_code: string | null
  cost_centre_name: string | null
  full_expense_code: string | null
}

type Allocation = {
  id: string
  revised_budget: number
  funded?: number
  released: number
  unreleased_funding?: number
  releasable: number
  funding_options?: Array<{
    funding_allocation_id: string
    allocation_number: string | null
    funding_source_code: string | null
    funding_source_name: string | null
    allocated_amount: number
    released_from_allocation: number
    allocation_unreleased_balance: number
  }>
  department_name: string | null
  section_name: string | null
  cost_centre_code: string | null
  cost_centre_name: string | null
  full_expense_code: string | null
}

type Dept = { id: string; code: string; name: string }
type BudgetCycleOption = { id: string; budget_year: number; name: string; status: string }
type BudgetPeriodOption = { id: string; period_number: number; period_code: string; period_name: string }
type RevisionHistoryRow = {
  budget_revision_id: string
  revision_number: string
  division_code: string | null
  division_name: string | null
  revision_type: string
  status: string
  reason: string
  authority_reference: string | null
  effective_date: string
  created_at: string
  approved_at: string | null
  original_budget: number
  current_revised_budget_before: number
  revision_adjustment: number
  proposed_revised_budget: number
  actual_expenditure_at_submission: number
  outstanding_commitment_at_submission: number
  protected_minimum_at_submission: number
}
type Tab = "code" | "centre" | "releases" | "revisions" | "consolidation"

const CHART_COLORS = ["#8a1420", "#4c0f16", "#d4af37", "#a8324a", "#b8860b", "#6b1420"]

export default function BudgetControlPage() {
  const { can } = useAuth()
  const canViewRevisionReport = can("budget.revision.report")
  const [tab, setTab] = useState<Tab>("code")
  const [cycles, setCycles] = useState<BudgetCycleOption[]>([])
  const [periods, setPeriods] = useState<BudgetPeriodOption[]>([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<CodeRow[]>([])
  const [consolidations, setConsolidations] = useState<Consolidation[]>([])
  const [depts, setDepts] = useState<Dept[]>([])
  const [releases, setReleases] = useState<ReleaseRow[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [revisionHistory, setRevisionHistory] = useState<RevisionHistoryRow[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [codeData, consData, deptData, relData, allocData, cycleRes, revisionData] = await Promise.all([
        getBudgetByCode(year),
        getConsolidations(year),
        getDepartments(),
        getReleases(year),
        getAllocationsForRelease(year),
        supabase.from("budget_cycles").select("id, budget_year, name, status").order("budget_year", { ascending: false }),
        canViewRevisionReport ? getBudgetRevisionHistoryReport(year) : Promise.resolve([]),
      ])
      setRows((codeData || []) as unknown as CodeRow[])
      setConsolidations((consData || []) as unknown as Consolidation[])
      setDepts((deptData || []) as unknown as Dept[])
      setReleases((relData || []) as unknown as ReleaseRow[])
      setAllocations((allocData || []) as unknown as Allocation[])
      setRevisionHistory((revisionData || []) as unknown as RevisionHistoryRow[])
      const cycleRows = (cycleRes.data || []) as BudgetCycleOption[]
      setCycles(cycleRows)
      const selectedCycle = cycleRows.find((cycle) => cycle.budget_year === year) || cycleRows[0]
      if (selectedCycle) {
        const { data: periodRows } = await supabase.from("budget_periods").select("id, period_number, period_code, period_name").eq("budget_cycle_id", selectedCycle.id).eq("is_active", true).order("period_number")
        setPeriods((periodRows || []) as BudgetPeriodOption[])
        if (year !== selectedCycle.budget_year && (codeData || []).length === 0) setYear(selectedCycle.budget_year)
      }
    } catch (err) {
      console.error("Error loading budget data:", err)
    } finally {
      setLoading(false)
    }
  }, [year, canViewRevisionReport])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
  }, [fetchData])

  const totals = useMemo(() => {
    const original = rows.reduce((s, r) => s + (r.original_budget || 0), 0)
    const supplementary = rows.reduce((s, r) => s + (r.supplemental_budget || 0), 0)
    const revisionAdjustment = rows.reduce((s, r) => s + (r.revision_adjustment || 0), 0)
    const currentRevised = rows.reduce((s, r) => s + (r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0), 0)
    const funded = rows.reduce((s, r) => s + (r.funded_amount || 0), 0)
    const released = rows.reduce((s, r) => s + (r.released_amount || 0), 0)
    const pending = rows.reduce((s, r) => s + (r.pending_amount || 0), 0)
    const committed = rows.reduce((s, r) => s + (r.outstanding_commitment ?? r.committed_amount ?? 0), 0)
    const actual = rows.reduce((s, r) => s + (r.actual_expenditure || 0), 0)
    const budgetAvailable = rows.reduce((s, r) => s + (r.budget_available ?? ((r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0) - (r.outstanding_commitment ?? r.committed_amount ?? 0) - (r.actual_expenditure || 0))), 0)
    const releasedAvailable = rows.reduce((s, r) => s + (r.released_available ?? r.available_amount ?? ((r.released_amount || 0) - (r.outstanding_commitment ?? r.committed_amount ?? 0) - (r.actual_expenditure || 0))), 0)
    const unfunded = rows.reduce((s, r) => s + (r.unfunded_amount ?? ((r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0) - (r.funded_amount || 0))), 0)
    const unreleased = rows.reduce((s, r) => s + (r.unreleased_funding ?? ((r.funded_amount || 0) - (r.released_amount || 0))), 0)
    return { original, supplementary, revisionAdjustment, currentRevised, funded, released, pending, committed, actual, budgetAvailable, releasedAvailable, unfunded, unreleased }
  }, [rows])

  const byCentre = useMemo(() => {
    const map = new Map<string, { label: string; original: number; supplementary: number; revisionAdjustment: number; currentRevised: number; funded: number; released: number; pending: number; committed: number; actual: number; budgetAvailable: number; releasedAvailable: number; unfunded: number; unreleased: number }>()
    for (const r of rows) {
      const key = r.cost_centre_code || r.section_name || "Unassigned"
      const label = r.cost_centre_code ? `${r.cost_centre_code} — ${r.cost_centre_name}` : r.section_name || "Unassigned"
      const original = r.original_budget || 0
      const supplementary = r.supplemental_budget || 0
      const revisionAdjustment = r.revision_adjustment || 0
      const currentRevised = r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0
      const committed = r.outstanding_commitment ?? r.committed_amount ?? 0
      const actual = r.actual_expenditure || 0
      const budgetAvailable = r.budget_available ?? (currentRevised - committed - actual)
      const releasedAvailable = r.released_available ?? r.available_amount ?? ((r.released_amount || 0) - committed - actual)
      const e = map.get(key) || { label, original: 0, supplementary: 0, revisionAdjustment: 0, currentRevised: 0, funded: 0, released: 0, pending: 0, committed: 0, actual: 0, budgetAvailable: 0, releasedAvailable: 0, unfunded: 0, unreleased: 0 }
      e.original += original
      e.supplementary += supplementary
      e.revisionAdjustment += revisionAdjustment
      e.currentRevised += currentRevised
      e.funded += r.funded_amount || 0
      e.released += r.released_amount || 0
      e.pending += r.pending_amount || 0
      e.committed += committed
      e.actual += actual
      e.budgetAvailable += budgetAvailable
      e.releasedAvailable += releasedAvailable
      e.unfunded += r.unfunded_amount ?? (currentRevised - (r.funded_amount || 0))
      e.unreleased += r.unreleased_funding ?? ((r.funded_amount || 0) - (r.released_amount || 0))
      map.set(key, e)
    }
    return Array.from(map.values()).sort((a, b) => b.currentRevised - a.currentRevised)
  }, [rows])

  const chartData = useMemo(
    () => byCentre.slice(0, 8).map((c) => ({ name: c.label.split(" — ")[0], available: Math.max(0, c.releasedAvailable), used: c.committed + c.actual })),
    [byCentre]
  )

  const exportCurrent = (format: "csv" | "pdf") => {
    const stamp = new Date().toISOString().split("T")[0]
    const emit = (file: string, title: string, records: Record<string, string | number>[]) => {
      if (records.length === 0) return
      if (format === "csv") exportToCSV(`${file}_${stamp}`, records)
      else {
        const { columns, rows: r } = rowsToPdfTable(records)
        exportToPDF({ title, subtitle: `FY${year}`, columns, rows: r, filename: `${file}_${stamp}` })
      }
    }
    if (tab === "code") {
      emit("budget_by_code", "Budget by Expense Code", rows.map((r) => ({
        "Expense Code": r.full_expense_code || "-",
        Department: r.department_name || "-",
        "Cost Centre": r.cost_centre_code || "-",
        "Original Budget (K)": r.original_budget || 0,
        "Supplementary (K)": r.supplemental_budget || 0,
        "Revision Adjustment (K)": r.revision_adjustment || 0,
        "Current Revised Budget (K)": r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0,
        "Released (K)": r.released_amount || 0,
        "Committed (K)": r.outstanding_commitment ?? r.committed_amount ?? 0,
        "Actual (K)": r.actual_expenditure || 0,
        "Budget Available (K)": r.budget_available ?? ((r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0) - (r.outstanding_commitment ?? r.committed_amount ?? 0) - (r.actual_expenditure || 0)),
        "Released Available (K)": r.released_available ?? r.available_amount ?? ((r.released_amount || 0) - (r.outstanding_commitment ?? r.committed_amount ?? 0) - (r.actual_expenditure || 0)),
      })))
    } else if (tab === "centre") {
      emit("budget_by_cost_centre", "Budget by Cost Centre", byCentre.map((c) => ({
        "Cost Centre": c.label,
        "Original Budget (K)": c.original,
        "Supplementary (K)": c.supplementary,
        "Revision Adjustment (K)": c.revisionAdjustment,
        "Current Revised Budget (K)": c.currentRevised,
        "Funded (K)": c.funded,
        "Released (K)": c.released,
        "Pending (K)": c.pending,
        "Committed (K)": c.committed,
        "Actual (K)": c.actual,
        "Budget Available (K)": c.budgetAvailable,
        "Released Available (K)": c.releasedAvailable,
        "Unfunded (K)": c.unfunded,
        "Unreleased Funding (K)": c.unreleased,
      })))
    } else if (tab === "releases") {
      emit("quarterly_releases", "Quarterly Releases", releases.map((r) => ({
        Release: r.release_number || "-",
        "Expense Code": r.full_expense_code || "-",
        "Cost Centre": r.cost_centre_code || "-",
        Quarter: `Q${r.quarter}`,
        Date: r.release_date,
        "Amount (K)": r.released_amount || 0,
      })))
    } else if (tab === "revisions") {
      emit("budget_revision_history", "Budget Revision History", revisionHistory.map((r) => ({
        Revision: r.revision_number,
        Division: r.division_code || r.division_name || "-",
        Type: r.revision_type,
        Status: r.status,
        "Original Budget (K)": r.original_budget || 0,
        "Current Before (K)": r.current_revised_budget_before || 0,
        "Revision Adjustment (K)": r.revision_adjustment || 0,
        "Proposed Revised (K)": r.proposed_revised_budget || 0,
        "Actual at Submission (K)": r.actual_expenditure_at_submission || 0,
        "Commitments at Submission (K)": r.outstanding_commitment_at_submission || 0,
        "Protected Minimum (K)": r.protected_minimum_at_submission || 0,
        "Effective Date": r.effective_date,
      })))
    } else {
      emit("consolidations", "Budget Consolidations", consolidations.map((c) => ({
        Department: c.department?.name || "-",
        Status: c.status,
        Sections: c.section_count,
        Plans: c.plan_count,
        "Total (K)": c.total_amount,
      })))
    }
  }

  const TABS: { key: Tab; label: string; icon: typeof Hash }[] = [
    { key: "code", label: "By Expense Code", icon: Hash },
    { key: "centre", label: "By Cost Centre", icon: Layers },
    { key: "releases", label: "Releases", icon: Banknote },
    ...(canViewRevisionReport ? [{ key: "revisions" as Tab, label: "Revision History", icon: History }] : []),
    { key: "consolidation", label: "Consolidation", icon: Building2 },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Wallet className="h-7 w-7 text-png-red" /> Budget Control
          </h1>
          <p className="text-slate-600 mt-1">Approved budget, quarterly releases, commitments &amp; actual expenditure by code, cost centre and department</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red"
          >
            {cycles.length === 0 ? <option value={year}>FY{year}</option> : cycles.map((cycle) => <option key={cycle.id} value={cycle.budget_year}>{cycle.name || `FY${cycle.budget_year}`}</option>)}
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

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <SummaryCard title="Original Budget" value={totals.original} subtitle="Approved baseline" icon={<Wallet className="h-6 w-6" />} tone="maroon" />
        <SummaryCard title="Supplementary" value={totals.supplementary} subtitle="Additional authority" icon={<Layers className="h-6 w-6" />} tone="gold" />
        <SummaryCard title="Revision Adjustment" value={totals.revisionAdjustment} subtitle="Net approved movements" icon={<History className="h-6 w-6" />} tone="slate" />
        <SummaryCard title="Current Revised Budget" value={totals.currentRevised} subtitle="Current authoritative ceiling" icon={<Wallet className="h-6 w-6" />} tone="maroon" />
        <SummaryCard title="Funded" value={totals.funded} subtitle="Actual allocations" icon={<Banknote className="h-6 w-6" />} tone="gold" />
        <SummaryCard title="Released" value={totals.released} subtitle="Cash made available" icon={<Banknote className="h-6 w-6" />} tone="gold" />
        <SummaryCard title="Pending" value={totals.pending} subtitle="Submitted FF3" icon={<AlertCircle className="h-6 w-6" />} tone="slate" />
        <SummaryCard title="Committed" value={totals.committed} subtitle="Outstanding" icon={<FileText className="h-6 w-6" />} tone="slate" />
        <SummaryCard title="Actual" value={totals.actual} subtitle="Paid to date" icon={<DollarSign className="h-6 w-6" />} tone="red" />
        <SummaryCard title="Budget Available" value={totals.budgetAvailable} subtitle="Revised − Com − Act" icon={<TrendingUp className="h-6 w-6" />} tone="green" />
        <SummaryCard title="Released Available" value={totals.releasedAvailable} subtitle="Released − Com − Act" icon={<TrendingUp className="h-6 w-6" />} tone="green" />
        <SummaryCard title="Unfunded" value={totals.unfunded} subtitle="Revised − Funded" icon={<Layers className="h-6 w-6" />} tone="red" />
        <SummaryCard title="Unreleased Funding" value={totals.unreleased} subtitle="Funded − Released" icon={<Hash className="h-6 w-6" />} tone="maroon" />
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${tab === t.key ? "bg-png-red/10 text-png-red border border-png-gold/40" : "text-slate-600 hover:bg-slate-100 border border-transparent"}`}
            >
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
      ) : tab === "releases" ? (
        <ReleasesView year={year} releases={releases} allocations={allocations} periods={periods} canRelease={can("budget.release")} onChanged={fetchData} />
      ) : tab === "revisions" ? (
        <RevisionHistoryView rows={revisionHistory} />
      ) : (
        <ConsolidationView year={year} depts={depts} consolidations={consolidations} canRun={can("budget.consolidate") || can("consolidation.run")} onChanged={fetchData} />
      )}
    </div>
  )
}

function ByCodeTable({ rows }: { rows: CodeRow[] }) {
  if (rows.length === 0) return <EmptyState message="No approved Excel budget allocations yet. Approve a Budget Preparation submission to populate budget control." />
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Expense Code</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Department</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">CC</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Original Budget</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Supplementary</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Revision Adjustment</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Current Revised Budget</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Funded</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Released</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Pending</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Committed</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Actual</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Budget Available</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Released Available</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Unfunded</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Unreleased Funding</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Used %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => {
              const original = r.original_budget || 0
              const supplementary = r.supplemental_budget || 0
              const revisionAdjustment = r.revision_adjustment || 0
              const approved = r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0
              const funded = r.funded_amount || 0
              const committed = r.outstanding_commitment ?? r.committed_amount ?? 0
              const budgetAvail = r.budget_available ?? (approved - committed - (r.actual_expenditure || 0))
              const avail = r.released_available ?? r.available_amount ?? ((r.released_amount || 0) - committed - (r.actual_expenditure || 0))
              const unfunded = r.unfunded_amount ?? (approved - funded)
              const unreleased = r.unreleased_funding ?? (funded - (r.released_amount || 0))
              const used = r.released_amount ? ((committed + (r.actual_expenditure || 0)) / r.released_amount) * 100 : 0
              return (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><span className="font-mono text-sm text-png-red font-medium">{r.full_expense_code || "—"}</span></td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.department_name || "-"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 font-mono">{r.cost_centre_code || "-"}</td>
                  <td className="px-4 py-3 text-sm text-slate-900 text-right">K {original.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-png-gold-strong text-right">K {supplementary.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right">K {revisionAdjustment.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">K {approved.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-png-maroon text-right">K {funded.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-png-gold-strong text-right">K {(r.released_amount || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right">K {(r.pending_amount || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-png-maroon text-right">K {committed.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-png-red text-right">K {(r.actual_expenditure || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold"><span className={budgetAvail >= 0 ? "text-green-700" : "text-red-600"}>K {budgetAvail.toLocaleString()}</span></td>
                  <td className="px-4 py-3 text-sm text-right font-semibold"><span className={avail >= 0 ? "text-green-700" : "text-red-600"}>K {avail.toLocaleString()}</span></td>
                  <td className="px-4 py-3 text-sm text-red-600 text-right">K {unfunded.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-png-maroon text-right">K {unreleased.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${used > 90 ? "bg-red-100 text-red-700" : used > 70 ? "bg-png-gold/25 text-png-maroon" : "bg-green-100 text-green-700"}`}>{used.toFixed(0)}%</span>
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

function ByCentreView({ byCentre, chartData }: { byCentre: { label: string; original: number; supplementary: number; revisionAdjustment: number; currentRevised: number; funded: number; released: number; pending: number; committed: number; actual: number; budgetAvailable: number; releasedAvailable: number; unfunded: number; unreleased: number }[]; chartData: { name: string; available: number; used: number }[] }) {
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
              <Legend />
              <Bar dataKey="used" name="Committed + Actual" stackId="a" fill="#8a1420" />
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
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Original Budget</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Supplementary</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Revision Adjustment</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Current Revised Budget</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Funded</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Released</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Pending</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Committed</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Actual</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Budget Available</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Released Available</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Unfunded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byCentre.map((c, i) => {
                const avail = c.releasedAvailable
                return (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{c.label}</td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right">K {c.original.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-png-gold-strong text-right">K {c.supplementary.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 text-right">K {c.revisionAdjustment.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">K {c.currentRevised.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-png-maroon text-right">K {c.funded.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-png-gold-strong text-right">K {c.released.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 text-right">K {c.pending.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-png-maroon text-right">K {c.committed.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-png-red text-right">K {c.actual.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold"><span className={c.budgetAvailable >= 0 ? "text-green-700" : "text-red-600"}>K {c.budgetAvailable.toLocaleString()}</span></td>
                    <td className="px-4 py-3 text-sm text-right font-semibold"><span className={avail >= 0 ? "text-green-700" : "text-red-600"}>K {avail.toLocaleString()}</span></td>
                    <td className="px-4 py-3 text-sm text-red-600 text-right">K {c.unfunded.toLocaleString()}</td>
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

function RevisionHistoryView({ rows }: { rows: RevisionHistoryRow[] }) {
  if (rows.length === 0) return <EmptyState message="No budget revisions have been recorded for this financial year." />
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Revision</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Division</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Original Budget</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Current Before</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Revision Adjustment</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Proposed Revised</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Actual at Submit</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Commitments at Submit</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Protected Minimum</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Effective</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.budget_revision_id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-mono font-medium text-png-red">{r.revision_number}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{r.division_code || r.division_name || "-"}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{r.revision_type}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{r.status}</td>
                <td className="px-4 py-3 text-sm text-right">K {(r.original_budget || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right">K {(r.current_revised_budget_before || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right">K {(r.revision_adjustment || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right font-medium">K {(r.proposed_revised_budget || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right">K {(r.actual_expenditure_at_submission || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right">K {(r.outstanding_commitment_at_submission || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right">K {(r.protected_minimum_at_submission || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{r.effective_date || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ReleasesView({ year, releases, allocations, periods, canRelease, onChanged }: {
  year: number; releases: ReleaseRow[]; allocations: Allocation[]; periods: BudgetPeriodOption[]; canRelease: boolean; onChanged: () => void
}) {
  const [allocId, setAllocId] = useState("")
  const [fundingAllocationId, setFundingAllocationId] = useState("")
  const [quarter, setQuarter] = useState(1)
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const selected = allocations.find((a) => a.id === allocId)
  const selectedFundingOption = selected?.funding_options?.find((option) => option.funding_allocation_id === fundingAllocationId)
  const totalReleased = releases.reduce((s, r) => s + (r.released_amount || 0), 0)

  const submit = async () => {
    const amt = parseFloat(amount)
    if (!allocId || !fundingAllocationId || !amt || amt <= 0) return
    if (!selectedFundingOption) {
      setMsg({ type: "err", text: "Select an approved funding allocation for this release." })
      return
    }
    if (amt > selectedFundingOption.allocation_unreleased_balance) {
      setMsg({ type: "err", text: `Release exceeds selected funding allocation balance of K ${selectedFundingOption.allocation_unreleased_balance.toLocaleString()}.` })
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      const r = await createQuarterlyRelease({ budget_allocation_id: allocId, financial_year: year, quarter, released_amount: amt, release_date: date, funding_lines: [{ funding_allocation_id: fundingAllocationId, amount: amt }] })
      setMsg({ type: "ok", text: `Released K ${amt.toLocaleString()} (${r?.release_number || "Q" + quarter}) for ${selected?.full_expense_code || "allocation"}.` })
      setAmount("")
      setAllocId("")
      setFundingAllocationId("")
      onChanged()
    } catch (err: unknown) {
      setMsg({ type: "err", text: err instanceof Error ? err.message : "Release failed." })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {canRelease && (
        <div className="bg-white rounded-lg border border-png-gold/40 p-5">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-1"><Banknote className="h-4 w-4 text-png-gold" /> Release Quarterly Funds</h3>
          <p className="text-xs text-slate-500 mb-4">Make cash available against an approved funded budget code. Release validation is limited by MIN(approved budget remaining, funded amount remaining).</p>
          {msg && (
            <div className={`mb-3 rounded-lg p-2.5 text-sm flex items-center gap-2 ${msg.type === "ok" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
              {msg.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {msg.text}
            </div>
          )}
          <div className="grid md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-slate-500 mb-1">Budget Code / Allocation</label>
              <select
                value={allocId}
                onChange={(e) => {
                  setAllocId(e.target.value)
                  setFundingAllocationId("")
                }}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red"
              >
                <option value="">Select an approved budget code...</option>
                {allocations.map((a) => (
                  <option key={a.id} value={a.id} disabled={a.releasable <= 0}>
                    {(a.full_expense_code || a.cost_centre_code || "—")} · {a.department_name} · funded K{(a.funded || 0).toLocaleString()} · releasable K{a.releasable.toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-500 mb-1">Funding Allocation</label>
              <select
                value={fundingAllocationId}
                onChange={(e) => setFundingAllocationId(e.target.value)}
                disabled={!selected}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red disabled:bg-slate-50"
              >
                <option value="">Select funding source...</option>
                {(selected?.funding_options || []).map((option) => (
                  <option key={option.funding_allocation_id} value={option.funding_allocation_id}>
                    {option.allocation_number || "Funding"} · {option.funding_source_code || option.funding_source_name || "Source"} · balance K{option.allocation_unreleased_balance.toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Quarter</label>
              <select
                value={quarter}
                onChange={(e) => setQuarter(parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red"
              >
                {(periods.length ? periods : Array.from({ length: 4 }, (_, index) => ({ id: String(index + 1), period_number: index + 1, period_code: `Q${index + 1}`, period_name: `Quarter ${index + 1}` }))).map((period) => <option key={period.id} value={period.period_number}>{period.period_code}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Amount (K)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-png-red"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red"
              />
            </div>
            <div className="md:col-span-1">
              <button
                onClick={submit}
                disabled={!allocId || !fundingAllocationId || !amount || saving}
                className="w-full px-3 py-2 bg-png-red text-white rounded-lg text-sm font-medium hover:bg-png-maroon disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {selected && (
            <p className="mt-2 text-xs text-slate-500">
              Approved <b>K {selected.revised_budget.toLocaleString()}</b> · funded <b>K {(selected.funded || 0).toLocaleString()}</b> · already released <b>K {selected.released.toLocaleString()}</b> · remaining funded release <b className="text-png-maroon">K {selected.releasable.toLocaleString()}</b>{selectedFundingOption ? <> · selected funding balance <b className="text-png-maroon">K {selectedFundingOption.allocation_unreleased_balance.toLocaleString()}</b></> : null}
            </p>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Quarterly Releases — FY{year}</h2>
          <span className="text-sm text-slate-600">Total released: <span className="font-bold text-png-gold-strong">K {totalReleased.toLocaleString()}</span></span>
        </div>
        {releases.length === 0 ? (
          <EmptyState message="No releases recorded yet. Release funds against an approved budget code above." bordered={false} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Release #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Expense Code</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Cost Centre</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Quarter</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Date</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {releases.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-png-red">{r.release_number || "—"}</td>
                    <td className="px-4 py-3"><span className="font-mono text-sm text-slate-700">{r.full_expense_code || "—"}</span></td>
                    <td className="px-4 py-3 text-sm text-slate-600">{r.cost_centre_code || "-"}</td>
                    <td className="px-4 py-3 text-center"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-png-gold/20 text-png-maroon">Q{r.quarter}</span></td>
                    <td className="px-4 py-3 text-sm text-slate-500">{new Date(r.release_date).toLocaleDateString("en-GB")}</td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-900 text-right">K {(r.released_amount || 0).toLocaleString()}</td>
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

function ConsolidationView({ year, depts, consolidations, canRun, onChanged }: {
  year: number; depts: Dept[]; consolidations: Consolidation[]; canRun: boolean; onChanged: () => void
}) {
  const [deptId, setDeptId] = useState("")
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const run = async () => {
    if (!deptId) return
    setRunning(true)
    setMsg(null)
    try {
      const res = await consolidateDepartmentBudget(year, deptId)
      setMsg({ type: "ok", text: `Consolidated ${depts.find((d) => d.id === deptId)?.name}: K ${(res?.total_amount || 0).toLocaleString()} across ${res?.plan_count || 0} approved divisional budget(s).` })
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
          <p className="text-xs text-slate-500 mb-4">Roll up all approved Excel-style divisional budgets for a department into a consolidated budget for FY{year}.</p>
          {msg && (
            <div className={`mb-3 rounded-lg p-2.5 text-sm flex items-center gap-2 ${msg.type === "ok" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
              {msg.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {msg.text}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs font-medium text-slate-500 mb-1">Department</label>
              <select
                value={deptId}
                onChange={(e) => setDeptId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red"
              >
                <option value="">Select department...</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
              </select>
            </div>
            <button
              onClick={run}
              disabled={!deptId || running}
              className="px-4 py-2 bg-png-red text-white rounded-lg text-sm font-medium hover:bg-png-maroon disabled:opacity-50 flex items-center gap-2"
            >
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
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Divisions</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Budgets</th>
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
  title: string; value: number; subtitle: string; icon: React.ReactNode; tone: "maroon" | "gold" | "red" | "green" | "slate"
}) {
  const toneClasses = {
    maroon: "bg-png-maroon/10 text-png-maroon",
    gold: "bg-png-gold/20 text-png-maroon",
    red: "bg-png-red/10 text-png-red",
    green: "bg-green-100 text-green-700",
    slate: "bg-slate-100 text-slate-600",
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
