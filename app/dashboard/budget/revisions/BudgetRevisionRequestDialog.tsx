"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertCircle, Loader2, Send, X } from "lucide-react"
import {
  createBudgetRevisionRequest,
  getApprovedBudgetSummary,
  getEligibleLineSupervisors,
  type ApprovedBudgetCandidate,
  type ApprovedBudgetSummary,
  type EligibleLineSupervisor,
} from "@/lib/budget-revision-workspace"
import type { BudgetRevisionType } from "@/lib/budget-revision"

const emptySummary: ApprovedBudgetSummary = {
  original_budget: 0,
  current_revised_budget: 0,
  actual_expenditure: 0,
  outstanding_commitment: 0,
  budget_available: 0,
  released_available: 0,
}

const money = (value: number) => `K ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const revisionTypes: Array<{ value: BudgetRevisionType; label: string; help: string }> = [
  { value: "SUPPLEMENTARY", label: "Supplementary Budget", help: "Additional approved funding / authority." },
  { value: "VIREMENT", label: "Virement", help: "Move authorised budget between valid lines." },
  { value: "REDUCTION", label: "Budget Reduction", help: "Reduce an existing authorised allocation." },
  { value: "RECLASSIFICATION", label: "Reclassification", help: "Move authorised expenditure to another valid classification." },
  { value: "REFORECAST", label: "Reforecast", help: "Change remaining monthly phasing without increasing the annual budget." },
]

function dateForBudgetYear(year: number) {
  const today = new Date()
  if (today.getFullYear() === year) return today.toISOString().split("T")[0]
  return `${year}-01-01`
}

type Props = {
  candidates: ApprovedBudgetCandidate[]
  initialParentId?: string | null
  onClose: () => void
  onCreated: (revisionId: string) => void | Promise<void>
}

export function BudgetRevisionRequestDialog({ candidates, initialParentId, onClose, onCreated }: Props) {
  const initialCandidate = (initialParentId ? candidates.find((item) => item.submission_id === initialParentId) : candidates[0]) || null
  const [budgetYear, setBudgetYear] = useState(initialCandidate ? String(initialCandidate.budget_year) : "")
  const [departmentId, setDepartmentId] = useState(initialCandidate?.department_id || "")
  const [divisionId, setDivisionId] = useState(initialCandidate?.division_id || "")
  const [parentSubmissionId, setParentSubmissionId] = useState(initialCandidate?.submission_id || "")
  const [revisionType, setRevisionType] = useState<BudgetRevisionType>("SUPPLEMENTARY")
  const [requestedChangeAmount, setRequestedChangeAmount] = useState("")
  const [reason, setReason] = useState("")
  const [authorityReference, setAuthorityReference] = useState("")
  const [effectiveDate, setEffectiveDate] = useState(initialCandidate ? dateForBudgetYear(initialCandidate.budget_year) : "")
  const [supportingReference, setSupportingReference] = useState("")
  const [requestInstruction, setRequestInstruction] = useState("")
  const [supervisors, setSupervisors] = useState<EligibleLineSupervisor[]>([])
  const [assignedSupervisorId, setAssignedSupervisorId] = useState("")
  const [summary, setSummary] = useState<ApprovedBudgetSummary>(emptySummary)
  const [loadingContext, setLoadingContext] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const years = useMemo(() => [...new Set(candidates.map((item) => item.budget_year))].sort((a, b) => b - a), [candidates])
  const yearCandidates = useMemo(() => candidates.filter((item) => String(item.budget_year) === budgetYear), [candidates, budgetYear])
  const departments = useMemo(() => {
    const byId = new Map<string, string>()
    for (const item of yearCandidates) {
      if (item.department_id) byId.set(item.department_id, item.department_name || item.department_id)
    }
    return [...byId.entries()].map(([id, name]) => ({ id, name }))
  }, [yearCandidates])
  const departmentCandidates = useMemo(
    () => yearCandidates.filter((item) => !departmentId || item.department_id === departmentId),
    [yearCandidates, departmentId],
  )
  const divisions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const item of departmentCandidates) byId.set(item.division_id, item.section_name || item.division_name || item.division_code || item.division_id)
    return [...byId.entries()].map(([id, name]) => ({ id, name }))
  }, [departmentCandidates])
  const divisionCandidates = useMemo(
    () => departmentCandidates.filter((item) => !divisionId || item.division_id === divisionId),
    [departmentCandidates, divisionId],
  )
  const selectedCandidate = candidates.find((item) => item.submission_id === parentSubmissionId) || null

  useEffect(() => {
    if (parentSubmissionId || candidates.length === 0) return
    const next = (initialParentId ? candidates.find((item) => item.submission_id === initialParentId) : candidates[0]) || null
    if (!next) {
      if (initialParentId) {
        Promise.resolve().then(() => setError("The selected approved budget is no longer eligible for a new revision request. Refresh the workspace and select the current authoritative budget."))
      }
      return
    }
    Promise.resolve().then(() => {
      setBudgetYear(String(next.budget_year))
      setDepartmentId(next.department_id || "")
      setDivisionId(next.division_id || "")
      setParentSubmissionId(next.submission_id)
      setEffectiveDate(dateForBudgetYear(next.budget_year))
    })
  }, [candidates, initialParentId, parentSubmissionId])

  useEffect(() => {
    if (!selectedCandidate) {
      Promise.resolve().then(() => {
        setSupervisors([])
        setAssignedSupervisorId("")
        setSummary(emptySummary)
      })
      return
    }

    let active = true
    Promise.resolve().then(() => {
      if (active) {
        setLoadingContext(true)
        setError("")
      }
    })
    Promise.all([
      getEligibleLineSupervisors(selectedCandidate.division_id),
      getApprovedBudgetSummary(selectedCandidate.submission_id),
    ])
      .then(([supervisorRows, budgetSummary]) => {
        if (!active) return
        setSupervisors(supervisorRows)
        setAssignedSupervisorId(supervisorRows.length === 1 ? supervisorRows[0].user_id : "")
        setSummary(budgetSummary)
        setEffectiveDate(dateForBudgetYear(selectedCandidate.budget_year))
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : "Could not load the budget request context.")
        setSupervisors([])
        setAssignedSupervisorId("")
        setSummary(emptySummary)
      })
      .finally(() => {
        if (active) setLoadingContext(false)
      })

    return () => {
      active = false
    }
  }, [selectedCandidate?.submission_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectYear = (value: string) => {
    setBudgetYear(value)
    const next = candidates.find((item) => String(item.budget_year) === value) || null
    setDepartmentId(next?.department_id || "")
    setDivisionId(next?.division_id || "")
    setParentSubmissionId(next?.submission_id || "")
  }

  const selectDepartment = (value: string) => {
    setDepartmentId(value)
    const next = yearCandidates.find((item) => item.department_id === value) || null
    setDivisionId(next?.division_id || "")
    setParentSubmissionId(next?.submission_id || "")
  }

  const selectDivision = (value: string) => {
    setDivisionId(value)
    const next = departmentCandidates.find((item) => item.division_id === value) || null
    setParentSubmissionId(next?.submission_id || "")
  }

  const submit = async () => {
    setError("")
    if (!selectedCandidate) return setError("Select the current approved budget to be reviewed.")
    if (!reason.trim()) return setError("Reason / Justification is required.")
    if (revisionType === "SUPPLEMENTARY" && !authorityReference.trim()) return setError("Authority Reference is required for a Supplementary Budget.")
    if (supervisors.length === 0) return setError("No active Line Supervisor is assigned to this section. Configure the section assignment before requesting a budget change.")
    if (!assignedSupervisorId) return setError("Select the Responsible Line Supervisor.")

    const requestedAmount = requestedChangeAmount.trim() === "" ? null : Number(requestedChangeAmount)
    if (requestedAmount !== null && (!Number.isFinite(requestedAmount) || requestedAmount < 0)) return setError("Indicative Change Amount must be zero or greater.")

    setSubmitting(true)
    try {
      const result = await createBudgetRevisionRequest({
        parentSubmissionId: selectedCandidate.submission_id,
        revisionType,
        reason: reason.trim(),
        authorityReference: authorityReference.trim() || null,
        effectiveDate,
        supportingReference: supportingReference.trim() || null,
        assignedLineSupervisorId: assignedSupervisorId,
        requestInstruction: requestInstruction.trim() || null,
        requestedChangeAmount: requestedAmount,
      })
      await onCreated(result.revision_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the budget revision request.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Initiate Budget Change</h2>
            <p className="mt-1 text-sm text-slate-500">Registrar creates the request; the responsible Line Supervisor prepares and submits the section revision.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close request dialog"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-6 p-6">
          {error && (
            <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
            </div>
          )}

          {candidates.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">No current approved budget is available for a new revision request. A budget must be approved, locked, unsuperseded and have no other active revision.</div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1.5 text-sm font-medium text-slate-700">Budget Year
                  <select value={budgetYear} onChange={(e) => selectYear(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900">
                    {years.map((year) => <option key={year} value={year}>{year}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-700">Department
                  <select value={departmentId} onChange={(e) => selectDepartment(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900">
                    {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-700">Section / Division
                  <select value={divisionId} onChange={(e) => selectDivision(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900">
                    {divisions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-700">Current Approved Budget
                  <select value={parentSubmissionId} onChange={(e) => setParentSubmissionId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900">
                    {divisionCandidates.map((item) => <option key={item.submission_id} value={item.submission_id}>{item.submission_number || `FY${item.budget_year}`} • v{item.version}</option>)}
                  </select>
                </label>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-slate-900">Current financial position</h3>{loadingContext && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}</div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  {[
                    ["Original Budget", summary.original_budget],
                    ["Current Revised", summary.current_revised_budget],
                    ["Actuals", summary.actual_expenditure],
                    ["Commitments", summary.outstanding_commitment],
                    ["Budget Available", summary.budget_available],
                    ["Released Available", summary.released_available],
                  ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-white p-3 ring-1 ring-slate-200"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-bold text-slate-900">{money(Number(value))}</p></div>)}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5 text-sm font-medium text-slate-700">Change Type
                  <select value={revisionType} onChange={(e) => setRevisionType(e.target.value as BudgetRevisionType)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900">
                    {revisionTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <span className="block text-xs font-normal text-slate-500">{revisionTypes.find((item) => item.value === revisionType)?.help}</span>
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-700">Indicative Change Amount
                  <input value={requestedChangeAmount} onChange={(e) => setRequestedChangeAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="Optional management indication" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900" />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-700 md:col-span-2">Reason / Justification
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900" placeholder="Why must the approved budget be reviewed?" />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-700">Authority Reference {revisionType === "SUPPLEMENTARY" && <span className="text-red-600">*</span>}
                  <input value={authorityReference} onChange={(e) => setAuthorityReference(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900" placeholder="Supplementary warrant / authority reference" />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-700">Effective Date
                  <input value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} type="date" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900" />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-700">Supporting Reference
                  <input value={supportingReference} onChange={(e) => setSupportingReference(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900" placeholder="Memo, minute, warrant or other reference" />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-700">Responsible Line Supervisor
                  <select value={assignedSupervisorId} onChange={(e) => setAssignedSupervisorId(e.target.value)} disabled={loadingContext || supervisors.length === 0} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900 disabled:bg-slate-100">
                    <option value="">Select Line Supervisor...</option>
                    {supervisors.map((supervisor) => <option key={supervisor.user_id} value={supervisor.user_id}>{supervisor.full_name || supervisor.email || supervisor.user_id}</option>)}
                  </select>
                  {!loadingContext && selectedCandidate && supervisors.length === 0 && <span className="block text-xs font-normal text-red-600">No active Line Supervisor is assigned to this section. Configure the section assignment before requesting a budget change.</span>}
                </label>
                <label className="space-y-1.5 text-sm font-medium text-slate-700 md:col-span-2">Instruction to Line Supervisor
                  <textarea value={requestInstruction} onChange={(e) => setRequestInstruction(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900" placeholder="Explain the budget areas the Line Supervisor should review and adjust." />
                </label>
              </div>
            </>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={submit} disabled={submitting || candidates.length === 0 || loadingContext || supervisors.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-[#132A44] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1C3B5A] disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Request Review
          </button>
        </div>
      </div>
    </div>
  )
}
