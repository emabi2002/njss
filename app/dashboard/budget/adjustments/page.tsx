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

type References = { sections: SectionReference[]; ledgers: LedgerReference[] }

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
  const [references, setReferences] = useState<References>({ sections: [], ledgers: [] })
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
      setReferences({ sections: (sectionResult.data || []) as SectionReference[], ledgers: (ledgerResult.data || []) as LedgerReference[] })

      const first = nextDashboard.divisions[0]
      if (first) {
        setSuppDivisionBudgetId((current) => current || first.id)
        setSourceDivisionBudgetId((current) => current || first.id)
        setDestinationDivisionBudgetId((current) => current || first.id)
      }
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not load Budget Adjustments." })
    } finally {
      setLoading(false)
    }
  }, [financialYear])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const divisionByBudgetId = useMemo(() => new Map((dashboard?.divisions || []).map((row) => [row.id, row])), [dashboard])
  const sectionById = useMemo(() => new Map(references.sections.map((row) => [row.id, row])), [references.sections])
  const ledgerById = useMemo(() => new Map(references.ledgers.map((row) => [row.id, row])), [references.ledgers])
  const sectionsForBudget = useCallback((budgetId: string) => {
    const divisionId = divisionByBudgetId.get(budgetId)?.division_id
    return references.sections.filter((section) => section.department_id === divisionId)
  }, [divisionByBudgetId, references.sections])

  const sourcePosition = useMemo(() => positions.find((row) =>
    row.division_budget_id === sourceDivisionBudgetId && row.section_id === sourceSectionId && row.expense_ledger_id === sourceLedgerId
  ) || null, [positions, sourceDivisionBudgetId, sourceSectionId, sourceLedgerId])
  const destinationPosition = useMemo(() => positions.find((row) =>
    row.division_budget_id === destinationDivisionBudgetId && row.section_id === destinationSectionId && row.expense_ledger_id === destinationLedgerId
  ) || null, [positions, destinationDivisionBudgetId, destinationSectionId, destinationLedgerId])

  const transfer = Number(transferAmount || 0)
  const projectedSource = (sourcePosition?.available_budget || 0) - transfer
  const projectedDestination = (destinationPosition?.current_approved_budget || 0) + transfer

  const refresh = async () => {
    setLoading(true)
    setMessage(null)
    await load()
  }

  const handlePostSupplementary = async () => {
    const amount = Number(suppAmount)
    if (!canSupplementary || !canManageDocuments || !suppFile || !suppDivisionBudgetId || !suppSectionId || !suppLedgerId || !Number.isFinite(amount) || amount === 0 || !suppReason.trim()) {
      setMessage({ type: "err", text: "Complete the Supplementary Budget fields and attach its authority document." })
      return
    }
    const validation = validateFile(suppFile, { maxSizeMB: 20, allowedTypes: ALLOWED_DOCUMENT_TYPES })
    if (!validation.valid) return setMessage({ type: "err", text: validation.error || "Invalid authority document." })

    setBusy(true)
    setMessage(null)
    try {
      const adjustmentId = await createSupplementaryDraft({ financialYear, divisionBudgetId: suppDivisionBudgetId, sectionId: suppSectionId, expenseLedgerId: suppLedgerId, adjustmentAmount: amount, reason: suppReason.trim() })
      const divisionCode = divisionByBudgetId.get(suppDivisionBudgetId)?.division?.code || suppDivisionBudgetId
      const uploaded = await uploadPrivateFile(BUCKETS.BUDGET_DOCUMENTS, `FY${financialYear}/${divisionCode}/supplementary/${adjustmentId}`, suppFile)
      const documentId = await registerBudgetDocument({ financialYear, divisionBudgetId: suppDivisionBudgetId, relatedEntityType: 'SUPPLEMENTARY', relatedEntityId: adjustmentId, documentType: 'SUPPLEMENTARY_AUTHORITY', referenceNumber: suppReference || null, documentDate: suppDate || null, description: suppReason.trim(), storagePath: uploaded.path, originalFilename: uploaded.name, mimeType: uploaded.type })
      await postSupplementaryAdjustment(adjustmentId, documentId)
      setSuppAmount(""); setSuppReason(""); setSuppReference(""); setSuppDate(""); setSuppFile(null)
      await load()
      setMessage({ type: "ok", text: "Supplementary Budget posted without changing the original approved budget." })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not post supplementary budget." })
    } finally { setBusy(false) }
  }

  const handleRequestReallocation = async () => {
    if (!canRequestReallocation || !sourceDivisionBudgetId || !sourceSectionId || !sourceLedgerId || !destinationDivisionBudgetId || !destinationSectionId || !destinationLedgerId || transfer <= 0 || !reallocationReason.trim()) {
      setMessage({ type: "err", text: "Complete the source, destination, amount and reason." })
      return
    }
    if (sourceDivisionBudgetId === destinationDivisionBudgetId && sourceSectionId === destinationSectionId && sourceLedgerId === destinationLedgerId) {
      return setMessage({ type: "err", text: "Source and destination budget keys must be different." })
    }
    if (sourcePosition && transfer > sourcePosition.available_budget) return setMessage({ type: "err", text: "Requested transfer exceeds Available Budget." })

    setBusy(true); setMessage(null)
    try {
      await requestBudgetReallocation({ financialYear, requestingDivisionId: profile?.departmentId || null, sourceDivisionBudgetId, sourceSectionId, sourceExpenseLedgerId: sourceLedgerId, destinationDivisionBudgetId, destinationSectionId, destinationExpenseLedgerId: destinationLedgerId, transferAmount: transfer, reason: reallocationReason.trim() })
      setTransferAmount(""); setReallocationReason("")
      await load()
      setMessage({ type: "ok", text: "Budget Reallocation submitted for Registrar consideration." })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not request reallocation." })
    } finally { setBusy(false) }
  }

  const handleApprove = async (row: BudgetReallocation) => {
    if (!canApproveReallocation) return
    setBusy(true); setMessage(null)
    try { await approveBudgetReallocation(row.id); await load(); setMessage({ type: "ok", text: `${row.reallocation_number} authorised by Registrar.` }) }
    catch (error) { setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not authorise reallocation." }) }
    finally { setBusy(false) }
  }

  const handleReject = async (row: BudgetReallocation) => {
    if (!canApproveReallocation || !rejectReason.trim()) return setMessage({ type: "err", text: "Registrar rejection reason is required." })
    setBusy(true); setMessage(null)
    try { await rejectBudgetReallocation(row.id, rejectReason.trim()); setRejectReason(""); await load(); setMessage({ type: "ok", text: `${row.reallocation_number} rejected by Registrar.` }) }
    catch (error) { setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not reject reallocation." }) }
    finally { setBusy(false) }
  }

  const handleExecute = async () => {
    const row = reallocations.find((item) => item.id === selectedReallocationId)
    if (!canExecuteReallocation || !canManageDocuments || !row || row.status !== 'REGISTRAR_APPROVED' || !reallocationFile) return setMessage({ type: "err", text: "Select a Registrar-approved reallocation and attach Registrar correspondence." })
    const validation = validateFile(reallocationFile, { maxSizeMB: 20, allowedTypes: ALLOWED_DOCUMENT_TYPES })
    if (!validation.valid) return setMessage({ type: "err", text: validation.error || "Invalid Registrar authority document." })

    setBusy(true); setMessage(null)
    try {
      const divisionCode = divisionByBudgetId.get(row.source_division_budget_id)?.division?.code || row.source_division_budget_id
      const uploaded = await uploadPrivateFile(BUCKETS.BUDGET_DOCUMENTS, `FY${financialYear}/${divisionCode}/reallocations/${row.id}`, reallocationFile)
      const documentId = await registerBudgetDocument({ financialYear, divisionBudgetId: row.source_division_budget_id, relatedEntityType: 'REALLOCATION', relatedEntityId: row.id, documentType: 'REGISTRAR_REALLOCATION_AUTHORITY', referenceNumber: reallocationReference || null, documentDate: reallocationDate || null, description: row.reason, storagePath: uploaded.path, originalFilename: uploaded.name, mimeType: uploaded.type })
      await executeBudgetReallocation(row.id, documentId)
      setSelectedReallocationId(""); setReallocationReference(""); setReallocationDate(""); setReallocationFile(null)
      await load()
      setMessage({ type: "ok", text: `${row.reallocation_number} executed after Registrar authority and source availability were verified.` })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not execute reallocation." })
    } finally { setBusy(false) }
  }

  const label = (row: BudgetPositionRow) => `${divisionByBudgetId.get(row.division_budget_id)?.division?.name || row.division_id} / ${sectionById.get(row.section_id)?.name || row.section_id} / ${ledgerById.get(row.expense_ledger_id)?.finance_code || row.expense_ledger_id}`
  const active = dashboard?.cycle?.status === 'ACTIVE'

  return <div className="mx-auto max-w-[1800px] space-y-6 p-4 md:p-6">
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div><h1 className="text-2xl font-semibold">Budget Adjustments</h1><p className="text-sm text-slate-600">Supplementary Budget and Budget Reallocation controls for the active Head Office budget.</p></div>
      <div className="flex items-end gap-2"><label className="text-sm">Financial Year <input className="w-28 rounded border px-3 py-2" type="number" value={financialYear} onChange={(e) => setFinancialYear(Number(e.target.value))} /></label><button className="rounded border px-3 py-2 text-sm" onClick={() => void refresh()}><RefreshCw className="mr-1 inline h-4 w-4" />Refresh</button></div>
    </header>

    {message && <div className={`flex gap-2 rounded border p-3 text-sm ${message.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{message.type === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{message.text}</div>}
    {!active && !loading && <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm">Adjustments can only be posted to an <strong>ACTIVE</strong> annual budget. Current status: {dashboard?.cycle?.status || 'not created'}.</div>}

    <section className="rounded-lg border bg-white p-4"><div className="mb-3 flex justify-between"><div><h2 className="font-semibold">Current Budget Position</h2><p className="text-xs text-slate-500">Original + Supplementary + Reallocation In - Reallocation Out = Current Approved.</p></div>{loading && <Loader2 className="h-5 w-5 animate-spin" />}</div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-xs"><tr><th className="p-2 text-left">Budget Key</th><th>Original</th><th>Supplementary</th><th>Reallocation In</th><th>Reallocation Out</th><th>Current Approved</th><th>Outstanding Commitments</th><th>Actual Expenditure</th><th>Available Budget</th></tr></thead><tbody>{positions.map((row) => <tr className="border-t" key={`${row.division_budget_id}:${row.section_id}:${row.expense_ledger_id}`}><td className="p-2">{label(row)}</td>{[row.original_budget,row.supplementary_adjustments,row.reallocations_in,row.reallocations_out,row.current_approved_budget,row.outstanding_commitments,row.actual_expenditure,row.available_budget].map((value,index) => <td className="p-2 text-right" key={index}>{money(value)}</td>)}</tr>)}</tbody></table></div></section>

    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-lg border bg-white p-4"><h2 className="font-semibold">Supplementary Budget</h2><p className="mb-3 text-xs text-slate-500">Budget Officer records separately approved changes; original locked figures remain unchanged.</p><div className="grid gap-2 md:grid-cols-2">
        <select className="rounded border p-2" value={suppDivisionBudgetId} onChange={(e)=>{setSuppDivisionBudgetId(e.target.value);setSuppSectionId("")}}><option value="">Division</option>{(dashboard?.divisions||[]).map(row=><option key={row.id} value={row.id}>{row.division?.name}</option>)}</select>
        <select className="rounded border p-2" value={suppSectionId} onChange={(e)=>setSuppSectionId(e.target.value)}><option value="">Section</option>{sectionsForBudget(suppDivisionBudgetId).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <select className="rounded border p-2 md:col-span-2" value={suppLedgerId} onChange={(e)=>setSuppLedgerId(e.target.value)}><option value="">Standard Ledger</option>{references.ledgers.map(row=><option key={row.id} value={row.id}>{row.finance_code || row.ledger_number} — {row.standard_description}</option>)}</select>
        <input className="rounded border p-2" type="number" value={suppAmount} onChange={(e)=>setSuppAmount(e.target.value)} placeholder="Adjustment amount"/><input className="rounded border p-2" value={suppReference} onChange={(e)=>setSuppReference(e.target.value)} placeholder="Authority reference"/><input className="rounded border p-2" type="date" value={suppDate} onChange={(e)=>setSuppDate(e.target.value)}/><textarea className="rounded border p-2" value={suppReason} onChange={(e)=>setSuppReason(e.target.value)} placeholder="Reason"/>
        <label className="rounded border border-dashed p-3 text-sm md:col-span-2"><Upload className="mr-2 inline h-4 w-4"/>SUPPLEMENTARY_AUTHORITY<input className="mt-2 block w-full text-xs" type="file" onChange={(e)=>setSuppFile(e.target.files?.[0]||null)}/></label>
      </div><button className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40" onClick={()=>void handlePostSupplementary()} disabled={!active||!canSupplementary||!canManageDocuments||busy}>Post Supplementary Budget</button><div className="mt-4 border-t pt-3 text-xs">{supplementaryRows.map(row=><div className="border-b py-2" key={row.id}><b>{row.transaction_number}</b> · {row.status} · {money(row.adjustment_amount)} · {row.reason}</div>)}</div></section>

      <section className="rounded-lg border bg-white p-4"><h2 className="font-semibold">Budget Reallocation</h2><p className="mb-3 text-xs text-slate-500">Director requests; Registrar alone approves; Budget Officer executes.</p><div className="grid gap-2 md:grid-cols-2">
        <select className="rounded border p-2" value={sourceDivisionBudgetId} onChange={(e)=>{setSourceDivisionBudgetId(e.target.value);setSourceSectionId("")}}><option value="">Source Division</option>{(dashboard?.divisions||[]).map(row=><option key={row.id} value={row.id}>{row.division?.name}</option>)}</select><select className="rounded border p-2" value={destinationDivisionBudgetId} onChange={(e)=>{setDestinationDivisionBudgetId(e.target.value);setDestinationSectionId("")}}><option value="">Destination Division</option>{(dashboard?.divisions||[]).map(row=><option key={row.id} value={row.id}>{row.division?.name}</option>)}</select>
        <select className="rounded border p-2" value={sourceSectionId} onChange={(e)=>setSourceSectionId(e.target.value)}><option value="">Source Section</option>{sectionsForBudget(sourceDivisionBudgetId).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select><select className="rounded border p-2" value={destinationSectionId} onChange={(e)=>setDestinationSectionId(e.target.value)}><option value="">Destination Section</option>{sectionsForBudget(destinationDivisionBudgetId).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <select className="rounded border p-2" value={sourceLedgerId} onChange={(e)=>setSourceLedgerId(e.target.value)}><option value="">Source Ledger</option>{references.ledgers.map(row=><option key={row.id} value={row.id}>{row.finance_code || row.ledger_number}</option>)}</select><select className="rounded border p-2" value={destinationLedgerId} onChange={(e)=>setDestinationLedgerId(e.target.value)}><option value="">Destination Ledger</option>{references.ledgers.map(row=><option key={row.id} value={row.id}>{row.finance_code || row.ledger_number}</option>)}</select>
        <input className="rounded border p-2" type="number" value={transferAmount} onChange={(e)=>setTransferAmount(e.target.value)} placeholder="Transfer amount"/><textarea className="rounded border p-2" value={reallocationReason} onChange={(e)=>setReallocationReason(e.target.value)} placeholder="Reason"/>
      </div><div className="mt-3 grid grid-cols-2 gap-2 rounded bg-slate-50 p-3 text-sm"><span>Current Approved: <b>{money(sourcePosition?.current_approved_budget||0)}</b></span><span>Outstanding Commitments: <b>{money(sourcePosition?.outstanding_commitments||0)}</b></span><span>Actual Expenditure: <b>{money(sourcePosition?.actual_expenditure||0)}</b></span><span>Available Budget: <b>{money(sourcePosition?.available_budget||0)}</b></span><span>Projected Source: <b>{money(projectedSource)}</b></span><span>Projected Destination: <b>{money(projectedDestination)}</b></span></div><button className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40" onClick={()=>void handleRequestReallocation()} disabled={!active||!canRequestReallocation||busy||(sourcePosition?transfer>sourcePosition.available_budget:false)}>Request Budget Reallocation</button></section>
    </div>

    <section className="rounded-lg border bg-white p-4"><h2 className="font-semibold">Reallocation Register</h2><p className="mb-3 text-xs text-slate-500">REGISTRAR_APPROVED does not move funds. Execution requires REGISTRAR_REALLOCATION_AUTHORITY.</p><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50"><tr><th>Number</th><th>Status</th><th>Amount</th><th>Reason</th><th>Controls</th></tr></thead><tbody>{reallocations.map(row=><tr className="border-t" key={row.id}><td className="p-2">{row.reallocation_number}</td><td className="p-2">{row.status}</td><td className="p-2 text-right">{money(row.transfer_amount)}</td><td className="p-2">{row.reason}</td><td className="p-2">{row.status==='REQUESTED'&&canApproveReallocation&&<><button className="mr-2 rounded bg-emerald-700 px-2 py-1 text-xs text-white" onClick={()=>void handleApprove(row)}>Registrar Authorise</button><button className="rounded bg-red-700 px-2 py-1 text-xs text-white" onClick={()=>void handleReject(row)}>Registrar Reject</button></>}{row.status==='REGISTRAR_APPROVED'&&canExecuteReallocation&&<button className="rounded bg-slate-900 px-2 py-1 text-xs text-white" onClick={()=>setSelectedReallocationId(row.id)}>Prepare Execution</button>}</td></tr>)}</tbody></table></div>
      {canApproveReallocation&&reallocations.some(row=>row.status==='REQUESTED')&&<input className="mt-3 w-full max-w-xl rounded border p-2" value={rejectReason} onChange={(e)=>setRejectReason(e.target.value)} placeholder="Registrar rejection reason"/>}
      {canExecuteReallocation&&selectedReallocationId&&<div className="mt-4 rounded border bg-slate-50 p-4"><h3 className="font-semibold">Budget Officer execution evidence</h3><div className="mt-2 grid gap-2 md:grid-cols-3"><input className="rounded border p-2" value={reallocationReference} onChange={(e)=>setReallocationReference(e.target.value)} placeholder="Registrar authority reference"/><input className="rounded border p-2" type="date" value={reallocationDate} onChange={(e)=>setReallocationDate(e.target.value)}/><label className="rounded border border-dashed p-2 text-sm"><FileText className="mr-1 inline h-4 w-4"/>REGISTRAR_REALLOCATION_AUTHORITY<input className="mt-1 block w-full text-xs" type="file" onChange={(e)=>setReallocationFile(e.target.files?.[0]||null)}/></label></div><button className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40" onClick={()=>void handleExecute()} disabled={!reallocationFile||!canManageDocuments||busy}>Execute Approved Reallocation</button></div>}
    </section>
  </div>
}
