"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, FileText, Loader2, LockKeyhole, Printer, Save } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { supabase } from "@/lib/supabase"
import {
  createOrGetHeadOfficeBudgetCycle,
  getDivisionBudget,
  getHeadOfficeBudgetDashboard,
  lockDivisionBudget,
  saveDivisionBudgetLine,
  updateDivisionBudgetDraftHeader,
  type BudgetDocument,
  type DivisionBudgetDetail,
  type HeadOfficeBudgetDashboard,
  type LedgerReference,
  type SectionReference,
} from "@/lib/head-office-budget"

const money = (value: number) =>
  `K ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const amountKey = (sectionId: string, ledgerId: string) => `${sectionId}:${ledgerId}`

export default function AnnualBudgetPage() {
  const { can } = useAuth()
  const canCapture = can('budget.capture')
  const canLock = can('budget.lock')
  const canManageDocuments = can('budget.documents.manage')
  const [financialYear, setFinancialYear] = useState(new Date().getFullYear() + 1)
  const [dashboard, setDashboard] = useState<HeadOfficeBudgetDashboard | null>(null)
  const [selectedBudgetId, setSelectedBudgetId] = useState("")
  const [detail, setDetail] = useState<DivisionBudgetDetail | null>(null)
  const [sections, setSections] = useState<SectionReference[]>([])
  const [ledgers, setLedgers] = useState<LedgerReference[]>([])
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set())
  const [referenceNumber, setReferenceNumber] = useState("")
  const [approvalDate, setApprovalDate] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      if (canCapture) await createOrGetHeadOfficeBudgetCycle(financialYear)
      const next = await getHeadOfficeBudgetDashboard(financialYear)
      setDashboard(next)
      setSelectedBudgetId((current) => {
        if (current && next.divisions.some((division) => division.id === current)) return current
        return next.divisions[0]?.id || ""
      })
    } catch (error) {
      setDashboard(null)
      setSelectedBudgetId("")
      setDetail(null)
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not load the annual budget." })
    } finally {
      setLoading(false)
    }
  }, [canCapture, financialYear])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const loadDivision = useCallback(async (budgetId: string) => {
    if (!budgetId) {
      setDetail(null)
      setSections([])
      setLedgers([])
      setAmounts({})
      setDirtyKeys(new Set())
      return
    }

    setLoading(true)
    setMessage(null)
    try {
      const nextDetail = await getDivisionBudget(budgetId)
      const divisionId = nextDetail.budget.division_id
      const [sectionResult, ledgerResult] = await Promise.all([
        supabase.from('sections').select('id, code, name, department_id').eq('department_id', divisionId).eq('is_active', true).order('name'),
        supabase.from('expense_ledger').select('id, ledger_number, finance_code, standard_description, budget_class, expense_category, is_posting, is_active').eq('is_active', true).eq('is_posting', true).order('finance_code'),
      ])
      if (sectionResult.error) throw sectionResult.error
      if (ledgerResult.error) throw ledgerResult.error

      const nextAmounts: Record<string, string> = {}
      nextDetail.lines.forEach((line) => {
        nextAmounts[amountKey(line.section_id, line.expense_ledger_id)] = String(Number(line.original_amount || 0))
      })

      setDetail(nextDetail)
      setSections((sectionResult.data || []) as SectionReference[])
      setLedgers((ledgerResult.data || []) as LedgerReference[])
      setAmounts(nextAmounts)
      setDirtyKeys(new Set())
      setReferenceNumber(nextDetail.budget.reference_number || "")
      setApprovalDate(nextDetail.budget.approval_date || "")
    } catch (error) {
      setDetail(null)
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not load the selected Division budget." })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDivision(selectedBudgetId)
  }, [selectedBudgetId, loadDivision])

  const filteredSections = useMemo(
    () => sections.filter((section) => !detail || section.department_id === detail.budget.division_id),
    [sections, detail],
  )

  const numericAmount = useCallback(
    (sectionId: string, ledgerId: string) => Number(amounts[amountKey(sectionId, ledgerId)] || 0),
    [amounts],
  )

  const sectionTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const section of filteredSections) {
      totals.set(
        section.id,
        ledgers.reduce((sum, ledger) => sum + numericAmount(section.id, ledger.id), 0),
      )
    }
    return totals
  }, [filteredSections, ledgers, numericAmount])

  const divisionTotal = useMemo(
    () => Array.from(sectionTotals.values()).reduce((sum, value) => sum + value, 0),
    [sectionTotals],
  )

  const selectedDashboardRow = useMemo(
    () => dashboard?.divisions.find((division) => division.id === selectedBudgetId) || null,
    [dashboard, selectedBudgetId],
  )

  const headOfficeTotal = useMemo(() => {
    if (!dashboard || !selectedDashboardRow) return dashboard?.headOfficeTotal || 0
    return dashboard.headOfficeTotal - selectedDashboardRow.division_total + divisionTotal
  }, [dashboard, selectedDashboardRow, divisionTotal])

  const officialDocuments = useMemo(
    () => (detail?.documents || []).filter((document) => document.document_type === "OFFICIAL_APPROVED_BUDGET"),
    [detail],
  )

  const isLocked = detail?.budget.status === "LOCKED"

  const updateAmount = (sectionId: string, ledgerId: string, value: string) => {
    if (isLocked || !canCapture) return
    const key = amountKey(sectionId, ledgerId)
    setAmounts((current) => ({ ...current, [key]: value }))
    setDirtyKeys((current) => new Set(current).add(key))
  }

  const handleSaveDraft = async () => {
    if (!detail || isLocked || !canCapture) return
    setSaving(true)
    setMessage(null)
    try {
      await updateDivisionBudgetDraftHeader({
        divisionBudgetId: detail.budget.id,
        referenceNumber,
        approvalDate: approvalDate || null,
      })

      for (const key of dirtyKeys) {
        const separator = key.indexOf(":")
        const sectionId = key.slice(0, separator)
        const ledgerId = key.slice(separator + 1)
        const originalAmount = Number(amounts[key] || 0)
        if (!Number.isFinite(originalAmount) || originalAmount < 0) {
          throw new Error("Approved amounts must be zero or greater.")
        }
        await saveDivisionBudgetLine({
          divisionBudgetId: detail.budget.id,
          sectionId,
          expenseLedgerId: ledgerId,
          originalAmount,
        })
      }

      await loadDivision(detail.budget.id)
      await loadDashboard()
      setMessage({ type: "ok", text: "Draft budget saved." })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not save the draft budget." })
    } finally {
      setSaving(false)
    }
  }

  const handleLock = async () => {
    if (!detail || isLocked || !canLock) return
    if (dirtyKeys.size > 0) {
      setMessage({ type: "err", text: "Save all draft changes before locking the Division budget." })
      return
    }
    if (officialDocuments.length === 0) {
      setMessage({ type: "err", text: "Upload the official Registrar-approved budget document before locking this Division." })
      return
    }
    if (!window.confirm("Lock this Division budget? The original approved amounts will become immutable.")) return

    setSaving(true)
    setMessage(null)
    try {
      await lockDivisionBudget(detail.budget.id)
      await loadDivision(detail.budget.id)
      await loadDashboard()
      setMessage({ type: "ok", text: "Division budget locked successfully." })
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Could not lock the Division budget." })
    } finally {
      setSaving(false)
    }
  }

  const divisionName = detail?.budget.division?.name || selectedDashboardRow?.division?.name || "Division"

  return (
    <div className="space-y-6 pb-24" data-testid="head-office-budget-dashboard">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">NJSS Head Office Annual Budget</h1>
          <p className="mt-1 text-sm text-slate-600">
            Enter the approved annual budget by Division, Section and standard ledger code.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!detail}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Printer className="h-4 w-4" /> Print Draft
          </button>
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={!detail || isLocked || !canCapture || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#132A44] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1C3B5A] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
          </button>
        </div>
      </div>

      {message && (
        <div className={`rounded-lg border p-4 ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          <div className="flex items-start gap-2">
            {message.type === "ok" ? <CheckCircle2 className="mt-0.5 h-5 w-5" /> : <AlertCircle className="mt-0.5 h-5 w-5" />}
            <span className="text-sm font-medium">{message.text}</span>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Financial Year</span>
            <input
              type="number"
              min={2000}
              max={2200}
              value={financialYear}
              onChange={(event) => {
                setFinancialYear(Number(event.target.value))
                setSelectedBudgetId("")
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block" data-testid="division-budget-selector">
            <span className="mb-1 block text-sm font-medium text-slate-700">Division</span>
            <select
              value={selectedBudgetId}
              onChange={(event) => setSelectedBudgetId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select Division</option>
              {(dashboard?.divisions || []).map((division) => (
                <option key={division.id} value={division.id}>
                  {division.division?.name || division.division_id} — {division.status}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Annual Budget Status</span>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
              {dashboard?.cycle?.status || "NOT CREATED"}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Summary label="Division Total" value={money(divisionTotal)} />
          <Summary label="Head Office Total" value={money(headOfficeTotal)} />
          <Summary
            label="Division Status"
            value={detail?.budget.status || selectedDashboardRow?.status || "—"}
          />
        </div>
      </section>

      {loading && (
        <div className="flex h-40 items-center justify-center rounded-xl border border-slate-200 bg-white">
          <Loader2 className="h-7 w-7 animate-spin text-[#132A44]" />
        </div>
      )}

      {!loading && detail && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-end">
              <label className="block flex-1">
                <span className="mb-1 block text-sm font-medium text-slate-700">Optional Reference Number</span>
                <input
                  value={referenceNumber}
                  onChange={(event) => setReferenceNumber(event.target.value)}
                  disabled={isLocked || !canCapture}
                  placeholder="Registrar / meeting / document reference"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
                />
              </label>
              <label className="block md:w-56">
                <span className="mb-1 block text-sm font-medium text-slate-700">Approval Date</span>
                <input
                  type="date"
                  value={approvalDate}
                  onChange={(event) => setApprovalDate(event.target.value)}
                  disabled={isLocked || !canCapture}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
                />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="section-budget-grid">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">{divisionName}</h2>
              <p className="mt-1 text-sm text-slate-500">
                The same standard ledger master is available to every Section. Enter amounts only where the Section has an approved budget.
              </p>
            </div>

            <div className="overflow-x-auto">
              {filteredSections.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">No active Sections are configured for this Division.</div>
              ) : (
                filteredSections.map((section) => (
                  <div key={section.id} className="border-b border-slate-200 last:border-b-0">
                    <div className="bg-slate-50 px-5 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="font-semibold text-slate-900">{section.name}</h3>
                          <p className="text-xs text-slate-500">{section.code}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Section Total</p>
                          <p className="font-bold text-slate-900">{money(sectionTotals.get(section.id) || 0)}</p>
                        </div>
                      </div>
                    </div>

                    <table className="min-w-[760px] w-full">
                      <thead>
                        <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <th className="px-5 py-3 w-40">Ledger Code</th>
                          <th className="px-5 py-3">Description</th>
                          <th className="px-5 py-3 w-56 text-right">Approved Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ledgers.map((ledger) => {
                          const key = amountKey(section.id, ledger.id)
                          return (
                            <tr key={ledger.id} className="hover:bg-slate-50/60">
                              <td className="px-5 py-2.5 text-sm font-medium text-slate-800">{ledger.finance_code || ledger.ledger_number}</td>
                              <td className="px-5 py-2.5 text-sm text-slate-700">{ledger.standard_description}</td>
                              <td className="px-5 py-2.5">
                                <div className="flex items-center justify-end gap-2">
                                  <span className="text-sm text-slate-500">K</span>
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={amounts[key] ?? ""}
                                    onChange={(event) => updateAmount(section.id, ledger.id, event.target.value)}
                                    disabled={isLocked || !canCapture}
                                    aria-label={`${section.name} ${ledger.finance_code} approved amount`}
                                    className={`w-40 rounded-md border px-3 py-1.5 text-right text-sm disabled:bg-slate-100 ${dirtyKeys.has(key) ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}
                                    placeholder="0.00"
                                  />
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-50 font-semibold text-slate-900">
                          <td className="px-5 py-3" colSpan={2}>Section Total</td>
                          <td className="px-5 py-3 text-right">{money(sectionTotals.get(section.id) || 0)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-[#132A44] px-5 py-4 text-white">
              <span className="font-semibold">Division Total</span>
              <span className="text-lg font-bold">{money(divisionTotal)}</span>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="budget-document-panel">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-[#132A44]" />
                  <h2 className="text-lg font-semibold text-slate-900">Official Budget Record</h2>
                </div>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">
                  The signed and stamped Registrar-approved document is required before the Division can be locked. Document upload is controlled by the Budget Officer document permission.
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${officialDocuments.length > 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {officialDocuments.length > 0 ? "Official document recorded" : "Official document required"}
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {detail.documents.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">No budget documents have been recorded yet.</p>
              ) : (
                detail.documents.map((document: BudgetDocument) => (
                  <div key={document.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{document.original_filename}</p>
                      <p className="text-xs text-slate-500">{document.document_type} · Version {document.version_number}</p>
                    </div>
                    <span className="text-xs text-slate-500">{document.document_date || document.uploaded_at.slice(0, 10)}</span>
                  </div>
                ))
              )}
            </div>

            {canManageDocuments && !isLocked && (
              <p className="mt-4 text-xs text-slate-500">Official document upload controls are available to authorised Budget Officers.</p>
            )}

            <div className="mt-5 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-600">
                {isLocked ? "This Division budget is locked. Original amounts cannot be changed." : "Save and verify all figures against the official signed document before locking."}
              </div>
              <button
                type="button"
                data-testid="lock-division-budget"
                onClick={handleLock}
                disabled={isLocked || !canLock || saving || dirtyKeys.size > 0 || officialDocuments.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#8A1420] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6F1019] disabled:opacity-50"
              >
                <LockKeyhole className="h-4 w-4" /> {isLocked ? "Division Locked" : "Lock Division"}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
    </div>
  )
}
