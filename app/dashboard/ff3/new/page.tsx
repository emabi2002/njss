"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Save, Send, Plus, Trash2, AlertCircle, CheckCircle2, ArrowLeft, Loader2, Upload, X, FileText } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { uploadFile, BUCKETS, type UploadedFile } from "@/lib/storage"
import { checkBudgetAndNotify, notifyFF3Submitted } from "@/lib/notifications"
import { approveFF3, checkBudgetAvailability, createSupplier } from "@/lib/api"
import { LookupSelect, type LookupOption } from "@/components/LookupSelect"
import { loadLookup } from "@/lib/lookups"
import { useAuth } from "@/contexts/AuthContext"
import {
  attachLedgerDescriptions,
  buildApprovedExpenseCodes,
  buildExpenseCodePayload,
  buildMasterLookupPayload,
  formatExpenseCodeLabel,
  type ExpenseCodeOption,
} from "@/lib/ff3-lookups"

type Department = { id: string; code: string; name: string }
type Section = { id: string; code: string; name: string; department_id: string }
type Project = { id: string; code: string; name: string }
type Province = { id: string; code: string; name: string }
type FundingSource = { id: string; code: string; name: string }
type CostCentre = { id: string; code: string; name: string; section_id: string | null; department_id: string | null }
type ExpenseCategory = { id: string; code: string; name: string }
type ExpenseItem = { id: string; code: string; name: string; expense_category_id: string | null }
type ExpenseCode = ExpenseCodeOption
type BudgetInfo = { available_balance: number; quarterly_released: number }
type BudgetCheck = { budgetAllocationId: string | null; mappingStatus: string; allocationCount: number; revised: number; released: number; pending: number; committed: number; spent: number; available: number; projectedAvailableAfterPending: number; hasAllocation: boolean; withinBudget?: boolean } | null
type FF3ItemDraft = {
  line_number: number
  item_code: string
  item_description: string
  specifications: string
  quantity: number
  unit_of_measure: string
  unit_of_measure_id: string
  estimated_unit_price: number
  line_notes: string
}

const newItemLine = (lineNumber: number): FF3ItemDraft => ({
  line_number: lineNumber,
  item_code: "",
  item_description: "",
  specifications: "",
  quantity: 0,
  unit_of_measure: "",
  unit_of_measure_id: "",
  estimated_unit_price: 0,
  line_notes: "",
})

const money = (value: number) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const lineTotal = (item: FF3ItemDraft) => (Number(item.quantity) || 0) * (Number(item.estimated_unit_price) || 0)
const isBlankItem = (item: FF3ItemDraft) => !item.item_code.trim() && !item.item_description.trim() && !item.specifications.trim() && !item.unit_of_measure_id && !item.unit_of_measure.trim() && !item.line_notes.trim() && Number(item.quantity || 0) === 0 && Number(item.estimated_unit_price || 0) === 0
const isValidItem = (item: FF3ItemDraft) => Boolean(item.item_description.trim() && Number(item.quantity) > 0 && item.unit_of_measure_id && Number(item.estimated_unit_price) >= 0)

export default function NewFF3Page() {
  const router = useRouter()
  const { can } = useAuth()
  const activeFinancialYear = new Date().getFullYear()
  const canManageMasterData = can("masterdata.manage") || can("registry.manage")
  const canManageExpenseCodes = can("registry.manage")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [departments, setDepartments] = useState<Department[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [provinces, setProvinces] = useState<Province[]>([])
  const [fundingSources, setFundingSources] = useState<FundingSource[]>([])
  const [costCentres, setCostCentres] = useState<CostCentre[]>([])
  const [expenseCodes, setExpenseCodes] = useState<ExpenseCode[]>([])
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([])
  const [expenseItems, setExpenseItems] = useState<ExpenseItem[]>([])
  const [budgetInfo, setBudgetInfo] = useState<BudgetInfo>({ available_balance: 0, quarterly_released: 0 })
  const [budgetCheck, setBudgetCheck] = useState<BudgetCheck>(null)
  const [urgencyLevels, setUrgencyLevels] = useState<LookupOption[]>([])
  const [procurementMethods, setProcurementMethods] = useState<LookupOption[]>([])
  const [units, setUnits] = useState<LookupOption[]>([])
  const [suppliers, setSuppliers] = useState<LookupOption[]>([])

  const [formData, setFormData] = useState({
    financial_year: activeFinancialYear,
    department_id: "",
    section_id: "",
    cost_centre_id: "",
    expense_code_registry_id: "",
    project_id: "",
    province_id: "",
    funding_source_id: "",
    purpose: "",
    justification: "",
    required_by_date: "",
    urgency_level: "MEDIUM",
    urgency_level_id: "",
    procurement_method: "QUOTATION",
    procurement_method_id: "",
    supplier_not_required: false,
    supplier_not_required_reason: "",
    supplier_not_required_expenditure_type: "",
    supplier_not_required_comments: "",
  })

  const [items, setItems] = useState<FF3ItemDraft[]>([newItemLine(1)])

  const [quotations, setQuotations] = useState([
    { supplier_id: "", supplier_name: "", quotation_number: "", quotation_date: "", quotation_amount: 0, is_selected: false, attachment_url: "", attachment_name: "" },
    { supplier_id: "", supplier_name: "", quotation_number: "", quotation_date: "", quotation_amount: 0, is_selected: false, attachment_url: "", attachment_name: "" },
    { supplier_id: "", supplier_name: "", quotation_number: "", quotation_date: "", quotation_amount: 0, is_selected: false, attachment_url: "", attachment_name: "" }
  ])

  const [supportingDocs, setSupportingDocs] = useState<UploadedFile[]>([])
  const [uploadingQuotation, setUploadingQuotation] = useState<number | null>(null)
  const [uploadingDoc, setUploadingDoc] = useState(false)

  useEffect(() => {
    async function fetchMasterData() {
      try {
        const [deptRes, secRes, projRes, provRes, fundRes, ccRes, codeRes, ledgerRes, categoryRes, itemRes, urgencyRows, methodRows, unitRows, supplierRows] = await Promise.all([
          supabase.from("departments").select("id, code, name").eq("is_active", true).order("name"),
          supabase.from("sections").select("id, code, name, department_id").eq("is_active", true).order("name"),
          supabase.from("projects").select("id, code, name").eq("is_active", true).order("name"),
          supabase.from("provinces").select("id, code, name").eq("is_active", true).order("name"),
          supabase.from("funding_sources").select("id, code, name").eq("is_active", true).order("name"),
          supabase.from("cost_centres").select("id, code, name, section_id, department_id").eq("is_active", true).order("code"),
          supabase.from("expense_code_registry").select("id, full_expense_code, section_id, description").eq("is_active", true).order("full_expense_code"),
          supabase.from("expense_ledger").select("finance_code, standard_description, expense_code_registry_id").eq("is_active", true).order("finance_code"),
          supabase.from("expense_categories").select("id, code, name").eq("is_active", true).order("name"),
          supabase.from("expense_items").select("id, code, name, expense_category_id").eq("is_active", true).order("name"),
          loadLookup("urgency_levels"),
          loadLookup("procurement_methods"),
          loadLookup("units_of_measure"),
          loadLookup("suppliers", { order: "supplier_name" }),
        ])

        setDepartments(deptRes.data || [])
        setSections(secRes.data || [])
        setProjects(projRes.data || [])
        setProvinces(provRes.data || [])
        setFundingSources(fundRes.data || [])
        setCostCentres(ccRes.data || [])
        setExpenseCategories(categoryRes.data || [])
        setExpenseItems(itemRes.data || [])
        setUrgencyLevels(urgencyRows)
        setProcurementMethods(methodRows)
        setUnits(unitRows)
        setSuppliers(supplierRows)

        const { data: approvedBudgetCodes } = await supabase
          .from("v_budget_by_code")
          .select("expense_code_registry_id, full_expense_code, section_id, expense_description")
          .eq("financial_year", activeFinancialYear)

        const ledgerDescriptions = ledgerRes.data || []
        const registryCodes = attachLedgerDescriptions((codeRes.data || []) as ExpenseCode[], ledgerDescriptions)
        const approvedCodes = buildApprovedExpenseCodes(approvedBudgetCodes || [], registryCodes, ledgerDescriptions)

        setExpenseCodes(approvedCodes.length > 0 ? approvedCodes : registryCodes)
        setFormData((current) => ({
          ...current,
          urgency_level_id: current.urgency_level_id || urgencyRows.find((row) => row.code === current.urgency_level)?.id || "",
          procurement_method_id: current.procurement_method_id || methodRows.find((row) => row.code === current.procurement_method)?.id || "",
        }))

        const { data: releases } = await supabase.from("quarterly_releases").select("released_amount").eq("financial_year", activeFinancialYear)
        const { data: commitments } = await supabase.from("ff3_commitments").select("committed_amount, paid_amount").eq("financial_year", activeFinancialYear)

        const quarterlyReleased = releases?.reduce((sum, r) => sum + (r.released_amount || 0), 0) || 0
        const committedAmount = commitments?.reduce((sum, c) => sum + ((c.committed_amount || 0) - (c.paid_amount || 0)), 0) || 0
        const actualExpenditure = commitments?.reduce((sum, c) => sum + (c.paid_amount || 0), 0) || 0

        setBudgetInfo({
          quarterly_released: quarterlyReleased,
          available_balance: quarterlyReleased - committedAmount - actualExpenditure
        })
      } catch (err) {
        console.error("Error fetching master data:", err)
      } finally {
        setLoading(false)
      }
    }

    fetchMasterData()
  }, [activeFinancialYear])

  const filteredSections = useMemo(() => formData.department_id ? sections.filter(s => s.department_id === formData.department_id) : [], [formData.department_id, sections])
  const filteredCostCentres = useMemo(() => costCentres.filter(c => (!formData.section_id || c.section_id === formData.section_id) && (!formData.department_id || c.department_id === formData.department_id)), [costCentres, formData.section_id, formData.department_id])
  const filteredCodes = useMemo(() => expenseCodes.filter(c => !formData.section_id || c.section_id === formData.section_id || !c.section_id), [expenseCodes, formData.section_id])

  useEffect(() => {
    let cancelled = false
    async function loadPosition() {
      if (!formData.expense_code_registry_id && !formData.section_id) { setBudgetCheck(null); return }
      try {
        const res = await checkBudgetAvailability({
          financialYear: formData.financial_year,
          expenseCodeId: formData.expense_code_registry_id || null,
          sectionId: formData.section_id || null,
          departmentId: formData.department_id || null,
          costCentreId: formData.cost_centre_id || null,
          fundingSourceId: formData.funding_source_id || null,
          projectId: formData.project_id || null,
          amount: 0,
        })
        if (!cancelled) setBudgetCheck({ ...res })
      } catch {
        if (!cancelled) setBudgetCheck(null)
      }
    }
    loadPosition()
    return () => { cancelled = true }
  }, [formData.expense_code_registry_id, formData.section_id, formData.department_id, formData.cost_centre_id, formData.funding_source_id, formData.project_id, formData.financial_year])

  const renumberItems = (rows: FF3ItemDraft[]) => rows.map((item, index) => ({ ...item, line_number: index + 1 }))
  const addItem = () => setItems((current) => [...current, newItemLine(current.length + 1)])
  const updateItem = (index: number, patch: Partial<FF3ItemDraft>) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  const removeItem = (index: number) => setItems((current) => renumberItems(current.filter((_, itemIndex) => itemIndex !== index).length ? current.filter((_, itemIndex) => itemIndex !== index) : [newItemLine(1)]))

  const handleItemGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter") return
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    if (target.dataset.finalCell !== "true") return
    const rowIndex = Number(target.dataset.rowIndex || -1)
    if (rowIndex !== items.length - 1) return
    event.preventDefault()
    addItem()
    setTimeout(() => {
      const next = document.querySelector<HTMLInputElement>(`[data-item-cell="${rowIndex + 1}-description"]`)
      next?.focus()
    }, 0)
  }

  const addQuotation = () => setQuotations([...quotations, { supplier_id: "", supplier_name: "", quotation_number: "", quotation_date: "", quotation_amount: 0, is_selected: false, attachment_url: "", attachment_name: "" }])

  const handleQuotationUpload = async (index: number, file: File) => {
    if (!file) return
    setUploadingQuotation(index)
    try {
      const tempId = `temp-${Date.now()}`
      const uploaded = await uploadFile(BUCKETS.QUOTATIONS, tempId, file)
      const newQuots = [...quotations]
      newQuots[index].attachment_url = uploaded.url
      newQuots[index].attachment_name = uploaded.name
      setQuotations(newQuots)
    } catch (err) {
      console.error("Upload error:", err)
      setError("Failed to upload quotation file")
    } finally {
      setUploadingQuotation(null)
    }
  }

  const handleDocUpload = async (file: File) => {
    if (!file) return
    setUploadingDoc(true)
    try {
      const tempId = `temp-${Date.now()}`
      const uploaded = await uploadFile(BUCKETS.FF3_ATTACHMENTS, tempId, file)
      setSupportingDocs(prev => [...prev, uploaded])
    } catch (err) {
      console.error("Upload error:", err)
      setError("Failed to upload supporting document")
    } finally {
      setUploadingDoc(false)
    }
  }

  const removeDoc = (index: number) => setSupportingDocs(prev => prev.filter((_, i) => i !== index))

  const validItems = items.filter((item) => !isBlankItem(item) && isValidItem(item))
  const invalidItems = items.filter((item) => !isBlankItem(item) && !isValidItem(item))
  const totalEstimate = validItems.reduce((sum, item) => sum + lineTotal(item), 0)
  const effectiveAvailable = budgetCheck?.hasAllocation ? budgetCheck.available : budgetInfo.available_balance
  const selectedCode = expenseCodes.find(c => c.id === formData.expense_code_registry_id)
  const selectedQuotation = quotations.find(q => q.is_selected)
  const quotationCount = quotations.filter(q => q.supplier_name && q.quotation_amount > 0).length
  const supplierExceptionComplete = formData.supplier_not_required && formData.supplier_not_required_reason.trim() && formData.supplier_not_required_expenditure_type.trim()
  const supplierRequirementMet = formData.supplier_not_required ? supplierExceptionComplete : Boolean(selectedQuotation?.supplier_id)
  const canSubmit = (formData.supplier_not_required || quotationCount >= 3) && supplierRequirementMet && totalEstimate > 0 && formData.purpose && formData.justification && formData.department_id && formData.section_id

  const saveFF3 = async (status: "DRAFT" | "SUBMITTED") => {
    setError("")
    setSuccess("")
    setSubmitting(true)
    try {
      const rowsToSave = items.filter((item) => !isBlankItem(item))
      const invalidRows = rowsToSave.filter((item) => !isValidItem(item))
      if (invalidRows.length > 0) {
        setError("Complete every populated line item before saving or submitting.")
        setSubmitting(false)
        return
      }
      if (status === "SUBMITTED" && rowsToSave.length === 0) {
        setError("Add at least one valid requisition line item before submission.")
        setSubmitting(false)
        return
      }
      let latestBudget = budgetCheck
      if (status === "SUBMITTED") {
        const checkedBudget = await checkBudgetAvailability({
          financialYear: formData.financial_year,
          expenseCodeId: formData.expense_code_registry_id || null,
          sectionId: formData.section_id || null,
          departmentId: formData.department_id || null,
          costCentreId: formData.cost_centre_id || null,
          fundingSourceId: formData.funding_source_id || null,
          projectId: formData.project_id || null,
          amount: totalEstimate,
        })
        latestBudget = { ...checkedBudget }
        if (!checkedBudget.hasAllocation) {
          setError(checkedBudget.mappingStatus === "BUDGET_MAPPING_REQUIRED_AMBIGUOUS"
            ? "More than one budget allocation matches this FF3. Select a more specific department, section, cost centre, funding source, project and finance code."
            : "No exact approved budget allocation was found for this FF3.")
          setSubmitting(false)
          return
        }
        if (!checkedBudget.withinBudget) {
          await checkBudgetAndNotify(totalEstimate, undefined, formData.financial_year)
          const shortfall = totalEstimate - checkedBudget.available
          setError(`Insufficient Available Budget. Available: K${checkedBudget.available.toLocaleString()}. Requested: K${totalEstimate.toLocaleString()}. Shortfall: K${shortfall.toLocaleString()}.`)
          setSubmitting(false)
          return
        }
      }

      const selectedQuotation = quotations.find(q => q.is_selected)
      if (!formData.supplier_not_required && !selectedQuotation?.supplier_id) {
        setError("Select or quick add a supplier for the selected quotation before submitting the FF3.")
        setSubmitting(false)
        return
      }
      if (formData.supplier_not_required && (!formData.supplier_not_required_reason.trim() || !formData.supplier_not_required_expenditure_type.trim())) {
        setError("Supplier-not-required FF3s need an expenditure type and authorized reason.")
        setSubmitting(false)
        return
      }

      const { data: header, error: headerError } = await supabase
        .from("ff3_headers")
        .insert({
          financial_year: formData.financial_year,
          department_id: formData.department_id || null,
          section_id: formData.section_id || null,
          cost_centre_id: formData.cost_centre_id || null,
          expense_code_registry_id: formData.expense_code_registry_id || null,
          project_id: formData.project_id || null,
          province_id: formData.province_id || null,
          funding_source_id: formData.funding_source_id || null,
          budget_allocation_id: latestBudget?.budgetAllocationId || null,
          budget_mapping_status: latestBudget?.mappingStatus || null,
          purpose: formData.purpose,
          justification: formData.justification,
          required_by_date: formData.required_by_date || null,
          urgency_level: formData.urgency_level,
          urgency_level_id: formData.urgency_level_id || null,
          procurement_method: formData.procurement_method,
          procurement_method_id: formData.procurement_method_id || null,
          status: "DRAFT",
          selected_supplier_id: formData.supplier_not_required ? null : selectedQuotation?.supplier_id || null,
          selected_supplier_name: formData.supplier_not_required ? null : selectedQuotation?.supplier_name || null,
          supplier_not_required: formData.supplier_not_required,
          supplier_not_required_reason: formData.supplier_not_required ? formData.supplier_not_required_reason : null,
          supplier_not_required_expenditure_type: formData.supplier_not_required ? formData.supplier_not_required_expenditure_type : null,
          supplier_not_required_comments: formData.supplier_not_required ? formData.supplier_not_required_comments || null : null,
          total_estimated_amount: totalEstimate,
          is_within_budget: totalEstimate <= (latestBudget?.available ?? budgetInfo.available_balance),
          submitted_date: status === "SUBMITTED" ? new Date().toISOString() : null
        })
        .select()
        .single()

      if (headerError) throw headerError

      const itemsToInsert = items.filter(item => !isBlankItem(item) && isValidItem(item)).map((item, index) => ({
        ff3_header_id: header.id,
        line_number: index + 1,
        item_code: item.item_code || null,
        item_description: item.item_description,
        specifications: item.specifications || null,
        quantity: item.quantity,
        unit_of_measure: item.unit_of_measure || null,
        unit_of_measure_id: item.unit_of_measure_id || null,
        estimated_unit_price: item.estimated_unit_price,
        line_notes: item.line_notes || null
      }))

      if (itemsToInsert.length > 0) {
        const { error: itemsError } = await supabase.from("ff3_items").insert(itemsToInsert)
        if (itemsError) throw itemsError
      }

      const quotsToInsert = quotations.filter(q => q.supplier_name && q.quotation_amount > 0).map(q => ({
        ff3_header_id: header.id,
        supplier_id: q.supplier_id || null,
        supplier_name: q.supplier_name,
        quotation_number: q.quotation_number || null,
        quotation_date: q.quotation_date || null,
        quotation_amount: q.quotation_amount,
        attachment_url: q.attachment_url || null,
        attachment_name: q.attachment_name || null,
        is_selected: q.is_selected
      }))

      if (quotsToInsert.length > 0) {
        const { error: quotsError } = await supabase.from("ff3_quotations").insert(quotsToInsert)
        if (quotsError) throw quotsError
      }

      if (status === "SUBMITTED") {
        await approveFF3(header.id, "SUBMIT", "Submitted from FF3 creation screen")
        await notifyFF3Submitted(header.ff3_number, header.id, totalEstimate)
      }

      setSuccess(`FF3 ${header.ff3_number} ${status === "DRAFT" ? "saved as draft" : "submitted for approval"}!`)
      setTimeout(() => router.push("/dashboard/ff3"), 1500)
    } catch (err: unknown) {
      console.error("Error saving FF3:", err)
      setError(err instanceof Error ? err.message : "Failed to save FF3. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveDraft = async () => { await saveFF3("DRAFT") }
  const handleSubmit = async () => { await saveFF3("SUBMITTED") }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div>
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/ff3" className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">New FF3 Requisition</h1>
          <p className="text-slate-600 mt-1">Finance Form 3 - Requisition and Commitment Request</p>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3"><AlertCircle className="h-5 w-5 text-red-600 mt-0.5" /><div><p className="font-medium text-red-900">Error</p><p className="text-sm text-red-700 mt-1">{error}</p></div></div>}
      {success && <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" /><div><p className="font-medium text-green-900">Success</p><p className="text-sm text-green-700 mt-1">{success}</p></div></div>}
      {quotationCount < 3 && <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3"><AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" /><div><p className="font-medium text-amber-900">Minimum 3 Quotations Required</p><p className="text-sm text-amber-700 mt-1">You have {quotationCount} valid quotation(s). Add {3 - quotationCount} more to submit.</p></div></div>}

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section A: Requisition Header</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Financial Year</label><input type="number" value={formData.financial_year} onChange={(e) => setFormData({ ...formData, financial_year: parseInt(e.target.value) })} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Department <span className="text-red-500">*</span></label><select value={formData.department_id} onChange={(e) => setFormData({ ...formData, department_id: e.target.value, section_id: "" })} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"><option value="">Select Department</option>{departments.map(dept => <option key={dept.id} value={dept.id}>{dept.name}</option>)}</select></div>
          <LookupSelect
            label="Section"
            required
            selectOnly
            value={formData.section_id}
            options={filteredSections}
            placeholder="Select Section"
            disabled={!formData.department_id}
            canAdd={canManageMasterData}
            addTable="sections"
            addLabel="Add Section"
            addPayload={(form) => buildMasterLookupPayload("sections", form, { departmentId: formData.department_id })}
            onCreated={(option) => setSections((current) => [...current, option as Section])}
            onChange={(value) => setFormData((current) => ({ ...current, section_id: value, cost_centre_id: "", expense_code_registry_id: "" }))}
          />
          <LookupSelect
            label="Project / Portfolio"
            selectOnly
            value={formData.project_id}
            options={projects}
            placeholder="Select Project"
            canAdd={canManageMasterData}
            addTable="projects"
            addLabel="Add Project / Portfolio"
            addPayload={(form) => buildMasterLookupPayload("projects", form, { departmentId: formData.department_id })}
            onCreated={(option) => setProjects((current) => [...current, option as Project])}
            onChange={(value) => setFormData((current) => ({ ...current, project_id: value }))}
          />
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Province</label><select value={formData.province_id} onChange={(e) => setFormData({ ...formData, province_id: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"><option value="">Select Province</option>{provinces.map(prov => <option key={prov.id} value={prov.id}>{prov.name}</option>)}</select></div>
          <LookupSelect
            label="Funding Source"
            selectOnly
            value={formData.funding_source_id}
            options={fundingSources}
            placeholder="Select Funding Source"
            canAdd={canManageMasterData}
            addTable="funding_sources"
            addLabel="Add Funding Source"
            addFields={[
              { name: "code", label: "Funding Code", required: true },
              { name: "name", label: "Funding Source", required: true },
              { name: "source_type", label: "Source Type", placeholder: "Government, donor or grant" },
            ]}
            addPayload={(form) => buildMasterLookupPayload("funding_sources", form)}
            onCreated={(option) => setFundingSources((current) => [...current, option as FundingSource])}
            onChange={(value) => setFormData((current) => ({ ...current, funding_source_id: value }))}
          />
          <LookupSelect
            label="Cost Centre"
            selectOnly
            value={formData.cost_centre_id}
            options={filteredCostCentres}
            placeholder="Select Cost Centre"
            disabled={!formData.department_id}
            canAdd={canManageMasterData}
            addTable="cost_centres"
            addLabel="Add Cost Centre"
            addPayload={(form) => buildMasterLookupPayload("cost_centres", form, { departmentId: formData.department_id, sectionId: formData.section_id })}
            onCreated={(option) => setCostCentres((current) => [...current, option as CostCentre])}
            onChange={(value) => setFormData((current) => ({ ...current, cost_centre_id: value, expense_code_registry_id: "" }))}
          />
          <LookupSelect
            label="Expense Code (approved budget line)"
            selectOnly
            value={formData.expense_code_registry_id}
            options={filteredCodes.map((code) => ({ ...code, name: formatExpenseCodeLabel(code) }))}
            placeholder="Select Expense Code"
            canAdd={canManageExpenseCodes}
            addTable="expense_code_registry"
            addLabel="Add Expense Code"
            addFields={[
              { name: "expense_category_id", label: "Expense Category", required: true, type: "select", options: expenseCategories },
              { name: "expense_item_id", label: "Expense Item", required: true, type: "select", options: expenseItems, dependsOn: "expense_category_id" },
              { name: "description", label: "Expense Description", required: true, placeholder: "Describe what this expense code is used for" },
            ]}
            createVia={async (form) => {
              const payload = buildExpenseCodePayload({
                departmentId: formData.department_id,
                sectionId: formData.section_id,
                costCentreId: formData.cost_centre_id,
                categoryId: form.expense_category_id,
                itemId: form.expense_item_id,
                financialYear: formData.financial_year,
                description: form.description,
              })
              const { data, error: insertError } = await supabase
                .from("expense_code_registry")
                .insert(payload)
                .select("id, full_expense_code, section_id, description")
                .single()
              if (insertError) throw new Error(insertError.message)
              return { ...data, name: formatExpenseCodeLabel(data) }
            }}
            onCreated={(option) => setExpenseCodes((current) => [...current, {
              id: option.id,
              full_expense_code: String(option.full_expense_code || ""),
              section_id: typeof option.section_id === "string" ? option.section_id : null,
              description: typeof option.description === "string" ? option.description : null,
            }])}
            onChange={(value) => setFormData((current) => ({ ...current, expense_code_registry_id: value }))}
          />
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section B: Request Details</h2>
        <div className="space-y-4">
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Purpose of Expenditure <span className="text-red-500">*</span></label><textarea value={formData.purpose} onChange={(e) => setFormData({ ...formData, purpose: e.target.value })} rows={3} placeholder="Describe the purpose of this expenditure..." className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Justification <span className="text-red-500">*</span></label><textarea value={formData.justification} onChange={(e) => setFormData({ ...formData, justification: e.target.value })} rows={3} placeholder="Provide justification for this expenditure..." className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" /></div>
          <div className="grid md:grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Required By Date</label><input type="date" value={formData.required_by_date} onChange={(e) => setFormData({ ...formData, required_by_date: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" /></div>
            <LookupSelect label="Urgency Level" selectOnly value={formData.urgency_level_id} options={urgencyLevels} placeholder="Select urgency" onChange={(value, option) => setFormData({ ...formData, urgency_level_id: value, urgency_level: option?.code || "" })} />
            <LookupSelect label="Procurement Method" selectOnly value={formData.procurement_method_id} options={procurementMethods} placeholder="Select method" canAdd addTable="procurement_methods" addLabel="+ Add Procurement Method" onRefresh={async () => setProcurementMethods(await loadLookup("procurement_methods"))} onChange={(value, option) => setFormData({ ...formData, procurement_method_id: value, procurement_method: option?.code || "" })} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Section C: Requisition Line Items</h2>
            <p className="mt-1 text-sm text-slate-600">Enter one database line per quoted item or service. Units are loaded from the controlled units register.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={addItem} className="px-3 py-1.5 bg-png-red text-white rounded-lg text-sm font-medium hover:bg-png-maroon flex items-center gap-2"><Plus className="h-4 w-4" /> Add Line Item</button>
          </div>
        </div>

        {invalidItems.length > 0 && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{invalidItems.length} populated line item(s) need Description, Quantity, Unit of Measure and Unit Price before saving or submitting.</div>}

        <div className="overflow-x-auto rounded-xl border border-slate-200" onKeyDown={handleItemGridKeyDown}>
          <table className="min-w-[1280px] w-full border-collapse text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-12 border-b border-slate-200 px-2 py-2 text-right">#</th>
                <th className="w-[260px] border-b border-slate-200 px-2 py-2">Item / Service Description</th>
                <th className="w-[260px] border-b border-slate-200 px-2 py-2">Specifications / Details</th>
                <th className="w-24 border-b border-slate-200 px-2 py-2 text-right">Qty</th>
                <th className="w-44 border-b border-slate-200 px-2 py-2">Unit</th>
                <th className="w-36 border-b border-slate-200 px-2 py-2 text-right">Unit Price (K)</th>
                <th className="w-36 border-b border-slate-200 px-2 py-2 text-right">Line Total (K)</th>
                <th className="w-40 border-b border-slate-200 px-2 py-2">Quote Ref / Notes</th>
                <th className="w-20 border-b border-slate-200 px-2 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const invalid = !isBlankItem(item) && !isValidItem(item)
                return (
                  <tr key={index} className={`${invalid ? "bg-amber-50" : index % 2 === 0 ? "bg-white" : "bg-slate-50/60"} align-top`}>
                    <td className="border-b border-slate-100 px-2 py-2 text-right font-semibold text-slate-600">{index + 1}</td>
                    <td className="border-b border-slate-100 px-2 py-1.5"><input data-item-cell={`${index}-description`} value={item.item_description} onChange={(e) => updateItem(index, { item_description: e.target.value })} className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-png-red" placeholder="Description" /></td>
                    <td className="border-b border-slate-100 px-2 py-1.5"><input value={item.specifications} onChange={(e) => updateItem(index, { specifications: e.target.value })} className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-png-red" placeholder="Technical requirement" /></td>
                    <td className="border-b border-slate-100 px-2 py-1.5"><input type="number" min="0" step="0.01" value={item.quantity || ""} onChange={(e) => updateItem(index, { quantity: Number(e.target.value) || 0 })} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-png-red" /></td>
                    <td className="border-b border-slate-100 px-2 py-1.5"><select value={item.unit_of_measure_id} onChange={(e) => { const unit = units.find((row) => row.id === e.target.value); updateItem(index, { unit_of_measure_id: e.target.value, unit_of_measure: unit?.name || "" }) }} className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-png-red"><option value="">Select unit</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.code ? `${unit.code} — ${unit.name}` : unit.name}</option>)}</select></td>
                    <td className="border-b border-slate-100 px-2 py-1.5"><input type="number" min="0" step="0.01" value={item.estimated_unit_price || ""} onChange={(e) => updateItem(index, { estimated_unit_price: Number(e.target.value) || 0 })} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-png-red" /></td>
                    <td className="border-b border-slate-100 px-2 py-2 text-right font-semibold text-slate-900">{money(lineTotal(item))}</td>
                    <td className="border-b border-slate-100 px-2 py-1.5"><input data-final-cell="true" data-row-index={index} value={item.line_notes} onChange={(e) => updateItem(index, { line_notes: e.target.value })} className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-png-red" placeholder="Q-001 / notes" /></td>
                    <td className="border-b border-slate-100 px-2 py-1.5 text-center"><button type="button" onClick={() => removeItem(index)} className="inline-flex rounded-md p-2 text-red-600 hover:bg-red-50" aria-label={`Remove line ${index + 1}`}><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-col gap-2 rounded-lg bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"><span className="font-semibold text-slate-900">TOTAL ESTIMATED REQUISITION:</span><span className="text-xl font-bold text-slate-900">K {money(totalEstimate)}</span></div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section D: Supplier / Service Provider Control</h2>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={formData.supplier_not_required} onChange={(event) => setFormData({ ...formData, supplier_not_required: event.target.checked })} className="mt-1 h-4 w-4 rounded border-slate-300 text-png-red" />
            <span><span className="block text-sm font-semibold text-slate-900">Supplier not required for this expenditure</span><span className="block text-sm text-slate-600">Use only for legitimate non-supplier expenditure. Do not create fake GENERAL, N/A, or placeholder suppliers.</span></span>
          </label>
          {formData.supplier_not_required && <div className="mt-4 grid md:grid-cols-3 gap-3"><div><label className="block text-sm font-medium text-slate-700 mb-1">Expenditure Type <span className="text-red-500">*</span></label><input value={formData.supplier_not_required_expenditure_type} onChange={(event) => setFormData({ ...formData, supplier_not_required_expenditure_type: event.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" placeholder="e.g. Internal statutory charge" /></div><div><label className="block text-sm font-medium text-slate-700 mb-1">Authorized Reason <span className="text-red-500">*</span></label><input value={formData.supplier_not_required_reason} onChange={(event) => setFormData({ ...formData, supplier_not_required_reason: event.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" placeholder="Why no supplier is required" /></div><div><label className="block text-sm font-medium text-slate-700 mb-1">Comments</label><input value={formData.supplier_not_required_comments} onChange={(event) => setFormData({ ...formData, supplier_not_required_comments: event.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" placeholder="Optional approval notes" /></div></div>}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Section E: Quotations <span className="text-red-500">*</span></h2>
            <p className="text-sm text-slate-600 mt-1">Minimum 3 quotations required for supplier-based expenditure. Select the quotation supplier to link this FF3 and later expenditure reporting.</p>
          </div>
          <button onClick={addQuotation} className="px-3 py-1.5 bg-png-red text-white rounded-lg text-sm font-medium hover:bg-png-maroon flex items-center gap-2"><Plus className="h-4 w-4" /> Add Quotation</button>
        </div>
        <div className="space-y-4">
          {quotations.map((quot, index) => (
            <div key={index} className={`border rounded-lg p-4 ${quot.is_selected ? "border-green-500 bg-green-50" : "border-slate-200"}`}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-slate-700">Quotation {index + 1}</span>
                <label className="flex items-center gap-2"><input type="radio" name="selected_quotation" checked={quot.is_selected} onChange={() => setQuotations(quotations.map((q, i) => ({ ...q, is_selected: i === index })))} className="h-4 w-4 text-green-600" /><span className="text-sm text-slate-700">Select</span></label>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
                <LookupSelect label="Supplier Name" required value={quot.supplier_id} options={suppliers} placeholder="Search supplier" canAdd addTable="suppliers" addLabel="+ Quick Add Supplier" emptyLabel="No active suppliers found. Quick add a supplier to continue." addFields={[{ name: "legal_name", label: "Supplier / Business Name", required: true }, { name: "primary_contact_name", label: "Contact Person" }, { name: "phone", label: "Phone" }, { name: "email", label: "Email" }, { name: "physical_address", label: "Address" }, { name: "ipa_registration_number", label: "IPA Registration" }, { name: "tin", label: "TIN" }]} createVia={async (form) => {
                  const result = await createSupplier({
                    legal_name: form.legal_name,
                    ipa_registration_number: form.ipa_registration_number,
                    tin: form.tin,
                    primary_contact_name: form.primary_contact_name,
                    phone: form.phone,
                    email: form.email,
                    physical_address: form.physical_address,
                    is_active: true,
                  })
                  if (result.requires_review) throw new Error("Possible duplicate supplier found. Select the existing supplier or add it from the Supplier Register with duplicate override if genuinely different.")
                  if (!result.supplier) throw new Error("Supplier registration did not return a supplier record.")
                  return { ...result.supplier, id: result.supplier.id, code: result.supplier.supplier_code, name: result.supplier.supplier_name }
                }} onRefresh={async () => setSuppliers(await loadLookup("suppliers", { order: "supplier_name" }))} onChange={(value, option) => { const newQuots = [...quotations]; newQuots[index].supplier_id = value; newQuots[index].supplier_name = option?.name || ""; setQuotations(newQuots) }} />
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Quotation Number</label><input type="text" value={quot.quotation_number} onChange={(e) => { const newQuots = [...quotations]; newQuots[index].quotation_number = e.target.value; setQuotations(newQuots) }} placeholder="Quote #" className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Quote Date</label><input type="date" value={quot.quotation_date} onChange={(e) => { const newQuots = [...quotations]; newQuots[index].quotation_date = e.target.value; setQuotations(newQuots) }} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Amount (K) <span className="text-red-500">*</span></label><input type="number" step="0.01" value={quot.quotation_amount || ""} onChange={(e) => { const newQuots = [...quotations]; newQuots[index].quotation_amount = parseFloat(e.target.value) || 0; setQuotations(newQuots) }} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" /></div>
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-slate-700 mb-1">Quotation Document</label>
                {quot.attachment_url ? (
                  <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg"><FileText className="h-4 w-4 text-green-600" /><a href={quot.attachment_url} target="_blank" rel="noopener noreferrer" className="text-sm text-green-700 hover:underline flex-1 truncate">{quot.attachment_name || "View Attachment"}</a><button type="button" onClick={() => { const newQuots = [...quotations]; newQuots[index].attachment_url = ""; newQuots[index].attachment_name = ""; setQuotations(newQuots) }} className="p-1 hover:bg-green-100 rounded"><X className="h-4 w-4 text-green-600" /></button></div>
                ) : (
                  <label className="flex items-center gap-2 p-2 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 hover:border-png-gold transition-colors">
                    {uploadingQuotation === index ? <Loader2 className="h-4 w-4 text-png-red animate-spin" /> : <Upload className="h-4 w-4 text-slate-400" />}
                    <span className="text-sm text-slate-600">{uploadingQuotation === index ? "Uploading..." : "Upload PDF or Image"}</span>
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => e.target.files?.[0] && handleQuotationUpload(index, e.target.files[0])} className="hidden" disabled={uploadingQuotation !== null} />
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section E: Supporting Documents</h2>
        <p className="text-sm text-slate-600 mb-4">Upload any supporting documents such as specifications, approvals, or other relevant files.</p>
        <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 hover:border-png-gold transition-colors">
          {uploadingDoc ? <Loader2 className="h-8 w-8 text-png-red animate-spin mb-2" /> : <Upload className="h-8 w-8 text-slate-400 mb-2" />}
          <span className="text-sm font-medium text-slate-700">{uploadingDoc ? "Uploading..." : "Click to upload supporting documents"}</span>
          <span className="text-xs text-slate-500 mt-1">PDF, JPG, PNG up to 10MB</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={(e) => e.target.files?.[0] && handleDocUpload(e.target.files[0])} className="hidden" disabled={uploadingDoc} />
        </label>
        {supportingDocs.length > 0 && <div className="mt-4 space-y-2"><p className="text-sm font-medium text-slate-700">Uploaded Documents ({supportingDocs.length})</p>{supportingDocs.map((doc, index) => <div key={doc.id} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg"><FileText className="h-5 w-5 text-png-red" /><div className="flex-1 min-w-0"><a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-png-red hover:underline truncate block">{doc.name}</a><p className="text-xs text-slate-500">{(doc.size / 1024).toFixed(1)} KB</p></div><button type="button" onClick={() => removeDoc(index)} className="p-1 hover:bg-slate-200 rounded"><X className="h-4 w-4 text-slate-500" /></button></div>)}</div>}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-semibold text-slate-900">Section F: Budget Validation</h2>{selectedCode && <span className="font-mono text-xs px-2 py-1 rounded-lg bg-png-red/5 text-png-red border border-png-gold/40">{formatExpenseCodeLabel(selectedCode)}</span>}</div>
        {budgetCheck?.hasAllocation ? <div className="space-y-2"><p className="text-xs text-slate-500 mb-1">{selectedCode ? "Position for the selected expense code" : "Position for the selected section"}</p><BudgetLine label="Approved Budget (Revised)" amount={budgetCheck.revised} /><BudgetLine label="Released (cash available)" amount={budgetCheck.released} /><BudgetLine label="Pending Requests" amount={budgetCheck.pending} /><BudgetLine label="Committed" amount={budgetCheck.committed} /><BudgetLine label="Actual Expenditure" amount={budgetCheck.spent} /><BudgetLine label="Available Balance" amount={budgetCheck.available} isTotal /><div className="border-t border-slate-200 pt-2 mt-2"><BudgetLine label="This Request" amount={totalEstimate} highlight /><BudgetLine label="Available After This Request" amount={budgetCheck.available - totalEstimate} /><BudgetLine label="Projected Available After Pending" amount={budgetCheck.projectedAvailableAfterPending - totalEstimate} /></div></div> : <div className="space-y-2">{(formData.expense_code_registry_id || formData.section_id) && <div className="mb-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Exact budget allocation is required. {budgetCheck?.mappingStatus === "BUDGET_MAPPING_REQUIRED_AMBIGUOUS" ? "Multiple allocations match this request." : "No confirmed budget allocation found yet."}</div>}<BudgetLine label="Quarterly Released" amount={budgetInfo.quarterly_released} /><BudgetLine label="Available Balance" amount={budgetInfo.available_balance} isTotal /><div className="border-t border-slate-200 pt-2 mt-2"><BudgetLine label="This Request" amount={totalEstimate} highlight /></div></div>}
        {totalEstimate > 0 && <div className={`mt-4 p-3 rounded-lg flex items-center gap-2 text-sm ${totalEstimate <= effectiveAvailable ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{totalEstimate <= effectiveAvailable ? <><CheckCircle2 className="h-4 w-4" /><span className="font-medium">Within Budget — sufficient funds available (K {effectiveAvailable.toLocaleString()} remaining)</span></> : <><AlertCircle className="h-4 w-4" /><span className="font-medium">Insufficient Funds — exceeds available balance of K {effectiveAvailable.toLocaleString()}</span></>}</div>}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 z-10">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <Link href="/dashboard/ff3" className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50">Cancel</Link>
          <div className="flex items-center gap-3">
            <button onClick={handleSaveDraft} disabled={submitting} className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save as Draft</button>
            <button onClick={handleSubmit} disabled={!canSubmit || submitting} className="px-6 py-2 bg-png-red text-white rounded-lg font-medium hover:bg-png-maroon disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit for Approval</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function BudgetLine({ label, amount, isNegative = false, isTotal = false, highlight = false }: { label: string; amount: number; isNegative?: boolean; isTotal?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 ${isTotal ? "text-lg font-bold" : ""} ${highlight ? "text-png-red font-semibold" : ""}`}>
      <span className={isTotal ? "text-slate-900" : "text-slate-700"}>{label}</span>
      <span className={`${isTotal ? "text-green-700" : isNegative ? "text-red-600" : "text-slate-900"}`}>
        K {amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  )
}
