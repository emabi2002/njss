"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CalendarDays, CheckCircle2, ClipboardList, FileSpreadsheet, Loader2, Plus, RefreshCw, Save, Send, ShieldCheck, Trash2, Undo2 } from "lucide-react"
import {
  MONTHS,
  annualEstimate,
  allocationTotal,
  createDraftSubmission,
  deleteBudgetLine,
  getBudgetDashboard,
  getBudgetLookups,
  getSubmissionDetail,
  saveBudgetLine,
  transitionSubmission,
  type BudgetCycle,
  type BudgetDivision,
  type BudgetLine,
  type BudgetMonthlyAllocation,
  type BudgetSubmission,
  type ExpenseLedger,
} from "@/lib/budget-module"
import { useAuth } from "@/contexts/AuthContext"
import { exportToExcel, rowsToPdfTable, exportToPDF } from "@/lib/export"

type FundingSource = { id: string; code: string; name: string }
type LookupState = { cycles: BudgetCycle[]; divisions: BudgetDivision[]; ledgers: ExpenseLedger[]; fundingSources: FundingSource[] }
type CashflowRow = { budget_year: number; division_code: string; division_name: string; month_number: number; month_name: string; amount: number }
type LineDraft = Partial<BudgetLine> & { line_number: number }

const emptyLookups: LookupState = { cycles: [], divisions: [], ledgers: [], fundingSources: [] }
const money = (value: number) => `K ${Number(value || 0).toLocaleString()}`
const newAllocations = (): BudgetMonthlyAllocation[] => MONTHS.map((month, index) => ({ month_number: index + 1, month_name: month, amount: 0 }))

export default function BudgetTemplatePage() {
  const { profile, can } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lookups, setLookups] = useState<LookupState>(emptyLookups)
  const [submissions, setSubmissions] = useState<BudgetSubmission[]>([])
  const [cashflow, setCashflow] = useState<CashflowRow[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [selected, setSelected] = useState<BudgetSubmission | null>(null)
  const [lines, setLines] = useState<BudgetLine[]>([])
  const [history, setHistory] = useState<{ action: string; from_status: string | null; to_status: string; comments: string | null; created_at: string; changed_by_email: string | null }[]>([])
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const [draftHeader, setDraftHeader] = useState({ cycle_id: "", division_id: "", budget_ceiling: "", submission_reference: "" })
  const [lineDraft, setLineDraft] = useState<LineDraft>({ line_number: 1, quantity: 1, unit_cost: 0, frequency_periods: 1, other_costs: 0, priority: "MEDIUM" })
  const [allocations, setAllocations] = useState<BudgetMonthlyAllocation[]>(newAllocations())

  const canEdit = can("budget.template") || can("budget.template.submit")
  const canReview = can("budget.template.review")
  const canApprove = can("budget.template.approve")
  const selectedLocked = selected?.is_locked || ["SUBMITTED", "RESUBMITTED", "REVIEWED", "APPROVED", "ARCHIVED"].includes(selected?.status || "")

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    try {
      const [lookupData, dashboard] = await Promise.all([getBudgetLookups(), getBudgetDashboard()])
      setLookups(lookupData as LookupState)
      setSubmissions((dashboard.submissions || []) as BudgetSubmission[])
      setCashflow((dashboard.cashflow || []) as CashflowRow[])
      if (!draftHeader.cycle_id && lookupData.cycles?.[0]) {
        setDraftHeader((h) => ({ ...h, cycle_id: lookupData.cycles[0].id, budget_ceiling: String(lookupData.cycles[0].department_ceiling || "") }))
      }
    } catch (err) {
      console.error(err)
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not load the budget template workspace." })
    } finally {
      setLoading(false)
    }
  }, [draftHeader.cycle_id])

  const loadSubmission = useCallback(async (id: string) => {
    if (!id) {
      setSelected(null); setLines([]); setHistory([])
      return
    }
    setLoading(true)
    try {
      const detail = await getSubmissionDetail(id)
      setSelected(detail.submission)
      setLines(detail.lines || [])
      setHistory(detail.history || [])
      const nextLine = (detail.lines || []).reduce((max, line) => Math.max(max, line.line_number || 0), 0) + 1
      setLineDraft({ line_number: nextLine, quantity: 1, unit_cost: 0, frequency_periods: 1, other_costs: 0, priority: "MEDIUM" })
      setAllocations(newAllocations())
    } catch (err) {
      console.error(err)
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not load the selected submission." })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSubmission(selectedId)
  }, [selectedId, loadSubmission])

  const selectedCycle = lookups.cycles.find((cycle) => cycle.id === draftHeader.cycle_id)
  const selectedDivision = lookups.divisions.find((division) => division.id === draftHeader.division_id)
  const lineEstimate = annualEstimate({
    quantity: Number(lineDraft.quantity || 0),
    unit_cost: Number(lineDraft.unit_cost || 0),
    frequency_periods: Number(lineDraft.frequency_periods || 0),
    other_costs: Number(lineDraft.other_costs || 0),
  })
  const monthlyTotal = allocationTotal(allocations)
  const monthlyVariance = lineEstimate - monthlyTotal

  const totalsByStatus = useMemo(() => {
    return submissions.reduce<Record<string, number>>((acc, submission) => {
      acc[submission.status] = (acc[submission.status] || 0) + 1
      return acc
    }, {})
  }, [submissions])

  const cashflowChart = useMemo(() => {
    const activeYear = selected?.budget_year || selectedCycle?.budget_year || 2025
    return MONTHS.map((month, index) => ({
      month: month.slice(0, 3),
      amount: cashflow.filter((row) => row.budget_year === activeYear && row.month_number === index + 1).reduce((sum, row) => sum + (row.amount || 0), 0),
    }))
  }, [cashflow, selected?.budget_year, selectedCycle?.budget_year])

  const createSubmission = async () => {
    setMessage(null)
    if (!selectedCycle || !selectedDivision) {
      setMessage({ type: "err", text: "Select a budget cycle and division first." })
      return
    }
    setSaving(true)
    try {
      const id = await createDraftSubmission({
        cycle_id: selectedCycle.id,
        budget_year: selectedCycle.budget_year,
        division_id: selectedDivision.id,
        department_id: selectedDivision.department_id,
        cost_centre: selectedDivision.cost_centre_code || selectedDivision.code,
        budget_ceiling: Number(draftHeader.budget_ceiling || 0),
        submission_reference: draftHeader.submission_reference || null,
        prepared_by: profile?.id || null,
      })
      setSelectedId(id)
      setMessage({ type: "ok", text: "Draft divisional budget template created." })
      await loadDashboard()
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not create the draft submission." })
    } finally {
      setSaving(false)
    }
  }

  const resetLineDraft = () => {
    const nextLine = lines.reduce((max, line) => Math.max(max, line.line_number || 0), 0) + 1
    setLineDraft({ line_number: nextLine, quantity: 1, unit_cost: 0, frequency_periods: 1, other_costs: 0, priority: "MEDIUM" })
    setAllocations(newAllocations())
  }

  const saveLine = async () => {
    if (!selected) return
    setMessage(null)
    if (!lineDraft.expense_ledger_id || !lineDraft.line_item_description || !lineDraft.business_justification) {
      setMessage({ type: "err", text: "Finance code, line-item description and business justification are required." })
      return
    }
    if (Math.abs(monthlyVariance) > 0.009) {
      setMessage({ type: "err", text: "Monthly allocation must equal the annual estimate before saving." })
      return
    }
    setSaving(true)
    try {
      await saveBudgetLine(selected.id, lineDraft, allocations)
      await loadSubmission(selected.id)
      await loadDashboard()
      resetLineDraft()
      setMessage({ type: "ok", text: "Budget line saved with its monthly allocation." })
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not save the budget line." })
    } finally {
      setSaving(false)
    }
  }

  const removeLine = async (lineId: string) => {
    if (!selected || !confirm("Delete this budget line?")) return
    setSaving(true)
    try {
      await deleteBudgetLine(lineId)
      await loadSubmission(selected.id)
      await loadDashboard()
      setMessage({ type: "ok", text: "Budget line deleted." })
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not delete the line." })
    } finally {
      setSaving(false)
    }
  }

  const runAction = async (action: "SUBMIT" | "RESUBMIT" | "RETURN" | "REVIEW" | "APPROVE" | "REJECT") => {
    if (!selected) return
    const comments = action === "RETURN" || action === "REJECT" ? window.prompt("Comments / reason:") || "" : ""
    setSaving(true)
    try {
      await transitionSubmission(selected.id, action, comments, profile?.email || "")
      await loadSubmission(selected.id)
      await loadDashboard()
      setMessage({ type: "ok", text: `Budget submission ${action.toLowerCase()} action completed.` })
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Workflow action failed." })
    } finally {
      setSaving(false)
    }
  }

  const spreadEvenly = () => {
    const perMonth = Math.floor((lineEstimate / 12) * 100) / 100
    const next = newAllocations().map((month) => ({ ...month, amount: perMonth }))
    const diff = lineEstimate - allocationTotal(next)
    next[11].amount = Number((next[11].amount + diff).toFixed(2))
    setAllocations(next)
  }

  const exportTemplate = (format: "excel" | "pdf") => {
    if (!selected || lines.length === 0) return
    const records = lines.map((line) => {
      const months = Object.fromEntries(MONTHS.map((month, index) => [month.slice(0, 3), line.allocations?.find((a) => a.month_number === index + 1)?.amount || 0]))
      return {
        "Line #": line.line_number,
        "Finance Code": line.ledger?.finance_code || "-",
        Description: line.line_item_description,
        Justification: line.business_justification,
        Quantity: line.quantity || 0,
        Unit: line.unit_of_measure || "-",
        "Unit Cost": line.unit_cost || 0,
        Frequency: line.frequency_periods || 0,
        "Other Costs": line.other_costs || 0,
        "Annual Estimate": line.annual_estimate || 0,
        ...months,
      }
    })
    const filename = `${selected.submission_number || "budget_template"}_${new Date().toISOString().split("T")[0]}`
    const title = `Standard Divisional Budget Template — ${selected.division?.name || "Division"}`
    const subtitle = `FY${selected.budget_year} • ${selected.status}`
    if (format === "excel") exportToExcel(filename, records, { title, subtitle, sheetName: "Budget Template" })
    else {
      const { columns, rows } = rowsToPdfTable(records)
      exportToPDF({ title, subtitle, columns, rows, filename })
    }
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-png-gold/40 bg-gradient-to-br from-png-maroon via-png-red to-png-maroon-dark p-6 text-white shadow-lg">
        <div className="absolute right-0 top-0 h-full w-1/3 bg-[radial-gradient(circle_at_top_right,rgba(212,175,55,0.35),transparent_55%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-png-gold-soft">NJSS Budget Preparation</p>
            <h1 className="mt-2 text-3xl font-bold">Standard Divisional Budget Template</h1>
            <p className="mt-2 max-w-3xl text-sm text-white/80">Prepare activity-based budget submissions by finance code, justify every line item, allocate the annual estimate across all twelve months, then submit for review and approval.</p>
          </div>
          <button onClick={loadDashboard} className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/20 flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {message && (
        <div className={`rounded-lg border p-3 text-sm flex items-center gap-2 ${message.type === "ok" ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"}`}>
          {message.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {message.text}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Drafts" value={totalsByStatus.DRAFT || 0} tone="slate" />
        <Metric label="Submitted" value={(totalsByStatus.SUBMITTED || 0) + (totalsByStatus.RESUBMITTED || 0)} tone="gold" />
        <Metric label="Reviewed" value={totalsByStatus.REVIEWED || 0} tone="maroon" />
        <Metric label="Approved" value={totalsByStatus.APPROVED || 0} tone="green" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2"><Plus className="h-4 w-4 text-png-red" /> New template</h2>
            <div className="mt-4 space-y-3">
              <Field label="Budget cycle">
                <select value={draftHeader.cycle_id} onChange={(e) => setDraftHeader((h) => ({ ...h, cycle_id: e.target.value }))} className="input">
                  <option value="">Select cycle</option>
                  {lookups.cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}
                </select>
              </Field>
              <Field label="Division / cost centre">
                <select value={draftHeader.division_id} onChange={(e) => setDraftHeader((h) => ({ ...h, division_id: e.target.value }))} className="input">
                  <option value="">Select division</option>
                  {lookups.divisions.map((division) => <option key={division.id} value={division.id}>{division.code} — {division.name}</option>)}
                </select>
              </Field>
              <Field label="Budget ceiling">
                <input value={draftHeader.budget_ceiling} onChange={(e) => setDraftHeader((h) => ({ ...h, budget_ceiling: e.target.value }))} type="number" className="input text-right" placeholder="0.00" />
              </Field>
              <Field label="Internal reference">
                <input value={draftHeader.submission_reference} onChange={(e) => setDraftHeader((h) => ({ ...h, submission_reference: e.target.value }))} className="input" placeholder="Optional reference / circular number" />
              </Field>
              <button onClick={createSubmission} disabled={saving || !canEdit} className="w-full rounded-lg bg-png-red px-4 py-2.5 text-sm font-semibold text-white hover:bg-png-maroon disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />} Create Draft Template
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="font-semibold text-slate-900">Submissions</h2>
            </div>
            <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-100">
              {submissions.length === 0 ? <Empty message="No divisional budget templates yet." /> : submissions.map((submission) => (
                <button key={submission.id} onClick={() => setSelectedId(submission.id)} className={`w-full p-4 text-left hover:bg-slate-50 ${selectedId === submission.id ? "bg-png-red/5" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{submission.submission_number || "Draft"}</span>
                    <StatusBadge status={submission.status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{submission.division?.code} — {submission.division?.name}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>FY{submission.budget_year}</span>
                    <span>{money(submission.total_proposed_budget || 0)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {!selected ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">Select or create a divisional budget template to start editing.</div>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-slate-900">{selected.submission_number}</h2>
                      <StatusBadge status={selected.status} />
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${selected.validation_status === "VALID" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{selected.validation_status}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{selected.division?.code} — {selected.division?.name} • FY{selected.budget_year}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => exportTemplate("excel")} className="btn-light"><FileSpreadsheet className="h-4 w-4" /> Excel</button>
                    <button onClick={() => exportTemplate("pdf")} className="btn-light"><FileSpreadsheet className="h-4 w-4" /> PDF</button>
                    {selected.status === "DRAFT" || selected.status === "RETURNED" ? <button onClick={() => runAction(selected.status === "RETURNED" ? "RESUBMIT" : "SUBMIT")} disabled={saving} className="btn-primary"><Send className="h-4 w-4" /> Submit</button> : null}
                    {canReview && ["SUBMITTED", "RESUBMITTED"].includes(selected.status) && <button onClick={() => runAction("REVIEW")} disabled={saving} className="btn-primary"><ShieldCheck className="h-4 w-4" /> Mark Reviewed</button>}
                    {canReview && ["SUBMITTED", "RESUBMITTED"].includes(selected.status) && <button onClick={() => runAction("RETURN")} disabled={saving} className="btn-light"><Undo2 className="h-4 w-4" /> Return</button>}
                    {canApprove && selected.status === "REVIEWED" && <button onClick={() => runAction("APPROVE")} disabled={saving} className="btn-primary"><CheckCircle2 className="h-4 w-4" /> Approve</button>}
                  </div>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <Metric label="Ceiling" value={money(selected.budget_ceiling || 0)} tone="slate" compact />
                  <Metric label="Annual estimate" value={money(selected.total_proposed_budget || 0)} tone="maroon" compact />
                  <Metric label="Monthly allocation" value={money(selected.total_monthly_allocation || 0)} tone="gold" compact />
                  <Metric label="Variance" value={money(selected.unallocated_variance || 0)} tone={Math.abs(selected.unallocated_variance || 0) < 0.01 ? "green" : "red"} compact />
                </div>
              </div>

              {!selectedLocked && canEdit && (
                <div className="rounded-xl border border-png-gold/40 bg-white p-5 shadow-sm">
                  <h3 className="font-semibold text-slate-900 flex items-center gap-2"><Save className="h-4 w-4 text-png-red" /> Add activity line</h3>
                  <div className="mt-4 grid gap-3 md:grid-cols-12">
                    <Field label="Line" className="md:col-span-1"><input className="input text-right" type="number" value={lineDraft.line_number} onChange={(e) => setLineDraft((l) => ({ ...l, line_number: Number(e.target.value) }))} /></Field>
                    <Field label="Finance code" className="md:col-span-4"><select className="input" value={lineDraft.expense_ledger_id || ""} onChange={(e) => setLineDraft((l) => ({ ...l, expense_ledger_id: e.target.value }))}><option value="">Select posting code</option>{lookups.ledgers.filter((ledger) => ledger.is_posting).map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.finance_code} — {ledger.standard_description}</option>)}</select></Field>
                    <Field label="Priority" className="md:col-span-2"><select className="input" value={lineDraft.priority || "MEDIUM"} onChange={(e) => setLineDraft((l) => ({ ...l, priority: e.target.value }))}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <option key={p}>{p}</option>)}</select></Field>
                    <Field label="Funding" className="md:col-span-3"><select className="input" value={lineDraft.funding_source_id || ""} onChange={(e) => setLineDraft((l) => ({ ...l, funding_source_id: e.target.value || null }))}><option value="">Optional funding source</option>{lookups.fundingSources.map((source) => <option key={source.id} value={source.id}>{source.code} — {source.name}</option>)}</select></Field>
                    <Field label="Activity ref" className="md:col-span-2"><input className="input" value={lineDraft.activity_reference || ""} onChange={(e) => setLineDraft((l) => ({ ...l, activity_reference: e.target.value }))} /></Field>
                    <Field label="Line-item / activity description" className="md:col-span-6"><input className="input" value={lineDraft.line_item_description || ""} onChange={(e) => setLineDraft((l) => ({ ...l, line_item_description: e.target.value }))} placeholder="e.g. Registry circuit travel for Q1 hearings" /></Field>
                    <Field label="Business justification" className="md:col-span-6"><input className="input" value={lineDraft.business_justification || ""} onChange={(e) => setLineDraft((l) => ({ ...l, business_justification: e.target.value }))} placeholder="Why this activity is required" /></Field>
                    <Field label="Expected output" className="md:col-span-4"><input className="input" value={lineDraft.expected_output || ""} onChange={(e) => setLineDraft((l) => ({ ...l, expected_output: e.target.value }))} /></Field>
                    <Field label="Location / provider" className="md:col-span-4"><input className="input" value={lineDraft.location_destination_provider || ""} onChange={(e) => setLineDraft((l) => ({ ...l, location_destination_provider: e.target.value }))} /></Field>
                    <Field label="Responsible officer" className="md:col-span-4"><input className="input" value={lineDraft.responsible_officer || ""} onChange={(e) => setLineDraft((l) => ({ ...l, responsible_officer: e.target.value }))} /></Field>
                    <Field label="Qty" className="md:col-span-2"><input className="input text-right" type="number" value={lineDraft.quantity || 0} onChange={(e) => setLineDraft((l) => ({ ...l, quantity: Number(e.target.value) }))} /></Field>
                    <Field label="Unit" className="md:col-span-2"><input className="input" value={lineDraft.unit_of_measure || ""} onChange={(e) => setLineDraft((l) => ({ ...l, unit_of_measure: e.target.value }))} /></Field>
                    <Field label="Unit cost" className="md:col-span-2"><input className="input text-right" type="number" value={lineDraft.unit_cost || 0} onChange={(e) => setLineDraft((l) => ({ ...l, unit_cost: Number(e.target.value) }))} /></Field>
                    <Field label="Frequency" className="md:col-span-2"><input className="input text-right" type="number" value={lineDraft.frequency_periods || 0} onChange={(e) => setLineDraft((l) => ({ ...l, frequency_periods: Number(e.target.value) }))} /></Field>
                    <Field label="Other costs" className="md:col-span-2"><input className="input text-right" type="number" value={lineDraft.other_costs || 0} onChange={(e) => setLineDraft((l) => ({ ...l, other_costs: Number(e.target.value) }))} /></Field>
                    <div className="md:col-span-2 rounded-lg bg-png-red/5 p-3 text-right"><p className="text-xs text-slate-500">Annual estimate</p><p className="font-bold text-png-maroon">{money(lineEstimate)}</p></div>
                  </div>

                  <div className="mt-5 rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><CalendarDays className="h-4 w-4 text-png-gold" /> Monthly allocation</h4>
                      <button onClick={spreadEvenly} type="button" className="text-xs font-medium text-png-red hover:text-png-maroon">Spread annual estimate evenly</button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
                      {allocations.map((month, index) => <label key={month.month_number} className="text-xs text-slate-500">{month.month_name}<input className="input mt-1 text-right" type="number" value={month.amount} onChange={(e) => setAllocations((items) => items.map((item, i) => i === index ? { ...item, amount: Number(e.target.value) } : item))} /></label>)}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-4 text-sm">
                      <span>Allocated: <b>{money(monthlyTotal)}</b></span>
                      <span className={Math.abs(monthlyVariance) < 0.01 ? "text-green-700" : "text-red-600"}>Variance: <b>{money(monthlyVariance)}</b></span>
                    </div>
                  </div>

                  <div className="mt-4 flex justify-end gap-2">
                    <button onClick={resetLineDraft} className="btn-light" type="button">Clear</button>
                    <button onClick={saveLine} disabled={saving} className="btn-primary" type="button">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save line</button>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900">Budget template lines</h3>
                  <span className="text-sm text-slate-500">{lines.length} line(s)</span>
                </div>
                {lines.length === 0 ? <Empty message="No budget lines added yet." /> : <div className="overflow-x-auto"><table className="w-full min-w-[1100px]"><thead className="bg-slate-50"><tr><Th>Line</Th><Th>Finance code</Th><Th>Description</Th><Th>Justification</Th><Th align="right">Annual</Th><Th align="right">Allocated</Th><Th align="right">Variance</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead><tbody className="divide-y divide-slate-100">{lines.map((line) => <tr key={line.id} className="hover:bg-slate-50"><Td>{line.line_number}</Td><Td><span className="font-mono text-png-red">{line.ledger?.finance_code}</span><div className="text-xs text-slate-500">{line.ledger?.standard_description}</div></Td><Td>{line.line_item_description}</Td><Td className="max-w-xs truncate">{line.business_justification}</Td><Td align="right">{money(line.annual_estimate || 0)}</Td><Td align="right">{money(line.monthly_allocation_total || 0)}</Td><Td align="right"><span className={Math.abs(line.allocation_variance || 0) < 0.01 ? "text-green-700" : "text-red-600"}>{money(line.allocation_variance || 0)}</span></Td><Td><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{line.priority}</span></Td><Td align="right">{!selectedLocked && <button onClick={() => removeLine(line.id)} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}</Td></tr>)}</tbody></table></div>}
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="font-semibold text-slate-900">Monthly cash-flow profile</h3>
                  <div className="mt-4 grid grid-cols-6 gap-2">
                    {cashflowChart.map((row) => <div key={row.month} className="rounded-lg bg-slate-50 p-2 text-center"><p className="text-xs text-slate-500">{row.month}</p><p className="text-xs font-bold text-png-maroon">{money(row.amount)}</p></div>)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="font-semibold text-slate-900">Workflow history</h3>
                  {history.length === 0 ? <p className="mt-4 text-sm text-slate-500">No workflow events yet.</p> : <div className="mt-4 space-y-3">{history.map((item, index) => <div key={index} className="rounded-lg bg-slate-50 p-3 text-sm"><div className="flex justify-between"><b>{item.action}</b><span className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString("en-GB")}</span></div><p className="text-slate-600">{item.from_status || "START"} → {item.to_status}</p>{item.comments && <p className="mt-1 text-slate-500">{item.comments}</p>}</div>)}</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {loading && <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/40"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div>}

      <style jsx global>{`
        .input { width: 100%; border-radius: 0.5rem; border: 1px solid #e2e8f0; background: white; padding: 0.5rem 0.75rem; font-size: 0.875rem; outline: none; }
        .input:focus { border-color: #8a1420; box-shadow: 0 0 0 2px rgba(138,20,32,0.15); }
        .btn-primary { display: inline-flex; align-items: center; gap: 0.4rem; border-radius: 0.5rem; background: #8a1420; color: white; padding: 0.55rem 0.85rem; font-size: 0.875rem; font-weight: 600; }
        .btn-primary:hover { background: #4c0f16; }
        .btn-primary:disabled { opacity: .5; }
        .btn-light { display: inline-flex; align-items: center; gap: 0.4rem; border-radius: 0.5rem; border: 1px solid #e2e8f0; background: white; color: #475569; padding: 0.55rem 0.85rem; font-size: 0.875rem; font-weight: 600; }
        .btn-light:hover { background: #f8fafc; }
      `}</style>
    </div>
  )
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block text-xs font-medium text-slate-500 ${className}`}>{label}<div className="mt-1">{children}</div></label>
}

function Metric({ label, value, tone, compact = false }: { label: string; value: number | string; tone: "slate" | "gold" | "maroon" | "green" | "red"; compact?: boolean }) {
  const tones = { slate: "bg-slate-50 text-slate-900", gold: "bg-png-gold/20 text-png-maroon", maroon: "bg-png-red/10 text-png-red", green: "bg-green-50 text-green-700", red: "bg-red-50 text-red-700" }
  return <div className={`rounded-xl border border-slate-200 bg-white ${compact ? "p-3" : "p-4"}`}><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className={`${compact ? "text-lg" : "text-2xl"} mt-1 font-bold ${tones[tone].split(" ").at(-1)}`}>{value}</p></div>
}

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = { DRAFT: "bg-slate-100 text-slate-700", SUBMITTED: "bg-png-gold/20 text-png-maroon", RESUBMITTED: "bg-png-gold/20 text-png-maroon", RETURNED: "bg-orange-100 text-orange-700", REVIEWED: "bg-png-red/10 text-png-red", APPROVED: "bg-green-100 text-green-700", REJECTED: "bg-red-100 text-red-700", ARCHIVED: "bg-slate-200 text-slate-600" }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${classes[status] || classes.DRAFT}`}>{status}</span>
}

function Empty({ message }: { message: string }) {
  return <div className="p-8 text-center text-sm text-slate-500">{message}</div>
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-4 py-3 text-${align} text-xs font-semibold uppercase text-slate-600`}>{children}</th>
}

function Td({ children, align = "left", className = "" }: { children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-4 py-3 text-${align} text-sm text-slate-700 ${className}`}>{children}</td>
}
