"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  CheckCircle2,
  FileCheck2,
  FileText,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import {
  activateAnnualBudget,
  getAnnualBudgetActivationAuthorities,
  getHeadOfficeBudgetDashboard,
  registerBudgetDocument,
  type BudgetDocument,
  type HeadOfficeBudgetDashboard,
} from "@/lib/head-office-budget"
import {
  ALLOWED_DOCUMENT_TYPES,
  BUCKETS,
  getSignedUrl,
  uploadPrivateFile,
  validateFile,
} from "@/lib/storage"

const money = (value: number) =>
  `K ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const EMPTY_DASHBOARD: HeadOfficeBudgetDashboard = {
  cycle: null,
  divisions: [],
  headOfficeTotal: 0,
}

export default function AnnualBudgetActivationPage() {
  const { can } = useAuth()
  const [financialYear, setFinancialYear] = useState(new Date().getFullYear())
  const [dashboard, setDashboard] = useState<HeadOfficeBudgetDashboard>(EMPTY_DASHBOARD)
  const [authorities, setAuthorities] = useState<BudgetDocument[]>([])
  const [selectedAuthorityId, setSelectedAuthorityId] = useState<string | null>(null)
  const [authorityReference, setAuthorityReference] = useState("")
  const [authorityDate, setAuthorityDate] = useState("")
  const [authorityDescription, setAuthorityDescription] = useState("")
  const [authorityFile, setAuthorityFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const canView = can('budget.view') || can('budget.activate') || can('budget.documents.manage') || can('all')
  const canActivate = can('budget.activate') || can('all')
  const canManageDocuments = can('budget.documents.manage') || can('all')

  const cycle = dashboard.cycle
  const allLocked = dashboard.divisions.length > 0 && dashboard.divisions.every((division) => division.status === "LOCKED")
  const readyForActivation = cycle?.status === "READY_FOR_ACTIVATION" && allLocked
  const active = cycle?.status === "ACTIVE"

  const lockedCount = useMemo(
    () => dashboard.divisions.filter((division) => division.status === "LOCKED").length,
    [dashboard.divisions],
  )

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const nextDashboard = await getHeadOfficeBudgetDashboard(financialYear)
      setDashboard(nextDashboard)
      if (!nextDashboard.cycle) {
        setAuthorities([])
        setSelectedAuthorityId(null)
        return
      }

      const nextAuthorities = await getAnnualBudgetActivationAuthorities(nextDashboard.cycle.id)
      setAuthorities(nextAuthorities)
      setSelectedAuthorityId(
        nextDashboard.cycle.activation_authority_document_id || nextAuthorities[0]?.id || null,
      )
    } catch (error) {
      setDashboard(EMPTY_DASHBOARD)
      setAuthorities([])
      setSelectedAuthorityId(null)
      setMessage({
        type: "err",
        text: error instanceof Error ? error.message : "Could not load annual budget activation.",
      })
    } finally {
      setLoading(false)
    }
  }, [financialYear])

  useEffect(() => {
    loadWorkspace()
  }, [loadWorkspace])

  const handleUploadAuthority = async () => {
    if (!cycle) {
      setMessage({ type: "err", text: "Create the annual budget before recording activation authority." })
      return
    }
    if (!readyForActivation) {
      setMessage({ type: "err", text: "All required Divisions must be locked before activation authority is recorded." })
      return
    }
    if (!authorityFile) {
      setMessage({ type: "err", text: "Select the Registrar Office activation advice or correspondence." })
      return
    }
    if (!canManageDocuments) {
      setMessage({ type: "err", text: "You do not have permission to manage budget documents." })
      return
    }

    const validation = validateFile(authorityFile, {
      maxSizeMB: 20,
      allowedTypes: ALLOWED_DOCUMENT_TYPES,
    })
    if (!validation.valid) {
      setMessage({ type: "err", text: validation.error || "Invalid activation authority document." })
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const uploaded = await uploadPrivateFile(
        BUCKETS.BUDGET_DOCUMENTS,
        `FY${financialYear}/annual/activation`,
        authorityFile,
      )
      const documentId = await registerBudgetDocument({
        financialYear,
        relatedEntityType: "ANNUAL_BUDGET_CYCLE",
        relatedEntityId: cycle.id,
        documentType: "REGISTRAR_ACTIVATION_AUTHORITY",
        referenceNumber: authorityReference || null,
        documentDate: authorityDate || null,
        description: authorityDescription || "Registrar Office authority to activate the annual Head Office budget",
        storagePath: uploaded.path,
        originalFilename: authorityFile.name,
        mimeType: authorityFile.type || null,
        supersedesDocumentId: authorities[0]?.id || null,
      })

      setSelectedAuthorityId(documentId)
      setAuthorityFile(null)
      setAuthorityReference("")
      setAuthorityDate("")
      setAuthorityDescription("")
      setMessage({ type: "ok", text: "Registrar activation authority recorded in the controlled budget document register." })
      await loadWorkspace()
    } catch (error) {
      setMessage({
        type: "err",
        text: error instanceof Error ? error.message : "Could not record Registrar activation authority.",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleActivate = async () => {
    if (!cycle || !selectedAuthorityId) {
      setMessage({ type: "err", text: "Record and select the Registrar activation authority before activation." })
      return
    }
    if (!readyForActivation) {
      setMessage({ type: "err", text: "All required Divisions must be locked before activation." })
      return
    }
    if (!canActivate) {
      setMessage({ type: "err", text: "You do not have permission to activate the annual budget." })
      return
    }

    const confirmed = window.confirm(
      `Activate the FY${financialYear} Head Office annual budget? This makes the locked approved figures operational for budget control.`,
    )
    if (!confirmed) return

    setSaving(true)
    setMessage(null)
    try {
      await activateAnnualBudget(cycle.id, selectedAuthorityId)
      setMessage({
        type: "ok",
        text: `FY${financialYear} annual budget activated. Locked approved figures are now the operational budget baseline.`,
      })
      await loadWorkspace()
    } catch (error) {
      setMessage({
        type: "err",
        text: error instanceof Error ? error.message : "Annual budget activation failed.",
      })
    } finally {
      setSaving(false)
    }
  }

  const openAuthority = async (document: BudgetDocument) => {
    try {
      const url = await getSignedUrl(BUCKETS.BUDGET_DOCUMENTS, document.storage_path, 900)
      window.open(url, "_blank", "noopener,noreferrer")
    } catch (error) {
      setMessage({
        type: "err",
        text: error instanceof Error ? error.message : "Could not open the controlled document.",
      })
    }
  }

  if (!canView) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">
        You do not have access to Annual Budget Activation.
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#A97C12]">
            <ShieldCheck className="h-4 w-4" /> Budget Management · Annual Control
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Annual Budget Activation</h1>
          <p className="mt-1 max-w-4xl text-sm text-slate-600">
            All required Divisions must be locked before activation. The Budget Officer then records formal Registrar Office authority and activates the year. Activation changes status only; it does not alter approved figures.
          </p>
        </div>
        <button
          type="button"
          onClick={loadWorkspace}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Financial Year</label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            type="number"
            min={2000}
            max={2200}
            value={financialYear}
            onChange={(event) => setFinancialYear(Number(event.target.value))}
            className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${active ? "bg-emerald-100 text-emerald-700" : readyForActivation ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
            {cycle?.status || "NOT STARTED"}
          </span>
          {cycle && (
            <span className="text-sm text-slate-600">
              {lockedCount}/{dashboard.divisions.length} Divisions locked
            </span>
          )}
        </div>
      </div>

      {message && (
        <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.type === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center rounded-xl border border-slate-200 bg-white py-20">
          <Loader2 className="h-7 w-7 animate-spin text-[#132A44]" />
        </div>
      ) : !cycle ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <FileText className="mx-auto h-10 w-10 text-slate-400" />
          <h2 className="mt-3 text-lg font-semibold text-slate-900">No FY{financialYear} annual budget cycle exists</h2>
          <p className="mt-1 text-sm text-slate-500">Begin annual budget capture first. The system will snapshot all active Head Office Divisions into the year.</p>
          <Link href="/dashboard/budget-template" className="mt-4 inline-flex rounded-lg bg-[#132A44] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1C3B5A]">
            Open Annual Budget
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <SummaryCard label="Required Divisions" value={String(dashboard.divisions.length)} help="Head Office Division snapshot for the year" />
            <SummaryCard label="Locked Divisions" value={`${lockedCount}/${dashboard.divisions.length}`} help={allLocked ? "All Division originals are immutable" : "Draft Divisions still require verification and lock"} />
            <SummaryCard label="Head Office Total" value={money(dashboard.headOfficeTotal)} help="Sum of all Division original approved amounts" />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="font-semibold text-slate-900">Division readiness</h2>
              <p className="mt-1 text-xs text-slate-500">Every required Division must be LOCKED before the annual cycle can reach READY_FOR_ACTIVATION.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Division</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Total</th>
                    <th className="px-5 py-3">Official Document</th>
                    <th className="px-5 py-3">Locked Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dashboard.divisions.map((division) => (
                    <tr key={division.id}>
                      <td className="px-5 py-3">
                        <p className="font-semibold text-slate-900">{division.division?.name || division.division_id}</p>
                        <p className="text-xs text-slate-500">{division.division?.code || "Head Office"}</p>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${division.status === "LOCKED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                          {division.status === "LOCKED" && <LockKeyhole className="h-3.5 w-3.5" />}
                          {division.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-900">{money(division.division_total)}</td>
                      <td className="px-5 py-3">{division.official_document_count > 0 ? "Registrar-approved document recorded" : "Not recorded"}</td>
                      <td className="px-5 py-3">{division.locked_at ? new Date(division.locked_at).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <FileCheck2 className="mt-0.5 h-5 w-5 text-[#A97C12]" />
                <div>
                  <h2 className="font-semibold text-slate-900">Registrar Office activation authority</h2>
                  <p className="mt-1 text-sm text-slate-500">Record the signed advice, memo or correspondence directing NJSS to activate the approved annual budget.</p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">
                  Authority reference
                  <input value={authorityReference} onChange={(event) => setAuthorityReference(event.target.value)} disabled={!readyForActivation || active} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" placeholder="Memo / letter reference" />
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Authority date
                  <input type="date" value={authorityDate} onChange={(event) => setAuthorityDate(event.target.value)} disabled={!readyForActivation || active} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
                </label>
                <label className="text-sm font-medium text-slate-700 md:col-span-2">
                  Description
                  <textarea value={authorityDescription} onChange={(event) => setAuthorityDescription(event.target.value)} disabled={!readyForActivation || active} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" placeholder="Registrar Office instruction to activate the annual budget" />
                </label>
                <label className="text-sm font-medium text-slate-700 md:col-span-2">
                  Authority document
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" onChange={(event) => setAuthorityFile(event.target.files?.[0] || null)} disabled={!readyForActivation || active} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50" />
                </label>
              </div>

              {!readyForActivation && !active && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  All required Divisions must be locked before activation authority can be recorded.
                </div>
              )}

              <button
                type="button"
                onClick={handleUploadAuthority}
                disabled={!readyForActivation || active || !authorityFile || !canManageDocuments || saving}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#132A44] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1C3B5A] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Record Registrar Authority
              </button>

              {authorities.length > 0 && (
                <div className="mt-6 border-t border-slate-200 pt-4">
                  <h3 className="text-sm font-semibold text-slate-900">Recorded authority versions</h3>
                  <div className="mt-2 space-y-2">
                    {authorities.map((document) => (
                      <label key={document.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 ${selectedAuthorityId === document.id ? "border-[#132A44] bg-slate-50" : "border-slate-200"}`}>
                        <span className="flex min-w-0 items-center gap-3">
                          <input type="radio" name="activation-authority" checked={selectedAuthorityId === document.id} onChange={() => setSelectedAuthorityId(document.id)} disabled={active} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-900">{document.original_filename}</span>
                            <span className="block text-xs text-slate-500">Version {document.version_number} · {document.reference_number || "No reference"}</span>
                          </span>
                        </span>
                        <button type="button" onClick={(event) => { event.preventDefault(); openAuthority(document) }} className="shrink-0 text-xs font-semibold text-[#132A44] hover:underline">View</button>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-slate-900">Activation control</h2>
              <div className="mt-4 space-y-3 text-sm">
                <ControlRow label="All Divisions locked" ok={allLocked} />
                <ControlRow label="Annual state READY_FOR_ACTIVATION" ok={cycle.status === "READY_FOR_ACTIVATION" || active} />
                <ControlRow label="Registrar authority recorded" ok={Boolean(selectedAuthorityId || cycle.activation_authority_document_id)} />
                <ControlRow label="Budget Officer activation permission" ok={canActivate} />
              </div>

              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Head Office Total</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{money(dashboard.headOfficeTotal)}</p>
              </div>

              {active ? (
                <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                  <p className="font-semibold">Annual budget ACTIVE</p>
                  <p className="mt-1">Activated {cycle.activated_at ? new Date(cycle.activated_at).toLocaleString() : "successfully"}. The locked approved figures are operational.</p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleActivate}
                  disabled={!readyForActivation || !selectedAuthorityId || !canActivate || saving}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#A97C12] px-4 py-3 text-sm font-bold text-white hover:bg-[#8F690F] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Activate Annual Budget
                </button>
              )}

              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                Activation is authorised by the Registrar Office correspondence but executed in NJSS by a user holding budget.activate. The secured database RPC independently verifies readiness and the authority document.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{help}</p>
    </div>
  )
}

function ControlRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2.5">
      <span className="text-slate-700">{label}</span>
      <span className={`inline-flex items-center gap-1 text-xs font-semibold ${ok ? "text-emerald-700" : "text-amber-700"}`}>
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
        {ok ? "Ready" : "Pending"}
      </span>
    </div>
  )
}
