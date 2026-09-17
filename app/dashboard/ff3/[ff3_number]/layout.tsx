"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useParams } from "next/navigation"
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"

type BudgetBanner = {
  status: string
  budget_control_status: string | null
  budget_current_approved_snapshot: number | null
  budget_available_snapshot: number | null
  budget_shortfall: number | null
  budget_checked_at: string | null
  total_estimated_amount: number | null
  expense_ledger_id: string | null
}

const money = (value: number | null) => `K${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function FF3ReviewLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ ff3_number: string }>()
  const ff3Number = decodeURIComponent(params.ff3_number || "")
  const [row, setRow] = useState<BudgetBanner | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      if (!ff3Number) return
      const { data } = await supabase
        .from("ff3_headers")
        .select("status, budget_control_status, budget_current_approved_snapshot, budget_available_snapshot, budget_shortfall, budget_checked_at, total_estimated_amount, expense_ledger_id")
        .eq("ff3_number", ff3Number)
        .maybeSingle()
      if (active) {
        setRow((data || null) as BudgetBanner | null)
        setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [ff3Number])

  const simplified = Boolean(row?.expense_ledger_id)
  const blocked = row?.budget_control_status === "INSUFFICIENT_BUDGET_BLOCKED" || row?.budget_control_status === "NO_ACTIVE_BUDGET" || row?.budget_control_status === "POSTING_MAPPING_REQUIRED"

  return <>
    {simplified && <div className="mb-4 rounded-lg border bg-white p-4 shadow-sm">
      {loading ? <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading budget-control status…</div> : row && <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">FF3 Control Status</div>
            <div className="mt-1 flex flex-wrap gap-2 text-sm">
              <span className="rounded bg-slate-100 px-2 py-1 font-medium">Workflow: {row.status}</span>
              <span className={`rounded px-2 py-1 font-semibold ${blocked ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-800"}`}>
                Budget: {row.budget_control_status || "NOT_CHECKED"}
              </span>
            </div>
          </div>
          {blocked ? <AlertTriangle className="h-6 w-6 text-amber-600" /> : <CheckCircle2 className="h-6 w-6 text-green-600" />}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Current Approved" value={row.budget_current_approved_snapshot} />
          <Metric label="Available" value={row.budget_available_snapshot} />
          <Metric label="This FF3 Request" value={row.total_estimated_amount} />
          <Metric label="Shortfall" value={row.budget_shortfall} />
        </div>
        {row.budget_control_status === "INSUFFICIENT_BUDGET_BLOCKED" && <p className="mt-3 text-sm font-medium text-amber-800">INSUFFICIENT BUDGET – COMMITMENT BLOCKED. Managerial review may continue, but final approval cannot create a financial commitment until supplementary budget or a Registrar-approved reallocation clears the shortfall.</p>}
        {row.budget_control_status === "POSTING_MAPPING_REQUIRED" && <p className="mt-3 text-sm font-medium text-amber-800">Budget is available, but Finance must configure a valid posting mapping before final approval can create the commitment.</p>}
        {row.budget_control_status === "NO_ACTIVE_BUDGET" && <p className="mt-3 text-sm font-medium text-amber-800">No active approved Head Office budget position exists for this Division / Section / Ledger. Commitment remains blocked.</p>}
        {row.budget_checked_at && <div className="mt-2 text-xs text-slate-500">Budget checked: {new Date(row.budget_checked_at).toLocaleString()}</div>}
      </>}
    </div>}
    {children}
  </>
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return <div className="rounded-md bg-slate-50 p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-semibold text-slate-900">{money(value)}</div></div>
}
