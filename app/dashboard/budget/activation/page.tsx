"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  AlertCircle,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  History,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Wrench,
} from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import {
  activateApprovedBudget,
  getBudgetActivationLines,
  getBudgetActivationQueue,
  getBudgetActivationSnapshots,
  prepareBudgetActivation,
  submitBudgetActivation,
  type BudgetActivationBatch,
  type BudgetActivationLine,
  type BudgetActivationSnapshot,
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

type QueueFilter =
  | "AWAITING_PREPARATION"
  | "MAPPING_ISSUES"
  | "READY_FOR_REGISTRAR"
  | "READY_FOR_MY_ACTION"
  | "ACTIVATED_HISTORY"

function fingerprintLabel(batch: BudgetActivationBatch) {
  if (batch.fingerprint_state === "ACTIVATED" || batch.status === "ACTIVATED") return "Activated"
  if (batch.validation_fingerprint) return "Validated"
  return "Not validated"
}

function abbreviatedFingerprint(value: string | null) {
  if (!value) return "Not available"
  if (value.length <= 20) return value
  return `${value.slice(0, 8)}…${value.slice(-8)}`
}

export default function BudgetActivationPage() {
  const { roles, can } = useAuth()
  const searchParams = useSearchParams()
  const requestedBatchId = searchParams.get("batch")

  const isSystemAdministrator = roles.includes("System Administrator")
  const isRegistrar = roles.includes("Registrar")
  const canView = isSystemAdministrator || isRegistrar || can("budget.activation.view")
  const canPrepare = isSystemAdministrator && (can("budget.activation.prepare") || can("all"))
  const canSubmit = isSystemAdministrator && (can("budget.activation.submit") || can("all"))
  const canActivate = isRegistrar && !isSystemAdministrator && can("budget.activation.authorize")

  const [queue, setQueue] = useState<BudgetActivationBatch[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [lines, setLines] = useState<BudgetActivationLine[]>([])
  const [snapshots, setSnapshots] = useState<BudgetActivationSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [filter, setFilter] = useState<QueueFilter>("AWAITING_PREPARATION")

  const selected = queue.find((row) => row.id === selectedBatchId) || null

  const roleTabs = useMemo<Array<{ key: QueueFilter; label: string }>>(() => {
    if (isSystemAdministrator) {
      return [
        { key: "AWAITING_PREPARATION", label: "Awaiting Preparation" },
        { key: "MAPPING_ISSUES", label: "Mapping Issues" },
        { key: "READY_FOR_REGISTRAR", label: "Ready for Registrar" },
        { key: "ACTIVATED_HISTORY", label: "Activated History" },
      ]
    }
    return [
      { key: "READY_FOR_MY_ACTION", label: "Ready for My Action" },
      { key: "ACTIVATED_HISTORY", label: "Activated History" },
    ]
  }, [isSystemAdministrator])

  const activeFilter = roleTabs.some((tab) => tab.key === filter) ? filter : roleTabs[0]?.key || "ACTIVATED_HISTORY"

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await getBudgetActivationQueue()
      setQueue(rows)
      setSelectedBatchId((current) => {
        if (requestedBatchId && rows.some((row) => row.id === requestedBatchId)) return requestedBatchId
        if (current && rows.some((row) => row.id === current)) return current
        return rows[0]?.id || null
      })
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not load Budget Activation." })
    } finally {
      setLoading(false)
    }
  }, [requestedBatchId])

  const loadDetails = useCallback(async (batch: BudgetActivationBatch) => {
    setDetailLoading(true)
    try {
      const [activationLines, activationSnapshots] = await Promise.all([
        getBudgetActivationLines(batch.id),
        batch.status === "ACTIVATED" ? getBudgetActivationSnapshots(batch.id) : Promise.resolve([]),
      ])
      setLines(activationLines)
      setSnapshots(activationSnapshots)
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not load activation reconciliation details." })
      setLines([])
      setSnapshots([])
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    if (!selected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLines([])
      setSnapshots([])
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetails(selected)
  }, [selected, loadDetails])

  const visibleQueue = useMemo(() => queue.filter((row) => {
    if (activeFilter === "AWAITING_PREPARATION") return row.status === "DRAFT_MAPPING"
    if (activeFilter === "MAPPING_ISSUES") return row.status === "VALIDATION_FAILED"
    if (activeFilter === "READY_FOR_REGISTRAR" || activeFilter === "READY_FOR_MY_ACTION") return row.status === "READY_FOR_ACTIVATION"
    if (activeFilter === "ACTIVATED_HISTORY") return row.status === "ACTIVATED"
    return false
  }), [queue, activeFilter])

  const counts = useMemo(() => ({
    awaiting: queue.filter((row) => row.status === "DRAFT_MAPPING").length,
    failed: queue.filter((row) => row.status === "VALIDATION_FAILED").length,
    ready: queue.filter((row) => row.status === "READY_FOR_ACTIVATION").length,
    activated: queue.filter((row) => row.status === "ACTIVATED").length,
  }), [queue])

  const runAction = async (action: "prepare" | "submit" | "activate") => {
    if (!selected) return
    if (action === "activate") {
      const confirmed = window.confirm(`Activate approved budget ${selected.submission_number || selected.submission_id}? This creates all operational allocations atomically and cannot be partially completed.`)
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
            ? "Activation submitted to the Registrar. The validated fingerprint now protects this prepared state."
            : "Approved budget activated successfully. Operational allocations and immutable activation snapshots were created atomically.",
      })
      await loadWorkspace()
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Budget activation action failed." })
      // A stale Registrar activation returns HTTP 409 after committing VALIDATION_FAILED.
      // Reload so the UI reflects the persisted failure instead of showing stale READY state.
      await loadWorkspace()
    } finally {
      setSaving(false)
    }
  }

  const staleValidation = Boolean(selected?.validation_snapshot && selected.validation_snapshot.stale_validation === true)

  if (!canView) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">You do not have access to Budget Activation.</div>
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#A97C12]"><ShieldCheck className="h-4 w-4" /> Budget Management · Dual Control</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Budget Activation</h1>
          <p className="mt-1 max-w-4xl text-sm text-slate-600">Budget approval is governance authority only. Operational use begins after System Administrator mapping/preflight and separate Registrar activation. No fallback account, Cost Centre name matching, or partial activation is permitted.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSystemAdministrator && <Link href="/dashboard/master/finance-mapping" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Wrench className="h-4 w-4" /> Finance Mapping</Link>}
          <button type="button" onClick={loadWorkspace} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Approved Awaiting Mapping" value={counts.awaiting} help="Administrator preparation required" />
        <SummaryCard label="Validation Failed" value={counts.failed} help="Mapping or stale-state issue" />
        <SummaryCard label="Ready for Activation" value={counts.ready} help="Registrar action required" />
        <SummaryCard label="Activated" value={counts.activated} help="Operational baseline created" />
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 lg:grid-cols-2">
        <div><strong>System Administrator:</strong> prepares and validates the technical Finance mapping, then submits a fully reconciled batch. The Administrator cannot authorise final activation.</div>
        <div><strong>Registrar:</strong> receives a read-only reconciliation and may activate only a READY_FOR_ACTIVATION batch. The Registrar does not edit technical mappings here.</div>
      </div>

      {message && <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{message.type === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}<span>{message.text}</span></div>}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {roleTabs.map((tab) => <button key={tab.key} type="button" onClick={() => setFilter(tab.key)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${activeFilter === tab.key ? "bg-[#132A44] text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{tab.label}</button>)}
      </div>

      <div className="grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4"><h2 className="font-semibold text-slate-900">Approved budget activation queue</h2><p className="mt-1 text-xs text-slate-500">Only batches authorised by database RLS are shown.</p></div>
          {loading ? <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-[#132A44]" /></div> : visibleQueue.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No activation batches in this queue.</div> : <div className="max-h-[720px] divide-y divide-slate-100 overflow-y-auto">{visibleQueue.map((row) => <button key={row.id} type="button" onClick={() => setSelectedBatchId(row.id)} className={`w-full p-4 text-left transition-colors ${row.id === selectedBatchId ? "bg-sky-50" : "hover:bg-slate-50"}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">{row.submission_number || "Approved Budget"}</p><p className="mt-0.5 text-xs text-slate-500">FY {row.financial_year} · {row.division_code || row.department_code || "Organisation"}</p></div><span className={`whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold ${statusTone[row.status]}`}>{statusLabel[row.status]}</span></div><div className="mt-3 flex items-center justify-between text-xs text-slate-600"><span>{row.mapped_line_count}/{row.approved_line_count} lines mapped</span><span className="font-semibold">{money(row.approved_total)}</span></div></button>)}</div>}
        </div>

        <div className="space-y-5">
          {!selected ? <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">Select an approved budget activation batch.</div> : <>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div><div className="flex items-center gap-2"><FileCheck2 className="h-5 w-5 text-[#A97C12]" /><h2 className="text-lg font-bold text-slate-900">{selected.submission_number || selected.submission_id}</h2></div><p className="mt-1 text-sm text-slate-500">{selected.department_name || "Department"} · {selected.division_name || selected.division_code || "Division"} · FY {selected.financial_year}</p></div>
                <span className={`self-start rounded-full px-3 py-1.5 text-xs font-semibold ${statusTone[selected.status]}`}>{statusLabel[selected.status]}</span>
              </div>

              {staleValidation && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>Technical mapping or approved budget state changed after Administrator validation. The fingerprint was cleared. System Administrator must re-prepare and re-submit before Registrar activation.</span></div>}

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Metric label="Approved Total" value={money(selected.approved_total)} />
                <Metric label="Activation Total" value={money(selected.activation_total)} />
                <Metric label="Variance" value={money(selected.variance)} danger={Math.abs(Number(selected.variance || 0)) > 0.009} />
                <Metric label="Approved Lines" value={String(selected.approved_line_count)} />
                <Metric label="Mapped Lines" value={String(selected.mapped_line_count)} />
                <Metric label="Validation Errors" value={String(selected.validation_error_count || selected.unmapped_line_count || 0)} danger={(selected.validation_error_count || selected.unmapped_line_count || 0) > 0} />
              </div>

              <div className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                <span><strong>Approved By:</strong> {selected.approved_by_name || "—"}</span>
                <span><strong>Prepared By:</strong> {selected.prepared_by_name || selected.prepared_by_email || "Not prepared"}</span>
                <span><strong>Registrar:</strong> {selected.authorised_by_name || selected.authorised_by_email || "Not authorised"}</span>
                <span><strong>Activated At:</strong> {selected.activated_at ? new Date(selected.activated_at).toLocaleString() : "Not activated"}</span>
              </div>

              <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 p-3 text-xs text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                <span className="flex items-start gap-1.5"><KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><strong>Fingerprint State:</strong> {fingerprintLabel(selected)}</span></span>
                <span><strong>Fingerprint:</strong> <span className="font-mono">{abbreviatedFingerprint(selected.validation_fingerprint)}</span></span>
                <span><strong>Prepared Against:</strong> {selected.prepared_against_submission_updated_at ? new Date(selected.prepared_against_submission_updated_at).toLocaleString() : "—"}</span>
                <span><strong>Snapshot Count:</strong> {selected.activation_snapshot_count ?? snapshots.length}</span>
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {canPrepare && selected.status !== "ACTIVATED" && selected.status !== "CANCELLED" && <button type="button" onClick={() => runAction("prepare")} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-[#132A44] bg-white px-4 py-2.5 text-sm font-semibold text-[#132A44] hover:bg-slate-50 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />} {selected.validated_at ? "Re-prepare Activation" : "Prepare Activation"}</button>}
                {canSubmit && selected.status === "DRAFT_MAPPING" && selected.unmapped_line_count === 0 && Math.abs(Number(selected.variance || 0)) <= 0.009 && <button type="button" onClick={() => runAction("submit")} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#132A44] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1C3B5A] disabled:opacity-50"><Send className="h-4 w-4" /> Submit for Activation</button>}
                {canActivate && selected.status === "READY_FOR_ACTIVATION" && <button type="button" onClick={() => runAction("activate")} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"><CircleDollarSign className="h-4 w-4" /> Activate Approved Budget</button>}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-4"><h3 className="font-semibold text-slate-900">Activation preflight lines</h3><p className="mt-1 text-xs text-slate-500">Every approved line must resolve to exactly one active canonical Finance mapping and exact Cost Centre FK.</p></div>
              {detailLoading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#132A44]" /></div> : lines.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No preflight lines are available yet. System Administrator can prepare the batch to generate validation evidence.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Finance Code</th><th className="px-4 py-3">Posting Code</th><th className="px-4 py-3">Chart of Accounts</th><th className="px-4 py-3">Cost Centre</th><th className="px-4 py-3">Approved</th><th className="px-4 py-3">Mapped</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Validation</th></tr></thead><tbody className="divide-y divide-slate-100">{lines.map((line) => <tr key={line.id} className="align-top"><td className="px-4 py-3"><div className="font-mono font-semibold text-[#8B1E2D]">{line.finance_code || "—"}</div><div className="mt-1 max-w-[220px] text-xs text-slate-500">{line.finance_description || ""}</div></td><td className="px-4 py-3 font-mono text-xs">{line.posting_code || "—"}</td><td className="px-4 py-3">{line.chart_account_code ? `${line.chart_account_code} — ${line.chart_account_name || ""}` : "—"}</td><td className="px-4 py-3">{line.cost_centre_code ? `${line.cost_centre_code} — ${line.cost_centre_name || ""}` : "—"}</td><td className="px-4 py-3 font-semibold">{money(line.approved_amount)}</td><td className="px-4 py-3">{money(line.mapped_amount)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${line.mapping_status === "READY" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{line.mapping_status}</span></td><td className="px-4 py-3">{line.validation_errors.length ? <ul className="space-y-1 text-xs text-red-700">{line.validation_errors.map((error, index) => <li key={`${line.id}-${index}`}>• {error}</li>)}</ul> : <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Exact mapping valid</span>}</td></tr>)}</tbody></table></div>}
            </div>

            {selected.status === "ACTIVATED" && <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-200 p-4"><History className="h-5 w-5 text-[#A97C12]" /><div><h3 className="font-semibold text-slate-900">Activated History</h3><p className="mt-1 text-xs text-slate-500">Immutable evidence captured at activation. Master-data changes after activation do not rewrite this history.</p></div></div>
              {detailLoading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#132A44]" /></div> : snapshots.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No immutable activation snapshots are available for this legacy/activated batch.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Finance Code</th><th className="px-4 py-3">Posting Code</th><th className="px-4 py-3">Chart of Accounts</th><th className="px-4 py-3">Cost Centre</th><th className="px-4 py-3">Approved Amount</th><th className="px-4 py-3">Allocation ID</th></tr></thead><tbody className="divide-y divide-slate-100">{snapshots.map((snapshot) => <tr key={snapshot.id}><td className="px-4 py-3"><div className="font-mono font-semibold text-[#8B1E2D]">{snapshot.finance_code_snapshot}</div><div className="mt-1 text-xs text-slate-500">{snapshot.finance_description_snapshot || ""}</div></td><td className="px-4 py-3 font-mono text-xs">{snapshot.posting_code_snapshot}</td><td className="px-4 py-3">{snapshot.chart_account_code_snapshot} — {snapshot.chart_account_name_snapshot || ""}</td><td className="px-4 py-3">{snapshot.cost_centre_code_snapshot} — {snapshot.cost_centre_name_snapshot || ""}</td><td className="px-4 py-3 font-semibold">{money(snapshot.approved_amount)}</td><td className="px-4 py-3 font-mono text-xs">{snapshot.budget_allocation_id}</td></tr>)}</tbody></table></div>}
            </div>}
          </>}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, help }: { label: string; value: number; help: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-500">{help}</p></div>
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className={`rounded-lg border p-3 ${danger ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-base font-bold ${danger ? "text-red-700" : "text-slate-900"}`}>{value}</p></div>
}
