"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Plus, Save, Send, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { approveFF3 } from "@/lib/api"
import {
  checkHeadOfficeFF3Budget,
  type HeadOfficeFF3BudgetCheck,
  type HeadOfficeFF3BudgetStatus,
} from "@/lib/ff3-simplified-budget"

type Department = { id: string; code: string; name: string }
type Section = { id: string; code: string; name: string; department_id: string }
type Ledger = { id: string; ledger_number: string; finance_code: string; standard_description: string }
type CostCentre = { id: string; code: string; name: string; department_id: string | null; section_id: string | null }
type Project = { id: string; code: string; name: string }
type Province = { id: string; code: string; name: string }
type FundingSource = { id: string; code: string; name: string }
type Unit = { id: string; code: string; name: string }
type Supplier = { id: string; supplier_name: string; supplier_code: string | null }

type ItemRow = {
  item_description: string
  specifications: string
  quantity: number
  unit_of_measure_id: string
  estimated_unit_price: number
}

type QuoteRow = {
  supplier_id: string
  supplier_name: string
  quotation_number: string
  quotation_date: string
  quotation_amount: number
  is_selected: boolean
}

const blankItem = (): ItemRow => ({
  item_description: "",
  specifications: "",
  quantity: 1,
  unit_of_measure_id: "",
  estimated_unit_price: 0,
})

const blankQuote = (): QuoteRow => ({
  supplier_id: "",
  supplier_name: "",
  quotation_number: "",
  quotation_date: "",
  quotation_amount: 0,
  is_selected: false,
})

const money = (value: number) => `K${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const statusLabel = (status: HeadOfficeFF3BudgetStatus) => {
  if (status === "INSUFFICIENT_BUDGET_BLOCKED") return "INSUFFICIENT BUDGET – COMMITMENT BLOCKED"
  if (status === "POSTING_MAPPING_REQUIRED") return "BUDGET AVAILABLE – POSTING MAPPING REQUIRED"
  if (status === "NO_ACTIVE_BUDGET") return "NO ACTIVE APPROVED BUDGET – COMMITMENT BLOCKED"
  if (status === "SUFFICIENT") return "BUDGET SUFFICIENT"
  return "BUDGET NOT CHECKED"
}

export default function SimplifiedHeadOfficeFF3() {
  const router = useRouter()
  const currentYear = new Date().getFullYear()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [departments, setDepartments] = useState<Department[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [costCentres, setCostCentres] = useState<CostCentre[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [provinces, setProvinces] = useState<Province[]>([])
  const [fundingSources, setFundingSources] = useState<FundingSource[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [budgetCheck, setBudgetCheck] = useState<HeadOfficeFF3BudgetCheck | null>(null)
  const [checkingBudget, setCheckingBudget] = useState(false)

  const [form, setForm] = useState({
    financial_year: currentYear,
    department_id: "",
    section_id: "",
    expense_ledger_id: "",
    cost_centre_id: "",
    project_id: "",
    province_id: "",
    funding_source_id: "",
    purpose: "",
    justification: "",
    required_by_date: "",
    urgency_level: "MEDIUM",
    procurement_method: "QUOTATION",
    supplier_not_required: false,
    supplier_not_required_reason: "",
  })
  const [items, setItems] = useState<ItemRow[]>([blankItem()])
  const [quotations, setQuotations] = useState<QuoteRow[]>([blankQuote(), blankQuote(), blankQuote()])

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [d, s, l, c, p, pr, f, u, sp] = await Promise.all([
          supabase.from("departments").select("id, code, name").eq("is_active", true).order("name"),
          supabase.from("sections").select("id, code, name, department_id").eq("is_active", true).order("name"),
          supabase.from("expense_ledger").select("id, ledger_number, finance_code, standard_description").eq("is_active", true).eq("is_posting", true).order("ledger_number"),
          supabase.from("cost_centres").select("id, code, name, department_id, section_id").eq("is_active", true).order("code"),
          supabase.from("projects").select("id, code, name").eq("is_active", true).order("name"),
          supabase.from("provinces").select("id, code, name").eq("is_active", true).order("name"),
          supabase.from("funding_sources").select("id, code, name").eq("is_active", true).order("name"),
          supabase.from("units_of_measure").select("id, code, name").eq("is_active", true).order("name"),
          supabase.from("suppliers").select("id, supplier_name, supplier_code").eq("is_active", true).order("supplier_name"),
        ])
        if (!active) return
        for (const result of [d, s, l, c, p, pr, f, u, sp]) if (result.error) throw result.error
        setDepartments((d.data || []) as Department[])
        setSections((s.data || []) as Section[])
        setLedgers((l.data || []) as Ledger[])
        setCostCentres((c.data || []) as CostCentre[])
        setProjects((p.data || []) as Project[])
        setProvinces((pr.data || []) as Province[])
        setFundingSources((f.data || []) as FundingSource[])
        setUnits((u.data || []) as Unit[])
        setSuppliers((sp.data || []) as Supplier[])
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Unable to load FF3 reference data")
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [])

  const filteredSections = useMemo(
    () => sections.filter((row) => row.department_id === form.department_id),
    [sections, form.department_id],
  )
  const filteredCostCentres = useMemo(
    () => costCentres.filter((row) =>
      (!row.department_id || row.department_id === form.department_id) &&
      (!row.section_id || row.section_id === form.section_id)),
    [costCentres, form.department_id, form.section_id],
  )

  const validItems = useMemo(
    () => items.filter((row) => row.item_description.trim() && row.quantity > 0 && row.estimated_unit_price >= 0),
    [items],
  )
  const totalEstimate = useMemo(
    () => validItems.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.estimated_unit_price || 0), 0),
    [validItems],
  )
  const validQuotes = useMemo(
    () => quotations.filter((row) => row.supplier_name.trim() && Number(row.quotation_amount) > 0),
    [quotations],
  )
  const selectedQuote = quotations.find((row) => row.is_selected)

  useEffect(() => {
    let active = true
    const canCheck = Boolean(form.department_id && form.section_id && form.expense_ledger_id && totalEstimate > 0)
    if (!canCheck) {
      setBudgetCheck(null)
      return () => { active = false }
    }
    setCheckingBudget(true)
    const timer = window.setTimeout(async () => {
      try {
        const result = await checkHeadOfficeFF3Budget({
          financialYear: form.financial_year,
          departmentId: form.department_id,
          sectionId: form.section_id,
          expenseLedgerId: form.expense_ledger_id,
          costCentreId: form.cost_centre_id || null,
          amount: totalEstimate,
        })
        if (active) setBudgetCheck(result)
      } catch (e) {
        if (active) {
          setBudgetCheck(null)
          setError(e instanceof Error ? e.message : "Unable to check the budget position")
        }
      } finally {
        if (active) setCheckingBudget(false)
      }
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [form.financial_year, form.department_id, form.section_id, form.expense_ledger_id, form.cost_centre_id, totalEstimate])

  const canSubmit = Boolean(
    form.department_id &&
    form.section_id &&
    form.expense_ledger_id &&
    form.purpose.trim() &&
    form.justification.trim() &&
    validItems.length > 0 &&
    (form.supplier_not_required || (validQuotes.length >= 3 && selectedQuote?.supplier_name)),
  )

  const changeItem = (index: number, patch: Partial<ItemRow>) => {
    setItems((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row))
  }
  const changeQuote = (index: number, patch: Partial<QuoteRow>) => {
    setQuotations((current) => current.map((row, i) => {
      if (i === index) return { ...row, ...patch }
      if (patch.is_selected) return { ...row, is_selected: false }
      return row
    }))
  }

  async function save(mode: "DRAFT" | "SUBMITTED") {
    setError("")
    setSuccess("")
    if (mode === "SUBMITTED" && !canSubmit) {
      setError("Complete the Division, Section, Ledger, request details, line items and quotation requirements before submission.")
      return
    }
    if (!form.department_id || !form.section_id || !form.expense_ledger_id) {
      setError("Financial Year, Division, Section and Ledger are required.")
      return
    }
    if (validItems.length === 0) {
      setError("Add at least one valid requisition line item.")
      return
    }

    setSaving(true)
    try {
      let position = budgetCheck
      if (totalEstimate > 0) {
        position = await checkHeadOfficeFF3Budget({
          financialYear: form.financial_year,
          departmentId: form.department_id,
          sectionId: form.section_id,
          expenseLedgerId: form.expense_ledger_id,
          costCentreId: form.cost_centre_id || null,
          amount: totalEstimate,
        })
        setBudgetCheck(position)
      }

      const { data: header, error: headerError } = await supabase
        .from("ff3_headers")
        .insert({
          financial_year: form.financial_year,
          department_id: form.department_id,
          section_id: form.section_id,
          expense_ledger_id: form.expense_ledger_id,
          cost_centre_id: form.cost_centre_id || null,
          project_id: form.project_id || null,
          province_id: form.province_id || null,
          funding_source_id: form.funding_source_id || null,
          purpose: form.purpose.trim(),
          justification: form.justification.trim(),
          required_by_date: form.required_by_date || null,
          urgency_level: form.urgency_level,
          procurement_method: form.procurement_method,
          status: "DRAFT",
          selected_supplier_id: form.supplier_not_required ? null : selectedQuote?.supplier_id || null,
          selected_supplier_name: form.supplier_not_required ? null : selectedQuote?.supplier_name || null,
          supplier_not_required: form.supplier_not_required,
          supplier_not_required_reason: form.supplier_not_required ? form.supplier_not_required_reason.trim() || null : null,
          total_estimated_amount: totalEstimate,
          budget_control_status: position?.status || "NOT_CHECKED",
          budget_current_approved_snapshot: position?.currentApprovedBudget ?? null,
          budget_available_snapshot: position?.availableBudget ?? null,
          budget_shortfall: position?.shortfall ?? null,
          budget_checked_at: position ? new Date().toISOString() : null,
          is_within_budget: position?.status === "SUFFICIENT" || position?.status === "POSTING_MAPPING_REQUIRED",
          budget_mapping_status: position?.postingMappingCount === 1 ? "RESOLVED" : "BUDGET_MAPPING_REQUIRED",
        })
        .select("id, ff3_number")
        .single()
      if (headerError) throw headerError

      const { error: itemsError } = await supabase.from("ff3_items").insert(validItems.map((row, index) => ({
        ff3_header_id: header.id,
        line_number: index + 1,
        item_description: row.item_description.trim(),
        specifications: row.specifications.trim() || null,
        quantity: Number(row.quantity),
        unit_of_measure_id: row.unit_of_measure_id || null,
        estimated_unit_price: Number(row.estimated_unit_price),
      })))
      if (itemsError) throw itemsError

      if (validQuotes.length > 0) {
        const { error: quoteError } = await supabase.from("ff3_quotations").insert(validQuotes.map((row) => ({
          ff3_header_id: header.id,
          supplier_id: row.supplier_id || null,
          supplier_name: row.supplier_name.trim(),
          quotation_number: row.quotation_number.trim() || null,
          quotation_date: row.quotation_date || null,
          quotation_amount: Number(row.quotation_amount),
          is_selected: row.is_selected,
        })))
        if (quoteError) throw quoteError
      }

      if (mode === "SUBMITTED") {
        await approveFF3(header.id, "SUBMIT", "Submitted from direct-ledger Head Office FF3 workspace")
      }

      setSuccess(`FF3 ${header.ff3_number} ${mode === "SUBMITTED" ? "submitted for managerial review" : "saved as draft"}.`)
      window.setTimeout(() => router.push(`/dashboard/ff3/${header.ff3_number}`), 900)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save the FF3")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/ff3" className="rounded-lg p-2 hover:bg-slate-100"><ArrowLeft className="h-5 w-5" /></Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">New FF3 Requisition</h1>
          <p className="text-sm text-slate-600">Head Office budget authority: Financial Year + Division + Section + Ledger</p>
        </div>
      </div>

      {error && <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800"><AlertCircle className="h-5 w-5 shrink-0" /><span>{error}</span></div>}
      {success && <div className="flex gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800"><CheckCircle2 className="h-5 w-5 shrink-0" /><span>{success}</span></div>}

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Budget and Requisition Header</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm font-medium">Financial Year<input className="mt-1 w-full rounded border p-2" type="number" value={form.financial_year} onChange={(e) => setForm({ ...form, financial_year: Number(e.target.value) })} /></label>
          <label className="text-sm font-medium">Division *<select className="mt-1 w-full rounded border p-2" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value, section_id: "", cost_centre_id: "" })}><option value="">Select Division</option>{departments.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
          <label className="text-sm font-medium">Section *<select className="mt-1 w-full rounded border p-2" value={form.section_id} onChange={(e) => setForm({ ...form, section_id: e.target.value, cost_centre_id: "" })} disabled={!form.department_id}><option value="">Select Section</option>{filteredSections.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
          <label className="text-sm font-medium">Expense Ledger *<select className="mt-1 w-full rounded border p-2" value={form.expense_ledger_id} onChange={(e) => setForm({ ...form, expense_ledger_id: e.target.value })}><option value="">Select standard ledger</option>{ledgers.map((row) => <option key={row.id} value={row.id}>{row.ledger_number || row.finance_code} — {row.standard_description}</option>)}</select></label>
          <label className="text-sm font-medium">Cost Centre<select className="mt-1 w-full rounded border p-2" value={form.cost_centre_id} onChange={(e) => setForm({ ...form, cost_centre_id: e.target.value })}><option value="">Optional</option>{filteredCostCentres.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
          <label className="text-sm font-medium">Project<select className="mt-1 w-full rounded border p-2" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}><option value="">Optional</option>{projects.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
          <label className="text-sm font-medium">Province<select className="mt-1 w-full rounded border p-2" value={form.province_id} onChange={(e) => setForm({ ...form, province_id: e.target.value })}><option value="">Optional</option>{provinces.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="text-sm font-medium">Funding Source<select className="mt-1 w-full rounded border p-2" value={form.funding_source_id} onChange={(e) => setForm({ ...form, funding_source_id: e.target.value })}><option value="">Optional</option>{fundingSources.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
          <label className="text-sm font-medium">Required By<input className="mt-1 w-full rounded border p-2" type="date" value={form.required_by_date} onChange={(e) => setForm({ ...form, required_by_date: e.target.value })} /></label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">Purpose *<textarea className="mt-1 w-full rounded border p-2" rows={3} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></label>
          <label className="text-sm font-medium">Justification *<textarea className="mt-1 w-full rounded border p-2" rows={3} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} /></label>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Requisition Items</h2><button type="button" onClick={() => setItems((rows) => [...rows, blankItem()])} className="flex items-center gap-2 rounded border px-3 py-2 text-sm"><Plus className="h-4 w-4" /> Add Item</button></div>
        <div className="space-y-3">{items.map((row, index) => <div key={index} className="grid gap-2 rounded border p-3 md:grid-cols-12">
          <input className="rounded border p-2 md:col-span-4" placeholder="Item description" value={row.item_description} onChange={(e) => changeItem(index, { item_description: e.target.value })} />
          <input className="rounded border p-2 md:col-span-2" placeholder="Specifications" value={row.specifications} onChange={(e) => changeItem(index, { specifications: e.target.value })} />
          <input className="rounded border p-2 md:col-span-1" type="number" min="0" value={row.quantity} onChange={(e) => changeItem(index, { quantity: Number(e.target.value) })} />
          <select className="rounded border p-2 md:col-span-2" value={row.unit_of_measure_id} onChange={(e) => changeItem(index, { unit_of_measure_id: e.target.value })}><option value="">Unit</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>
          <input className="rounded border p-2 md:col-span-2" type="number" min="0" step="0.01" placeholder="Unit price" value={row.estimated_unit_price} onChange={(e) => changeItem(index, { estimated_unit_price: Number(e.target.value) })} />
          <button type="button" className="flex items-center justify-center md:col-span-1" onClick={() => setItems((rows) => rows.length === 1 ? [blankItem()] : rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4 text-red-600" /></button>
        </div>)}</div>
        <div className="mt-4 text-right text-lg font-semibold">This FF3 Request: {money(totalEstimate)}</div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Authoritative Budget Position</h2>
        {checkingBudget ? <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Checking active budget…</div> : budgetCheck ? <>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Metric label="Current Approved Budget" value={budgetCheck.currentApprovedBudget} />
            <Metric label="Outstanding Commitments" value={budgetCheck.outstandingCommitments} />
            <Metric label="Actual Expenditure" value={budgetCheck.actualExpenditure} />
            <Metric label="Available Budget" value={budgetCheck.availableBudget} />
            <Metric label="This FF3 Request" value={budgetCheck.requested} />
            <Metric label="Shortfall" value={budgetCheck.shortfall} />
          </div>
          <div className={`mt-4 rounded-lg border p-4 font-semibold ${budgetCheck.status === "SUFFICIENT" ? "border-green-200 bg-green-50 text-green-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
            {statusLabel(budgetCheck.status)}
            {budgetCheck.status !== "SUFFICIENT" && <p className="mt-1 text-sm font-normal">Managerial review may continue. No financial commitment will be created until the server confirms sufficient budget and a valid posting mapping at final approval.</p>}
          </div>
        </> : <p className="text-sm text-slate-600">Choose a Division, Section and Ledger and enter the request amount to calculate the budget position.</p>}
      </section>

      <section className="rounded-lg border bg-white p-6">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Quotations</h2><button type="button" onClick={() => setQuotations((rows) => [...rows, blankQuote()])} className="flex items-center gap-2 rounded border px-3 py-2 text-sm"><Plus className="h-4 w-4" /> Add Quote</button></div>
        <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.supplier_not_required} onChange={(e) => setForm({ ...form, supplier_not_required: e.target.checked })} /> Supplier/quotations not required for this expenditure</label>
        {form.supplier_not_required ? <textarea className="w-full rounded border p-2" rows={2} placeholder="Authorized reason" value={form.supplier_not_required_reason} onChange={(e) => setForm({ ...form, supplier_not_required_reason: e.target.value })} /> : <div className="space-y-3">{quotations.map((row, index) => <div key={index} className="grid gap-2 rounded border p-3 md:grid-cols-12">
          <select className="rounded border p-2 md:col-span-4" value={row.supplier_id} onChange={(e) => { const supplier = suppliers.find((s) => s.id === e.target.value); changeQuote(index, { supplier_id: e.target.value, supplier_name: supplier?.supplier_name || "" }) }}><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplier_code ? `${supplier.supplier_code} — ` : ""}{supplier.supplier_name}</option>)}</select>
          <input className="rounded border p-2 md:col-span-2" placeholder="Quote #" value={row.quotation_number} onChange={(e) => changeQuote(index, { quotation_number: e.target.value })} />
          <input className="rounded border p-2 md:col-span-2" type="date" value={row.quotation_date} onChange={(e) => changeQuote(index, { quotation_date: e.target.value })} />
          <input className="rounded border p-2 md:col-span-2" type="number" min="0" step="0.01" placeholder="Amount" value={row.quotation_amount} onChange={(e) => changeQuote(index, { quotation_amount: Number(e.target.value) })} />
          <label className="flex items-center gap-2 text-sm md:col-span-1"><input type="radio" name="selected-quote" checked={row.is_selected} onChange={() => changeQuote(index, { is_selected: true })} /> Select</label>
          <button type="button" className="flex items-center justify-center md:col-span-1" onClick={() => setQuotations((rows) => rows.length <= 3 ? rows : rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4 text-red-600" /></button>
        </div>)}</div>}
      </section>

      <div className="flex justify-end gap-3">
        <button disabled={saving} type="button" onClick={() => save("DRAFT")} className="flex items-center gap-2 rounded-lg border px-4 py-2 disabled:opacity-50"><Save className="h-4 w-4" /> Save Draft</button>
        <button disabled={saving || !canSubmit} type="button" onClick={() => save("SUBMITTED")} className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50"><Send className="h-4 w-4" /> Submit for Managerial Review</button>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-semibold text-slate-900">{money(value)}</div></div>
}
