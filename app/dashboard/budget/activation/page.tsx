"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, CircleDollarSign, FileCheck2, Loader2, RefreshCw, Send, ShieldCheck, Wrench } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import {
  activateApprovedBudget,
  getBudgetActivationLines,
  getBudgetActivationQueue,
  prepareBudgetActivation,
  submitBudgetActivation,
  type BudgetActivationBatch,
  type BudgetActivationLine,
  type BudgetActivationStatus,
} from "@/lib/budget-activation"

const money = (value: number | null | undefined) => `K ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const statusLabel: Record<BudgetActivationStatus, string> = {
  DRAFT_MAPPING: "Draft Mapping",
  VALIDATION_FAILED: "Validation Failed",
  READY_FOR_ACTIVATION: "Ready for Activation",
  ACTIVATED: "Activated",
  CANCELLED: "Cancelled",
}

const statusTone: Record<BudgetActivationStatus, string> = {
  DRAFT_MAPPING: "bg-sky-100 text-sky-700",
  VALIDATION_FAILED: "bg-red-100 text-red-700",
  READY_FOR_ACTIVATION: "bg-amber-100 text-amber-800",
  ACTIVATED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-slate-200 text-slate-600",
}

export default function BudgetActivationPage() {
  const { roles, can } = useAuth()
  const isSystemAdministrator = roles.includes("System Administrator")
  const isRegistrar = roles.includes("Registrar")
  const canView = isSystemAdministrator || isRegistrar || can("budget.activation.view")
  const canPrepare = isSystemAdministrator && (can("budget.activation.prepare") || can("all"))
  const canSubmit = isSystemAdministrator && (can("budget.activation.submit") || can("all"))
  const canActivate = isRegistrar && can("budget.activation.authorize")

  const [queue, setQueue] = useState<BudgetActivationBatch[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [lines, setLines] = useState<BudgetActivationLine[]>([])
  const [loading, setLoading] = useState(true)
  const [linesLoading, setLinesLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [filter, setFilter] = useState<"OPEN" | "READY" | "ACTIVATED" | "ALL">("OPEN")

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await getBudgetActivationQueue()
      setQueue(rows)
      setSelectedBatchId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || null)
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not load Budget Activation." })
    } finally {
      setLoading(false)
    }
  }, [])

  const loadLines = useCallback(async (batchId: string) => {
    setLinesLoading(true)
    try {
      setLines(await getBudgetActivationLines(batchId))
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not load activation validation lines." })
      setLines([])
    } finally {
      setLinesLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    if (!selectedBatchId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLines([])
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLines(selectedBatchId)
  }, [selectedBatchId, loadLines])

  const selected = queue.find((row) => row.id === selectedBatchId) || null

  const visibleQueue = useMemo(() => queue.filter((row) => {
    if (filter === "READY") return row.status === "READY_FOR_ACTIVATION"
    if (filter === "ACTIVATED") return row.status === "ACTIVATED"
    if (filter === "OPEN") return !["ACTIVATED", "CANCELLED"].includes(row.status)
    return true
  }), [queue, filter])

  const counts = useMemo(() => ({
    open: queue.filter((row) => !["ACTIVATED", "CANCELLED"].includes(row.status)).length,
    failed: queue.filter((row) => row.status === "VALIDATION_FAILED").length,
    ready: queue.filter((row) => row.status === "READY_FOR_ACTIVATION").length,
    activated: queue.filter((row) => row.status === "ACTIVATED").length,
  }), [queue])

  const runAction = async (action: "prepare" | "submit" | "activate") => {
    if (!selected) return
    if (action === "activate") {
      const confirmed = window.confirm(`Activate approved budget ${selected.submission_number || selected.submission_id}? This creates the operational allocations atomically and cannot be partially completed.`)
      if (!confirmed) return
    }
    setSaving(true)
    setMessage(null)
    try {
      if (action === "prepare") await prepareBudgetActivation(selected.id)
      if (action === "submit") await submitBudgetActivation(selected.id)
      if (action === "activate") await activateApprovedBudget(selected.id)
      setMessage({
        type: "ok",
        text: action === "prepare"
          ? "Activation preflight completed. Review every Finance mapping and reconciliation result."
          : action === "submit"
            ? "Activation submitted to the Registrar for final authorisation."
            : "Approved budget activated successfully. Operational allocations are now available to downstream controls.",
      })
      await loadWorkspace()
      await loadLines(selected.id)
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Budget activation action failed." })
    } finally {
      setSaving(false)
    }
  }

  if (!canView) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">You do not have access to Budget Activation.</div>
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#A97C12]"><ShieldCheck className="h-4 w-4" /> Budget Management · Dual Control</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Budget Activation</h1>
          <p className="mt-1 max-w-4xl text-sm text-slate-600">An approved budget is business authority, but it becomes operational only after System Administrator mapping/preflight and separate Registrar authorisation. No fallback Chart of Accounts account or partial activation is permitted.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSystemAdministrator && <a href="/dashboard/master/finance-mapping" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Wrench className="h-4 w-4" /> Finance Mapping</a>}
          <button type="button" onClick={loadWorkspace} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Open Activation", counts.open, "Approved but not yet operational"],
          ["Validation Issues", counts.failed, "Requires Finance mapping correction"],
          ["Awaiting Registrar", counts.ready, "Ready for final authorisation"],
          ["Activated", counts.activated, "Operational allocations created"],
        ].map(([label, value, help]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-500">{help}</p></div>)}
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 lg:grid-cols-2">
        <div><strong>System Administrator:</strong> prepares the approved budget, validates Finance Code / Posting Code / Chart of Accounts relationships, corrects master data outside the approved budget, and submits a fully reconciled batch.</div>
        <div><strong>Registrar:</strong> receives a read-only reconciliation and may use Activate Approved Budget only when the batch is READY_FOR_ACTIVATION. Registrar does not edit technical mappings here.</div>
      </div>

      {message && <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{message.type === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}<span>{message.text}</span></div>}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {([['OPEN', 'Open'], ['READY', 'Awaiting Registrar'], ['ACTIVATED', 'Activated'], ['ALL', 'All']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${filter === value ? "bg-[#132A44] text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{label}</button>)}
      </div>

      <div className="grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4"><h2 className="font-semibold text-slate-900">Approved budget activation queue</h2><p className="mt-1 text-xs text-slate-500">Select a budget to inspect its reconciliation and mapping status.</p></div>
          {loading ? <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-[#132A44]" /></div> : visibleQueue.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No activation batches in this queue.</div> : <div className="max-h-[720px] divide-y divide-slate-100 overflow-y-auto">{visibleQueue.map((row) => <button key={row.id} type="button" onClick={() => setSelectedBatchId(row.id)} className={`w-full p-4 text-left transition-colors ${row.id === selectedBatchId ? "bg-sky-50" : "hover:bg-slate-50"}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">{row.submission_number || "Approved Budget"}</p><p className="mt-0.5 text-xs text-slate-500">FY {row.financial_year} · {row.division_code || row.department_code || "Organisation"}</p></div><span className={`whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold ${statusTone[row.status]}`}>{statusLabel[row.status]}</span></div><div className="mt-3 flex items-center justify-between text-xs text-slate-600"><span>{row.mapped_line_count}/{row.approved_line_count} lines mapped</span><span className="font-semibold">{money(row.approved_total)}</span></div></button>)}</div>}
        </div>

        <div className="space-y-5">
          {!selected ? <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">Select an approved budget activation batch.</div> : <>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div><div className="flex items-center gap-2"><FileCheck2 className="h-5 w-5 text-[#A97C12]" /><h2 className="text-lg font-bold text-slate-900">{selected.submission_number || selected.submission_id}</h2></div><p className="mt-1 text-sm text-slate-500">{selected.department_name || "Department"} · {selected.division_name || selected.division_code || "Division"} · FY {selected.financial_year}</p></div>
                <span className={`self-start rounded-full px-3 py-1.5 text-xs font-semibold ${statusTone[selected.status]}`}>{statusLabel[selected.status]}</span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Metric label="Approved Total" value={money(selected.approved_total)} />
                <Metric label="Activation Total" value={money(selected.activation_total)} />
                <Metric label="Variance" value={money(selected.variance)} danger={Math.abs(Number(selected.variance || 0)) > 0.009} />
                <Metric label="Approved Lines" value={String(selected.approved_line_count)} />
                <Metric label="Mapped Lines" value={String(selected.mapped_line_count)} />
                <Metric label="Unmapped Lines" value={String(selected.unmapped_line_count)} danger={selected.unmapped_line_count > 0} />
              </div>

              <div className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 md:grid-cols-2 xl:grid-cols-4"><span><strong>Prepared By:</strong> {selected.prepared_by_name || selected.prepared_by_email || "Not prepared"}</span><span><strong>Validated At:</strong> {selected.validated_at ? new Date(selected.validated_at).toLocaleString() : "Not validated"}</span><span><strong>Registrar:</strong> {selected.authorised_by_name || selected.authorised_by_email || "Not authorised"}</span><span><strong>Activated At:</strong> {selected.activated_at ? new Date(selected.activated_at).toLocaleString() : "Not activated"}</span></div>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {canPrepare && selected.status !== "ACTIVATED" && selected.status !== "CANCELLED" && <button type="button" onClick={() => runAction("prepare")} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-[#132A44] bg-white px-4 py-2.5 text-sm font-semibold text-[#132A44] hover:bg-slate-50 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />} {selected.validated_at ? "Revalidate" : "Prepare Activation"}</button>}
                {canSubmit && selected.status === "DRAFT_MAPPING" && selected.unmapped_line_count === 0 && Math.abs(Number(selected.variance || 0)) <= 0.009 && <button type="button" onClick={() => runAction("submit")} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#132A44] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1C3B5A] disabled:opacity-50"><Send className="h-4 w-4" /> Submit for Activation</button>}
                {canActivate && selected.status === "READY_FOR_ACTIVATION" && <button type="button" onClick={() => runAction("activate")} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"><CircleDollarSign className="h-4 w-4" /> Activate Approved Budget</button>}
              </div>
            </div>

            {selected.status === "VALIDATION_FAILED" && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><strong>Activation is blocked.</strong> Correct the Finance mapping issues below in <a href="/dashboard/master/finance-mapping" className="font-semibold underline">Finance Mapping</a>, then return here and select Revalidate. Approved budget amounts and Finance Codes are not edited during this process.</div>}

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-4"><h2 className="font-semibold text-slate-900">Finance mapping preflight</h2><p className="mt-1 text-xs text-slate-500">Approved Budget Line → Finance Code → Posting Code → Chart of Accounts → Cost Centre → Operational Allocation.</p></div>
              {linesLoading ? <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-[#132A44]" /></div> : lines.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">Run Prepare Activation to generate the line-by-line preflight.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Finance Code</th><th className="px-4 py-3">Finance Description</th><th className="px-4 py-3">Posting Code</th><th className="px-4 py-3">Chart of Accounts</th><th className="px-4 py-3">Cost Centre</th><th className="px-4 py-3">Approved Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Validation</th></tr></thead><tbody className="divide-y divide-slate-100">{lines.map((line) => <ActivationLineRow key={line.id} line={line} />)}</tbody></table></div>}
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className={`rounded-lg border p-3 ${danger ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-lg font-bold ${danger ? "text-red-700" : "text-slate-900"}`}>{value}</p></div>
}

function ActivationLineRow({ line }: { line: BudgetActivationLine }) {
  const validation_errors = Array.isArray(line.validation_errors) ? line.validation_errors : []
  return <tr className={line.mapping_status === "READY" ? "" : "bg-red-50/40"}><td className="px-4 py-3 font-mono font-semibold text-[#8B1E2D]">{line.finance_code || "—"}</td><td className="px-4 py-3 text-slate-700">{line.finance_description || "—"}</td><td className="px-4 py-3 font-mono text-xs">{line.posting_code || "—"}</td><td className="px-4 py-3">{line.chart_account_code ? `${line.chart_account_code} — ${line.chart_account_name || ""}` : "—"}</td><td className="px-4 py-3">{line.cost_centre_code ? `${line.cost_centre_code} — ${line.cost_centre_name || ""}` : "—"}</td><td className="px-4 py-3 font-semibold">{money(line.approved_amount)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${line.mapping_status === "READY" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{line.mapping_status === "READY" ? "Ready" : "Blocked"}</span></td><td className="px-4 py-3"><div className="max-w-[360px] space-y-1">{validation_errors.length === 0 ? <span className="text-xs text-emerald-700">All activation checks passed.</span> : validation_errors.map((error, index) => <div key={`${line.id}-${index}`} className="flex items-start gap-1.5 text-xs text-red-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{error}</span></div>)}</div></td></tr>
}
