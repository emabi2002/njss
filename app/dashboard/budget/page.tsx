"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertCircle, Loader2, RefreshCw } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { supabase } from "@/lib/supabase"
import { getCurrentBudgetPositions, getHeadOfficeBudgetDashboard, type BudgetPositionRow, type HeadOfficeBudgetDashboard } from "@/lib/head-office-budget"

type Reference = { id: string; name: string; code: string; department_id?: string | null }
type Ledger = { id: string; finance_code: string; standard_description: string }
const money = (value: number) => `K ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const emptyDashboard: HeadOfficeBudgetDashboard = { cycle: null, divisions: [], headOfficeTotal: 0 }

export default function HeadOfficeBudgetPositionPage() {
  const { can, loading: authLoading } = useAuth()
  const canView = can('budget.view') || can('all')
  const [year, setYear] = useState<number | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [dashboard, setDashboard] = useState<HeadOfficeBudgetDashboard>(emptyDashboard)
  const [positions, setPositions] = useState<BudgetPositionRow[]>([])
  const [divisions, setDivisions] = useState<Reference[]>([])
  const [sections, setSections] = useState<Reference[]>([])
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [divisionId, setDivisionId] = useState("")
  const [sectionId, setSectionId] = useState("")

  useEffect(() => {
    if (authLoading || !canView || year !== null) return
    let cancelled = false
    async function selectInitialYear() {
      setLoading(true)
      setError("")
      const result = await supabase.from('annual_budget_cycles')
        .select('financial_year, status').order('financial_year', { ascending: false })
      if (cancelled) return
      if (result.error) {
        setError("Could not select the annual budget year. Refresh or select a financial year to continue.")
        setLoading(false)
        return
      }
      const cycles = result.data || []
      const preferred = cycles.find(cycle => cycle.status === 'ACTIVE') || cycles[0]
      setYear(current => current ?? preferred?.financial_year ?? new Date().getFullYear())
    }
    void selectInitialYear()
    return () => { cancelled = true }
  }, [authLoading, canView, year, refresh])

  useEffect(() => {
    if (authLoading || !canView || year === null) return
    const selectedYear = year
    let cancelled = false
    async function load() {
      setLoading(true)
      setError("")
      try {
        const [nextDashboard, location] = await Promise.all([
          getHeadOfficeBudgetDashboard(selectedYear),
          supabase.from('court_locations').select('id').eq('code', 'NCD-WGN').eq('location_type', 'HEADQUARTERS').eq('is_active', true).single(),
        ])
        if (location.error) throw location.error
        const divisionResult = await supabase.from('departments').select('id, code, name')
          .eq('court_location_id', location.data.id).eq('is_active', true).order('name')
        if (divisionResult.error) throw divisionResult.error
        const nextDivisions = divisionResult.data || []
        const [sectionResult, ledgerResult, nextPositions] = await Promise.all([
          nextDivisions.length ? supabase.from('sections').select('id, code, name, department_id').in('department_id', nextDivisions.map(division => division.id)).eq('is_active', true).order('name') : Promise.resolve({ data: [], error: null }),
          supabase.from('expense_ledger').select('id, finance_code, standard_description').eq('is_active', true).order('sort_order'),
          nextDashboard.cycle?.status === 'ACTIVE' ? getCurrentBudgetPositions(selectedYear) : Promise.resolve([]),
        ])
        if (sectionResult.error) throw sectionResult.error
        if (ledgerResult.error) throw ledgerResult.error
        if (cancelled) return
        const divisionIds = new Set(nextDivisions.map(division => division.id))
        const scopedDivisions = nextDashboard.divisions.filter(division => divisionIds.has(division.division_id))
        setDashboard({ ...nextDashboard, divisions: scopedDivisions, headOfficeTotal: scopedDivisions.reduce((total, division) => total + Number(division.division_total || 0), 0) })
        setPositions(nextPositions.filter(position => divisionIds.has(position.division_id)))
        setDivisions(nextDivisions)
        setSections(sectionResult.data || [])
        setLedgers(ledgerResult.data || [])
      } catch (cause) {
        if (cancelled) return
        setDashboard(emptyDashboard)
        setPositions([])
        setError(cause instanceof Error ? cause.message : "Could not load the annual Head Office budget position.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [authLoading, canView, year, refresh])

  const active = dashboard.cycle?.status === 'ACTIVE'
  const filtered = useMemo(() => positions.filter(row => (!divisionId || row.division_id === divisionId) && (!sectionId || row.section_id === sectionId)), [positions, divisionId, sectionId])
  const totals = useMemo(() => filtered.reduce((sum, row) => ({ approved: sum.approved + row.current_approved_budget, commitments: sum.commitments + row.outstanding_commitments, expenditure: sum.expenditure + row.actual_expenditure, available: sum.available + row.available_budget }), { approved: 0, commitments: 0, expenditure: 0, available: 0 }), [filtered])
  const divisionNames = new Map(divisions.map(division => [division.id, division.name]))
  const sectionNames = new Map(sections.map(section => [section.id, section.name]))
  const ledgerNames = new Map(ledgers.map(ledger => [ledger.id, `${ledger.finance_code} — ${ledger.standard_description}`]))

  if (authLoading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin" aria-label="Loading permissions" /></div>
  if (!canView) return <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">You do not have permission to view the annual Head Office budget.</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900">Head Office Annual Budget Position</h1><p className="mt-1 text-sm text-slate-600">Annual Division, Section and expense ledger balances.</p></div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-600">Financial year <input aria-label="Financial year" type="number" min={2000} max={2100} value={year ?? ""} onChange={event => { const value = Number(event.target.value); if (value >= 2000 && value <= 2100) { setYear(value); setDivisionId(""); setSectionId("") } }} className="ml-2 w-24 rounded-md border border-slate-300 px-3 py-2" /></label>
          <button onClick={() => setRefresh(value => value + 1)} disabled={loading} className="rounded-md border border-slate-300 p-2 disabled:opacity-50" aria-label="Refresh budget"><RefreshCw size={18} /></button>
        </div>
      </div>
      <nav aria-label="Annual budget actions" className="flex flex-wrap gap-3 text-sm">
        {(can('budget.capture') || can('budget.registrar.approve') || can('all')) && <Link href="/dashboard/budget-template" className="rounded-md bg-[#8a1420] px-4 py-2 text-white">Capture and review</Link>}
        {(can('budget.activate') || can('budget.documents.manage') || can('all')) && <Link href="/dashboard/budget/activation" className="rounded-md border border-slate-300 px-4 py-2">Annual activation</Link>}
        {(can('budget.supplementary.enter') || can('budget.reallocation.request') || can('budget.reallocation.approve') || can('budget.reallocation.execute') || can('all')) && <Link href="/dashboard/budget/adjustments" className="rounded-md border border-slate-300 px-4 py-2">Supplementary budgets and reallocations</Link>}
      </nav>
      {error ? <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800"><AlertCircle size={18} />{error}</div> : loading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" aria-label="Loading budget position" /></div> : <>
        <div className={`rounded-lg border p-4 ${active ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
          <p className="font-semibold">FY {year} · {dashboard.cycle?.status.replaceAll('_', ' ') || 'NOT STARTED'}</p>
          <p className="mt-1 text-sm">{active ? 'The activated annual budget is available for commitment and expenditure control.' : dashboard.cycle?.status === 'CLOSED' ? 'This annual cycle is closed. Current spending balances are unavailable.' : 'Captured amounts remain in preparation until all Divisions are approved and the annual budget is activated.'}</p>
        </div>
        {active ? <>
          <div className="flex flex-wrap gap-3">
            <select aria-label="Division" value={divisionId} onChange={event => { setDivisionId(event.target.value); setSectionId("") }} className="rounded-md border border-slate-300 p-2 text-sm"><option value="">All Head Office Divisions</option>{divisions.map(division => <option key={division.id} value={division.id}>{division.name}</option>)}</select>
            <select aria-label="Section" value={sectionId} onChange={event => setSectionId(event.target.value)} className="rounded-md border border-slate-300 p-2 text-sm"><option value="">All Sections</option>{sections.filter(section => !divisionId || section.department_id === divisionId).map(section => <option key={section.id} value={section.id}>{section.name}</option>)}</select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Current approved budget', totals.approved], ['Outstanding commitments', totals.commitments], ['Actual expenditure', totals.expenditure], ['Available budget', totals.available]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-xl font-semibold">{money(Number(value))}</p></div>)}</div>
          <p className="text-sm text-slate-600">Available budget = original budget + supplementary adjustments + reallocations in − reallocations out − outstanding commitments − actual expenditure.</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr>{['Division', 'Section', 'Expense ledger', 'Original budget', 'Supplementary', 'Reallocations in', 'Reallocations out', 'Approved budget', 'Commitments', 'Expenditure', 'Available'].map((label, index) => <th key={label} className={`whitespace-nowrap px-4 py-3 ${index < 3 ? 'text-left' : 'text-right'}`}>{label}</th>)}</tr></thead><tbody>{filtered.map(row => <tr key={`${row.division_budget_id}:${row.section_id}:${row.expense_ledger_id}`} className="border-t border-slate-100"><td className="px-4 py-3">{divisionNames.get(row.division_id) || 'Division unavailable'}</td><td className="px-4 py-3">{sectionNames.get(row.section_id) || 'Section unavailable'}</td><td className="min-w-64 px-4 py-3">{ledgerNames.get(row.expense_ledger_id) || 'Expense ledger unavailable'}</td>{[row.original_budget, row.supplementary_adjustments, row.reallocations_in, row.reallocations_out, row.current_approved_budget, row.outstanding_commitments, row.actual_expenditure, row.available_budget].map((amount, index) => <td key={index} className={`whitespace-nowrap px-4 py-3 text-right ${index === 7 && amount < 0 ? 'font-semibold text-red-700' : ''}`}>{money(amount)}</td>)}</tr>)}{!filtered.length && <tr><td colSpan={11} className="p-8 text-center text-slate-500">No active budget lines match the selected filters.</td></tr>}</tbody></table></div>
        </> : <>
          <div className="rounded-lg border border-slate-200 bg-white p-5"><p className="text-sm text-slate-600">{dashboard.cycle?.status === 'CLOSED' ? 'Captured annual total' : 'Captured preparation total'}</p><p className="mt-2 text-2xl font-semibold">{money(dashboard.headOfficeTotal)}</p><p className="mt-2 text-sm text-slate-600">{dashboard.divisions.filter(division => division.status === 'LOCKED').length} of {dashboard.divisions.length} Divisions approved and locked.</p></div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="px-4 py-3 text-left">Head Office Division</th><th className="px-4 py-3 text-left">Review status</th><th className="px-4 py-3 text-right">Captured annual amount</th></tr></thead><tbody>{dashboard.divisions.map(division => <tr key={division.id} className="border-t border-slate-100"><td className="px-4 py-3">{division.division?.name || divisionNames.get(division.division_id) || 'Division unavailable'}</td><td className="px-4 py-3">{division.status.replaceAll('_', ' ')}</td><td className="px-4 py-3 text-right">{money(division.division_total)}</td></tr>)}{!dashboard.divisions.length && <tr><td colSpan={3} className="p-8 text-center text-slate-500">No Division budgets have been captured for this year.</td></tr>}</tbody></table></div>
        </>}
      </>}
    </div>
  )
}
