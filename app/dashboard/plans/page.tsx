"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Calendar, Plus, Loader2, X, ChevronDown, ChevronRight, Trash2, CheckCircle2, AlertCircle, Send, Eye, Stamp, Wallet } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/AuthContext"
import { transitionAnnualPlan, type PlanAction } from "@/lib/api"
import { type Permission } from "@/lib/permissions"

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
  q1_amount: number; q2_amount: number; q3_amount: number; q4_amount: number
  total_amount: number
  expense_code: { full_expense_code: string } | null
}

type Dept = { id: string; name: string }
type Sec = { id: string; name: string; department_id: string }
type CC = { id: string; code: string; name: string; section_id: string | null; department_id: string | null }
type Code = { id: string; full_expense_code: string; section_id: string | null }
type LineInput = { activity_description: string; expense_code_registry_id: string; quantity: number; unit_cost: number; quarter: 1 | 2 | 3 | 4 }

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

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  REVIEWED: "Reviewed",
  APPROVED_BY_DEPARTMENT: "Approved (Dept)",
  AUTHORIZED_BY_REGISTRAR: "Authorized (Registrar)",
  BUDGET_CONFIRMED: "Budget Confirmed",
  REJECTED: "Rejected",
  RETURNED_FOR_CORRECTION: "Returned",
}

// Which actions are available at each status (and the permission needed)
type Act = { action: PlanAction; label: string; perm: Permission; icon: typeof Send; tone: "primary" | "neutral" | "danger" }
const ACTIONS: Record<string, Act[]> = {
  DRAFT: [{ action: "SUBMIT", label: "Submit", perm: "plans.submit", icon: Send, tone: "primary" }],
  RETURNED_FOR_CORRECTION: [{ action: "SUBMIT", label: "Re-submit", perm: "plans.submit", icon: Send, tone: "primary" }],
  SUBMITTED: [
    { action: "REVIEW", label: "Review", perm: "plans.review", icon: Eye, tone: "primary" },
    { action: "RETURN", label: "Return", perm: "plans.review", icon: X, tone: "neutral" },
  ],
  REVIEWED: [
    { action: "APPROVE_DEPARTMENT", label: "Approve (Dept)", perm: "plans.review", icon: CheckCircle2, tone: "primary" },
    { action: "RETURN", label: "Return", perm: "plans.review", icon: X, tone: "neutral" },
  ],
  APPROVED_BY_DEPARTMENT: [
    { action: "AUTHORIZE_REGISTRAR", label: "Authorize", perm: "plans.authorize", icon: Stamp, tone: "primary" },
    { action: "REJECT", label: "Reject", perm: "plans.authorize", icon: X, tone: "danger" },
  ],
  AUTHORIZED_BY_REGISTRAR: [{ action: "CONFIRM_BUDGET", label: "Confirm to Budget", perm: "plans.confirm", icon: Wallet, tone: "primary" }],
}

export default function AnnualPlansPage() {
  const { can } = useAuth()
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [yearFilter, setYearFilter] = useState<number>(2025)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [lines, setLines] = useState<Record<string, PlanLine[]>>({})
  const [showModal, setShowModal] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ type: "ok" | "err"; msg: string } | null>(null)

  const fetchPlans = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from("annual_plan_headers")
        .select("id, plan_number, plan_title, financial_year, status, total_planned_budget, created_at, department:departments(name), section:sections(name), cost_centre:cost_centres(code, name)")
        .eq("financial_year", yearFilter)
        .order("created_at", { ascending: false })
      setPlans((data || []) as unknown as Plan[])
    } catch (err) {
      console.error("Error loading plans:", err)
    } finally {
      setLoading(false)
    }
  }, [yearFilter])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPlans()
  }, [fetchPlans])

  const toggleExpand = async (planId: string) => {
    if (expanded === planId) { setExpanded(null); return }
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

  const runAction = async (planId: string, action: PlanAction) => {
    setBusy(planId + action); setBanner(null)
    try {
      await transitionAnnualPlan(planId, action)
      setBanner({ type: "ok", msg: action === "CONFIRM_BUDGET" ? "Plan confirmed — budget allocations created." : "Plan updated." })
      await fetchPlans()
    } catch (err: unknown) {
      setBanner({ type: "err", msg: err instanceof Error ? err.message : "Action failed." })
    } finally {
      setBusy(null)
    }
  }

  const stats = useMemo(() => ({
    total: plans.length,
    draft: plans.filter((p) => p.status === "DRAFT" || p.status === "RETURNED_FOR_CORRECTION").length,
    inflight: plans.filter((p) => ["SUBMITTED", "REVIEWED", "APPROVED_BY_DEPARTMENT", "AUTHORIZED_BY_REGISTRAR"].includes(p.status)).length,
    confirmed: plans.filter((p) => p.status === "BUDGET_CONFIRMED").length,
    value: plans.reduce((s, p) => s + (p.total_planned_budget || 0), 0),
  }), [plans])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="h-7 w-7 text-png-red" /> Annual Activity Plans
          </h1>
          <p className="text-slate-600 mt-1">Section plans → department review → registrar authorization → budget confirmation</p>
        </div>
        {can("plans.create") && (
          <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-png-red text-white rounded-lg font-medium hover:bg-png-maroon flex items-center gap-2">
            <Plus className="h-4 w-4" /> New Annual Plan
          </button>
        )}
      </div>

      {banner && (
        <div className={`rounded-lg p-3 flex items-center gap-2 text-sm ${banner.type === "ok" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
          {banner.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {banner.msg}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Total Plans" value={stats.total} />
        <StatCard label="Draft / Returned" value={stats.draft} />
        <StatCard label="In Workflow" value={stats.inflight} />
        <StatCard label="Budget Confirmed" value={stats.confirmed} />
        <StatCard label="Planned Value" value={`K ${stats.value.toLocaleString()}`} />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4 flex items-center gap-3">
        <label className="text-sm font-medium text-slate-700">Financial Year</label>
        <select value={yearFilter} onChange={(e) => setYearFilter(parseInt(e.target.value))}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red">
          {[2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div>
        ) : plans.length === 0 ? (
          <div className="text-center py-16">
            <Calendar className="h-12 w-12 mx-auto text-slate-300 mb-3" />
            <h3 className="text-lg font-medium text-slate-900">No annual plans yet</h3>
            <p className="text-slate-600 mt-1">Create your first plan for FY{yearFilter}.</p>
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
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Workflow</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plans.map((plan) => (
                  <PlanRow key={plan.id} plan={plan} expanded={expanded === plan.id} lines={lines[plan.id]}
                    onToggle={() => toggleExpand(plan.id)} onAction={runAction} busy={busy} can={can} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && <NewPlanModal onClose={() => setShowModal(false)} onCreated={() => { setShowModal(false); fetchPlans() }} />}
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

function PlanRow({ plan, expanded, lines, onToggle, onAction, busy, can }: {
  plan: Plan; expanded: boolean; lines?: PlanLine[]; onToggle: () => void
  onAction: (id: string, a: PlanAction) => void; busy: string | null; can: (p: Permission) => boolean
}) {
  const acts = (ACTIONS[plan.status] || []).filter((a) => can(a.perm))
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
        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[plan.status] || STATUS_STYLES.DRAFT}`}>{STATUS_LABEL[plan.status] || plan.status}</span></td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-1.5">
            {acts.length === 0 ? <span className="text-xs text-slate-400">—</span> : acts.map((a) => {
              const Icon = a.icon
              const isBusy = busy === plan.id + a.action
              const tone = a.tone === "primary" ? "bg-png-red text-white hover:bg-png-maroon"
                : a.tone === "danger" ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              return (
                <button key={a.action} onClick={() => onAction(plan.id, a.action)} disabled={!!busy}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 disabled:opacity-50 ${tone}`}>
                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />} {a.label}
                </button>
              )
            })}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50">
          <td colSpan={6} className="px-6 py-4">
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
                  {lines.map((l) => (
                    <tr key={l.id} className="border-t border-slate-200">
                      <td className="py-1.5 pr-4 text-slate-600">{l.line_number}</td>
                      <td className="py-1.5 pr-4 text-slate-900">{l.activity_description}</td>
                      <td className="py-1.5 pr-4 font-mono text-xs text-png-red">{l.expense_code?.full_expense_code || "-"}</td>
                      <td className="py-1.5 pr-4 text-right">{l.quantity || "-"}</td>
                      <td className="py-1.5 pr-4 text-right">{l.unit_cost ? `K ${l.unit_cost.toLocaleString()}` : "-"}</td>
                      <td className="py-1.5 pr-4 text-right">K {(l.q1_amount || 0).toLocaleString()}</td>
                      <td className="py-1.5 pr-4 text-right">K {(l.q2_amount || 0).toLocaleString()}</td>
                      <td className="py-1.5 pr-4 text-right">K {(l.q3_amount || 0).toLocaleString()}</td>
                      <td className="py-1.5 pr-4 text-right">K {(l.q4_amount || 0).toLocaleString()}</td>
                      <td className="py-1.5 text-right font-medium">K {(l.total_amount || 0).toLocaleString()}</td>
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

function NewPlanModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [depts, setDepts] = useState<Dept[]>([])
  const [sections, setSections] = useState<Sec[]>([])
  const [costCentres, setCostCentres] = useState<CC[]>([])
  const [codes, setCodes] = useState<Code[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({ financial_year: 2025, department_id: "", section_id: "", cost_centre_id: "", plan_title: "" })
  const [planLines, setPlanLines] = useState<LineInput[]>([{ activity_description: "", expense_code_registry_id: "", quantity: 1, unit_cost: 0, quarter: 1 }])

  useEffect(() => {
    async function load() {
      const [d, s, cc, c] = await Promise.all([
        supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
        supabase.from("sections").select("id, name, department_id").eq("is_active", true).order("name"),
        supabase.from("cost_centres").select("id, code, name, section_id, department_id").eq("is_active", true).order("code"),
        supabase.from("expense_code_registry").select("id, full_expense_code, section_id").eq("is_active", true).order("full_expense_code"),
      ])
      setDepts((d.data || []) as Dept[]); setSections((s.data || []) as Sec[])
      setCostCentres((cc.data || []) as CC[]); setCodes((c.data || []) as Code[])
    }
    load()
  }, [])

  const filteredSections = useMemo(() => form.department_id ? sections.filter((s) => s.department_id === form.department_id) : [], [form.department_id, sections])
  const filteredCC = useMemo(() => costCentres.filter((c) => (!form.section_id || c.section_id === form.section_id) && (!form.department_id || c.department_id === form.department_id)), [costCentres, form.section_id, form.department_id])
  const filteredCodes = useMemo(() => codes.filter((c) => !form.section_id || c.section_id === form.section_id || !c.section_id), [codes, form.section_id])

  const updateLine = (i: number, patch: Partial<LineInput>) => setPlanLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const lineTotal = (l: LineInput) => (l.quantity || 0) * (l.unit_cost || 0)
  const grandTotal = planLines.reduce((s, l) => s + lineTotal(l), 0)
  const validLines = planLines.filter((l) => l.activity_description.trim() && lineTotal(l) > 0)
  const canSave = form.department_id && validLines.length > 0

  const handleSave = async () => {
    setSaving(true); setError("")
    try {
      const { count } = await supabase.from("annual_plan_headers").select("id", { count: "exact", head: true }).eq("financial_year", form.financial_year)
      const planNumber = `AP-${form.financial_year}-${String((count || 0) + 1).padStart(3, "0")}`

      const { data: header, error: hErr } = await supabase.from("annual_plan_headers").insert({
        plan_number: planNumber, financial_year: form.financial_year, department_id: form.department_id,
        section_id: form.section_id || null, cost_centre_id: form.cost_centre_id || null,
        plan_title: form.plan_title || null, status: "DRAFT",
      }).select().single()
      if (hErr) throw hErr

      const linesToInsert = validLines.map((l, idx) => {
        const total = lineTotal(l)
        return {
          plan_header_id: header.id, line_number: idx + 1,
          activity_description: l.activity_description, item_description: l.activity_description,
          expense_code_registry_id: l.expense_code_registry_id || null, cost_centre_id: form.cost_centre_id || null,
          quantity: l.quantity, unit_cost: l.unit_cost,
          q1_amount: l.quarter === 1 ? total : 0, q2_amount: l.quarter === 2 ? total : 0,
          q3_amount: l.quarter === 3 ? total : 0, q4_amount: l.quarter === 4 ? total : 0,
        }
      })
      const { error: lErr } = await supabase.from("annual_plan_lines").insert(linesToInsert)
      if (lErr) throw lErr
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create the plan.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold text-slate-900">New Annual Activity Plan</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded"><X className="h-5 w-5 text-slate-500" /></button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-sm text-red-700"><AlertCircle className="h-4 w-4" /> {error}</div>}
          <div className="grid md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Financial Year</label>
              <input type="number" value={form.financial_year} onChange={(e) => setForm({ ...form, financial_year: parseInt(e.target.value) || 2025 })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Department <span className="text-png-red">*</span></label>
              <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value, section_id: "", cost_centre_id: "" })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red">
                <option value="">Select...</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Section</label>
              <select value={form.section_id} onChange={(e) => setForm({ ...form, section_id: e.target.value, cost_centre_id: "" })} disabled={!form.department_id}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red disabled:bg-slate-100">
                <option value="">Select...</option>
                {filteredSections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Cost Centre</label>
              <select value={form.cost_centre_id} onChange={(e) => setForm({ ...form, cost_centre_id: e.target.value })} disabled={!form.department_id}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red disabled:bg-slate-100">
                <option value="">Select...</option>
                {filteredCC.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Plan Title</label>
              <input value={form.plan_title} onChange={(e) => setForm({ ...form, plan_title: e.target.value })} placeholder="e.g. 2025 Operations"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-slate-900">Activity Lines</h4>
              <button onClick={() => setPlanLines([...planLines, { activity_description: "", expense_code_registry_id: "", quantity: 1, unit_cost: 0, quarter: 1 }])}
                className="text-sm text-png-red hover:text-png-maroon flex items-center gap-1"><Plus className="h-4 w-4" /> Add line</button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-[11px] uppercase text-slate-400 font-medium px-1">
                <span className="col-span-3">Activity</span><span className="col-span-3">Expense Code</span>
                <span className="col-span-1 text-right">Qty</span><span className="col-span-2 text-right">Unit Cost</span>
                <span className="col-span-1 text-center">Qtr</span><span className="col-span-1 text-right">Total</span><span className="col-span-1"></span>
              </div>
              {planLines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input placeholder="Description" value={l.activity_description} onChange={(e) => updateLine(i, { activity_description: e.target.value })}
                    className="col-span-3 px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red" />
                  <select value={l.expense_code_registry_id} onChange={(e) => updateLine(i, { expense_code_registry_id: e.target.value })}
                    className="col-span-3 px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red">
                    <option value="">— code —</option>
                    {filteredCodes.map((c) => <option key={c.id} value={c.id}>{c.full_expense_code}</option>)}
                  </select>
                  <input type="number" value={l.quantity || ""} onChange={(e) => updateLine(i, { quantity: parseFloat(e.target.value) || 0 })}
                    className="col-span-1 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-png-red" />
                  <input type="number" value={l.unit_cost || ""} onChange={(e) => updateLine(i, { unit_cost: parseFloat(e.target.value) || 0 })}
                    className="col-span-2 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-png-red" />
                  <select value={l.quarter} onChange={(e) => updateLine(i, { quarter: parseInt(e.target.value) as 1 | 2 | 3 | 4 })}
                    className="col-span-1 px-1 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red">
                    {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
                  </select>
                  <div className="col-span-1 text-right text-sm font-medium text-slate-700">K {lineTotal(l).toLocaleString()}</div>
                  <button onClick={() => setPlanLines(planLines.filter((_, idx) => idx !== i))} disabled={planLines.length === 1}
                    className="col-span-1 text-red-500 hover:text-red-700 disabled:opacity-30 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <div className="flex justify-end pt-2 border-t border-slate-200 text-sm font-semibold text-slate-900">
                Grand Total:&nbsp;<span className="text-png-red">K {grandTotal.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="p-6 border-t border-slate-200 flex items-center justify-end gap-3 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={!canSave || saving}
            className="px-4 py-2 bg-png-red text-white rounded-lg font-medium hover:bg-png-maroon disabled:opacity-50 flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Create Plan
          </button>
        </div>
      </div>
    </div>
  )
}
