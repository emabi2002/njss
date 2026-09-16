"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, FileText, Loader2, RefreshCw, Upload } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { supabase } from "@/lib/supabase"
import {
  approveBudgetReallocation,
  createSupplementaryDraft,
  executeBudgetReallocation,
  getBudgetReallocations,
  getCurrentBudgetPositions,
  getHeadOfficeBudgetDashboard,
  getSupplementaryAdjustments,
  postSupplementaryAdjustment,
  registerBudgetDocument,
  rejectBudgetReallocation,
  requestBudgetReallocation,
  type BudgetPositionRow,
  type BudgetReallocation,
  type HeadOfficeBudgetDashboard,
  type LedgerReference,
  type SectionReference,
  type SupplementaryBudgetAdjustment,
} from "@/lib/head-office-budget"
import { ALLOWED_DOCUMENT_TYPES, BUCKETS, uploadPrivateFile, validateFile } from "@/lib/storage"

const money = (value: number) =>
  `K ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Message = { type: "ok" | "err"; text: string } | null

type ReferenceData = {
  sections: SectionReference[]
  ledgers: LedgerReference[]
}

export default function BudgetAdjustmentsPage() {
  const { can, roles, profile } = useAuth()
  const canSupplementary = can('budget.supplementary.enter')
  const canRequestReallocation = can('budget.reallocation.request')
  const canApproveReallocation = can('budget.reallocation.approve') && roles.includes('Registrar')
  const canExecuteReallocation = can('budget.reallocation.execute')
  const canManageDocuments = can('budget.documents.manage')

  const [financialYear, setFinancialYear] = useState(new Date().getFullYear())
  const [dashboard, setDashboard] = useState<HeadOfficeBudgetDashboard | null>(null)
  const [positions, setPositions] = useState<BudgetPositionRow[]>([])
  const [supplementaryRows, setSupplementaryRows] = useState<SupplementaryBudgetAdjustment[]>([])
  const [reallocations, setReallocations] = useState<BudgetReallocation[]>([])
  const [references, setReferences] = useState<ReferenceData>({ sections: [], ledgers: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  const [suppDivisionBudgetId, setSuppDivisionBudgetId] = useState("")
  const [suppSectionId, setSuppSectionId] = useState("")
  const [suppLedgerId, setSuppLedgerId] = useState("")
  const [suppAmount, setSuppAmount] = useState("")
  const [suppReason, setSuppReason] = useState("")
  const [suppReference, setSuppReference] = useState("")
  const [suppDate, setSuppDate] = useState("")
  const [suppFile, setSuppFile] = useState<File | null>(null)

  const [sourceDivisionBudgetId, setSourceDivisionBudgetId] = useState("")
  const [sourceSectionId, setSourceSectionId] = useState("")
  const [sourceLedgerId, setSourceLedgerId] = useState("")
  const [destinationDivisionBudgetId, setDestinationDivisionBudgetId] = useState("")
  const [destinationSectionId, setDestinationSectionId] = useState("")
  const [destinationLedgerId, setDestinationLedgerId] = useState("")
  const [transferAmount, setTransferAmount] = useState("")
  const [reallocationReason, setReallocationReason] = useState("")
  const [rejectReason, setRejectReason] = useState("")
  const [selectedReallocationId, setSelectedReallocationId] = useState("")
  const [reallocationReference, setReallocationReference] = useState("")
  const [reallocationDate, setReallocationDate] = useState("")
  const [reallocationFile, setReallocationFile] = useState<File | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const [nextDashboard, nextPositions, nextSupplementary, nextReallocations, sectionResult, ledgerResult] = await Promise.all([
        getHeadOfficeBudgetDashboard(financialYear),
        getCurrentBudgetPositions(financialYear),
        getSupplementaryAdjustments(financialYear),
        getBudgetReallocations(financialYear),
        supabase.from('sections').select('id, code, name, department_id').eq('is_active', true).order('name'),
        supabase.from('expense_ledger').select('id, ledger_number, finance_code, standard_description, budget_class, expense_category, is_posting, is_active').eq('is_active', true).eq('is_posting', true).order('finance_code'),
      ])
      if (sectionResult.error) throw sectionResult.error
      if (ledgerResult.error) throw ledgerResult.error

      setDashboard(nextDashboard)
      setPositions(nextPositions)
      setSupplementaryRows(nextSupplementary)
      setReallocations(nextReallocations)
      setReferences({
        sections: (sectionResult.data || []) as SectionReference[],
        ledgers: (ledgerResult.data || []) as LedgerReference[],
      })

      const firstDivision = nextDashboard.divisions[0]
      if (firstDivision) {
        setSuppDivisionBudgetId((current) => current || firstDivision.id)
        setSourceDivisionBudgetId((current) => current || firstDivision.id)
        setDestinationDivisionBudgetId((current) => current || firstDivision.id)
      }
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not load Budget Adjustments." })
    } finally {
      setLoading(false)
    }
  }, [financialYear])

  useEffect(() => {
    void load()
  }, [load])

  const divisionByBudgetId = useMemo(() => new Map((dashboard?.divisions || []).map((row) => [row.id, row])), [dashboard])
  const sectionById = useMemo(() => new Map(references.sections.map((row) => [row.id, row])), [references.sections])
  const ledgerById = useMemo(() => new Map(references.ledgers.map((row) => [row.id, row])), [references.ledgers])

  const sectionsForBudget = useCallback((divisionBudgetId: string) => {
    const divisionId = divisionByBudgetId.get(divisionBudgetId)?.division_id
    return references.sections.filter((section) => section.department_id === divisionId)
  }, [divisionByBudgetId, references.sections])

  const sourcePosition = useMemo(
    () => positions.find((row) => row.division_budget_id === sourceDivisionBudgetId && row.section_id === sourceSectionId && row.expense_ledger_id === sourceLedgerId) || null,
    [positions, sourceDivisionBudgetId, sourceSectionId, sourceLedgerId],
  )
  const destinationPosition = useMemo(
    () => positions.find((row) => row.division_budget_id === destinationDivisionBudgetId && row.section_id === destinationSectionId && row.expense_ledger_id === destinationLedgerId) || null,
    [positions, destinationDivisionBudgetId, destinationSectionId, destinationLedgerId],
  )
  const transfer = Number(transferAmount || 0)
  const projectedSource = (sourcePosition?.available_budget || 0) - transfer
  const projectedDestination = (destinationPosition?.current_approved_budget || 0) + transfer

  const handlePostSupplementary = async () => {
    if (!canSupplementary) return
    const adjustmentAmount = Number(suppAmount)
    if (!suppDivisionBudgetId || !suppSectionId || !suppLedgerId || !Number.isFinite(adjustmentAmount) || adjustmentAmount === 0 || !suppReason.trim()) {
      setMessage({ type: "err", text: "Complete Division, Section, Ledger, adjustment amount and reason." })
      return
    }
    if (!suppFile || !canManageDocuments) {
      setMessage({ type: "err", text: "A Supplementary Budget authority document is required before posting." })
      return
    }
    const validation = validateFile(suppFile, { maxSizeMB: 20, allowedTypes: ALLOWED_DOCUMENT_TYPES })
    if (!validation.valid) {
      setMessage({ type: "err", text: validation.error || "The selected authority document is not allowed." })
      return
    }

    setBusy(true)
    setMessage(null)
    try {
      const adjustmentId = await createSupplementaryDraft({
        financialYear,
        divisionBudgetId: suppDivisionBudgetId,
        sectionId: suppSectionId,
        expenseLedgerId: suppLedgerId,
        adjustmentAmount,
        reason: suppReason.trim(),
      })
      const divisionCode = divisionByBudgetId.get(suppDivisionBudgetId)?.division?.code || suppDivisionBudgetId
      const uploaded = await uploadPrivateFile(BUCKETS.BUDGET_DOCUMENTS, `FY${financialYear}/${divisionCode}/supplementary/${adjustmentId}`, suppFile)
      const documentId = await registerBudgetDocument({
        financialYear,
        divisionBudgetId: suppDivisionBudgetId,
        relatedEntityType: 'SUPPLEMENTARY',
        relatedEntityId: adjustmentId,
        documentType: 'SUPPLEMENTARY_AUTHORITY',
        referenceNumber: suppReference || null,
        documentDate: suppDate || null,
        description: suppReason.trim(),
        storagePath: uploaded.path,
        originalFilename: uploaded.name,
        mimeType: uploaded.type,
      })
      await postSupplementaryAdjustment(adjustmentId, documentId)
      setSuppAmount("")
      setSuppReason("")
      setSuppReference("")
      setSuppDate("")
      setSuppFile(null)
      await load()
      setMessage({ type: "ok", text: "Supplementary Budget posted. The original approved budget remains unchanged." })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not post the supplementary adjustment." })
    } finally {
      setBusy(false)
    }
  }

  const handleRequestReallocation = async () => {
    if (!canRequestReallocation) return
    if (!sourceDivisionBudgetId || !sourceSectionId || !sourceLedgerId || !destinationDivisionBudgetId || !destinationSectionId || !destinationLedgerId || !Number.isFinite(transfer) || transfer <= 0 || !reallocationReason.trim()) {
      setMessage({ type: "err", text: "Complete the source, destination, transfer amount and reason." })
      return
    }
    if (sourceDivisionBudgetId === destinationDivisionBudgetId && sourceSectionId === destinationSectionId && sourceLedgerId === destinationLedgerId) {
      setMessage({ type: "err", text: "Source and destination budget keys must be different." })
      return
    }
    if (sourcePosition && transfer > sourcePosition.available_budget) {
      setMessage({ type: "err", text: "Requested transfer exceeds the currently available source budget." })
      return
    }

    setBusy(true)
    setMessage(null)
    try {
      await requestBudgetReallocation({
        financialYear,
        requestingDivisionId: profile?.departmentId || null,
        sourceDivisionBudgetId,
        sourceSectionId,
        sourceExpenseLedgerId: sourceLedgerId,
        destinationDivisionBudgetId,
        destinationSectionId,
        destinationExpenseLedgerId: destinationLedgerId,
        transferAmount: transfer,
        reason: reallocationReason.trim(),
      })
      setTransferAmount("")
      setReallocationReason("")
      await load()
      setMessage({ type: "ok", text: "Budget Reallocation request submitted for Registrar consideration." })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not submit the reallocation request." })
    } finally {
      setBusy(false)
    }
  }

  const handleApprove = async (row: BudgetReallocation) => {
    if (!canApproveReallocation) return
    setBusy(true)
    setMessage(null)
    try {
      await approveBudgetReallocation(row.id)
      await load()
      setMessage({ type: "ok", text: `${row.reallocation_number} approved by Registrar.` })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not approve the reallocation." })
    } finally {
      setBusy(false)
    }
  }

  const handleReject = async (row: BudgetReallocation) => {
    if (!canApproveReallocation) return
    if (!rejectReason.trim()) {
      setMessage({ type: "err", text: "Enter a rejection reason before rejecting a reallocation." })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await rejectBudgetReallocation(row.id, rejectReason.trim())
      setRejectReason("")
      await load()
      setMessage({ type: "ok", text: `${row.reallocation_number} rejected by Registrar.` })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not reject the reallocation." })
    } finally {
      setBusy(false)
    }
  }

  const handleExecute = async () => {
    if (!canExecuteReallocation || !selectedReallocationId) return
    const row = reallocations.find((item) => item.id === selectedReallocationId)
    if (!row || row.status !== 'REGISTRAR_APPROVED') {
      setMessage({ type: "err", text: "Select a Registrar-approved reallocation." })
      return
    }
    if (!reallocationFile || !canManageDocuments) {
      setMessage({ type: "err", text: "Registrar correspondence is required before execution." })
      return
    }
    const validation = validateFile(reallocationFile, { maxSizeMB: 20, allowedTypes: ALLOWED_DOCUMENT_TYPES })
    if (!validation.valid) {
      setMessage({ type: "err", text: validation.error || "The selected Registrar authority document is not allowed." })
      return
    }

    setBusy(true)
    setMessage(null)
    try {
      const sourceDivision = divisionByBudgetId.get(row.source_division_budget_id)
      const divisionCode = sourceDivision?.division?.code || row.source_division_budget_id
      const uploaded = await uploadPrivateFile(BUCKETS.BUDGET_DOCUMENTS, `FY${financialYear}/${divisionCode}/reallocations/${row.id}`, reallocationFile)
      const documentId = await registerBudgetDocument({
        financialYear,
        divisionBudgetId: row.source_division_budget_id,
        relatedEntityType: 'REALLOCATION',
        relatedEntityId: row.id,
        documentType: 'REGISTRAR_REALLOCATION_AUTHORITY',
        referenceNumber: reallocationReference || null,
        documentDate: reallocationDate || null,
        description: row.reason,
        storagePath: uploaded.path,
        originalFilename: uploaded.name,
        mimeType: uploaded.type,
      })
      await executeBudgetReallocation(row.id, documentId)
      setSelectedReallocationId("")
      setReallocationReference("")
      setReallocationDate("")
      setReallocationFile(null)
      await load()
      setMessage({ type: "ok", text: `${row.reallocation_number} executed atomically after Registrar authority was verified.` })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not execute the reallocation." })
    } finally {
      setBusy(false)
    }
  }

  const renderPositionLabel = (row: BudgetPositionRow) => {
    const division = divisionByBudgetId.get(row.division_budget_id)?.division
    const section = sectionById.get(row.section_id)
    const ledger = ledgerById.get(row.expense_ledger_id)
    return `${division?.name || row.division_id} / ${section?.name || row.section_id} / ${ledger?.finance_code || ledger?.ledger_number || row.expense_ledger_id}`
  }

  return (
    <div className="mx-auto max-w-[1800px] space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Budget Adjustments</h1>
          <p className="mt-1 text-sm text-slate-600">Operational Supplementary Budget and Budget Reallocation workspace for the active Head Office annual budget.</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-sm font-medium text-slate-700">Financial Year
            <input className="ml-2 w-28 rounded border px-3 py-2" type="number" value={financialYear} onChange={(event) => setFinancialYear(Number(event.target.value))} />
          </label>
          <button className="rounded border px-3 py-2 text-sm" onClick={() => void load()} disabled={loading || busy}><RefreshCw className="mr-1 inline h-4 w-4" />Refresh</button>
        </div>
      </div>

      {message && (
        <div className={`flex items-start gap-2 rounded border p-3 text-sm ${message.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {message.type === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}
          <span>{message.text}</span>
        </div>
      )}

      {dashboard?.cycle?.status !== 'ACTIVE' && !loading && (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Budget adjustments are financial events and can only be posted against an <strong>ACTIVE</strong> annual Head Office budget. Current status: {dashboard?.cycle?.status || 'not created'}.
        </div>
      )}

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Current Budget Position</h2>
            <p className="text-xs text-slate-500">Original + Supplementary + Reallocation In - Reallocation Out = Current Approved. Commitments and actuals then reduce Available Budget.</p>
          </div>
          {loading && <Loader2 className="h-5 w-5 animate-spin text-slate-500" />}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-3 py-2">Budget Key</th><th className="px-3 py-2 text-right">Original</th><th className="px-3 py-2 text-right">Supplementary</th><th className="px-3 py-2 text-right">Reallocation In</th><th className="px-3 py-2 text-right">Reallocation Out</th><th className="px-3 py-2 text-right">Current Approved</th><th className="px-3 py-2 text-right">Outstanding Commitments</th><th className="px-3 py-2 text-right">Actual Expenditure</th><th className="px-3 py-2 text-right">Available Budget</th></tr></thead>
            <tbody>
              {positions.map((row) => <tr key={`${row.division_budget_id}:${row.section_id}:${row.expense_ledger_id}`} className="border-t"><td className="px-3 py-2 font-medium">{renderPositionLabel(row)}</td><td className="px-3 py-2 text-right">{money(row.original_budget)}</td><td className="px-3 py-2 text-right">{money(row.supplementary_adjustments)}</td><td className="px-3 py-2 text-right">{money(row.reallocations_in)}</td><td className="px-3 py-2 text-right">{money(row.reallocations_out)}</td><td className="px-3 py-2 text-right font-semibold">{money(row.current_approved_budget)}</td><td className="px-3 py-2 text-right">{money(row.outstanding_commitments)}</td><td className="px-3 py-2 text-right">{money(row.actual_expenditure)}</td><td className="px-3 py-2 text-right font-semibold">{money(row.available_budget)}</td></tr>)}
              {!positions.length && !loading && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">No active simplified budget position is available for FY{financialYear}.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-slate-900">Supplementary Budget</h2>
          <p className="mb-4 text-xs text-slate-500">Budget Officer posts a separately authorised adjustment. The original locked budget is never overwritten.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <select className="rounded border px-3 py-2" value={suppDivisionBudgetId} onChange={(e) => { setSuppDivisionBudgetId(e.target.value); setSuppSectionId("") }} disabled={!canSupplementary || busy}><option value="">Division</option>{(dashboard?.divisions || []).map((row) => <option key={row.id} value={row.id}>{row.division?.name || row.division_id}</option>)}</select>
            <select className="rounded border px-3 py-2" value={suppSectionId} onChange={(e) => setSuppSectionId(e.target.value)} disabled={!canSupplementary || busy}><option value="">Section</option>{sectionsForBudget(suppDivisionBudgetId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
            <select className="rounded border px-3 py-2 md:col-span-2" value={suppLedgerId} onChange={(e) => setSuppLedgerId(e.target.value)} disabled={!canSupplementary || busy}><option value="">Standard Ledger</option>{references.ledgers.map((row) => <option key={row.id} value={row.id}>{row.finance_code || row.ledger_number} — {row.standard_description}</option>)}</select>
            <input className="rounded border px-3 py-2" type="number" step="0.01" value={suppAmount} onChange={(e) => setSuppAmount(e.target.value)} placeholder="Adjustment amount" disabled={!canSupplementary || busy} />
            <input className="rounded border px-3 py-2" value={suppReference} onChange={(e) => setSuppReference(e.target.value)} placeholder="Authority reference" disabled={!canSupplementary || busy} />
            <input className="rounded border px-3 py-2" type="date" value={suppDate} onChange={(e) => setSuppDate(e.target.value)} disabled={!canSupplementary || busy} />
            <textarea className="rounded border px-3 py-2 md:col-span-2" value={suppReason} onChange={(e) => setSuppReason(e.target.value)} placeholder="Reason / description" disabled={!canSupplementary || busy} />
            <label className="rounded border border-dashed px-3 py-3 text-sm md:col-span-2"><Upload className="mr-2 inline h-4 w-4" />SUPPLEMENTARY_AUTHORITY document<input className="mt-2 block w-full text-xs" type="file" onChange={(e) => setSuppFile(e.target.files?.[0] || null)} disabled={!canSupplementary || !canManageDocuments || busy} /></label>
          </div>
          <button className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40" onClick={() => void handlePostSupplementary()} disabled={!canSupplementary || !canManageDocuments || dashboard?.cycle?.status !== 'ACTIVE' || busy}>{busy ? 'Working…' : 'Post Supplementary Budget'}</button>

          <div className="mt-5 border-t pt-4">
            <h3 className="text-sm font-semibold">Supplementary register</h3>
            <div className="mt-2 max-h-56 overflow-auto text-xs">{supplementaryRows.map((row) => <div key={row.id} className="border-b py-2"><span className="font-medium">{row.transaction_number}</span> · {row.status} · {money(row.adjustment_amount)} · {row.reason}</div>)}</div>
          </div>
        </section>

        <section className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-slate-900">Budget Reallocation</h2>
          <p className="mb-4 text-xs text-slate-500">Division Director/request permission initiates; Registrar alone approves; Budget Officer executes after official Registrar correspondence is attached.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <select className="rounded border px-3 py-2" value={sourceDivisionBudgetId} onChange={(e) => { setSourceDivisionBudgetId(e.target.value); setSourceSectionId("") }} disabled={!canRequestReallocation || busy}><option value="">Source Division</option>{(dashboard?.divisions || []).map((row) => <option key={row.id} value={row.id}>{row.division?.name || row.division_id}</option>)}</select>
            <select className="rounded border px-3 py-2" value={destinationDivisionBudgetId} onChange={(e) => { setDestinationDivisionBudgetId(e.target.value); setDestinationSectionId("") }} disabled={!canRequestReallocation || busy}><option value="">Destination Division</option>{(dashboard?.divisions || []).map((row) => <option key={row.id} value={row.id}>{row.division?.name || row.division_id}</option>)}</select>
            <select className="rounded border px-3 py-2" value={sourceSectionId} onChange={(e) => setSourceSectionId(e.target.value)} disabled={!canRequestReallocation || busy}><option value="">Source Section</option>{sectionsForBudget(sourceDivisionBudgetId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
            <select className="rounded border px-3 py-2" value={destinationSectionId} onChange={(e) => setDestinationSectionId(e.target.value)} disabled={!canRequestReallocation || busy}><option value="">Destination Section</option>{sectionsForBudget(destinationDivisionBudgetId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
            <select className="rounded border px-3 py-2" value={sourceLedgerId} onChange={(e) => setSourceLedgerId(e.target.value)} disabled={!canRequestReallocation || busy}><option value="">Source Ledger</option>{references.ledgers.map((row) => <option key={row.id} value={row.id}>{row.finance_code || row.ledger_number} — {row.standard_description}</option>)}</select>
            <select className="rounded border px-3 py-2" value={destinationLedgerId} onChange={(e) => setDestinationLedgerId(e.target.value)} disabled={!canRequestReallocation || busy}><option value="">Destination Ledger</option>{references.ledgers.map((row) => <option key={row.id} value={row.id}>{row.finance_code || row.ledger_number} — {row.standard_description}</option>)}</select>
            <input className="rounded border px-3 py-2" type="number" step="0.01" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} placeholder="Transfer amount" disabled={!canRequestReallocation || busy} />
            <textarea className="rounded border px-3 py-2" value={reallocationReason} onChange={(e) => setReallocationReason(e.target.value)} placeholder="Business reason" disabled={!canRequestReallocation || busy} />
          </div>

          <div className="mt-4 grid gap-3 rounded bg-slate-50 p-3 text-sm md:grid-cols-2">
            <div><div className="text-xs text-slate-500">Source Current Approved</div><div className="font-semibold">{money(sourcePosition?.current_approved_budget || 0)}</div></div>
            <div><div className="text-xs text-slate-500">Outstanding Commitments</div><div className="font-semibold">{money(sourcePosition?.outstanding_commitments || 0)}</div></div>
            <div><div className="text-xs text-slate-500">Actual Expenditure</div><div className="font-semibold">{money(sourcePosition?.actual_expenditure || 0)}</div></div>
            <div><div className="text-xs text-slate-500">Available Budget</div><div className="font-semibold">{money(sourcePosition?.available_budget || 0)}</div></div>
            <div><div className="text-xs text-slate-500">Projected Source Balance</div><div className={`font-semibold ${projectedSource < 0 ? 'text-red-600' : ''}`}>{money(projectedSource)}</div></div>
            <div><div className="text-xs text-slate-500">Projected Destination Current Approved</div><div className="font-semibold">{money(projectedDestination)}</div></div>
          </div>

          <button className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40" onClick={() => void handleRequestReallocation()} disabled={!canRequestReallocation || dashboard?.cycle?.status !== 'ACTIVE' || busy || (sourcePosition ? transfer > sourcePosition.available_budget : false)}>{busy ? 'Working…' : 'Request Budget Reallocation'}</button>
        </section>
      </div>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="mb-3"><h2 className="font-semibold text-slate-900">Reallocation Register</h2><p className="text-xs text-slate-500">REGISTRAR_APPROVED is an approval state only. Financial movement occurs only when the Budget Officer executes with REGISTRAR_REALLOCATION_AUTHORITY evidence.</p></div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-3 py-2">Number</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Destination</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Controls</th></tr></thead>
            <tbody>{reallocations.map((row) => <tr key={row.id} className="border-t align-top"><td className="px-3 py-2 font-medium">{row.reallocation_number}</td><td className="px-3 py-2">{row.status}</td><td className="px-3 py-2 text-xs">{divisionByBudgetId.get(row.source_division_budget_id)?.division?.name || row.source_division_budget_id}<br />{sectionById.get(row.source_section_id)?.name || row.source_section_id}<br />{ledgerById.get(row.source_expense_ledger_id)?.finance_code || row.source_expense_ledger_id}</td><td className="px-3 py-2 text-xs">{divisionByBudgetId.get(row.destination_division_budget_id)?.division?.name || row.destination_division_budget_id}<br />{sectionById.get(row.destination_section_id)?.name || row.destination_section_id}<br />{ledgerById.get(row.destination_expense_ledger_id)?.finance_code || row.destination_expense_ledger_id}</td><td className="px-3 py-2 text-right font-medium">{money(row.transfer_amount)}</td><td className="px-3 py-2">{row.reason}</td><td className="px-3 py-2"><div className="flex flex-wrap gap-2">{row.status === 'REQUESTED' && canApproveReallocation && <><button className="rounded bg-emerald-700 px-2 py-1 text-xs text-white" onClick={() => void handleApprove(row)} disabled={busy}>Registrar Authorise</button><button className="rounded bg-red-700 px-2 py-1 text-xs text-white" onClick={() => void handleReject(row)} disabled={busy}>Registrar Reject</button></>}{row.status === 'REGISTRAR_APPROVED' && canExecuteReallocation && <button className="rounded bg-slate-900 px-2 py-1 text-xs text-white" onClick={() => setSelectedReallocationId(row.id)} disabled={busy}>Prepare Execution</button>}</div></td></tr>)}{!reallocations.length && !loading && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No reallocation transactions for FY{financialYear}.</td></tr>}</tbody>
          </table>
        </div>

        {canApproveReallocation && reallocations.some((row) => row.status === 'REQUESTED') && <div className="mt-4 max-w-xl"><label className="text-sm font-medium">Registrar rejection reason<input className="mt-1 w-full rounded border px-3 py-2" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Required only when rejecting" /></label></div>}

        {canExecuteReallocation && selectedReallocationId && <div className="mt-5 rounded border border-slate-200 bg-slate-50 p-4"><h3 className="font-semibold">Budget Officer execution evidence</h3><p className="mb-3 text-xs text-slate-500">Attach official Registrar correspondence before execution. The database rechecks source availability atomically at execution time.</p><div className="grid gap-3 md:grid-cols-3"><input className="rounded border px-3 py-2" value={reallocationReference} onChange={(e) => setReallocationReference(e.target.value)} placeholder="Registrar authority reference" /><input className="rounded border px-3 py-2" type="date" value={reallocationDate} onChange={(e) => setReallocationDate(e.target.value)} /><label className="rounded border border-dashed px-3 py-2 text-sm"><FileText className="mr-2 inline h-4 w-4" />REGISTRAR_REALLOCATION_AUTHORITY<input className="mt-1 block w-full text-xs" type="file" onChange={(e) => setReallocationFile(e.target.files?.[0] || null)} /></label></div><button className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40" onClick={() => void handleExecute()} disabled={busy || !reallocationFile || !canManageDocuments}>{busy ? 'Working…' : 'Execute Approved Reallocation'}</button></div>}
      </section>
    </div>
  )
}
