"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, CheckCircle2, ClipboardList, Loader2, Plus, RefreshCw, RotateCcw, Send, XCircle } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { transitionBudgetRevision } from "@/lib/budget-revision"
import {
  getApprovedBudgetCandidates,
  getBudgetRevisionWorkQueue,
  type ApprovedBudgetCandidate,
  type BudgetRevisionQueueItem,
} from "@/lib/budget-revision-workspace"
import { BudgetRevisionQueue } from "./BudgetRevisionQueue"
import { BudgetRevisionRequestDialog } from "./BudgetRevisionRequestDialog"

const money = (value: number | null | undefined) => `K ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type RegistrarTab = "AWAITING" | "OPEN" | "COMPLETED" | "ALL"
type SupervisorTab = "MY_REQUESTS" | "SUBMITTED" | "COMPLETED"

export default function BudgetRevisionWorkspacePage() {
  const router = useRouter()
  const { profile, roles, can } = useAuth()
  const isRegistrar = roles.includes("Registrar")
  const isLineSupervisor = roles.includes("Line Supervisor")
  const canRevisionCreate = isRegistrar && can("budget.revision.create")
  const canRevisionApprove = isRegistrar && can("budget.revision.approve")
  const canRevisionReturn = isRegistrar && can("budget.revision.return")
  const canRevisionReject = isRegistrar && can("budget.revision.reject")

  const [queue, setQueue] = useState<BudgetRevisionQueueItem[]>([])
  const [candidates, setCandidates] = useState<ApprovedBudgetCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [showRequestDialog, setShowRequestDialog] = useState(false)
  const [initialParentId, setInitialParentId] = useState<string | null>(null)
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null)
  const [registrarTab, setRegistrarTab] = useState<RegistrarTab>("AWAITING")
  const [supervisorTab, setSupervisorTab] = useState<SupervisorTab>("MY_REQUESTS")
  const [decisionComments, setDecisionComments] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const queueRows = await getBudgetRevisionWorkQueue()
      setQueue(queueRows)
      if (isRegistrar && canRevisionCreate) {
        setCandidates(await getApprovedBudgetCandidates())
      } else {
        setCandidates([])
      }
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not load the budget revision workspace." })
    } finally {
      setLoading(false)
    }
  }, [isRegistrar, canRevisionCreate])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const revisionId = params.get("revision")
    const parentId = params.get("parent")
    const action = params.get("action")
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (revisionId) setSelectedRevisionId(revisionId)
    if (parentId) setInitialParentId(parentId)
    if (parentId && action === "request") setShowRequestDialog(true)
  }, [])

  const supervisorQueue = useMemo(
    () => queue.filter((item) => item.assigned_line_supervisor_id === profile?.id),
    [queue, profile?.id],
  )

  const registrarCounts = useMemo(() => ({
    awaiting: queue.filter((item) => ["SUBMITTED", "RESUBMITTED"].includes(item.status)).length,
    preparation: queue.filter((item) => ["DRAFT", "RETURNED"].includes(item.status)).length,
    returned: queue.filter((item) => item.status === "RETURNED").length,
    approved: queue.filter((item) => item.status === "APPROVED").length,
    rejected: queue.filter((item) => item.status === "REJECTED").length,
  }), [queue])

  const supervisorCounts = useMemo(() => ({
    newRequests: supervisorQueue.filter((item) => item.status === "DRAFT").length,
    draftReturned: supervisorQueue.filter((item) => ["DRAFT", "RETURNED"].includes(item.status)).length,
    submitted: supervisorQueue.filter((item) => ["SUBMITTED", "RESUBMITTED"].includes(item.status)).length,
    completed: supervisorQueue.filter((item) => ["APPROVED", "REJECTED"].includes(item.status)).length,
  }), [supervisorQueue])

  const visibleItems = useMemo(() => {
    if (isRegistrar) {
      if (registrarTab === "AWAITING") return queue.filter((item) => ["SUBMITTED", "RESUBMITTED"].includes(item.status))
      if (registrarTab === "OPEN") return queue.filter((item) => ["DRAFT", "RETURNED", "SUBMITTED", "RESUBMITTED"].includes(item.status))
      if (registrarTab === "COMPLETED") return queue.filter((item) => ["APPROVED", "REJECTED", "ARCHIVED"].includes(item.status))
      return queue
    }
    if (isLineSupervisor) {
      if (supervisorTab === "MY_REQUESTS") return supervisorQueue.filter((item) => ["DRAFT", "RETURNED"].includes(item.status))
      if (supervisorTab === "SUBMITTED") return supervisorQueue.filter((item) => ["SUBMITTED", "RESUBMITTED"].includes(item.status))
      return supervisorQueue.filter((item) => ["APPROVED", "REJECTED", "ARCHIVED"].includes(item.status))
    }
    return queue
  }, [isRegistrar, isLineSupervisor, queue, registrarTab, supervisorQueue, supervisorTab])

  const selectedItem = queue.find((item) => item.revision_id === selectedRevisionId) || null

  const openItem = (item: BudgetRevisionQueueItem) => {
    if (isLineSupervisor && item.assigned_line_supervisor_id === profile?.id && ["DRAFT", "RETURNED"].includes(item.status)) {
      router.push(`/dashboard/budget-template?submission=${item.revision_submission_id}&revision=${item.revision_id}`)
      return
    }
    setSelectedRevisionId(item.revision_id)
    setDecisionComments("")
    const url = new URL(window.location.href)
    url.searchParams.set("revision", item.revision_id)
    window.history.replaceState({}, "", url.toString())
  }

  const actionLabel = (item: BudgetRevisionQueueItem) => {
    if (isLineSupervisor && item.assigned_line_supervisor_id === profile?.id && ["DRAFT", "RETURNED"].includes(item.status)) return "Open Revision"
    if (isRegistrar && ["SUBMITTED", "RESUBMITTED"].includes(item.status)) return "Registrar Action"
    return "View Details"
  }

  const decide = async (action: "APPROVE" | "RETURN" | "REJECT") => {
    if (!selectedItem) return
    if ((action === "RETURN" || action === "REJECT") && !decisionComments.trim()) {
      setMessage({ type: "err", text: `${action === "RETURN" ? "Return" : "Rejection"} comments are required.` })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const result = await transitionBudgetRevision(selectedItem.revision_id, action, decisionComments.trim() || undefined)
      setMessage({ type: "ok", text: `${result.revision_number} is now ${result.status}.` })
      setDecisionComments("")
      await loadWorkspace()
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : `Could not ${action.toLowerCase()} the revision.` })
    } finally {
      setSaving(false)
    }
  }

  const openRequest = () => {
    setInitialParentId(null)
    setShowRequestDialog(true)
  }

  const requestCreated = async (revisionId: string) => {
    setShowRequestDialog(false)
    setSelectedRevisionId(revisionId)
    setMessage({ type: "ok", text: "Budget change request created and assigned to the responsible Line Supervisor." })
    await loadWorkspace()
  }

  if (!isRegistrar && !isLineSupervisor && !can("budget.revision.view") && !can("budget.revision.report")) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">You do not have access to Budget Revision & Supplementary Budget.</div>
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#A97C12]"><ClipboardList className="h-4 w-4" /> Budget Management</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Budget Revision & Supplementary Budget</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Registrar initiates a controlled post-approval change; the assigned Line Supervisor reviews and submits the section budget; Registrar approves, returns or rejects.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={loadWorkspace} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
          {canRevisionCreate && <button type="button" onClick={openRequest} className="inline-flex items-center gap-2 rounded-lg bg-[#132A44] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1C3B5A]"><Plus className="h-4 w-4" /> Initiate Budget Change</button>}
        </div>
      </div>

      {message && <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{message.type === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}<span>{message.text}</span></div>}

      {isRegistrar && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["Awaiting Registrar Action", registrarCounts.awaiting, "Submitted by Line Supervisors"],
            ["Requested / In Preparation", registrarCounts.preparation, "With Line Supervisors"],
            ["Returned", registrarCounts.returned, "Awaiting amendment"],
            ["Approved", registrarCounts.approved, "Current / historical approvals"],
            ["Rejected", registrarCounts.rejected, "Closed without approval"],
          ].map(([label, value, help]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-500">{help}</p></div>)}
        </div>
      )}

      {isLineSupervisor && !isRegistrar && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["New Requests", supervisorCounts.newRequests, "Registrar requests"],
            ["Draft / Returned", supervisorCounts.draftReturned, "Requires your preparation"],
            ["Submitted", supervisorCounts.submitted, "Awaiting Registrar"],
            ["Approved / Rejected", supervisorCounts.completed, "Completed decisions"],
          ].map(([label, value, help]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-500">{help}</p></div>)}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {isRegistrar ? (
          <>
            {([['AWAITING', 'Awaiting My Action'], ['OPEN', 'Open Requests'], ['COMPLETED', 'Completed'], ['ALL', 'All Revision History']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setRegistrarTab(value)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${registrarTab === value ? "bg-[#132A44] text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{label}</button>)}
          </>
        ) : (
          <>
            {([['MY_REQUESTS', 'My Revision Requests'], ['SUBMITTED', 'Submitted'], ['COMPLETED', 'Completed']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setSupervisorTab(value)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${supervisorTab === value ? "bg-[#132A44] text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{label}</button>)}
          </>
        )}
      </div>

      {loading ? <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-16"><Loader2 className="h-7 w-7 animate-spin text-[#132A44]" /></div> : <BudgetRevisionQueue items={visibleItems} selectedRevisionId={selectedRevisionId} actionLabel={actionLabel} onOpen={openItem} />}

      {selectedItem && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected Revision</p><h2 className="mt-1 text-lg font-bold text-slate-900">{selectedItem.revision_number} — {selectedItem.revision_type.replaceAll("_", " ")}</h2><p className="mt-1 text-sm text-slate-600">{selectedItem.department_name || "Department"} • {selectedItem.section_name || selectedItem.division_name || "Section / Division"}</p></div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{selectedItem.status}</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {[["Original", selectedItem.original_budget], ["Current Revised", selectedItem.current_revised_budget], ["Proposed", selectedItem.proposed_revised_budget], ["Actual", selectedItem.actual_expenditure], ["Commitments", selectedItem.outstanding_commitment], ["Protected Minimum", selectedItem.protected_minimum]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-bold text-slate-900">{money(Number(value))}</p></div>)}
          </div>
          {selectedItem.request_instruction && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span className="font-semibold">Registrar instruction:</span> {selectedItem.request_instruction}</div>}

          {isRegistrar && ["SUBMITTED", "RESUBMITTED"].includes(selectedItem.status) && (
            <div className="mt-5 border-t border-slate-200 pt-5">
              <label className="text-sm font-semibold text-slate-700">Decision comments
                <textarea value={decisionComments} onChange={(e) => setDecisionComments(e.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" placeholder="Comments are required for Return or Reject; optional for approval." />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                {canRevisionApprove && <button type="button" disabled={saving} onClick={() => decide("APPROVE")} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Approve</button>}
                {canRevisionReturn && <button type="button" disabled={saving} onClick={() => decide("RETURN")} className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"><RotateCcw className="h-4 w-4" /> Return for Amendment</button>}
                {canRevisionReject && <button type="button" disabled={saving} onClick={() => decide("REJECT")} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"><XCircle className="h-4 w-4" /> Reject</button>}
              </div>
            </div>
          )}

          {isLineSupervisor && selectedItem.assigned_line_supervisor_id === profile?.id && ["DRAFT", "RETURNED"].includes(selectedItem.status) && <button type="button" onClick={() => router.push(`/dashboard/budget-template?submission=${selectedItem.revision_submission_id}&revision=${selectedItem.revision_id}`)} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#132A44] px-4 py-2.5 text-sm font-semibold text-white"><Send className="h-4 w-4" /> Open Revision in Budget Preparation</button>}
        </div>
      )}

      {showRequestDialog && canRevisionCreate && <BudgetRevisionRequestDialog key={initialParentId || "new-request"} candidates={candidates} initialParentId={initialParentId} onClose={() => setShowRequestDialog(false)} onCreated={requestCreated} />}
    </div>
  )
}
