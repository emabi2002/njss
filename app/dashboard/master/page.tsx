"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, Eye, FolderOpen, Hash, Loader2, Pencil, Plus, Power, Trash2, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/AuthContext"

type Row = Record<string, unknown>
type SourceKey = "departments" | "sections" | "cost_centres" | "expense_categories" | "expense_items" | "units_of_measure"
type Opt = { id: string; code?: string; name: string; department_id?: string; section_id?: string; expense_category_id?: string }
type Field = { name: string; label: string; type: "text" | "select" | "number" | "date"; required?: boolean; optionsKey?: SourceKey; dependsOn?: string }
type Column = { key: string; label: string; badge?: boolean }
type TabConfig = { key: string; table: string; label: string; select: string; order: string; columns: Column[]; fields: Field[]; builder?: boolean }

const baseFields = {
  code: { name: "code", label: "Code", type: "text", required: true } as Field,
  name: { name: "name", label: "Name", type: "text", required: true } as Field,
  description: { name: "description", label: "Description", type: "text" } as Field,
  sortOrder: { name: "sort_order", label: "Sort Order", type: "number" } as Field,
}

const TABS: TabConfig[] = [
  { key: "departments", table: "departments", label: "Departments", select: "*", order: "name", columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "is_active", label: "Status", badge: true }], fields: [baseFields.code, baseFields.name, baseFields.description] },
  { key: "sections", table: "sections", label: "Sections", select: "id, code, name, is_active, department_id, department:departments(name)", order: "name", columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "department.name", label: "Department" }, { key: "is_active", label: "Status", badge: true }], fields: [{ name: "department_id", label: "Department", type: "select", required: true, optionsKey: "departments" }, baseFields.code, baseFields.name] },
  { key: "cost_centres", table: "cost_centres", label: "Cost Centres", select: "id, code, name, is_active, department_id, section_id, department:departments(name), section:sections(name)", order: "code", columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "department.name", label: "Department" }, { key: "section.name", label: "Section" }, { key: "is_active", label: "Status", badge: true }], fields: [{ name: "department_id", label: "Department", type: "select", required: true, optionsKey: "departments" }, { name: "section_id", label: "Section", type: "select", optionsKey: "sections", dependsOn: "department_id" }, baseFields.code, baseFields.name] },
  { key: "expense_categories", table: "expense_categories", label: "Categories", select: "*", order: "name", columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "is_active", label: "Status", badge: true }], fields: [baseFields.code, baseFields.name, baseFields.description] },
  { key: "expense_items", table: "expense_items", label: "Expense Items", select: "id, code, name, default_unit, unit_of_measure_id, expense_category_id, is_active, category:expense_categories(name), unit:units_of_measure(code, name)", order: "code", columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "category.name", label: "Category" }, { key: "unit.name", label: "Unit" }, { key: "is_active", label: "Status", badge: true }], fields: [{ name: "expense_category_id", label: "Category", type: "select", optionsKey: "expense_categories" }, { name: "unit_of_measure_id", label: "Unit of Measure", type: "select", optionsKey: "units_of_measure" }, baseFields.code, baseFields.name, { name: "default_unit", label: "Legacy Default Unit", type: "text" }] },
  { key: "expense_code_registry", table: "expense_code_registry", label: "Code Registry", builder: true, select: "id, full_expense_code, description, financial_year, is_active, department:departments(code), cost_centre:cost_centres(code), category:expense_categories(code), item:expense_items(code)", order: "full_expense_code", columns: [{ key: "full_expense_code", label: "Full Code" }, { key: "description", label: "Description" }, { key: "financial_year", label: "FY" }, { key: "is_active", label: "Status", badge: true }], fields: [{ name: "description", label: "Description", type: "text" }, { name: "financial_year", label: "Financial Year", type: "number" }] },
  { key: "activity_templates", table: "activity_templates", label: "Templates", select: "id, name, default_unit, description, is_active", order: "name", columns: [{ key: "name", label: "Template" }, { key: "default_unit", label: "Unit" }, { key: "description", label: "Description" }, { key: "is_active", label: "Status", badge: true }], fields: [baseFields.name, { name: "default_unit", label: "Unit", type: "text" }, baseFields.description] },
  { key: "funding_sources", table: "funding_sources", label: "Funding", select: "*", order: "name", columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "source_type", label: "Type" }, { key: "is_active", label: "Status", badge: true }], fields: [baseFields.code, baseFields.name, { name: "source_type", label: "Type", type: "text" }] },
  { key: "chart_of_accounts", table: "chart_of_accounts", label: "Accounts", select: "*", order: "account_code", columns: [{ key: "account_code", label: "Account Code" }, { key: "account_name", label: "Account Name" }, { key: "account_type", label: "Type" }, { key: "is_active", label: "Status", badge: true }], fields: [{ name: "account_code", label: "Account Code", type: "text", required: true }, { name: "account_name", label: "Account Name", type: "text", required: true }, { name: "account_type", label: "Type", type: "text" }] },
  { key: "provinces", table: "provinces", label: "Provinces", select: "*", order: "name", columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "region", label: "Region" }, { key: "is_active", label: "Status", badge: true }], fields: [baseFields.code, baseFields.name, { name: "region", label: "Region", type: "text" }] },
  { key: "budget_activity_templates", table: "budget_activity_templates", label: "Activity References", select: "id, code, name, description, default_line_item_description, default_business_justification, department_id, section_id, financial_year, sort_order, is_active, department:departments(name), section:sections(name)", order: "sort_order", columns: [{ key: "code", label: "Activity Ref." }, { key: "name", label: "Activity Name" }, { key: "department.name", label: "Department" }, { key: "section.name", label: "Section" }, { key: "financial_year", label: "FY" }, { key: "is_active", label: "Status", badge: true }], fields: [baseFields.code, baseFields.name, baseFields.description, { name: "default_line_item_description", label: "Default Line Description", type: "text" }, { name: "default_business_justification", label: "Default Justification", type: "text" }, { name: "department_id", label: "Department", type: "select", optionsKey: "departments" }, { name: "section_id", label: "Section", type: "select", optionsKey: "sections", dependsOn: "department_id" }, { name: "financial_year", label: "Financial Year", type: "number" }, baseFields.sortOrder] },
  { key: "units_of_measure", table: "units_of_measure", label: "Units of Measure", select: "*", order: "sort_order", columns: [{ key: "code", label: "Unit Code" }, { key: "name", label: "Unit Name" }, { key: "description", label: "Description" }, { key: "is_active", label: "Status", badge: true }], fields: [baseFields.code, baseFields.name, baseFields.description, baseFields.sortOrder] },
  { key: "priority_levels", table: "priority_levels", label: "Priorities", select: "*", order: "sort_order", columns: [{ key: "code", label: "Priority Code" }, { key: "name", label: "Priority Name" }, { key: "description", label: "Description" }, { key: "sort_order", label: "Rank" }, { key: "is_active", label: "Status", badge: true }], fields: [baseFields.code, baseFields.name, baseFields.description, baseFields.sortOrder] },
  { key: "procurement_methods", table: "procurement_methods", label: "Procurement Methods", select: "*", order: "sort_order", columns: [{ key: "code", label: "Method Code" }, { key: "name", label: "Method Name" }, { key: "threshold_from", label: "From" }, { key: "threshold_to", label: "To" }, { key: "currency", label: "Currency" }, { key: "is_active", label: "Status", badge: true }], fields: [baseFields.code, baseFields.name, baseFields.description, { name: "threshold_from", label: "Threshold From", type: "number" }, { name: "threshold_to", label: "Threshold To", type: "number" }, { name: "currency", label: "Currency", type: "text" }, { name: "effective_from", label: "Effective From", type: "date" }, { name: "effective_to", label: "Effective To", type: "date" }, baseFields.sortOrder] },
]

function getValue(row: Row, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), row)
}

export default function MasterDataPage() {
  const { can, profile } = useAuth()
  const canEdit = can("masterdata.manage") || can("registry.manage") || can("users.manage")
  const [active, setActive] = useState(0)
  const [rows, setRows] = useState<Row[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingRow, setEditingRow] = useState<Row | null>(null)
  const [viewRow, setViewRow] = useState<Row | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ACTIVE")
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [sources, setSources] = useState<Record<SourceKey, Opt[]>>({ departments: [], sections: [], cost_centres: [], expense_categories: [], expense_items: [], units_of_measure: [] })
  const tab = TABS[active]

  const loadSources = useCallback(async () => {
    const [d, s, cc, ec, ei, uom] = await Promise.all([
      supabase.from("departments").select("id, code, name").eq("is_active", true).order("name"),
      supabase.from("sections").select("id, code, name, department_id").eq("is_active", true).order("name"),
      supabase.from("cost_centres").select("id, code, name, section_id, department_id").eq("is_active", true).order("code"),
      supabase.from("expense_categories").select("id, code, name").eq("is_active", true).order("name"),
      supabase.from("expense_items").select("id, code, name, expense_category_id").eq("is_active", true).order("code"),
      supabase.from("units_of_measure").select("id, code, name").eq("is_active", true).order("sort_order"),
    ])
    setSources({ departments: (d.data || []) as Opt[], sections: (s.data || []) as Opt[], cost_centres: (cc.data || []) as Opt[], expense_categories: (ec.data || []) as Opt[], expense_items: (ei.data || []) as Opt[], units_of_measure: (uom.data || []) as Opt[] })
  }, [])

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase.from(tab.table).select(tab.select).order(tab.order)
      if (statusFilter === "ACTIVE") query = query.eq("is_active", true)
      if (statusFilter === "INACTIVE") query = query.eq("is_active", false)
      const { data, error: fetchError } = await query
      if (fetchError) throw fetchError
      setRows((data || []) as unknown as Row[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load master data.")
    } finally {
      setLoading(false)
    }
  }, [tab.table, tab.select, tab.order, statusFilter])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSources()
  }, [loadSources])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRows()
    setShowAdd(false)
    setEditingRow(null)
    setViewRow(null)
    setForm({})
    setPage(1)
  }, [fetchRows])

  useEffect(() => {
    async function loadCounts() {
      const entries = await Promise.all(TABS.map(async (t) => {
        const { count } = await supabase.from(t.table).select("id", { count: "exact", head: true })
        return [t.key, count || 0] as const
      }))
      setCounts(Object.fromEntries(entries))
    }
    loadCounts()
  }, [rows])

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) => tab.columns.some((column) => String(getValue(row, column.key) ?? "").toLowerCase().includes(needle)))
  }, [rows, search, tab.columns])
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const audit = async (action: string, rowId: string | null, oldValues: unknown, newValues: unknown) => {
    try {
      await supabase.from("audit_logs").insert({ user_id: profile?.id || null, user_email: profile?.email || null, user_name: profile?.name || null, action, entity_type: "MASTER_DATA", entity_id: rowId, entity_reference: tab.table, old_values: oldValues || null, new_values: newValues || null, metadata: { table: tab.table, tab: tab.key } })
    } catch (err) {
      console.warn("Master data audit failed:", err)
    }
  }

  const buildPayload = () => {
    const payload: Record<string, string | number> = {}
    for (const f of tab.fields) {
      if (f.required && !form[f.name]) throw new Error(`${f.label} is required`)
      if (form[f.name]) payload[f.name] = f.type === "number" ? Number(form[f.name]) : form[f.name]
    }
    return payload
  }

  const reload = () => { fetchRows(); loadSources() }

  const handleAdd = async () => {
    setSaving(true); setError(""); setSuccess("")
    try {
      const payload = buildPayload()
      const { data, error: insErr } = await supabase.from(tab.table).insert({ ...payload, is_active: true }).select("*").single()
      if (insErr) throw insErr
      await audit("MASTER_DATA_CREATED", data?.id ? String(data.id) : null, null, data)
      setSuccess(`${tab.label} added.`)
      setForm({}); setShowAdd(false); reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add record.")
    } finally { setSaving(false) }
  }

  const openEdit = (row: Row) => {
    const next: Record<string, string> = {}
    for (const f of tab.fields) next[f.name] = getValue(row, f.name) === null || getValue(row, f.name) === undefined ? "" : String(getValue(row, f.name))
    setForm(next); setEditingRow(row); setShowAdd(false); setViewRow(null); setError(""); setSuccess("")
  }

  const handleUpdate = async () => {
    if (!editingRow?.id) return
    setSaving(true); setError(""); setSuccess("")
    try {
      const payload = buildPayload()
      const { data, error: updErr } = await supabase.from(tab.table).update(payload).eq("id", String(editingRow.id)).select("*").single()
      if (updErr) throw updErr
      await audit("MASTER_DATA_UPDATED", String(editingRow.id), editingRow, data)
      setSuccess(`${tab.label} updated.`)
      setForm({}); setEditingRow(null); reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update record.")
    } finally { setSaving(false) }
  }

  const toggleActive = async (row: Row) => {
    if (!row.id) return
    setSaving(true); setError(""); setSuccess("")
    try {
      const next = !(row.is_active !== false)
      const { data, error: updErr } = await supabase.from(tab.table).update({ is_active: next }).eq("id", String(row.id)).select("*").single()
      if (updErr) throw updErr
      await audit(next ? "MASTER_DATA_ACTIVATED" : "MASTER_DATA_DEACTIVATED", String(row.id), row, data)
      setSuccess(`${tab.label} ${next ? "activated" : "deactivated"}.`)
      reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update status.")
    } finally { setSaving(false) }
  }

  const deleteRow = async (row: Row) => {
    if (!row.id) return
    if (!confirm(`Delete this ${tab.label.toLowerCase()} record? If it is used by transactions, it will be deactivated instead.`)) return
    setSaving(true); setError(""); setSuccess("")
    try {
      const { error: delErr } = await supabase.from(tab.table).delete().eq("id", String(row.id))
      if (delErr) {
        const { data, error: deactivateErr } = await supabase.from(tab.table).update({ is_active: false }).eq("id", String(row.id)).select("*").single()
        if (deactivateErr) throw deactivateErr
        await audit("MASTER_DATA_DELETE_BLOCKED_DEACTIVATED", String(row.id), row, data)
        setSuccess("This record is already referenced by existing transactions and cannot be permanently deleted. It has been deactivated instead.")
      } else {
        await audit("MASTER_DATA_DELETED", String(row.id), row, null)
        setSuccess(`${tab.label} deleted.`)
      }
      reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete/deactivate record.")
    } finally { setSaving(false) }
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><FolderOpen className="h-7 w-7 text-png-red" /> Ledger / Reference Data</h1>
          <p className="mt-1 text-slate-600">Central master-data administration for ledger, reference, and budget lookup values</p>
        </div>
        {canEdit && tab.fields.length > 0 && <button onClick={() => { setShowAdd((s) => !s); setEditingRow(null); setViewRow(null); setError(""); setSuccess("") }} className="flex items-center gap-2 rounded-lg bg-png-red px-4 py-2 font-medium text-white hover:bg-png-maroon"><Plus className="h-4 w-4" /> Add New</button>}
      </div>

      {success && <Notice tone="green" text={success} />}
      {error && <Notice tone="red" text={error} />}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-1"><div className="flex min-w-max gap-1">{TABS.map((t, i) => <button key={t.key} onClick={() => setActive(i)} className={`flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${i === active ? "border-png-gold/40 bg-png-red/10 text-png-red" : "border-transparent text-slate-600 hover:bg-slate-100"}`}>{t.label}<span className={`rounded-full px-1.5 py-0.5 text-xs ${i === active ? "bg-png-red/15 text-png-red" : "bg-slate-200 text-slate-600"}`}>{counts[t.key] ?? "·"}</span></button>)}</div></div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between"><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder={`Search ${tab.label.toLowerCase()}...`} className="min-w-[260px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red" /><select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red"><option value="ACTIVE">Active only</option><option value="INACTIVE">Inactive only</option><option value="ALL">All records</option></select></div>

      {tab.builder && can("registry.manage") && <CodeBuilder sources={sources} onCreated={reload} />}
      {(showAdd || editingRow) && canEdit && tab.fields.length > 0 && <MasterForm tab={tab} form={form} setForm={setForm} optionsFor={optionsFor} saving={saving} editing={Boolean(editingRow)} onClose={() => { setShowAdd(false); setEditingRow(null); setForm({}) }} onSubmit={editingRow ? handleUpdate : handleAdd} />}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">{loading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div> : filteredRows.length === 0 ? <div className="py-16 text-center text-slate-500">No {tab.label.toLowerCase()} found.</div> : <><div className="overflow-x-auto"><table className="w-full"><thead className="border-b border-slate-200 bg-slate-50"><tr>{tab.columns.map((c) => <th key={c.key} className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-700">{c.label}</th>)}<th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-700">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{pagedRows.map((row, idx) => <tr key={idx} className="hover:bg-slate-50">{tab.columns.map((c) => <td key={c.key} className="px-4 py-3 text-sm text-slate-700"><CellValue row={row} column={c} /></td>)}<td className="px-4 py-3 text-right"><div className="flex justify-end gap-1"><button onClick={() => setViewRow(row)} className="rounded p-1.5 text-slate-600 hover:bg-slate-100" title="View"><Eye className="h-4 w-4" /></button>{canEdit && <><button onClick={() => openEdit(row)} className="rounded p-1.5 text-slate-600 hover:bg-slate-100" title="Edit"><Pencil className="h-4 w-4" /></button><button onClick={() => toggleActive(row)} className="rounded p-1.5 text-amber-700 hover:bg-amber-50" title={row.is_active !== false ? "Deactivate" : "Activate"}><Power className="h-4 w-4" /></button><button onClick={() => deleteRow(row)} className="rounded p-1.5 text-red-700 hover:bg-red-50" title="Delete"><Trash2 className="h-4 w-4" /></button></>}</div></td></tr>)}</tbody></table></div><div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600"><span>Showing {pagedRows.length} of {filteredRows.length} records</span><div className="flex items-center gap-2"><button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-50">Previous</button><span>Page {currentPage} of {totalPages}</span><button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-50">Next</button></div></div></>}</div>

      {viewRow && <ViewModal tab={tab} row={viewRow} onClose={() => setViewRow(null)} />}
    </div>
  )
}

function CellValue({ row, column }: { row: Row; column: Column }) {
  const value = getValue(row, column.key)
  if (column.badge) return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${value ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{value ? "Active" : "Inactive"}</span>
  if (column.key === "full_expense_code") return <span className="font-mono font-medium text-png-red">{String(value ?? "-")}</span>
  return value === null || value === undefined || value === "" ? "-" : String(value)
}

function Notice({ tone, text }: { tone: "green" | "red"; text: string }) {
  return <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${tone === "green" ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}`}>{tone === "green" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {text}</div>
}

function MasterForm({ tab, form, setForm, optionsFor, saving, editing, onClose, onSubmit }: { tab: TabConfig; form: Record<string, string>; setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>; optionsFor: (field: Field) => Opt[]; saving: boolean; editing: boolean; onClose: () => void; onSubmit: () => void }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-slate-900">{editing ? `Edit ${tab.label}` : `Add ${tab.label}`}</h3><button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4 text-slate-500" /></button></div><div className="grid gap-3 md:grid-cols-3">{tab.fields.map((field) => <div key={field.name}><label className="mb-1 block text-sm font-medium text-slate-700">{field.label} {field.required && <span className="text-png-red">*</span>}</label>{field.type === "select" ? <select value={form[field.name] || ""} onChange={(e) => setForm((current) => ({ ...current, [field.name]: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red"><option value="">Select...</option>{optionsFor(field).map((option) => <option key={option.id} value={option.id}>{option.code ? `${option.code} — ${option.name}` : option.name}</option>)}</select> : <input type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={form[field.name] || ""} onChange={(e) => setForm((current) => ({ ...current, [field.name]: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red" />}</div>)}</div><div className="mt-4 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={onSubmit} disabled={saving} className="flex items-center gap-2 rounded-lg bg-png-red px-4 py-2 text-sm font-medium text-white hover:bg-png-maroon disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {editing ? "Save Changes" : "Save"}</button></div></div>
}

function ViewModal({ tab, row, onClose }: { tab: TabConfig; row: Row; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl"><div className="flex items-center justify-between border-b border-slate-200 p-4"><h3 className="font-semibold text-slate-900">View {tab.label}</h3><button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button></div><div className="grid gap-3 p-4 md:grid-cols-2">{tab.columns.map((column) => <div key={column.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{column.label}</p><p className="mt-1 text-sm text-slate-900">{String(getValue(row, column.key) ?? "-")}</p></div>)}</div></div></div>
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
  const preview = [codeOf(sources.departments, dept) || "DEPT", codeOf(sources.cost_centres, cc) || "CC", codeOf(sources.expense_categories, cat) || "CAT", codeOf(sources.expense_items, item) || "ITEM"].join("-").toUpperCase()
  const ready = dept && cc && cat && item
  const create = async () => {
    setSaving(true); setError(""); setSuccess("")
    try {
      const section_id = sources.cost_centres.find((c) => c.id === cc)?.section_id || null
      const { error: insErr } = await supabase.from("expense_code_registry").insert({ department_id: dept, cost_centre_id: cc, expense_category_id: cat, expense_item_id: item, section_id, description: desc || null, financial_year: new Date().getFullYear(), full_expense_code: "PENDING" })
      if (insErr) throw insErr
      setSuccess(`Code ${preview} created.`); setCc(""); setItem(""); setDesc(""); onCreated()
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to create code.") } finally { setSaving(false) }
  }
  return <div className="rounded-lg border border-png-gold/40 bg-white p-5"><h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-900"><Hash className="h-4 w-4 text-png-gold" /> Build Expense Code</h3><p className="mb-4 text-xs text-slate-500">Combine Department · Cost Centre · Category · Item. The full code is generated automatically.</p>{success && <Notice tone="green" text={success} />}{error && <Notice tone="red" text={error} />}<div className="mt-3 grid gap-3 md:grid-cols-4"><Picker label="Department" value={dept} onChange={(v) => { setDept(v); setCc("") }} options={sources.departments} /><Picker label="Cost Centre" value={cc} onChange={setCc} options={ccOptions} disabled={!dept} /><Picker label="Category" value={cat} onChange={(v) => { setCat(v); setItem("") }} options={sources.expense_categories} /><Picker label="Item" value={item} onChange={setItem} options={itemOptions} disabled={!cat} /></div><div className="mt-3 flex flex-wrap items-end justify-between gap-3"><div className="flex items-center gap-3"><div><label className="mb-1 block text-xs font-medium text-slate-500">Generated code</label><span className="rounded-lg border border-png-gold/40 bg-png-red/5 px-3 py-1.5 font-mono text-lg font-bold text-png-red">{preview}</span></div><input placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red" /></div><button onClick={create} disabled={!ready || saving} className="flex items-center gap-2 rounded-lg bg-png-red px-4 py-2 text-sm font-medium text-white hover:bg-png-maroon disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create Code</button></div></div>
}

function Picker({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (v: string) => void; options: Opt[]; disabled?: boolean }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-500">{label}</label><select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red disabled:bg-slate-100"><option value="">Select...</option>{options.map((o) => <option key={o.id} value={o.id}>{o.code ? `${o.code} — ${o.name}` : o.name}</option>)}</select></div>
}
