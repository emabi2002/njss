"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  Loader2,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { supabase } from "@/lib/supabase"
import {
  deactivateFinancePostingMapping,
  getBudgetActivationMappingWorklist,
  getFinancePostingMappings,
  saveFinancePostingMapping,
  type BudgetActivationMappingWorklistRow,
  type FinancePostingMapping,
} from "@/lib/finance-posting-mapping"

type Ledger = { id: string; finance_code: string; standard_description: string }
type PostingCode = {
  id: string
  full_expense_code: string
  description: string | null
  department_id: string | null
  section_id: string | null
  cost_centre_id: string | null
  expense_category_id: string | null
  expense_item_id: string | null
  financial_year: number | null
}
type Account = { id: string; account_code: string; account_name: string }
type NamedCode = { id: string; code: string; name: string; department_id?: string | null; section_id?: string | null }

type FormState = {
  mappingId: string | null
  financialYear: string
  expenseLedgerId: string
  expenseCodeRegistryId: string
  chartOfAccountId: string
  departmentId: string
  sectionId: string
  costCentreId: string
  mappingNotes: string
}

const emptyForm: FormState = {
  mappingId: null,
  financialYear: "",
  expenseLedgerId: "",
  expenseCodeRegistryId: "",
  chartOfAccountId: "",
  departmentId: "",
  sectionId: "",
  costCentreId: "",
  mappingNotes: "",
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    READY: "Ready",
    MAPPING_REQUIRED: "Mapping Required",
    COST_CENTRE_REQUIRED: "Cost Centre Required",
    COST_CENTRE_INACTIVE: "Cost Centre Inactive",
    POSTING_CODE_INACTIVE: "Posting Code Inactive",
    CHART_ACCOUNT_INACTIVE: "Chart Account Inactive",
    INACTIVE: "Inactive",
    INACTIVE_REFERENCE: "Inactive Reference",
    SCOPE_MISMATCH: "Scope Mismatch",
    FINANCE_CODE_MISSING: "Finance Code Missing",
    POSTING_CODE_MISSING: "Posting Code Missing",
    CHART_ACCOUNT_MISSING: "Chart Account Missing",
    COST_CENTRE_MISSING: "Cost Centre Missing",
    AMBIGUOUS_MAPPING: "Ambiguous Mapping",
  }
  return labels[status] || status.replaceAll("_", " ")
}

function statusClass(status: string) {
  if (status === "READY") return "bg-emerald-100 text-emerald-700"
  if (status === "INACTIVE") return "bg-slate-100 text-slate-600"
  if (["INACTIVE_REFERENCE", "SCOPE_MISMATCH", "COST_CENTRE_INACTIVE", "POSTING_CODE_INACTIVE", "CHART_ACCOUNT_INACTIVE"].includes(status)) return "bg-red-100 text-red-700"
  return "bg-amber-100 text-amber-700"
}

function money(value: number) {
  return new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK" }).format(Number(value || 0))
}

export default function FinanceMappingPage() {
  const { roles, can } = useAuth()
  const isSystemAdministrator = roles.includes("System Administrator")
  const canManage = isSystemAdministrator && (can("masterdata.manage") || can("registry.manage") || can("all"))

  const [mappings, setMappings] = useState<FinancePostingMapping[]>([])
  const [worklist, setWorklist] = useState<BudgetActivationMappingWorklistRow[]>([])
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [postingCodes, setPostingCodes] = useState<PostingCode[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [departments, setDepartments] = useState<NamedCode[]>([])
  const [sections, setSections] = useState<NamedCode[]>([])
  const [costCentres, setCostCentres] = useState<NamedCode[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deactivationReason, setDeactivationReason] = useState("")
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const [mappingRows, worklistRows, ledgerResult, postingResult, accountResult, departmentResult, sectionResult, costCentreResult] = await Promise.all([
        getFinancePostingMappings(),
        getBudgetActivationMappingWorklist(),
        supabase.from("expense_ledger").select("id, finance_code, standard_description").eq("is_active", true).eq("is_posting", true).order("finance_code"),
        supabase.from("expense_code_registry").select("id, full_expense_code, description, department_id, section_id, cost_centre_id, expense_category_id, expense_item_id, financial_year").eq("is_active", true).order("full_expense_code"),
        supabase.from("chart_of_accounts").select("id, account_code, account_name").eq("is_active", true).order("account_code"),
        supabase.from("departments").select("id, code, name").eq("is_active", true).order("code"),
        supabase.from("sections").select("id, code, name, department_id").eq("is_active", true).order("code"),
        supabase.from("cost_centres").select("id, code, name, department_id, section_id").eq("is_active", true).order("code"),
      ])
      for (const result of [ledgerResult, postingResult, accountResult, departmentResult, sectionResult, costCentreResult]) {
        if (result.error) throw result.error
      }
      setMappings(mappingRows)
      setWorklist(worklistRows)
      setLedgers((ledgerResult.data || []) as Ledger[])
      setPostingCodes((postingResult.data || []) as PostingCode[])
      setAccounts((accountResult.data || []) as Account[])
      setDepartments((departmentResult.data || []) as NamedCode[])
      setSections((sectionResult.data || []) as NamedCode[])
      setCostCentres((costCentreResult.data || []) as NamedCode[])
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not load canonical Finance mapping data." })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const needle = search.trim().toLowerCase()
  const visibleMappings = useMemo(() => {
    if (!needle) return mappings
    return mappings.filter((row) => [
      row.finance_code, row.finance_description, row.department_code, row.department_name,
      row.section_code, row.section_name, row.cost_centre_code, row.cost_centre_name,
      row.expense_category_code, row.expense_category_name, row.expense_item_code,
      row.expense_item_name, row.posting_code, row.chart_account_code, row.chart_account_name,
      statusLabel(row.mapping_status),
    ].some((value) => String(value || "").toLowerCase().includes(needle)))
  }, [mappings, needle])

  const visibleWorklist = useMemo(() => {
    if (!needle) return worklist
    return worklist.filter((row) => [
      row.submission_number, row.division_code, row.division_name, row.finance_code,
      row.finance_description, row.finance_expense_category, row.cost_centre_code,
      row.cost_centre_name, row.legacy_posting_code, row.canonical_posting_code,
      row.chart_account_code, row.chart_account_name, statusLabel(row.mapping_status),
    ].some((value) => String(value || "").toLowerCase().includes(needle)))
  }, [worklist, needle])

  const pendingCount = worklist.filter((row) => row.mapping_status !== "READY").length
  const readyCount = worklist.length - pendingCount
  const approvedTotal = worklist.reduce((sum, row) => sum + Number(row.annual_estimate || 0), 0)

  const selectedPosting = postingCodes.find((row) => row.id === form.expenseCodeRegistryId) || null
  const filteredSections = sections.filter((row) => !form.departmentId || row.department_id === form.departmentId)
  const filteredCostCentres = costCentres.filter((row) => {
    if (form.departmentId && row.department_id !== form.departmentId) return false
    if (form.sectionId && row.section_id && row.section_id !== form.sectionId) return false
    return true
  })
  const filteredPostings = postingCodes.filter((row) => {
    if (form.departmentId && row.department_id !== form.departmentId) return false
    if (form.costCentreId && row.cost_centre_id !== form.costCentreId) return false
    if (form.sectionId && row.section_id && row.section_id !== form.sectionId) return false
    return true
  })

  const edit = (row: FinancePostingMapping) => {
    setForm({
      mappingId: row.id,
      financialYear: row.financial_year ? String(row.financial_year) : "",
      expenseLedgerId: row.expense_ledger_id,
      expenseCodeRegistryId: row.expense_code_registry_id,
      chartOfAccountId: row.chart_of_account_id,
      departmentId: row.department_id,
      sectionId: row.section_id || "",
      costCentreId: row.cost_centre_id,
      mappingNotes: row.mapping_notes || "",
    })
    setDeactivationReason("")
    setMessage(null)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const useContext = (row: BudgetActivationMappingWorklistRow) => {
    setForm({
      mappingId: row.canonical_mapping_id,
      financialYear: String(row.financial_year),
      expenseLedgerId: row.expense_ledger_id,
      expenseCodeRegistryId: row.canonical_posting_code_id || "",
      chartOfAccountId: row.chart_of_account_id || "",
      departmentId: row.department_id || "",
      sectionId: row.section_id || "",
      costCentreId: row.cost_centre_id || "",
      mappingNotes: `Task 9 activation mapping for ${row.submission_number}, line ${row.line_number}`,
    })
    setMessage({ type: "ok", text: "Budget context loaded. Select or create the correct active Posting Code and Chart of Accounts before saving." })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const choosePosting = (postingId: string) => {
    const posting = postingCodes.find((row) => row.id === postingId)
    setForm((current) => ({
      ...current,
      expenseCodeRegistryId: postingId,
      departmentId: posting?.department_id || current.departmentId,
      sectionId: posting?.section_id || "",
      costCentreId: posting?.cost_centre_id || current.costCentreId,
      financialYear: posting?.financial_year ? String(posting.financial_year) : current.financialYear,
    }))
  }

  const save = async () => {
    if (!form.expenseLedgerId || !form.expenseCodeRegistryId || !form.chartOfAccountId || !form.departmentId || !form.costCentreId) {
      setMessage({ type: "err", text: "Finance Code, Posting Code, Chart of Accounts, Department and Cost Centre are required." })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      await saveFinancePostingMapping({
        mappingId: form.mappingId,
        financialYear: form.financialYear ? Number(form.financialYear) : null,
        expenseLedgerId: form.expenseLedgerId,
        expenseCodeRegistryId: form.expenseCodeRegistryId,
        chartOfAccountId: form.chartOfAccountId,
        costCentreId: form.costCentreId,
        departmentId: form.departmentId,
        sectionId: form.sectionId || null,
        mappingNotes: form.mappingNotes || null,
      })
      setMessage({ type: "ok", text: "Canonical Finance posting mapping saved. Re-prepare the related approved budget before activation." })
      setForm(emptyForm)
      setDeactivationReason("")
      await load()
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not save the canonical Finance mapping." })
    } finally {
      setSaving(false)
    }
  }

  const deactivate = async () => {
    if (!form.mappingId) return
    if (!deactivationReason.trim()) {
      setMessage({ type: "err", text: "Enter a reason before deactivating the mapping." })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      await deactivateFinancePostingMapping(form.mappingId, deactivationReason)
      setMessage({ type: "ok", text: "Canonical mapping deactivated. Any affected activation must be re-prepared." })
      setForm(emptyForm)
      setDeactivationReason("")
      await load()
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not deactivate the canonical Finance mapping." })
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">Finance Mapping is restricted to the System Administrator.</div>
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#A97C12]"><ShieldCheck className="h-4 w-4" /> System Administration · Finance Master Data</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Finance Mapping</h1>
          <p className="mt-1 max-w-5xl text-sm text-slate-600">Maintain the canonical Finance Code → Posting Code → Chart of Accounts → Cost Centre relationship used by Operational Budget Activation. This screen never changes approved budget amounts.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
      </div>

      {message && <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{message.type === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}<span>{message.text}</span></div>}

      <div className="grid gap-3 md:grid-cols-3">
        <Summary label="Approved mapping contexts" value={String(worklist.length)} />
        <Summary label="Ready / Pending" value={`${readyCount} / ${pendingCount}`} />
        <Summary label="Approved budget represented" value={money(approvedTotal)} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><h2 className="font-semibold text-slate-900">{form.mappingId ? "Edit canonical mapping" : "Create canonical mapping"}</h2><p className="mt-1 text-xs text-slate-500">The technical maker changes master-data mappings only; approved budget lines remain locked.</p></div>
          {form.mappingId && <button type="button" onClick={() => { setForm(emptyForm); setDeactivationReason("") }} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><X className="h-4 w-4" /></button>}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Finance Code"><select value={form.expenseLedgerId} onChange={(e) => setForm((c) => ({ ...c, expenseLedgerId: e.target.value }))} className="input"><option value="">Select...</option>{ledgers.map((row) => <option key={row.id} value={row.id}>{row.finance_code} — {row.standard_description}</option>)}</select></Field>
          <Field label="Department"><select value={form.departmentId} onChange={(e) => setForm((c) => ({ ...c, departmentId: e.target.value, sectionId: "", costCentreId: "", expenseCodeRegistryId: "" }))} className="input"><option value="">Select...</option>{departments.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></Field>
          <Field label="Section"><select value={form.sectionId} onChange={(e) => setForm((c) => ({ ...c, sectionId: e.target.value, costCentreId: "", expenseCodeRegistryId: "" }))} className="input"><option value="">All / not applicable</option>{filteredSections.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></Field>
          <Field label="Cost Centre"><select value={form.costCentreId} onChange={(e) => setForm((c) => ({ ...c, costCentreId: e.target.value, expenseCodeRegistryId: "" }))} className="input"><option value="">Select...</option>{filteredCostCentres.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></Field>
          <Field label="Posting Code"><select value={form.expenseCodeRegistryId} onChange={(e) => choosePosting(e.target.value)} className="input"><option value="">Select active contextual code...</option>{filteredPostings.map((row) => <option key={row.id} value={row.id}>{row.full_expense_code} — {row.description || "No description"}</option>)}</select></Field>
          <Field label="Chart of Accounts"><select value={form.chartOfAccountId} onChange={(e) => setForm((c) => ({ ...c, chartOfAccountId: e.target.value }))} className="input"><option value="">Select...</option>{accounts.map((row) => <option key={row.id} value={row.id}>{row.account_code} — {row.account_name}</option>)}</select></Field>
          <Field label="Financial Year"><input type="number" value={form.financialYear} onChange={(e) => setForm((c) => ({ ...c, financialYear: e.target.value }))} placeholder="Blank = reusable" className="input" /></Field>
          <Field label="Mapping Notes"><input value={form.mappingNotes} onChange={(e) => setForm((c) => ({ ...c, mappingNotes: e.target.value }))} placeholder="Optional control note" className="input" /></Field>
        </div>
        {selectedPosting && <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Selected Posting Code is controlled by Department, Section, Cost Centre, Category and Expense Item. The server will reject any inconsistent mapping.</div>}
        <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 lg:flex-row lg:items-end lg:justify-between">
          {form.mappingId ? <Field label="Deactivation reason"><input value={deactivationReason} onChange={(e) => setDeactivationReason(e.target.value)} placeholder="Required only to deactivate" className="input min-w-[320px]" /></Field> : <span className="text-xs text-slate-500">No default account or silent mapping is permitted.</span>}
          <div className="flex gap-2">
            {form.mappingId && <button type="button" onClick={deactivate} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"><Trash2 className="h-4 w-4" /> Deactivate</button>}
            <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#132A44] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1C3B5A] disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Mapping</button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-semibold text-amber-950">Required Budget Mappings</h2><p className="text-xs text-amber-800">One row per approved budget line context. A row remains blocked until its exact contextual Posting Code and Chart of Accounts mapping is approved.</p></div>
          <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Finance, Division, Cost Centre..." className="rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" /></div>
        </div>
        {loading ? <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-[#132A44]" /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[1500px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Submission / Line</th><th className="px-3 py-3">Division</th><th className="px-3 py-3">Finance Code</th><th className="px-3 py-3">Finance Description</th><th className="px-3 py-3">Cost Centre</th><th className="px-3 py-3">Legacy Posting Ref</th><th className="px-3 py-3">Canonical Posting</th><th className="px-3 py-3">Chart of Accounts</th><th className="px-3 py-3">Amount</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleWorklist.map((row) => <tr key={row.budget_line_id} className="hover:bg-slate-50"><td className="px-3 py-3">{row.submission_number} · {row.line_number}</td><td className="px-3 py-3">{row.division_code} — {row.division_name}</td><td className="px-3 py-3 font-mono font-semibold text-[#8B1E2D]">{row.finance_code}</td><td className="px-3 py-3">{row.finance_description || "—"}</td><td className="px-3 py-3">{row.cost_centre_code ? `${row.cost_centre_code} — ${row.cost_centre_name || ""}` : "—"}</td><td className="px-3 py-3 font-mono">{row.legacy_posting_code || "—"}</td><td className="px-3 py-3 font-mono">{row.canonical_posting_code || "—"}</td><td className="px-3 py-3">{row.chart_account_code ? `${row.chart_account_code} — ${row.chart_account_name || ""}` : "—"}</td><td className="px-3 py-3 font-semibold">{money(row.annual_estimate)}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(row.mapping_status)}`}>{statusLabel(row.mapping_status)}</span></td><td className="px-3 py-3"><button type="button" onClick={() => useContext(row)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Use Context</button></td></tr>)}</tbody></table>{visibleWorklist.length === 0 && <div className="py-10 text-center text-sm text-slate-500">No required mapping rows match the current search.</div>}</div>}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4"><h2 className="font-semibold text-slate-900">Canonical Finance mapping register</h2><p className="text-xs text-slate-500">Ready means all Finance, Posting, CoA and organisational references are active and scope-consistent.</p></div>
        {loading ? <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-[#132A44]" /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[1900px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Finance Code</th><th className="px-3 py-3">Finance Description</th><th className="px-3 py-3">Department</th><th className="px-3 py-3">Section</th><th className="px-3 py-3">Cost Centre</th><th className="px-3 py-3">Category</th><th className="px-3 py-3">Expense Item</th><th className="px-3 py-3">Posting Code</th><th className="px-3 py-3">Chart of Accounts</th><th className="px-3 py-3">Financial Year</th><th className="px-3 py-3">Mapping Status</th><th className="px-3 py-3">Last Updated By</th><th className="px-3 py-3">Last Updated At</th><th className="px-3 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleMappings.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="px-3 py-3 font-mono font-semibold text-[#8B1E2D]">{row.finance_code}</td><td className="px-3 py-3">{row.finance_description || "—"}</td><td className="px-3 py-3">{row.department_code} — {row.department_name}</td><td className="px-3 py-3">{row.section_code ? `${row.section_code} — ${row.section_name || ""}` : "—"}</td><td className="px-3 py-3">{row.cost_centre_code} — {row.cost_centre_name}</td><td className="px-3 py-3">{row.expense_category_code ? `${row.expense_category_code} — ${row.expense_category_name || ""}` : "—"}</td><td className="px-3 py-3">{row.expense_item_code ? `${row.expense_item_code} — ${row.expense_item_name || ""}` : "—"}</td><td className="px-3 py-3 font-mono">{row.posting_code}</td><td className="px-3 py-3">{row.chart_account_code} — {row.chart_account_name || ""}</td><td className="px-3 py-3">{row.financial_year || "All"}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(row.mapping_status)}`}>{statusLabel(row.mapping_status)}</span></td><td className="px-3 py-3">{row.updated_by_name || "System"}</td><td className="px-3 py-3">{new Date(row.updated_at).toLocaleString("en-GB")}</td><td className="px-3 py-3"><button type="button" onClick={() => edit(row)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Edit3 className="h-3.5 w-3.5" /> Edit</button></td></tr>)}</tbody></table>{visibleMappings.length === 0 && <div className="py-12 text-center text-sm text-slate-500">No canonical mappings match the current search.</div>}</div>}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"><strong>Control:</strong> unresolved or ambiguous accounting classifications remain blocked. The system never selects a default Chart of Accounts record and never activates an approved budget merely because a Finance Code exists.</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-sm font-medium text-slate-700"><span className="mb-1 block">{label}</span>{children}</label>
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-xl font-bold text-slate-900">{value}</div></div>
}
