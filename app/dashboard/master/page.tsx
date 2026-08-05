"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { FolderOpen, Plus, Loader2, X, CheckCircle2, AlertCircle, Hash } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/AuthContext"

type Row = Record<string, unknown>
type Opt = { id: string; code?: string; name: string; department_id?: string; section_id?: string; expense_category_id?: string }

type SourceKey = "departments" | "sections" | "cost_centres" | "expense_categories" | "expense_items"
type Field = {
  name: string
  label: string
  type: "text" | "select"
  required?: boolean
  optionsKey?: SourceKey
  dependsOn?: string // parent field whose value filters this select
}
type Column = { key: string; label: string; badge?: boolean }
type TabConfig = {
  key: string
  table: string
  label: string
  select: string
  order: string
  columns: Column[]
  fields: Field[]
  builder?: boolean
}

const TABS: TabConfig[] = [
  {
    key: "departments", table: "departments", label: "Departments", select: "*", order: "name",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "is_active", label: "Status", badge: true }],
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }, { name: "description", label: "Description", type: "text" }],
  },
  {
    key: "sections", table: "sections", label: "Sections", select: "id, code, name, is_active, department_id, department:departments(name)", order: "name",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "department.name", label: "Department" }, { key: "is_active", label: "Status", badge: true }],
    fields: [{ name: "department_id", label: "Department", type: "select", required: true, optionsKey: "departments" }, { name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }],
  },
  {
    key: "cost_centres", table: "cost_centres", label: "Cost Centres", select: "id, code, name, is_active, department:departments(name), section:sections(name)", order: "code",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "department.name", label: "Department" }, { key: "section.name", label: "Section" }, { key: "is_active", label: "Status", badge: true }],
    fields: [
      { name: "department_id", label: "Department", type: "select", required: true, optionsKey: "departments" },
      { name: "section_id", label: "Section", type: "select", optionsKey: "sections", dependsOn: "department_id" },
      { name: "code", label: "Code", type: "text", required: true },
      { name: "name", label: "Name", type: "text", required: true },
    ],
  },
  {
    key: "expense_categories", table: "expense_categories", label: "Categories", select: "*", order: "name",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "is_active", label: "Status", badge: true }],
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }],
  },
  {
    key: "expense_items", table: "expense_items", label: "Expense Items", select: "id, code, name, default_unit, is_active, category:expense_categories(name)", order: "code",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "category.name", label: "Category" }, { key: "default_unit", label: "Unit" }, { key: "is_active", label: "Status", badge: true }],
    fields: [
      { name: "expense_category_id", label: "Category", type: "select", required: true, optionsKey: "expense_categories" },
      { name: "code", label: "Code", type: "text", required: true },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "default_unit", label: "Unit", type: "text" },
    ],
  },
  {
    key: "expense_code_registry", table: "expense_code_registry", label: "Code Registry", builder: true,
    select: "id, full_expense_code, description, is_active, department:departments(code), cost_centre:cost_centres(code), category:expense_categories(code), item:expense_items(code)", order: "full_expense_code",
    columns: [{ key: "full_expense_code", label: "Full Code" }, { key: "description", label: "Description" }, { key: "is_active", label: "Status", badge: true }],
    fields: [],
  },
  {
    key: "activity_templates", table: "activity_templates", label: "Templates", select: "id, name, default_unit, description, is_active", order: "name",
    columns: [{ key: "name", label: "Template" }, { key: "default_unit", label: "Unit" }, { key: "description", label: "Description" }, { key: "is_active", label: "Status", badge: true }],
    fields: [{ name: "name", label: "Name", type: "text", required: true }, { name: "default_unit", label: "Unit", type: "text" }, { name: "description", label: "Description", type: "text" }],
  },
  {
    key: "funding_sources", table: "funding_sources", label: "Funding", select: "*", order: "name",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "source_type", label: "Type" }, { key: "is_active", label: "Status", badge: true }],
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }, { name: "source_type", label: "Type", type: "text" }],
  },
  {
    key: "chart_of_accounts", table: "chart_of_accounts", label: "Accounts", select: "*", order: "account_code",
    columns: [{ key: "account_code", label: "Account Code" }, { key: "account_name", label: "Account Name" }, { key: "account_type", label: "Type" }, { key: "is_active", label: "Status", badge: true }],
    fields: [{ name: "account_code", label: "Account Code", type: "text", required: true }, { name: "account_name", label: "Account Name", type: "text", required: true }, { name: "account_type", label: "Type", type: "text" }],
  },
  {
    key: "provinces", table: "provinces", label: "Provinces", select: "*", order: "name",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "region", label: "Region" }, { key: "is_active", label: "Status", badge: true }],
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }, { name: "region", label: "Region", type: "text" }],
  },
]

function getValue(row: Row, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), row)
}

export default function MasterDataPage() {
  const { can } = useAuth()
  const canEdit = can("masterdata.manage") || can("registry.manage") || can("users.manage")
  const [active, setActive] = useState(0)
  const [rows, setRows] = useState<Row[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  // select option sources
  const [sources, setSources] = useState<Record<SourceKey, Opt[]>>({
    departments: [], sections: [], cost_centres: [], expense_categories: [], expense_items: [],
  })

  const tab = TABS[active]

  const loadSources = useCallback(async () => {
    const [d, s, cc, ec, ei] = await Promise.all([
      supabase.from("departments").select("id, code, name").eq("is_active", true).order("name"),
      supabase.from("sections").select("id, code, name, department_id").eq("is_active", true).order("name"),
      supabase.from("cost_centres").select("id, code, name, section_id, department_id").eq("is_active", true).order("code"),
      supabase.from("expense_categories").select("id, code, name").eq("is_active", true).order("name"),
      supabase.from("expense_items").select("id, code, name, expense_category_id").eq("is_active", true).order("code"),
    ])
    setSources({
      departments: (d.data || []) as Opt[],
      sections: (s.data || []) as Opt[],
      cost_centres: (cc.data || []) as Opt[],
      expense_categories: (ec.data || []) as Opt[],
      expense_items: (ei.data || []) as Opt[],
    })
  }, [])

  const fetchRows = useCallback(async () => {
    setLoading(true)
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
    loadSources()
  }, [loadSources])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRows(); setShowAdd(false); setForm({})
  }, [fetchRows])

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
    setSaving(true); setError(""); setSuccess("")
    try {
      const payload: Record<string, string> = {}
      for (const f of tab.fields) {
        if (f.required && !form[f.name]) throw new Error(`${f.label} is required`)
        if (form[f.name]) payload[f.name] = form[f.name]
      }
      const { error: insErr } = await supabase.from(tab.table).insert(payload)
      if (insErr) throw insErr
      setSuccess(`${tab.label.replace(/s$/, "")} added.`)
      setForm({}); setShowAdd(false); fetchRows(); loadSources()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add record.")
    } finally {
      setSaving(false)
    }
  }

  const optionsFor = (f: Field): Opt[] => {
    if (!f.optionsKey) return []
    let opts = sources[f.optionsKey]
    if (f.dependsOn && form[f.dependsOn]) {
      const parent = form[f.dependsOn]
      opts = opts.filter((o) => o.department_id === parent || o.section_id === parent || o.expense_category_id === parent)
    }
    return opts
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FolderOpen className="h-7 w-7 text-png-red" /> Master Data &amp; Code Registry
          </h1>
          <p className="text-slate-600 mt-1">Departments, sections, cost centres, expense codes & templates used across the system</p>
        </div>
        {canEdit && !tab.builder && tab.fields.length > 0 && (
          <button onClick={() => { setShowAdd((s) => !s); setError(""); setSuccess("") }}
            className="px-4 py-2 bg-png-red text-white rounded-lg font-medium hover:bg-png-maroon flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add {tab.label.replace(/s$/, "")}
          </button>
        )}
      </div>

      {success && <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2 text-sm text-green-700"><CheckCircle2 className="h-4 w-4" /> {success}</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-sm text-red-700"><AlertCircle className="h-4 w-4" /> {error}</div>}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t, i) => (
          <button key={t.key} onClick={() => setActive(i)}
            className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${i === active ? "bg-png-red/10 text-png-red border border-png-gold/40" : "text-slate-600 hover:bg-slate-100 border border-transparent"}`}>
            {t.label}
            <span className={`px-1.5 py-0.5 rounded-full text-xs ${i === active ? "bg-png-red/15 text-png-red" : "bg-slate-200 text-slate-600"}`}>{counts[t.key] ?? "·"}</span>
          </button>
        ))}
      </div>

      {/* Code Registry builder */}
      {tab.builder && can("registry.manage") && (
        <CodeBuilder sources={sources} onCreated={() => { fetchRows(); loadSources() }} />
      )}

      {/* Generic add form */}
      {showAdd && canEdit && !tab.builder && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">Add {tab.label.replace(/s$/, "")}</h3>
            <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-slate-100 rounded"><X className="h-4 w-4 text-slate-500" /></button>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            {tab.fields.map((f) => (
              <div key={f.name}>
                <label className="block text-sm font-medium text-slate-700 mb-1">{f.label} {f.required && <span className="text-png-red">*</span>}</label>
                {f.type === "select" ? (
                  <select value={form[f.name] || ""} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red">
                    <option value="">Select...</option>
                    {optionsFor(f).map((o) => <option key={o.id} value={o.id}>{o.code ? `${o.code} — ${o.name}` : o.name}</option>)}
                  </select>
                ) : (
                  <input value={form[f.name] || ""} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red" />
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={handleAdd} disabled={saving} className="px-4 py-2 bg-png-red text-white rounded-lg text-sm font-medium hover:bg-png-maroon disabled:opacity-50 flex items-center gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-slate-500">No {tab.label.toLowerCase()} found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>{tab.columns.map((c) => <th key={c.key} className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">{c.label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    {tab.columns.map((c) => {
                      const v = getValue(row, c.key)
                      return (
                        <td key={c.key} className="px-4 py-3 text-sm text-slate-700">
                          {c.badge ? (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${v ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{v ? "Active" : "Inactive"}</span>
                          ) : c.key === "full_expense_code" ? (
                            <span className="font-mono text-png-red font-medium">{String(v ?? "-")}</span>
                          ) : (v === null || v === undefined || v === "" ? "-" : String(v))}
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

function CodeBuilder({ sources, onCreated }: { sources: Record<SourceKey, Opt[]>; onCreated: () => void }) {
  const [dept, setDept] = useState("")
  const [cc, setCc] = useState("")
  const [cat, setCat] = useState("")
  const [item, setItem] = useState("")
  const [desc, setDesc] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const ccOptions = useMemo(() => sources.cost_centres.filter((c) => !dept || c.department_id === dept), [sources.cost_centres, dept])
  const itemOptions = useMemo(() => sources.expense_items.filter((i) => !cat || i.expense_category_id === cat), [sources.expense_items, cat])

  const codeOf = (arr: Opt[], id: string) => arr.find((o) => o.id === id)?.code || ""
  const preview = [
    codeOf(sources.departments, dept) || "DEPT",
    codeOf(sources.cost_centres, cc) || "CC",
    codeOf(sources.expense_categories, cat) || "CAT",
    codeOf(sources.expense_items, item) || "ITEM",
  ].join("-").toUpperCase()

  const ready = dept && cc && cat && item

  const create = async () => {
    setSaving(true); setError(""); setSuccess("")
    try {
      const section_id = sources.cost_centres.find((c) => c.id === cc)?.section_id || null
      const { error: insErr } = await supabase.from("expense_code_registry").insert({
        department_id: dept, cost_centre_id: cc, expense_category_id: cat, expense_item_id: item,
        section_id, description: desc || null, financial_year: new Date().getFullYear(), full_expense_code: "PENDING",
      })
      if (insErr) throw insErr
      setSuccess(`Code ${preview} created.`)
      setCc(""); setItem(""); setDesc("")
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create code.")
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-white rounded-lg border border-png-gold/40 p-5">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-1"><Hash className="h-4 w-4 text-png-gold" /> Build Expense Code</h3>
      <p className="text-xs text-slate-500 mb-4">Combine Department · Cost Centre · Category · Item. The full code is generated automatically.</p>
      {success && <div className="mb-3 bg-green-50 border border-green-200 rounded-lg p-2.5 text-sm text-green-700 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> {success}</div>}
      {error && <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-2.5 text-sm text-red-700 flex items-center gap-2"><AlertCircle className="h-4 w-4" /> {error}</div>}
      <div className="grid md:grid-cols-4 gap-3">
        <Picker label="Department" value={dept} onChange={(v) => { setDept(v); setCc("") }} options={sources.departments} />
        <Picker label="Cost Centre" value={cc} onChange={setCc} options={ccOptions} disabled={!dept} />
        <Picker label="Category" value={cat} onChange={(v) => { setCat(v); setItem("") }} options={sources.expense_categories} />
        <Picker label="Item" value={item} onChange={setItem} options={itemOptions} disabled={!cat} />
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Generated code</label>
            <span className="font-mono text-lg font-bold text-png-red bg-png-red/5 px-3 py-1.5 rounded-lg border border-png-gold/40">{preview}</span>
          </div>
          <input placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red w-64" />
        </div>
        <button onClick={create} disabled={!ready || saving}
          className="px-4 py-2 bg-png-red text-white rounded-lg text-sm font-medium hover:bg-png-maroon disabled:opacity-50 flex items-center gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create Code
        </button>
      </div>
    </div>
  )
}

function Picker({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (v: string) => void; options: Opt[]; disabled?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red disabled:bg-slate-100">
        <option value="">Select...</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.code ? `${o.code} — ${o.name}` : o.name}</option>)}
      </select>
    </div>
  )
}
