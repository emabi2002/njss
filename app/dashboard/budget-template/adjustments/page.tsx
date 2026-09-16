"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2 } from "lucide-react"
import BudgetAdjustmentsPanel from "../BudgetAdjustmentsPanel"
import { getHeadOfficeBudgetDashboard, type HeadOfficeBudgetDashboard } from "@/lib/head-office-budget"

export default function BudgetAdjustmentsPage() {
  const [financialYear, setFinancialYear] = useState(new Date().getFullYear())
  const [dashboard, setDashboard] = useState<HeadOfficeBudgetDashboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setDashboard(await getHeadOfficeBudgetDashboard(financialYear))
    } catch (err) {
      setDashboard(null)
      setError(err instanceof Error ? err.message : "Could not load the annual budget status.")
    } finally {
      setLoading(false)
    }
  }, [financialYear])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/dashboard/budget-template" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-[#132A44] hover:underline">
            <ArrowLeft className="h-4 w-4" /> Annual Budget
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Budget Adjustments</h1>
          <p className="mt-1 text-sm text-slate-600">Supplementary budgets, Registrar-controlled reallocations and the current approved budget position.</p>
        </div>
        <label className="block w-48">
          <span className="mb-1 block text-sm font-medium text-slate-700">Financial Year</span>
          <input type="number" min={2000} max={2200} value={financialYear} onChange={(event) => setFinancialYear(Number(event.target.value))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>

      {loading && <div className="flex h-32 items-center justify-center rounded-xl border border-slate-200 bg-white"><Loader2 className="h-7 w-7 animate-spin text-[#132A44]" /></div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{error}</div>}
      {!loading && !error && (
        <BudgetAdjustmentsPanel financialYear={financialYear} cycleStatus={dashboard?.cycle?.status || null} />
      )}
    </div>
  )
}
