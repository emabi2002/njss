"use client"

import { useState, useEffect, useCallback } from "react"
import { FolderOpen, Plus, Loader2, X, CheckCircle2, AlertCircle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/AuthContext"

type Row = Record<string, unknown>
type Dept = { id: string; name: string }

type Field = { name: string; label: string; type: "text" | "select"; required?: boolean; optionsKey?: "departments" }
type Column = { key: string; label: string; badge?: boolean }
type TabConfig = {
  key: string
  table: string
  label: string
  select: string
  order: string
  columns: Column[]
  fields: Field[]
}

const TABS: TabConfig[] = [
  {
    key: "departments", table: "departments", label: "Departments", select: "*", order: "name",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "description", label: "Description" }, { key: "is_active", label: "Status", badge: true }],
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }, { name: "description", label: "Description", type: "text" }],
  },
  {
    key: "sections", table: "sections", label: "Sections", select: "id, code, name, is_active, department:departments(name)", order: "name",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "department.name", label: "Department" }, { key: "is_active", label: "Status", badge: true }],
    fields: [{ name: "department_id", label: "Department", type: "select", required: true, optionsKey: "departments" }, { name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }],
  },
  {
    key: "provinces", table: "provinces", label: "Provinces", select: "*", order: "name",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "region", label: "Region" }, { key: "is_active", label: "Status", badge: true }],
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }, { name: "region", label: "Region", type: "text" }],
  },
  {
    key: "funding_sources", table: "funding_sources", label: "Funding Sources", select: "*", order: "name",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "source_type", label: "Type" }, { key: "is_active", label: "Status", badge: true }],
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }, { name: "source_type", label: "Type", type: "text" }],
  },
  {
    key: "chart_of_accounts", table: "chart_of_accounts", label: "Chart of Accounts", select: "*", order: "account_code",
    columns: [{ key: "account_code", label: "Account Code" }, { key: "account_name", label: "Account Name" }, { key: "account_type", label: "Type" }, { key: "is_active", label: "Status", badge: true }],
    fields: [{ name: "account_code", label: "Account Code", type: "text", required: true }, { name: "account_name", label: "Account Name", type: "text", required: true }, { name: "account_type", label: "Type", type: "text" }],
  },
  {
    key: "expense_categories", table: "expense_categories", label: "Expense Categories", select: "*", order: "name",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "is_active", label: "Status", badge: true }],
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }],
  },
]

function getValue(row: Row, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), row)
}

export default function MasterDataPage() {
  const { can } = useAuth()
  const canEdit = can("users.manage")
  const [active, setActive] = useState(0)
  const [rows, setRows] = useState<Row[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [departments, setDepartments] = useState<Dept[]>([])

  const tab = TABS[active]

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const { data } = await supabase.from(tab.table).select(tab.select).order(tab.order)
      setRows((data || []) as unknown as Row[])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [tab.table, tab.select, tab.order])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRows()
    setShowAdd(false)
    setForm({})
  }, [fetchRows])

  useEffect(() => {
    async function loadAux() {
      const { data } = await supabase.from("departments").select("id, name").eq("is_active", true).order("name")
      setDepartments((data || []) as Dept[])
    }
    loadAux()
  }, [])

  // counts per tab (once)
  useEffect(() => {
    async function loadCounts() {
      const entries = await Promise.all(
        TABS.map(async (t) => {
          const { count } = await supabase.from(t.table).select("id", { count: "exact", head: true })
          return [t.key, count || 0] as const
        })
      )
      setCounts(Object.fromEntries(entries))
    }
    loadCounts()
  }, [rows])

  const handleAdd = async () => {
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      const payload: Record<string, string> = {}
      for (const f of tab.fields) {
        if (f.required && !form[f.name]) throw new Error(`${f.label} is required`)
        if (form[f.name]) payload[f.name] = form[f.name]
      }
      const { error: insErr } = await supabase.from(tab.table).insert(payload)
      if (insErr) throw insErr
      setSuccess(`${tab.label.replace(/s$/, "")} added.`)
      setForm({})
      setShowAdd(false)
      fetchRows()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add record.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FolderOpen className="h-7 w-7 text-slate-700" /> Master Data
          </h1>
          <p className="text-slate-600 mt-1">Reference data used across requisitions, budgets and reports</p>
        </div>
        {canEdit && (
          <button onClick={() => { setShowAdd((s) => !s); setError(""); setSuccess("") }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add {tab.label.replace(/s$/, "")}
          </button>
        )}
      </div>

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" /> {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            onClick={() => setActive(i)}
            className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
              i === active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t.label}
            <span className={`px-1.5 py-0.5 rounded-full text-xs ${i === active ? "bg-blue-200 text-blue-800" : "bg-slate-200 text-slate-600"}`}>
              {counts[t.key] ?? "·"}
            </span>
          </button>
        ))}
      </div>

      {/* Add form */}
      {showAdd && canEdit && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">Add {tab.label.replace(/s$/, "")}</h3>
            <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-slate-100 rounded"><X className="h-4 w-4 text-slate-500" /></button>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            {tab.fields.map((f) => (
              <div key={f.name}>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {f.label} {f.required && <span className="text-red-500">*</span>}
                </label>
                {f.type === "select" ? (
                  <select value={form[f.name] || ""} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Select...</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                ) : (
                  <input value={form[f.name] || ""} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={handleAdd} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-slate-500">No {tab.label.toLowerCase()} found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {tab.columns.map((c) => (
                    <th key={c.key} className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    {tab.columns.map((c) => {
                      const v = getValue(row, c.key)
                      return (
                        <td key={c.key} className="px-4 py-3 text-sm text-slate-700">
                          {c.badge ? (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${v ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {v ? "Active" : "Inactive"}
                            </span>
                          ) : (
                            v === null || v === undefined || v === "" ? "-" : String(v)
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
