"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Shuffle, Upload } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import {
  approveBudgetReallocation,
  createSupplementaryAdjustmentDraft,
  executeBudgetReallocation,
  getBudgetReallocations,
  getCurrentBudgetPosition,
  getHeadOfficeBudgetDashboard,
  getSupplementaryAdjustments,
  postSupplementaryAdjustment,
  registerBudgetDocument,
  rejectBudgetReallocation,
  requestBudgetReallocation,
  type BudgetPosition,
  type BudgetReallocation,
  type SupplementaryAdjustment,
} from "@/lib/head-office-budget"
import { ALLOWED_DOCUMENT_TYPES, BUCKETS, uploadPrivateFile, validateFile } from "@/lib/storage"

const money = (value: number) =>
  `K ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const positionKey = (position: BudgetPosition) =>
  `${position.division_id}:${position.section_id}:${position.expense_ledger_id}`

const positionLabel = (position: BudgetPosition) =>
  `${position.division_name} / ${position.section_name} / ${position.finance_code} — ${position.ledger_description}`

type Props = {
  financialYear: number
  cycleStatus?: string | null
}

export default function BudgetAdjustmentsPanel({ financialYear, cycleStatus }: Props) {
  const { can } = useAuth()
  const canSupplementary = can("budget.supplementary.enter")
  const canRequestReallocation = can("budget.reallocation.request")
  const canApproveReallocation = can("budget.reallocation.approve")
  const canExecuteReallocation = can("budget.reallocation.execute")
  const canManageDocuments = can("budget.documents.manage")

  const [positions, setPositions] = useState<BudgetPosition[]>([])
  const [supplementary, setSupplementary] = useState<SupplementaryAdjustment[]>([])
  const [reallocations, setReallocations] = useState<BudgetReallocation[]>([])
  const [divisionBudgetByDivision, setDivisionBudgetByDivision] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const [suppTarget, setSuppTarget] = useState("")
  const [suppAmount, setSuppAmount] = useState("")
  const [suppReason, setSuppReason] = useState("")
  const [suppReference, setSuppReference] = useState("")
  const [suppFile, setSuppFile] = useState<File | null>(null)

  const [sourceKey, setSourceKey] = useState("")
  const [destinationKey, setDestinationKey] = useState("")
  const [reallocationAmount, setReallocationAmount] = useState("")
  const [reallocationReason, setReallocationReason] = useState("")
  const [approvalReferences, setApprovalReferences] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const [positionRows, supplementaryRows, reallocationRows, dashboard] = await Promise.all([
        getCurrentBudgetPosition(financialYear),
        getSupplementaryAdjustments(financialYear),
        getBudgetReallocations(financialYear),
        getHeadOfficeBudgetDashboard(financialYear),
      ])
      setPositions(positionRows)
      setSupplementary(supplementaryRows)
      setReallocations(reallocationRows)
      setDivisionBudgetByDivision(
        Object.fromEntries(dashboard.divisions.map((division) => [division.division_id, division.id])),
      )
      setSuppTarget((current) => current || (positionRows[0] ? positionKey(positionRows[0]) : ""))
      setSourceKey((current) => current || (positionRows[0] ? positionKey(positionRows[0]) : ""))
      setDestinationKey((current) => current || (positionRows[1] ? positionKey(positionRows[1]) : ""))
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not load budget adjustments." })
    } finally {
      setLoading(false)
    }
  }, [financialYear])

  useEffect(() => {
    if (cycleStatus === "ACTIVE") void load()
  }, [cycleStatus, load])

  const byKey = useMemo(() => new Map(positions.map((position) => [positionKey(position), position])), [positions])
  const active = cycleStatus === "ACTIVE"

  const handleSupplementary = async () => {
    if (!canSupplementary || !canManageDocuments) return
    const target = byKey.get(suppTarget)
    const amount = Number(suppAmount)
    if (!target) return setMessage({ type: "err", text: "Select a budget position." })
    if (!Number.isFinite(amount) || amount === 0) return setMessage({ type: "err", text: "Enter a non-zero supplementary amount." })
    if (!suppReason.trim()) return setMessage({ type: "err", text: "Enter the reason for the supplementary adjustment." })
    if (!suppFile) return setMessage({ type: "err", text: "Upload the approved supplementary authority document before posting." })

    const validation = validateFile(suppFile, { maxSizeMB: 20, allowedTypes: ALLOWED_DOCUMENT_TYPES })
    if (!validation.valid) return setMessage({ type: "err", text: validation.error || "The selected document is not allowed." })

    const divisionBudgetId = divisionBudgetByDivision[target.division_id]
    if (!divisionBudgetId) return setMessage({ type: "err", text: "Could not resolve the Division budget record." })

    setBusy(true)
    setMessage(null)
    try {
      const adjustmentId = await createSupplementaryAdjustmentDraft({
        financialYear,
        divisionBudgetId,
        sectionId: target.section_id,
        expenseLedgerId: target.expense_ledger_id,
        adjustmentAmount: amount,
        reason: suppReason,
        authorityReference: suppReference || null,
      })
      const uploaded = await uploadPrivateFile(
        BUCKETS.BUDGET_DOCUMENTS,
        `FY${financialYear}/${target.division_code}/supplementary`,
        suppFile,
      )
      const documentId = await registerBudgetDocument({
        financialYear,
        divisionBudgetId,
        relatedEntityType: "SUPPLEMENTARY",
        relatedEntityId: adjustmentId,
        documentType: "SUPPLEMENTARY_AUTHORITY",
        referenceNumber: suppReference || null,
        description: suppReason,
        storagePath: uploaded.path,
        originalFilename: uploaded.name,
        mimeType: uploaded.type,
      })
      await postSupplementaryAdjustment(adjustmentId, documentId)
      setSuppAmount("")
      setSuppReason("")
      setSuppReference("")
      setSuppFile(null)
      await load()
      setMessage({ type: "ok", text: "Supplementary adjustment posted to the active budget." })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not post the supplementary adjustment." })
    } finally {
      setBusy(false)
    }
  }

  const handleRequestReallocation = async () => {
    if (!canRequestReallocation) return
    const source = byKey.get(sourceKey)
    const destination = byKey.get(destinationKey)
    const amount = Number(reallocationAmount)
    if (!source || !destination) return setMessage({ type: "err", text: "Select both source and destination budget positions." })
    if (positionKey(source) === positionKey(destination)) return setMessage({ type: "err", text: "Source and destination must be different." })
    if (!Number.isFinite(amount) || amount <= 0) return setMessage({ type: "err", text: "Enter a reallocation amount greater than zero." })
    if (!reallocationReason.trim()) return setMessage({ type: "err", text: "Enter the reason for the reallocation." })

    const sourceDivisionBudgetId = divisionBudgetByDivision[source.division_id]
    const destinationDivisionBudgetId = divisionBudgetByDivision[destination.division_id]
    if (!sourceDivisionBudgetId || !destinationDivisionBudgetId) return setMessage({ type: "err", text: "Could not resolve the source or destination Division budget." })

    setBusy(true)
    setMessage(null)
    try {
      await requestBudgetReallocation({
        financialYear,
        sourceDivisionBudgetId,
        sourceSectionId: source.section_id,
        sourceExpenseLedgerId: source.expense_ledger_id,
        destinationDivisionBudgetId,
        destinationSectionId: destination.section_id,
        destinationExpenseLedgerId: destination.expense_ledger_id,
        amount,
        reason: reallocationReason,
      })
      setReallocationAmount("")
      setReallocationReason("")
      await load()
      setMessage({ type: "ok", text: "Reallocation request submitted for Registrar decision." })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not submit the reallocation request." })
    } finally {
      setBusy(false)
    }
  }

  const handleApprove = async (row: BudgetReallocation) => {
    const reference = (approvalReferences[row.id] || "").trim()
    if (!reference) return setMessage({ type: "err", text: "Registrar authority reference is required before approval." })
    setBusy(true)
    setMessage(null)
    try {
      await approveBudgetReallocation({ reallocationId: row.id, authorityReference: reference })
      await load()
      setMessage({ type: "ok", text: `${row.reallocation_number} approved by Registrar authority.` })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not approve the reallocation." })
    } finally {
      setBusy(false)
    }
  }

  const handleReject = async (row: BudgetReallocation) => {
    const reason = window.prompt("Registrar rejection reason")?.trim()
    if (!reason) return
    setBusy(true)
    setMessage(null)
    try {
      await rejectBudgetReallocation(row.id, reason)
      await load()
      setMessage({ type: "ok", text: `${row.reallocation_number} rejected.` })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not reject the reallocation." })
    } finally {
      setBusy(false)
    }
  }

  const handleExecute = async (row: BudgetReallocation) => {
    if (!window.confirm(`Execute ${row.reallocation_number}? NJSS will recheck the source available balance before posting.`)) return
    setBusy(true)
    setMessage(null)
    try {
      await executeBudgetReallocation(row.id)
      await load()
      setMessage({ type: "ok", text: `${row.reallocation_number} executed and the budget position recalculated.` })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not execute the reallocation." })
    } finally {
      setBusy(false)
    }
  }

  if (!active) {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-lg font-semibold text-amber-900">Budget Adjustments</h2>
        <p className="mt-1 text-sm text-amber-800">Supplementary budgets and reallocations become available only after the annual budget is ACTIVE.</p>
      </section>
    )
  }

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="budget-adjustments-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Budget Adjustments & Current Position</h2>
          <p className="mt-1 text-sm text-slate-600">Original amounts remain locked. Only posted supplementary authority and executed Registrar-approved reallocations change the current approved budget.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {message && (
        <div className={`rounded-lg border p-3 ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          <div className="flex items-start gap-2">
            {message.type === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}
            <span className="text-sm font-medium">{message.text}</span>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-[1250px] w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-3">Division / Section / Ledger</th>
              <th className="px-3 py-3 text-right">Original</th>
              <th className="px-3 py-3 text-right">Supplementary</th>
              <th className="px-3 py-3 text-right">Reallocation In</th>
              <th className="px-3 py-3 text-right">Reallocation Out</th>
              <th className="px-3 py-3 text-right">Current Approved</th>
              <th className="px-3 py-3 text-right">Commitments</th>
              <th className="px-3 py-3 text-right">Actual</th>
              <th className="px-3 py-3 text-right">Available</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {positions.map((position) => (
              <tr key={positionKey(position)}>
                <td className="px-3 py-3">
                  <div className="font-medium text-slate-900">{position.division_name} / {position.section_name}</div>
                  <div className="text-xs text-slate-500">{position.finance_code} — {position.ledger_description}</div>
                </td>
                <td className="px-3 py-3 text-right">{money(position.original_budget)}</td>
                <td className="px-3 py-3 text-right">{money(position.supplementary_adjustments)}</td>
                <td className="px-3 py-3 text-right">{money(position.reallocations_in)}</td>
                <td className="px-3 py-3 text-right">{money(position.reallocations_out)}</td>
                <td className="px-3 py-3 text-right font-semibold">{money(position.current_approved_budget)}</td>
                <td className="px-3 py-3 text-right">{money(position.outstanding_commitments)}</td>
                <td className="px-3 py-3 text-right">{money(position.actual_expenditure)}</td>
                <td className={`px-3 py-3 text-right font-semibold ${position.available_budget < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(position.available_budget)}</td>
              </tr>
            ))}
            {!loading && positions.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">No active budget positions are available.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canSupplementary && (
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900">Post Supplementary Budget</h3>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <select value={suppTarget} onChange={(event) => setSuppTarget(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {positions.map((position) => <option key={positionKey(position)} value={positionKey(position)}>{positionLabel(position)}</option>)}
            </select>
            <input value={suppAmount} onChange={(event) => setSuppAmount(event.target.value)} inputMode="decimal" placeholder="Adjustment amount (negative reduces budget)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input value={suppReference} onChange={(event) => setSuppReference(event.target.value)} placeholder="Authority / correspondence reference" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input value={suppReason} onChange={(event) => setSuppReason(event.target.value)} placeholder="Reason" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-700">
              <Upload className="h-4 w-4" /> {suppFile?.name || "Upload approved supplementary authority"}
              <input type="file" className="hidden" onChange={(event) => setSuppFile(event.target.files?.[0] || null)} />
            </label>
            <button type="button" onClick={() => void handleSupplementary()} disabled={busy || !canManageDocuments || positions.length === 0} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#132A44] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Post Supplementary
            </button>
          </div>
          {!canManageDocuments && <p className="mt-2 text-xs text-amber-700">Document-management permission is required because supplementary authority evidence is mandatory.</p>}
          {supplementary.length > 0 && <p className="mt-3 text-xs text-slate-500">{supplementary.length} supplementary transaction(s) recorded for FY{financialYear}.</p>}
        </div>
      )}

      {canRequestReallocation && (
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900">Request Reallocation</h3>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <select value={sourceKey} onChange={(event) => setSourceKey(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Source budget position</option>
              {positions.map((position) => <option key={`src-${positionKey(position)}`} value={positionKey(position)}>{positionLabel(position)} — Available {money(position.available_budget)}</option>)}
            </select>
            <select value={destinationKey} onChange={(event) => setDestinationKey(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Destination budget position</option>
              {positions.map((position) => <option key={`dst-${positionKey(position)}`} value={positionKey(position)}>{positionLabel(position)}</option>)}
            </select>
            <input value={reallocationAmount} onChange={(event) => setReallocationAmount(event.target.value)} inputMode="decimal" placeholder="Transfer amount" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input value={reallocationReason} onChange={(event) => setReallocationReason(event.target.value)} placeholder="Reason for reallocation" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="button" onClick={() => void handleRequestReallocation()} disabled={busy || positions.length < 2} className="lg:col-span-2 inline-flex items-center justify-center gap-2 rounded-lg bg-[#132A44] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              <Shuffle className="h-4 w-4" /> Submit to Registrar
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900">Reallocation Register</h3>
        <div className="mt-3 space-y-3">
          {reallocations.map((row) => (
            <div key={row.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-900">{row.reallocation_number} · {money(row.amount)}</div>
                  <div className="mt-1 text-xs text-slate-500">{row.reason}</div>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{row.status.replaceAll("_", " ")}</span>
              </div>

              {row.status === "REQUESTED" && canApproveReallocation && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <input value={approvalReferences[row.id] || ""} onChange={(event) => setApprovalReferences((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Registrar authority reference" className="min-w-[260px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <button type="button" onClick={() => void handleApprove(row)} disabled={busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Registrar Approve</button>
                  <button type="button" onClick={() => void handleReject(row)} disabled={busy} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">Reject</button>
                </div>
              )}

              {row.status === "REGISTRAR_APPROVED" && canExecuteReallocation && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-emerald-50 p-3">
                  <span className="text-sm text-emerald-800">Registrar authority: {row.authority_reference}</span>
                  <button type="button" onClick={() => void handleExecute(row)} disabled={busy} className="rounded-lg bg-[#132A44] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Budget Officer Execute</button>
                </div>
              )}
            </div>
          ))}
          {!loading && reallocations.length === 0 && <p className="py-4 text-center text-sm text-slate-500">No reallocation requests recorded for FY{financialYear}.</p>}
        </div>
      </div>
    </section>
  )
}
