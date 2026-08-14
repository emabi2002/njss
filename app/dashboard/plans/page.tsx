"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertCircle, BookOpen, ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"

type Plan = {
  id: string
  plan_number: string
  plan_title: string | null
  financial_year: number
  status: string
  total_planned_budget: number | null
  created_at: string
  department: { name: string } | null
  section: { name: string } | null
  cost_centre: { code: string; name: string } | null
}

type PlanLine = {
  id: string
  line_number: number
  activity_description: string
  item_description: string | null
  quantity: number | null
  unit_cost: number | null
  q1_amount: number
  q2_amount: number
  q3_amount: number
  q4_amount: number
  total_amount: number
  expense_code: { full_expense_code: string } | null
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  SUBMITTED: "bg-amber-100 text-amber-800",
  REVIEWED: "bg-teal-100 text-teal-800",
  APPROVED_BY_DEPARTMENT: "bg-png-gold/25 text-png-maroon",
  AUTHORIZED_BY_REGISTRAR: "bg-emerald-100 text-emerald-800",
  BUDGET_CONFIRMED: "bg-green-600 text-white",
  REJECTED: "bg-red-100 text-red-700",
  RETURNED_FOR_CORRECTION: "bg-orange-100 text-orange-800",
}

export default function AnnualPlansPage() {
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [yearFilter, setYearFilter] = useState<number>(new Date().getFullYear())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [lines, setLines] = useState<Record<string, PlanLine[]>>({})

  const fetchPlans = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from("annual_plan_headers")
        .select("id, plan_number, plan_title, financial_year, status, total_planned_budget, created_at, department:departments(name), section:sections(name), cost_centre:cost_centres(code, name)")
        .eq("financial_year", yearFilter)
        .order("created_at", { ascending: false })
      setPlans((data || []) as unknown as Plan[])
    } finally {
      setLoading(false)
    }
  }, [yearFilter])

  useEffect(() => {
    // Data fetch on mount / filter change is the intended effect here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPlans()
  }, [fetchPlans])

  const toggleExpand = async (planId: string) => {
    if (expanded === planId) {
      setExpanded(null)
      return
    }
    setExpanded(planId)
    if (!lines[planId]) {
      const { data } = await supabase
        .from("annual_plan_lines")
        .select("id, line_number, activity_description, item_description, quantity, unit_cost, q1_amount, q2_amount, q3_amount, q4_amount, total_amount, expense_code:expense_code_registry(full_expense_code)")
        .eq("plan_header_id", planId)
        .order("line_number")
      setLines((prev) => ({ ...prev, [planId]: (data || []) as unknown as PlanLine[] }))
    }
  }

  const stats = useMemo(() => ({
    total: plans.length,
    value: plans.reduce((s, p) => s + (p.total_planned_budget || 0), 0),
    confirmed: plans.filter((p) => p.status === "BUDGET_CONFIRMED").length,
  }), [plans])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="h-7 w-7 text-png-red" /> Historical Annual Activity Plans
          </h1>
          <p className="text-slate-600 mt-1">Read-only archive. New budget work is completed in Budget Preparation.</p>
        </div>
        <Link href="/dashboard/budget-template" className="px-4 py-2 bg-png-red text-white rounded-lg font-medium hover:bg-png-maroon">
          Open Budget Preparation
        </Link>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3 text-amber-900">
        <AlertCircle className="h-5 w-5 mt-0.5" />
        <div>
          <p className="font-semibold">Annual Plan workflow retired</p>
          <p className="text-sm mt-1">Creation, submission, review, authorization and Confirm to Budget actions are disabled. Approved Excel-style Budget Preparation submissions now create operational budget allocations automatically.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Historical Plans" value={stats.total} />
        <StatCard label="Previously Confirmed" value={stats.confirmed} />
        <StatCard label="Historical Planned Value" value={`K ${stats.value.toLocaleString()}`} />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4 flex items-center gap-3">
        <label className="text-sm font-medium text-slate-700">Financial Year</label>
        <input type="number" value={yearFilter} onChange={(e) => setYearFilter(parseInt(e.target.value) || new Date().getFullYear())}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red" />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div>
        ) : plans.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen className="h-12 w-12 mx-auto text-slate-300 mb-3" />
            <h3 className="text-lg font-medium text-slate-900">No historical annual plans for FY{yearFilter}</h3>
            <p className="text-slate-600 mt-1">Use Budget Preparation for new divisional budgets.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 w-8"></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Plan</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Section / Cost Centre</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Planned</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plans.map((plan) => (
                  <PlanRow key={plan.id} plan={plan} expanded={expanded === plan.id} lines={lines[plan.id]} onToggle={() => toggleExpand(plan.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <p className="text-xs font-medium text-slate-600 uppercase">{label}</p>
      <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
    </div>
  )
}

function PlanRow({ plan, expanded, lines, onToggle }: { plan: Plan; expanded: boolean; lines?: PlanLine[]; onToggle: () => void }) {
  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3 text-slate-400 cursor-pointer" onClick={onToggle}>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
        <td className="px-4 py-3 cursor-pointer" onClick={onToggle}>
          <div className="text-sm font-medium text-png-red">{plan.plan_number}</div>
          <div className="text-xs text-slate-500">{plan.plan_title || plan.department?.name || "-"}</div>
        </td>
        <td className="px-4 py-3 text-sm text-slate-700">
          <div>{plan.section?.name || "-"}</div>
          {plan.cost_centre && <div className="text-xs text-slate-400 font-mono">{plan.cost_centre.code}</div>}
        </td>
        <td className="px-4 py-3 text-right text-sm font-medium text-slate-900">K {(plan.total_planned_budget || 0).toLocaleString()}</td>
        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[plan.status] || STATUS_STYLES.DRAFT}`}>{plan.status.replace(/_/g, " ")}</span></td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50">
          <td colSpan={5} className="px-6 py-4">
            {!lines ? (
              <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading lines...</div>
            ) : lines.length === 0 ? (
              <p className="text-sm text-slate-500">No activity lines.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 uppercase">
                    <th className="py-1 pr-4">#</th><th className="py-1 pr-4">Activity</th><th className="py-1 pr-4">Expense Code</th>
                    <th className="py-1 pr-4 text-right">Qty</th><th className="py-1 pr-4 text-right">Unit Cost</th>
                    <th className="py-1 pr-4 text-right">Q1</th><th className="py-1 pr-4 text-right">Q2</th><th className="py-1 pr-4 text-right">Q3</th><th className="py-1 pr-4 text-right">Q4</th>
                    <th className="py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-t border-slate-200">
                      <td className="py-1.5 pr-4 text-slate-600">{line.line_number}</td>
                      <td className="py-1.5 pr-4 text-slate-900">{line.activity_description}</td>
                      <td className="py-1.5 pr-4 font-mono text-xs text-png-red">{line.expense_code?.full_expense_code || "-"}</td>
                      <td className="py-1.5 pr-4 text-right">{line.quantity || "-"}</td>
                      <td className="py-1.5 pr-4 text-right">{line.unit_cost ? `K ${line.unit_cost.toLocaleString()}` : "-"}</td>
                      <td className="py-1.5 pr-4 text-right">K {(line.q1_amount || 0).toLocaleString()}</td>
                      <td className="py-1.5 pr-4 text-right">K {(line.q2_amount || 0).toLocaleString()}</td>
                      <td className="py-1.5 pr-4 text-right">K {(line.q3_amount || 0).toLocaleString()}</td>
                      <td className="py-1.5 pr-4 text-right">K {(line.q4_amount || 0).toLocaleString()}</td>
                      <td className="py-1.5 text-right font-medium">K {(line.total_amount || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
