"use client"

import { ArrowRight, CheckCircle2, Clock3, RotateCcw, XCircle } from "lucide-react"
import type { BudgetRevisionQueueItem } from "@/lib/budget-revision-workspace"

const money = (value: number | null | undefined) => `K ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function statusStyle(status: string) {
  if (status === "APPROVED") return "bg-emerald-50 text-emerald-700 border-emerald-200"
  if (status === "REJECTED") return "bg-red-50 text-red-700 border-red-200"
  if (status === "RETURNED") return "bg-amber-50 text-amber-700 border-amber-200"
  if (["SUBMITTED", "RESUBMITTED"].includes(status)) return "bg-blue-50 text-blue-700 border-blue-200"
  return "bg-slate-50 text-slate-700 border-slate-200"
}

function StatusIcon({ status }: { status: string }) {
  if (status === "APPROVED") return <CheckCircle2 className="h-4 w-4" />
  if (status === "REJECTED") return <XCircle className="h-4 w-4" />
  if (status === "RETURNED") return <RotateCcw className="h-4 w-4" />
  return <Clock3 className="h-4 w-4" />
}

type Props = {
  items: BudgetRevisionQueueItem[]
  selectedRevisionId?: string | null
  actionLabel: (item: BudgetRevisionQueueItem) => string
  onOpen: (item: BudgetRevisionQueueItem) => void
}

export function BudgetRevisionQueue({ items, selectedRevisionId, actionLabel, onOpen }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
        <Clock3 className="mx-auto h-9 w-9 text-slate-300" />
        <p className="mt-3 font-medium text-slate-700">No revision work items in this queue.</p>
        <p className="mt-1 text-sm text-slate-500">Items will appear here as the Registrar and Line Supervisor progress the workflow.</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Revision</th>
              <th className="px-4 py-3">Budget / Section</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Assigned / Requested</th>
              <th className="px-4 py-3 text-right">Current Revised</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={item.revision_id} className={selectedRevisionId === item.revision_id ? "bg-amber-50/60" : "hover:bg-slate-50/70"}>
                <td className="px-4 py-4 align-top">
                  <p className="font-semibold text-slate-900">{item.revision_number}</p>
                  <p className="mt-0.5 text-xs text-slate-500">FY{item.budget_year} • v{item.revision_version || "-"}</p>
                </td>
                <td className="px-4 py-4 align-top">
                  <p className="font-medium text-slate-800">{item.department_name || "Department"}</p>
                  <p className="text-xs text-slate-500">{item.section_name || item.division_name || item.division_code || "Section / Division"}</p>
                </td>
                <td className="px-4 py-4 align-top">
                  <span className="font-medium text-slate-700">{item.revision_type.replaceAll("_", " ")}</span>
                  {item.requested_change_amount != null && (
                    <p className="mt-1 text-xs text-slate-500">Indicative: {money(item.requested_change_amount)}</p>
                  )}
                </td>
                <td className="px-4 py-4 align-top">
                  <p className="text-slate-700">{item.assigned_line_supervisor_name || item.assigned_line_supervisor_email || "Unassigned"}</p>
                  <p className="mt-0.5 text-xs text-slate-500">Requested by {item.requested_by_name || item.requested_by_email || "Registrar"}</p>
                </td>
                <td className="px-4 py-4 text-right align-top font-semibold tabular-nums text-slate-800">{money(item.current_revised_budget)}</td>
                <td className="px-4 py-4 align-top">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyle(item.status)}`}>
                    <StatusIcon status={item.status} /> {item.status.replaceAll("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-4 text-right align-top">
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#132A44] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1C3B5A]"
                  >
                    {actionLabel(item)} <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
