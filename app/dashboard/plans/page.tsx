"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Calendar, Plus, Loader2, X, ChevronDown, ChevronRight, Trash2, CheckCircle2, AlertCircle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/AuthContext"

type Plan = {
  id: string
  plan_number: string
  financial_year: number
  status: string
  created_at: string
  department: { name: string } | null
  section: { name: string } | null
}

type PlanLine = {
  id: string
  line_number: number
  activity_description: string
  q1_amount: number
  q2_amount: number
  q3_amount: number
  q4_amount: number
  total_amount: number
}

type Dept = { id: string; name: string }
type Sec = { id: string; name: string; department_id: string }

type LineInput = { activity_description: string; q1: number; q2: number; q3: number; q4: number }

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  SUBMITTED: "bg-blue-100 text-blue-700",
  APPROVED: "bg-green-100 text-green-700",
}

export default function AnnualPlansPage() {
  const { can } = useAuth()
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [yearFilter, setYearFilter] = useState<number>(2025)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [lines, setLines] = useState<Record<string, PlanLine[]>>({})
  const [showModal, setShowModal] = useState(false)

  const fetchPlans = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from("annual_plan_headers")
        .select("id, plan_number, financial_year, status, created_at, department:departments(name), section:sections(name)")
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
        .select("id, line_number, activity_description, q1_amount, q2_amount, q3_amount, q4_amount, total_amount")
        .eq("plan_header_id", planId)
        .order("line_number")
      setLines((prev) => ({ ...prev, [planId]: (data || []) as unknown as PlanLine[] }))
    }
  }

  const stats = useMemo(() => ({
    total: plans.length,
    draft: plans.filter((p) => p.status === "DRAFT").length,
    submitted: plans.filter((p) => p.status === "SUBMITTED").length,
    approved: plans.filter((p) => p.status === "APPROVED").length,
  }), [plans])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="h-7 w-7 text-slate-700" /> Annual Plans
          </h1>
          <p className="text-slate-600 mt-1">Annual activity plans and quarterly budget phasing</p>
        </div>
        {can("budget.view") && (
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" /> New Annual Plan
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Plans" value={stats.total} />
        <StatCard label="Draft" value={stats.draft} />
        <StatCard label="Submitted" value={stats.submitted} />
        <StatCard label="Approved" value={stats.approved} />
      </div>

      {/* Filter */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 flex items-center gap-3">
        <label className="text-sm font-medium text-slate-700">Financial Year</label>
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(parseInt(e.target.value))}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {[2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* List */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>
        ) : plans.length === 0 ? (
          <div className="text-center py-16">
            <Calendar className="h-12 w-12 mx-auto text-slate-300 mb-3" />
            <h3 className="text-lg font-medium text-slate-900">No annual plans yet</h3>
            <p className="text-slate-600 mt-1">Create your first plan for FY{yearFilter}.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Plan Number</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Department</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Section</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">FY</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {plans.map((plan) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  expanded={expanded === plan.id}
                  lines={lines[plan.id]}
                  onToggle={() => toggleExpand(plan.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <NewPlanModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); fetchPlans() }}
        />
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <p className="text-xs font-medium text-slate-600 uppercase">{label}</p>
      <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
    </div>
  )
}

function PlanRow({ plan, expanded, lines, onToggle }: { plan: Plan; expanded: boolean; lines?: PlanLine[]; onToggle: () => void }) {
  const total = (lines || []).reduce((s, l) => s + (l.total_amount || 0), 0)
  return (
    <>
      <tr className="hover:bg-slate-50 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-3 text-slate-400">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
        <td className="px-4 py-3 text-sm font-medium text-blue-600">{plan.plan_number}</td>
        <td className="px-4 py-3 text-sm text-slate-700">{plan.department?.name || "-"}</td>
        <td className="px-4 py-3 text-sm text-slate-700">{plan.section?.name || "-"}</td>
        <td className="px-4 py-3 text-sm text-slate-700">{plan.financial_year}</td>
        <td className="px-4 py-3">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[plan.status] || STATUS_STYLES.DRAFT}`}>{plan.status}</span>
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
                    <th className="py-1 pr-4">#</th>
                    <th className="py-1 pr-4">Activity</th>
                    <th className="py-1 pr-4 text-right">Q1</th>
                    <th className="py-1 pr-4 text-right">Q2</th>
                    <th className="py-1 pr-4 text-right">Q3</th>
                    <th className="py-1 pr-4 text-right">Q4</th>
                    <th className="py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-t border-slate-200">
                      <td className="py-1.5 pr-4 text-slate-600">{l.line_number}</td>
                      <td className="py-1.5 pr-4 text-slate-900">{l.activity_description}</td>
                      <td className="py-1.5 pr-4 text-right">K {(l.q1_amount || 0).toLocaleString()}</td>
                      <td className="py-1.5 pr-4 text-right">K {(l.q2_amount || 0).toLocaleString()}</td>
                      <td className="py-1.5 pr-4 text-right">K {(l.q3_amount || 0).toLocaleString()}</td>
                      <td className="py-1.5 pr-4 text-right">K {(l.q4_amount || 0).toLocaleString()}</td>
                      <td className="py-1.5 text-right font-medium">K {(l.total_amount || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-300 font-semibold">
                    <td colSpan={6} className="py-1.5 pr-4 text-right">Grand Total</td>
                    <td className="py-1.5 text-right text-slate-900">K {total.toLocaleString()}</td>
                  </tr>
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({ financial_year: 2025, department_id: "", section_id: "", status: "DRAFT" })
  const [planLines, setPlanLines] = useState<LineInput[]>([{ activity_description: "", q1: 0, q2: 0, q3: 0, q4: 0 }])

  useEffect(() => {
    async function load() {
      const [d, s] = await Promise.all([
        supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
        supabase.from("sections").select("id, name, department_id").eq("is_active", true).order("name"),
      ])
      setDepts((d.data || []) as Dept[])
      setSections((s.data || []) as Sec[])
    }
    load()
  }, [])

  const filteredSections = useMemo(
    () => form.department_id ? sections.filter((s) => s.department_id === form.department_id) : [],
    [form.department_id, sections]
  )

  const updateLine = (i: number, patch: Partial<LineInput>) => {
    setPlanLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  const validLines = planLines.filter((l) => l.activity_description.trim())
  const canSave = form.department_id && validLines.length > 0

  const handleSave = async () => {
    setSaving(true)
    setError("")
    try {
      // Generate a unique plan number for the year
      const { count } = await supabase
        .from("annual_plan_headers")
        .select("id", { count: "exact", head: true })
        .eq("financial_year", form.financial_year)
      const planNumber = `AP-${form.financial_year}-${String((count || 0) + 1).padStart(3, "0")}`

      const { data: header, error: hErr } = await supabase
        .from("annual_plan_headers")
        .insert({
          plan_number: planNumber,
          financial_year: form.financial_year,
          department_id: form.department_id,
          section_id: form.section_id || null,
          status: form.status,
        })
        .select()
        .single()
      if (hErr) throw hErr

      const linesToInsert = validLines.map((l, idx) => ({
        plan_header_id: header.id,
        line_number: idx + 1,
        activity_description: l.activity_description,
        q1_amount: l.q1 || 0,
        q2_amount: l.q2 || 0,
        q3_amount: l.q3 || 0,
        q4_amount: l.q4 || 0,
      }))
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
      <div className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">New Annual Plan</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded"><X className="h-5 w-5 text-slate-500" /></button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}
          <div className="grid md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Financial Year</label>
              <input type="number" value={form.financial_year} onChange={(e) => setForm({ ...form, financial_year: parseInt(e.target.value) || 2025 })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Department <span className="text-red-500">*</span></label>
              <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value, section_id: "" })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select...</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Section</label>
              <select value={form.section_id} onChange={(e) => setForm({ ...form, section_id: e.target.value })} disabled={!form.department_id}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100">
                <option value="">Select...</option>
                {filteredSections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="DRAFT">Draft</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="APPROVED">Approved</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-slate-900">Activity Lines</h4>
              <button onClick={() => setPlanLines([...planLines, { activity_description: "", q1: 0, q2: 0, q3: 0, q4: 0 }])}
                className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus className="h-4 w-4" /> Add line</button>
            </div>
            <div className="space-y-2">
              {planLines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input placeholder="Activity description" value={l.activity_description} onChange={(e) => updateLine(i, { activity_description: e.target.value })}
                    className="col-span-5 px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {(["q1", "q2", "q3", "q4"] as const).map((q) => (
                    <input key={q} type="number" placeholder={q.toUpperCase()} value={l[q] || ""} onChange={(e) => updateLine(i, { [q]: parseFloat(e.target.value) || 0 })}
                      className="col-span-1 px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  ))}
                  <div className="col-span-2 text-right text-sm font-medium text-slate-700">K {(l.q1 + l.q2 + l.q3 + l.q4).toLocaleString()}</div>
                  <button onClick={() => setPlanLines(planLines.filter((_, idx) => idx !== i))} disabled={planLines.length === 1}
                    className="col-span-1 text-red-500 hover:text-red-700 disabled:opacity-30 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="p-6 border-t border-slate-200 flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={!canSave || saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Create Plan
          </button>
        </div>
      </div>
    </div>
  )
}
