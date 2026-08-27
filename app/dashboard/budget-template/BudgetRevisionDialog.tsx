"use client"

import { useState } from "react"
import { CalendarDays, FileText, X } from "lucide-react"
import type { BudgetRevisionType, CreateBudgetRevisionInput } from "@/lib/budget-revision"

const REVISION_TYPES: Array<{ value: BudgetRevisionType; label: string; help: string }> = [
  { value: "VIREMENT", label: "Virement / Reallocation", help: "Move budget between lines without changing the total approved envelope." },
  { value: "SUPPLEMENTARY", label: "Supplementary Budget", help: "Increase the approved envelope using a formal supplementary authority." },
  { value: "REDUCTION", label: "Budget Reduction", help: "Reduce available budget while protecting amounts already paid or committed." },
  { value: "RECLASSIFICATION", label: "Reclassification", help: "Move value from an existing posting line to a new target posting line." },
  { value: "REFORECAST", label: "Reforecast", help: "Update the remaining annual profile using current actuals and commitments." },
]

type Props = {
  open: boolean
  parentSubmissionId: string
  saving?: boolean
  onClose: () => void
  onCreate: (input: CreateBudgetRevisionInput) => Promise<void>
}

const today = () => new Date().toISOString().slice(0, 10)

export function BudgetRevisionDialog({ open, parentSubmissionId, saving = false, onClose, onCreate }: Props) {
  const [revisionType, setRevisionType] = useState<BudgetRevisionType>("REFORECAST")
  const [reason, setReason] = useState("")
  const [authorityReference, setAuthorityReference] = useState("")
  const [effectiveDate, setEffectiveDate] = useState(today())
  const [supportingReference, setSupportingReference] = useState("")
  const [error, setError] = useState("")

  const resetForm = () => {
    setRevisionType("REFORECAST")
    setReason("")
    setAuthorityReference("")
    setEffectiveDate(today())
    setSupportingReference("")
    setError("")
  }

  const closeDialog = () => {
    resetForm()
    onClose()
  }

  if (!open) return null

  const submit = async () => {
    const cleanReason = reason.trim()
    if (!cleanReason) {
      setError("A revision reason / justification is required.")
      return
    }
    if (revisionType === "SUPPLEMENTARY" && !authorityReference.trim()) {
      setError("Supplementary Budget requires an authority reference.")
      return
    }
    setError("")
    await onCreate({
      parentSubmissionId,
      revisionType,
      reason: cleanReason,
      authorityReference: authorityReference.trim() || null,
      effectiveDate: effectiveDate || null,
      supportingReference: supportingReference.trim() || null,
    })
    resetForm()
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="Create Budget Revision">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 bg-[#1f4e79] px-5 py-4 text-white">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-100">Controlled post-approval change</p>
            <h2 className="mt-1 text-lg font-bold">Create Budget Revision</h2>
            <p className="mt-1 max-w-xl text-xs text-blue-100">The approved budget remains locked. NJSS creates a new revision version for adjustment and approval.</p>
          </div>
          <button type="button" onClick={closeDialog} disabled={saving} className="rounded-lg p-1.5 text-blue-100 hover:bg-white/10 hover:text-white" aria-label="Close revision dialog">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Revision Type</span>
            <select value={revisionType} onChange={(e) => setRevisionType(e.target.value as BudgetRevisionType)} className="input">
              {REVISION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">{REVISION_TYPES.find((type) => type.value === revisionType)?.help}</span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Reason / justification *</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} className="input min-h-[100px] resize-y" placeholder="Explain why the approved budget must be revised and what management decision is being requested." />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Authority reference{revisionType === "SUPPLEMENTARY" ? " *" : ""}</span>
              <div className="relative">
                <FileText className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input value={authorityReference} onChange={(e) => setAuthorityReference(e.target.value)} className="input pl-9" placeholder="Warrant / approval / NEC / authority ref." />
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Effective date</span>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="input pl-9" />
              </div>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Supporting reference</span>
            <input value={supportingReference} onChange={(e) => setSupportingReference(e.target.value)} className="input" placeholder="Minute, memo, management paper, file reference or other supporting record" />
          </label>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <strong>Financial control:</strong> a revised line cannot be reduced below actual expenditure plus outstanding commitments. Closed periods and months containing posted actuals remain locked.
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
          <button type="button" onClick={closeDialog} disabled={saving} className="btn-light">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="btn-primary">
            {saving ? "Creating Revision..." : "Create Budget Revision"}
          </button>
        </div>
      </div>
    </div>
  )
}
