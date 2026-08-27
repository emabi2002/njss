"use client"

import { History, ShieldCheck } from "lucide-react"
import type { BudgetRevision, BudgetRevisionPosition } from "@/lib/budget-revision"

const money = (value: number) => `K ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type RevisionHistoryRow = BudgetRevision & {
  revision_submission?: {
    id: string
    submission_number: string | null
    version: number
    status: string
    total_proposed_budget: number
    submitted_at: string | null
    approved_at: string | null
    prepared_by_email: string | null
    approved_by: string | null
  } | null
}

type Props = {
  revision: BudgetRevision | null
  position: BudgetRevisionPosition[]
  history: RevisionHistoryRow[]
  currentAuthoritative: boolean
  proposedTotal: number
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-sm ${strong ? "font-bold text-slate-950" : "font-semibold text-slate-800"}`}>{value}</div>
    </div>
  )
}

export function BudgetRevisionPanel({ revision, position, history, currentAuthoritative, proposedTotal }: Props) {
  if (!revision) return null

  const totals = position.reduce(
    (sum, row) => ({
      original: sum.original + Number(row.original_budget || 0),
      current: sum.current + Number(row.current_revised_budget || 0),
      actual: sum.actual + Number(row.actual_expenditure || 0),
      outstanding: sum.outstanding + Number(row.outstanding_commitment || 0),
      protectedMinimum: sum.protectedMinimum + Number(row.protected_minimum || 0),
    }),
    { original: 0, current: 0, actual: 0, outstanding: 0, protectedMinimum: 0 },
  )
  const liveProposed = Number(proposedTotal || 0)
  const liveAdjustment = liveProposed - totals.current
  const liveAvailable = liveProposed - totals.actual - totals.outstanding

  return (
    <section className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-slate-950">Budget Revision / Reforecast</h2>
            <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-800">{revision.revision_number}</span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">{revision.revision_type}</span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">{revision.status}</span>
          </div>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-600">{revision.reason}</p>
          {(revision.authority_reference || revision.supporting_reference) && (
            <p className="mt-1 text-xs text-slate-500">Reference: {revision.authority_reference || revision.supporting_reference}</p>
          )}
        </div>
        <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${currentAuthoritative ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
          <ShieldCheck className="h-4 w-4" /> {currentAuthoritative ? "Current Authoritative" : "Historical / Pending"}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <Metric label="Original Approved" value={money(totals.original)} />
        <Metric label="Current Revised" value={money(totals.current)} />
        <Metric label="Actual Paid" value={money(totals.actual)} />
        <Metric label="Outstanding Commitments" value={money(totals.outstanding)} />
        <Metric label="Protected Minimum" value={money(totals.protectedMinimum)} />
        <Metric label="Proposed" value={money(liveProposed)} strong />
        <Metric label="Net Adjustment" value={money(liveAdjustment)} />
        <Metric label="Available After Revision" value={money(liveAvailable)} strong />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5">
          <History className="h-4 w-4 text-indigo-700" />
          <h3 className="text-sm font-semibold text-slate-900">Version / Revision History</h3>
        </div>
        {history.length === 0 ? (
          <div className="px-3 py-4 text-xs text-slate-500">No earlier revision history is recorded for this approved version.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-xs">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Version</th>
                  <th className="px-3 py-2">Revision</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Reason / Reference</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Submitted</th>
                  <th className="px-3 py-2">Approved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2 font-semibold">V{item.revision_submission?.version || "-"}</td>
                    <td className="px-3 py-2">{item.revision_number}</td>
                    <td className="px-3 py-2">{item.revision_type}</td>
                    <td className="px-3 py-2">{item.status}</td>
                    <td className="max-w-[340px] px-3 py-2 text-slate-600">{item.reason}{item.authority_reference ? ` • ${item.authority_reference}` : ""}</td>
                    <td className="px-3 py-2 text-right font-semibold">{money(item.revision_submission?.total_proposed_budget || 0)}</td>
                    <td className="px-3 py-2">{item.revision_submission?.submitted_at ? new Date(item.revision_submission.submitted_at).toLocaleDateString("en-GB") : "-"}</td>
                    <td className="px-3 py-2">{item.revision_submission?.approved_at ? new Date(item.revision_submission.approved_at).toLocaleDateString("en-GB") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
