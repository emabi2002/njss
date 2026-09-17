"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Plus, Save, Send, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { approveFF3 } from "@/lib/api"
import { checkHeadOfficeFF3Budget, type HeadOfficeFF3BudgetCheck, type HeadOfficeFF3BudgetStatus } from "@/lib/ff3-simplified-budget"

type Department = { id: string; code: string; name: string }
type Section = { id: string; code: string; name: string; department_id: string }
type Ledger = { id: string; ledger_number: string; finance_code: string; standard_description: string }
type CostCentre = { id: string; code: string; name: string; department_id: string | null; section_id: string | null }
type NamedCode = { id: string; code: string; name: string }
type Unit = { id: string; code: string; name: string }
type Supplier = { id: string; supplier_name: string; supplier_code: string | null }
type ItemRow = { item_description: string; specifications: string; quantity: number; unit_of_measure_id: string; estimated_unit_price: number }
type QuoteRow = { supplier_id: string; supplier_name: string; quotation_number: string; quotation_date: string; quotation_amount: number; is_selected: boolean }

const blankItem = (): ItemRow => ({ item_description: "", specifications: "", quantity: 1, unit_of_measure_id: "", estimated_unit_price: 0 })
const blankQuote = (): QuoteRow => ({ supplier_id: "", supplier_name: "", quotation_number: "", quotation_date: "", quotation_amount: 0, is_selected: false })
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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checkingBudget, setCheckingBudget] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [departments, setDepartments] = useState<Department[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [costCentres, setCostCentres] = useState<CostCentre[]>([])
  const [projects, setProjects] = useState<NamedCode[]>([])
  const [provinces, setProvinces] = useState<NamedCode[]>([])
  const [fundingSources, setFundingSources] = useState<NamedCode[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [budgetCheck, setBudgetCheck] = useState<HeadOfficeFF3BudgetCheck | null>(null)
  const [form, setForm] = useState({
    financial_year: new Date().getFullYear(), department_id: "", section_id: "", expense_ledger_id: "",
    cost_centre_id: "", project_id: "", province_id: "", funding_source_id: "", purpose: "", justification: "",
    required_by_date: "", urgency_level: "MEDIUM", procurement_method: "QUOTATION", supplier_not_required: false,
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
        const results = [d, s, l, c, p, pr, f, u, sp]
        const failed = results.find((result) => result.error)
        if (failed?.error) throw failed.error
        setDepartments((d.data || []) as Department[])
        setSections((s.data || []) as Section[])
        setLedgers((l.data || []) as Ledger[])
        setCostCentres((c.data || []) as CostCentre[])
        setProjects((p.data || []) as NamedCode[])
        setProvinces((pr.data || []) as NamedCode[])
        setFundingSources((f.data || []) as NamedCode[])
        setUnits((u.data || []) as Unit[])
        setSuppliers((sp.data || []) as Supplier[])
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Unable to load FF3 reference data")
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  const filteredSections = useMemo(() => sections.filter((row) => row.department_id === form.department_id), [sections, form.department_id])
  const filteredCostCentres = useMemo(() => costCentres.filter((row) => (!row.department_id || row.department_id === form.department_id) && (!row.section_id || row.section_id === form.section_id)), [costCentres, form.department_id, form.section_id])
  const validItems = useMemo(() => items.filter((row) => row.item_description.trim() && row.quantity > 0 && row.unit_of_measure_id && row.estimated_unit_price >= 0), [items])
  const totalEstimate = useMemo(() => validItems.reduce((sum, row) => sum + Number(row.quantity) * Number(row.estimated_unit_price), 0), [validItems])
  const validQuotes = useMemo(() => quotations.filter((row) => row.supplier_name.trim() && row.quotation_amount > 0), [quotations])
  const selectedQuote = quotations.find((row) => row.is_selected)
  const canSubmit = Boolean(form.department_id && form.section_id && form.expense_ledger_id && form.purpose.trim() && form.justification.trim() && validItems.length > 0 && (form.supplier_not_required || (validQuotes.length >= 3 && selectedQuote?.supplier_name)))

  const resetBudgetPreview = () => setBudgetCheck(null)
  const changeHeader = (patch: Partial<typeof form>) => { setForm((current) => ({ ...current, ...patch })); resetBudgetPreview() }
  const changeItem = (index: number, patch: Partial<ItemRow>) => { setItems((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row)); resetBudgetPreview() }
  const changeQuote = (index: number, patch: Partial<QuoteRow>) => setQuotations((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : patch.is_selected ? { ...row, is_selected: false } : row))

  async function evaluateBudget() {
    if (!form.department_id || !form.section_id || !form.expense_ledger_id || totalEstimate <= 0) {
      setError("Select the Division, Section and Ledger and enter at least one priced item before checking the budget.")
      return null
    }
    setCheckingBudget(true)
    setError("")
    try {
      const result = await checkHeadOfficeFF3Budget({ financialYear: form.financial_year, departmentId: form.department_id, sectionId: form.section_id, expenseLedgerId: form.expense_ledger_id, costCentreId: form.cost_centre_id || null, amount: totalEstimate })
      setBudgetCheck(result)
      return result
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to check the budget position")
      return null
    } finally {
      setCheckingBudget(false)
    }
  }

  async function save(mode: "DRAFT" | "SUBMITTED") {
    setError(""); setSuccess("")
    if (!form.department_id || !form.section_id || !form.expense_ledger_id) { setError("Financial Year, Division, Section and Ledger are required."); return }
    if (validItems.length === 0) { setError("Add at least one valid requisition line item with a unit and price."); return }
    if (mode === "SUBMITTED" && !canSubmit) { setError("Complete the request details and quotation requirements before submission."); return }
    setSaving(true)
    try {
      const position = await checkHeadOfficeFF3Budget({ financialYear: form.financial_year, departmentId: form.department_id, sectionId: form.section_id, expenseLedgerId: form.expense_ledger_id, costCentreId: form.cost_centre_id || null, amount: totalEstimate })
      setBudgetCheck(position)
      const { data: header, error: headerError } = await supabase.from("ff3_headers").insert({
        financial_year: form.financial_year, department_id: form.department_id, section_id: form.section_id,
        expense_ledger_id: form.expense_ledger_id, cost_centre_id: form.cost_centre_id || null, project_id: form.project_id || null,
        province_id: form.province_id || null, funding_source_id: form.funding_source_id || null, purpose: form.purpose.trim(),
        justification: form.justification.trim(), required_by_date: form.required_by_date || null, urgency_level: form.urgency_level,
        procurement_method: form.procurement_method, status: "DRAFT", selected_supplier_id: form.supplier_not_required ? null : selectedQuote?.supplier_id || null,
        selected_supplier_name: form.supplier_not_required ? null : selectedQuote?.supplier_name || null, supplier_not_required: form.supplier_not_required,
        supplier_not_required_reason: form.supplier_not_required ? form.supplier_not_required_reason.trim() || null : null,
        total_estimated_amount: totalEstimate, budget_control_status: position.status,
        budget_current_approved_snapshot: position.currentApprovedBudget, budget_available_snapshot: position.availableBudget,
        budget_shortfall: position.shortfall, budget_checked_at: new Date().toISOString(),
        is_within_budget: position.status === "SUFFICIENT" || position.status === "POSTING_MAPPING_REQUIRED",
        budget_mapping_status: position.postingMappingCount === 1 ? "RESOLVED" : "BUDGET_MAPPING_REQUIRED",
      }).select("id, ff3_number").single()
      if (headerError) throw headerError

      const { error: itemError } = await supabase.from("ff3_items").insert(validItems.map((row, index) => ({
        ff3_header_id: header.id, line_number: index + 1, item_description: row.item_description.trim(), specifications: row.specifications.trim() || null,
        quantity: row.quantity, unit_of_measure_id: row.unit_of_measure_id, estimated_unit_price: row.estimated_unit_price,
      })))
      if (itemError) throw itemError

      if (validQuotes.length > 0) {
        const { error: quoteError } = await supabase.from("ff3_quotations").insert(validQuotes.map((row) => ({
          ff3_header_id: header.id, supplier_id: row.supplier_id || null, supplier_name: row.supplier_name.trim(), quotation_number: row.quotation_number.trim() || null,
          quotation_date: row.quotation_date || null, quotation_amount: row.quotation_amount, is_selected: row.is_selected,
        })))
        if (quoteError) throw quoteError
      }
      if (mode === "SUBMITTED") await approveFF3(header.id, "SUBMIT", "Submitted from direct-ledger Head Office FF3 workspace")
      setSuccess(`FF3 ${header.ff3_number} ${mode === "SUBMITTED" ? "submitted for managerial review" : "saved as draft"}.`)
      window.setTimeout(() => router.push(`/dashboard/ff3/${header.ff3_number}`), 700)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save the FF3")
    } finally { setSaving(false) }
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>

  return <div className="space-y-6 pb-24">
    <div className="flex items-center gap-3"><Link href="/dashboard/ff3" className="rounded-lg p-2 hover:bg-slate-100"><ArrowLeft className="h-5 w-5" /></Link><div><h1 className="text-2xl font-bold">New FF3 Requisition</h1><p className="text-sm text-slate-600">Budget authority: Financial Year + Division + Section + Ledger</p></div></div>
    {error && <Notice bad>{error}</Notice>}{success && <Notice>{success}</Notice>}

    <section className="rounded-lg border bg-white p-6"><h2 className="mb-4 text-lg font-semibold">Budget and Requisition Header</h2><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Field label="Financial Year"><input className="w-full rounded border p-2" type="number" value={form.financial_year} onChange={(e) => changeHeader({ financial_year: Number(e.target.value) })} /></Field>
      <Field label="Division *"><select className="w-full rounded border p-2" value={form.department_id} onChange={(e) => changeHeader({ department_id: e.target.value, section_id: "", cost_centre_id: "" })}><option value="">Select Division</option>{departments.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></Field>
      <Field label="Section *"><select className="w-full rounded border p-2" value={form.section_id} onChange={(e) => changeHeader({ section_id: e.target.value, cost_centre_id: "" })}><option value="">Select Section</option>{filteredSections.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></Field>
      <Field label="Expense Ledger *"><select className="w-full rounded border p-2" value={form.expense_ledger_id} onChange={(e) => changeHeader({ expense_ledger_id: e.target.value })}><option value="">Select standard ledger</option>{ledgers.map((row) => <option key={row.id} value={row.id}>{row.ledger_number || row.finance_code} — {row.standard_description}</option>)}</select></Field>
      <Field label="Cost Centre"><select className="w-full rounded border p-2" value={form.cost_centre_id} onChange={(e) => changeHeader({ cost_centre_id: e.target.value })}><option value="">Optional</option>{filteredCostCentres.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></Field>
      <Field label="Project"><select className="w-full rounded border p-2" value={form.project_id} onChange={(e) => changeHeader({ project_id: e.target.value })}><option value="">Optional</option>{projects.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></Field>
      <Field label="Province"><select className="w-full rounded border p-2" value={form.province_id} onChange={(e) => changeHeader({ province_id: e.target.value })}><option value="">Optional</option>{provinces.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
      <Field label="Funding Source"><select className="w-full rounded border p-2" value={form.funding_source_id} onChange={(e) => changeHeader({ funding_source_id: e.target.value })}><option value="">Optional</option>{fundingSources.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></Field>
      <Field label="Required By"><input className="w-full rounded border p-2" type="date" value={form.required_by_date} onChange={(e) => changeHeader({ required_by_date: e.target.value })} /></Field>
    </div><div className="mt-4 grid gap-4 md:grid-cols-2"><Field label="Purpose *"><textarea className="w-full rounded border p-2" rows={3} value={form.purpose} onChange={(e) => changeHeader({ purpose: e.target.value })} /></Field><Field label="Justification *"><textarea className="w-full rounded border p-2" rows={3} value={form.justification} onChange={(e) => changeHeader({ justification: e.target.value })} /></Field></div></section>

    <section className="rounded-lg border bg-white p-6"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Requisition Items</h2><button type="button" onClick={() => setItems((rows) => [...rows, blankItem()])} className="flex items-center gap-2 rounded border px-3 py-2 text-sm"><Plus className="h-4 w-4" /> Add Item</button></div><div className="space-y-3">{items.map((row, index) => <div key={index} className="grid gap-2 rounded border p-3 md:grid-cols-12"><input className="rounded border p-2 md:col-span-4" placeholder="Item description" value={row.item_description} onChange={(e) => changeItem(index, { item_description: e.target.value })} /><input className="rounded border p-2 md:col-span-2" placeholder="Specifications" value={row.specifications} onChange={(e) => changeItem(index, { specifications: e.target.value })} /><input className="rounded border p-2 md:col-span-1" type="number" min="0" value={row.quantity} onChange={(e) => changeItem(index, { quantity: Number(e.target.value) })} /><select className="rounded border p-2 md:col-span-2" value={row.unit_of_measure_id} onChange={(e) => changeItem(index, { unit_of_measure_id: e.target.value })}><option value="">Unit</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select><input className="rounded border p-2 md:col-span-2" type="number" min="0" step="0.01" placeholder="Unit price" value={row.estimated_unit_price} onChange={(e) => changeItem(index, { estimated_unit_price: Number(e.target.value) })} /><button type="button" onClick={() => { setItems((rows) => rows.length === 1 ? [blankItem()] : rows.filter((_, i) => i !== index)); resetBudgetPreview() }}><Trash2 className="mx-auto h-4 w-4 text-red-600" /></button></div>)}</div><div className="mt-4 text-right text-lg font-semibold">This FF3 Request: {money(totalEstimate)}</div></section>

    <section className="rounded-lg border bg-white p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Authoritative Budget Position</h2><button type="button" onClick={evaluateBudget} disabled={checkingBudget} className="rounded border px-3 py-2 text-sm font-medium disabled:opacity-50">{checkingBudget ? "Checking…" : "Check Budget"}</button></div>{budgetCheck ? <><div className="mt-4 grid gap-3 md:grid-cols-3 lg:grid-cols-6"><Metric label="Current Approved Budget" value={budgetCheck.currentApprovedBudget} /><Metric label="Outstanding Commitments" value={budgetCheck.outstandingCommitments} /><Metric label="Actual Expenditure" value={budgetCheck.actualExpenditure} /><Metric label="Available Budget" value={budgetCheck.availableBudget} /><Metric label="This FF3 Request" value={budgetCheck.requested} /><Metric label="Shortfall" value={budgetCheck.shortfall} /></div><div className={`mt-4 rounded-lg border p-4 font-semibold ${budgetCheck.status === "SUFFICIENT" ? "border-green-200 bg-green-50 text-green-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>{statusLabel(budgetCheck.status)}{budgetCheck.status !== "SUFFICIENT" && <p className="mt-1 text-sm font-normal">Managerial review may continue. No financial commitment will be created until the server confirms sufficient budget and a valid posting mapping at final approval.</p>}</div></> : <p className="mt-3 text-sm text-slate-600">Check the budget after entering the Division, Section, Ledger and request amount.</p>}</section>

    <section className="rounded-lg border bg-white p-6"><h2 className="mb-4 text-lg font-semibold">Quotations</h2><label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.supplier_not_required} onChange={(e) => changeHeader({ supplier_not_required: e.target.checked })} /> Supplier/quotations not required</label>{form.supplier_not_required ? <textarea className="w-full rounded border p-2" rows={2} placeholder="Authorized reason" value={form.supplier_not_required_reason} onChange={(e) => changeHeader({ supplier_not_required_reason: e.target.value })} /> : <div className="space-y-3">{quotations.map((row, index) => <div key={index} className="grid gap-2 rounded border p-3 md:grid-cols-12"><select className="rounded border p-2 md:col-span-4" value={row.supplier_id} onChange={(e) => { const supplier = suppliers.find((s) => s.id === e.target.value); changeQuote(index, { supplier_id: e.target.value, supplier_name: supplier?.supplier_name || "" }) }}><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplier_code ? `${supplier.supplier_code} — ` : ""}{supplier.supplier_name}</option>)}</select><input className="rounded border p-2 md:col-span-2" placeholder="Quote #" value={row.quotation_number} onChange={(e) => changeQuote(index, { quotation_number: e.target.value })} /><input className="rounded border p-2 md:col-span-2" type="date" value={row.quotation_date} onChange={(e) => changeQuote(index, { quotation_date: e.target.value })} /><input className="rounded border p-2 md:col-span-2" type="number" min="0" step="0.01" placeholder="Amount" value={row.quotation_amount} onChange={(e) => changeQuote(index, { quotation_amount: Number(e.target.value) })} /><label className="flex items-center gap-2 text-sm md:col-span-2"><input type="radio" name="selected-quote" checked={row.is_selected} onChange={() => changeQuote(index, { is_selected: true })} /> Selected</label></div>)}</div>}</section>

    <div className="flex justify-end gap-3"><button disabled={saving} type="button" onClick={() => save("DRAFT")} className="flex items-center gap-2 rounded-lg border px-4 py-2 disabled:opacity-50"><Save className="h-4 w-4" /> Save Draft</button><button disabled={saving || !canSubmit} type="button" onClick={() => save("SUBMITTED")} className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50"><Send className="h-4 w-4" /> Submit for Managerial Review</button></div>
  </div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm font-medium text-slate-700"><span className="mb-1 block">{label}</span>{children}</label> }
function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-semibold">{money(value)}</div></div> }
function Notice({ children, bad = false }: { children: React.ReactNode; bad?: boolean }) { return <div className={`flex gap-3 rounded-lg border p-4 ${bad ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800"}`}>{bad ? <AlertCircle className="h-5 w-5 shrink-0" /> : <CheckCircle2 className="h-5 w-5 shrink-0" />}<span>{children}</span></div> }
