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

type Department = { id: string; code: string; name: string }
type Section = { id: string; code: string; name: string; department_id: string }
type Project = { id: string; code: string; name: string }
type Province = { id: string; code: string; name: string }
type FundingSource = { id: string; code: string; name: string }
type CostCentre = { id: string; code: string; name: string; section_id: string | null; department_id: string | null }
type ExpenseCode = { id: string; full_expense_code: string; section_id: string | null }
type BudgetInfo = { available_balance: number; quarterly_released: number }
type BudgetCheck = { budgetAllocationId: string | null; mappingStatus: string; allocationCount: number; revised: number; released: number; pending: number; committed: number; spent: number; available: number; projectedAvailableAfterPending: number; hasAllocation: boolean } | null

export default function NewFF3Page() {
  const router = useRouter()
  const activeFinancialYear = new Date().getFullYear()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  // Master data
  const [departments, setDepartments] = useState<Department[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [provinces, setProvinces] = useState<Province[]>([])
  const [fundingSources, setFundingSources] = useState<FundingSource[]>([])
  const [costCentres, setCostCentres] = useState<CostCentre[]>([])
  const [expenseCodes, setExpenseCodes] = useState<ExpenseCode[]>([])
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

  const [items, setItems] = useState([
    { line_number: 1, item_description: "", specifications: "", quantity: 0, unit_of_measure: "", unit_of_measure_id: "", estimated_unit_price: 0 }
  ])

  const [quotations, setQuotations] = useState([
    { supplier_id: "", supplier_name: "", quotation_number: "", quotation_date: "", quotation_amount: 0, is_selected: false, attachment_url: "", attachment_name: "" },
    { supplier_id: "", supplier_name: "", quotation_number: "", quotation_date: "", quotation_amount: 0, is_selected: false, attachment_url: "", attachment_name: "" },
    { supplier_id: "", supplier_name: "", quotation_number: "", quotation_date: "", quotation_amount: 0, is_selected: false, attachment_url: "", attachment_name: "" }
  ])

  const [supportingDocs, setSupportingDocs] = useState<UploadedFile[]>([])
  const [uploadingQuotation, setUploadingQuotation] = useState<number | null>(null)
  const [uploadingDoc, setUploadingDoc] = useState(false)

  // Fetch master data on mount
  useEffect(() => {
    async function fetchMasterData() {
      try {
        const [deptRes, secRes, projRes, provRes, fundRes, ccRes, codeRes, urgencyRows, methodRows, unitRows, supplierRows] = await Promise.all([
          supabase.from('departments').select('id, code, name').eq('is_active', true).order('name'),
          supabase.from('sections').select('id, code, name, department_id').eq('is_active', true).order('name'),
          supabase.from('projects').select('id, code, name').eq('is_active', true).order('name'),
          supabase.from('provinces').select('id, code, name').eq('is_active', true).order('name'),
          supabase.from('funding_sources').select('id, code, name').eq('is_active', true).order('name'),
          supabase.from('cost_centres').select('id, code, name, section_id, department_id').eq('is_active', true).order('code'),
          supabase.from('expense_code_registry').select('id, full_expense_code, section_id').eq('is_active', true).order('full_expense_code'),
          loadLookup('urgency_levels'),
          loadLookup('procurement_methods'),
          loadLookup('units_of_measure'),
          loadLookup('suppliers', { order: 'supplier_name' }),
        ])

        setDepartments(deptRes.data || [])
        setSections(secRes.data || [])
        setProjects(projRes.data || [])
        setProvinces(provRes.data || [])
        setFundingSources(fundRes.data || [])
        setCostCentres(ccRes.data || [])
        setUrgencyLevels(urgencyRows)
        setProcurementMethods(methodRows)
        setUnits(unitRows)
        setSuppliers(supplierRows)

        const { data: approvedBudgetCodes } = await supabase
          .from('v_budget_by_code')
          .select('expense_code_registry_id, full_expense_code, section_id')
          .eq('financial_year', activeFinancialYear)

        const approvedCodes = (approvedBudgetCodes || [])
          .filter((code) => code.expense_code_registry_id)
          .map((code) => ({
            id: String(code.expense_code_registry_id),
            full_expense_code: code.full_expense_code || '',
            section_id: code.section_id || null,
          }))

        setExpenseCodes(approvedCodes.length > 0 ? approvedCodes : (codeRes.data || []))
        setFormData((current) => ({
          ...current,
          urgency_level_id: current.urgency_level_id || urgencyRows.find((row) => row.code === current.urgency_level)?.id || "",
          procurement_method_id: current.procurement_method_id || methodRows.find((row) => row.code === current.procurement_method)?.id || "",
        }))

        // Fetch budget info
        const { data: releases } = await supabase
          .from('quarterly_releases')
          .select('released_amount')
          .eq('financial_year', activeFinancialYear)

        const { data: commitments } = await supabase
          .from('ff3_commitments')
          .select('committed_amount, paid_amount')
          .eq('financial_year', activeFinancialYear)

        const quarterlyReleased = releases?.reduce((sum, r) => sum + (r.released_amount || 0), 0) || 0
        const committedAmount = commitments?.reduce((sum, c) => sum + ((c.committed_amount || 0) - (c.paid_amount || 0)), 0) || 0
        const actualExpenditure = commitments?.reduce((sum, c) => sum + (c.paid_amount || 0), 0) || 0

        setBudgetInfo({
          quarterly_released: quarterlyReleased,
          available_balance: quarterlyReleased - committedAmount - actualExpenditure
        })

      } catch (err) {
        console.error('Error fetching master data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchMasterData()
  }, [activeFinancialYear])

  // Sections available for the selected department (derived state)
  const filteredSections = useMemo(
    () => formData.department_id ? sections.filter(s => s.department_id === formData.department_id) : [],
    [formData.department_id, sections]
  )

  const filteredCostCentres = useMemo(
    () => costCentres.filter(c => (!formData.section_id || c.section_id === formData.section_id) && (!formData.department_id || c.department_id === formData.department_id)),
    [costCentres, formData.section_id, formData.department_id]
  )

  const filteredCodes = useMemo(
    () => expenseCodes.filter(c => !formData.section_id || c.section_id === formData.section_id || !c.section_id),
    [expenseCodes, formData.section_id]
  )

  // Look up the budget position for the chosen expense code (or section) — spec §14
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
        if (!cancelled) setBudgetCheck({
          budgetAllocationId: res.budgetAllocationId,
          mappingStatus: res.mappingStatus,
          allocationCount: res.allocationCount,
          revised: res.revised,
          released: res.released,
          pending: res.pending,
          committed: res.committed,
          spent: res.spent,
          available: res.available,
          projectedAvailableAfterPending: res.projectedAvailableAfterPending,
          hasAllocation: res.hasAllocation,
        })
      } catch {
        if (!cancelled) setBudgetCheck(null)
      }
    }
    loadPosition()
    return () => { cancelled = true }
  }, [formData.expense_code_registry_id, formData.section_id, formData.department_id, formData.cost_centre_id, formData.funding_source_id, formData.project_id, formData.financial_year])

  const addItem = () => {
    setItems([...items, {
      line_number: items.length + 1,
      item_description: "",
      specifications: "",
      quantity: 0,
      unit_of_measure: "",
      unit_of_measure_id: "",
      estimated_unit_price: 0
    }])
  }

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index))
    }
  }

  const addQuotation = () => {
    setQuotations([...quotations, {
      supplier_id: "",
      supplier_name: "",
      quotation_number: "",
      quotation_date: "",
      quotation_amount: 0,
      is_selected: false,
      attachment_url: "",
      attachment_name: ""
    }])
  }

  // Handle quotation file upload
  const handleQuotationUpload = async (index: number, file: File) => {
    if (!file) return

    setUploadingQuotation(index)
    try {
      // Use a temporary ID until the FF3 is created
      const tempId = `temp-${Date.now()}`
      const uploaded = await uploadFile(BUCKETS.QUOTATIONS, tempId, file)

      const newQuots = [...quotations]
      newQuots[index].attachment_url = uploaded.url
      newQuots[index].attachment_name = uploaded.name
      setQuotations(newQuots)
    } catch (err) {
      console.error('Upload error:', err)
      setError('Failed to upload quotation file')
    } finally {
      setUploadingQuotation(null)
    }
  }

  // Handle supporting document upload
  const handleDocUpload = async (file: File) => {
    if (!file) return

    setUploadingDoc(true)
    try {
      const tempId = `temp-${Date.now()}`
      const uploaded = await uploadFile(BUCKETS.FF3_ATTACHMENTS, tempId, file)
      setSupportingDocs(prev => [...prev, uploaded])
    } catch (err) {
      console.error('Upload error:', err)
      setError('Failed to upload supporting document')
    } finally {
      setUploadingDoc(false)
    }
  }

  // Remove supporting document
  const removeDoc = (index: number) => {
    setSupportingDocs(prev => prev.filter((_, i) => i !== index))
  }

  const totalEstimate = items.reduce((sum, item) => sum + (item.quantity * item.estimated_unit_price), 0)
  const effectiveAvailable = budgetCheck?.hasAllocation ? budgetCheck.available : budgetInfo.available_balance
  const selectedCode = expenseCodes.find(c => c.id === formData.expense_code_registry_id)
  const selectedQuotation = quotations.find(q => q.is_selected)
  const quotationCount = quotations.filter(q => q.supplier_name && q.quotation_amount > 0).length
  const supplierExceptionComplete = formData.supplier_not_required && formData.supplier_not_required_reason.trim() && formData.supplier_not_required_expenditure_type.trim()
  const supplierRequirementMet = formData.supplier_not_required ? supplierExceptionComplete : Boolean(selectedQuotation?.supplier_id)
  const canSubmit = (formData.supplier_not_required || quotationCount >= 3) && supplierRequirementMet && totalEstimate > 0 && formData.purpose && formData.justification && formData.department_id && formData.section_id

  const handleSaveDraft = async () => {
    await saveFF3('DRAFT')
  }

  const handleSubmit = async () => {
    await saveFF3('SUBMITTED')
  }

  const saveFF3 = async (status: 'DRAFT' | 'SUBMITTED') => {
    setError("")
    setSuccess("")
    setSubmitting(true)

    try {
      let latestBudget = budgetCheck
      // Check budget before submitting against the exact approved Excel budget allocation.
      if (status === 'SUBMITTED') {
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
        latestBudget = {
          budgetAllocationId: checkedBudget.budgetAllocationId,
          mappingStatus: checkedBudget.mappingStatus,
          allocationCount: checkedBudget.allocationCount,
          revised: checkedBudget.revised,
          released: checkedBudget.released,
          pending: checkedBudget.pending,
          committed: checkedBudget.committed,
          spent: checkedBudget.spent,
          available: checkedBudget.available,
          projectedAvailableAfterPending: checkedBudget.projectedAvailableAfterPending,
          hasAllocation: checkedBudget.hasAllocation,
        }
        if (!checkedBudget.hasAllocation) {
          setError(checkedBudget.mappingStatus === 'BUDGET_MAPPING_REQUIRED_AMBIGUOUS'
            ? 'More than one budget allocation matches this FF3. Select a more specific department, section, cost centre, funding source, project and finance code.'
            : 'No exact approved budget allocation was found for this FF3.')
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
        setError('Select an approved supplier quotation before submitting an FF3 for supplier-based expenditure.')
        setSubmitting(false)
        return
      }
      if (formData.supplier_not_required && (!formData.supplier_not_required_reason.trim() || !formData.supplier_not_required_expenditure_type.trim())) {
        setError('Supplier-not-required FF3s need an expenditure type and authorized reason.')
        setSubmitting(false)
        return
      }

      // Insert FF3 header
      const { data: header, error: headerError } = await supabase
        .from('ff3_headers')
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
          status: 'DRAFT',
          selected_supplier_id: formData.supplier_not_required ? null : selectedQuotation?.supplier_id || null,
          selected_supplier_name: formData.supplier_not_required ? 'SUPPLIER_NOT_REQUIRED' : selectedQuotation?.supplier_name || null,
          supplier_not_required: formData.supplier_not_required,
          supplier_not_required_reason: formData.supplier_not_required ? formData.supplier_not_required_reason : null,
          supplier_not_required_expenditure_type: formData.supplier_not_required ? formData.supplier_not_required_expenditure_type : null,
          supplier_not_required_comments: formData.supplier_not_required ? formData.supplier_not_required_comments || null : null,
          total_estimated_amount: totalEstimate,
          is_within_budget: status === 'SUBMITTED' ? true : totalEstimate <= (latestBudget?.available ?? budgetInfo.available_balance),
          submitted_date: status === 'SUBMITTED' ? new Date().toISOString() : null
        })
        .select()
        .single()

      if (headerError) throw headerError

      // Insert FF3 items
      const itemsToInsert = items
        .filter(item => item.item_description)
        .map((item, index) => ({
          ff3_header_id: header.id,
          line_number: index + 1,
          item_description: item.item_description,
          specifications: item.specifications || null,
          quantity: item.quantity,
          unit_of_measure: item.unit_of_measure || null,
          unit_of_measure_id: item.unit_of_measure_id || null,
          estimated_unit_price: item.estimated_unit_price
        }))

      if (itemsToInsert.length > 0) {
        const { error: itemsError } = await supabase
          .from('ff3_items')
          .insert(itemsToInsert)

        if (itemsError) throw itemsError
      }

      // Insert FF3 quotations
      const quotsToInsert = quotations
        .filter(q => q.supplier_name && q.quotation_amount > 0)
        .map(q => ({
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
        const { error: quotsError } = await supabase
          .from('ff3_quotations')
          .insert(quotsToInsert)

        if (quotsError) throw quotsError
      }

      setSuccess(`FF3 ${header.ff3_number} ${status === 'DRAFT' ? 'saved as draft' : 'submitted for approval'}!`)

      // Use the controlled database workflow for submission so pending state is budget-checked atomically.
      if (status === 'SUBMITTED') {
        await approveFF3(header.id, 'SUBMIT', 'Submitted from FF3 creation screen')
        await notifyFF3Submitted(header.ff3_number, header.id, totalEstimate)
      }

      // Redirect after short delay
      setTimeout(() => {
        router.push('/dashboard/ff3')
      }, 1500)

    } catch (err: unknown) {
      console.error('Error saving FF3:', err)
      setError(err instanceof Error ? err.message : 'Failed to save FF3. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-png-red" />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/ff3" className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">New FF3 Requisition</h1>
          <p className="text-slate-600 mt-1">Finance Form 3 - Requisition and Commitment Request</p>
        </div>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
          <div>
            <p className="font-medium text-red-900">Error</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
          <div>
            <p className="font-medium text-green-900">Success</p>
            <p className="text-sm text-green-700 mt-1">{success}</p>
          </div>
        </div>
      )}

      {/* Validation Alert */}
      {quotationCount < 3 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
          <div>
            <p className="font-medium text-amber-900">Minimum 3 Quotations Required</p>
            <p className="text-sm text-amber-700 mt-1">
              You have {quotationCount} valid quotation(s). Add {3 - quotationCount} more to submit.
            </p>
          </div>
        </div>
      )}

      {/* Section A: Requisition Header */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section A: Requisition Header</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Financial Year</label>
            <input
              type="number"
              value={formData.financial_year}
              onChange={(e) => setFormData({ ...formData, financial_year: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Department <span className="text-red-500">*</span></label>
            <select
              value={formData.department_id}
              onChange={(e) => setFormData({ ...formData, department_id: e.target.value, section_id: "" })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
            >
              <option value="">Select Department</option>
              {departments.map(dept => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Section <span className="text-red-500">*</span></label>
            <select
              value={formData.section_id}
              onChange={(e) => setFormData({ ...formData, section_id: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
              disabled={!formData.department_id}
            >
              <option value="">Select Section</option>
              {filteredSections.map(sec => (
                <option key={sec.id} value={sec.id}>{sec.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Project / Portfolio</label>
            <select
              value={formData.project_id}
              onChange={(e) => setFormData({ ...formData, project_id: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
            >
              <option value="">Select Project</option>
              {projects.map(proj => (
                <option key={proj.id} value={proj.id}>{proj.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Province</label>
            <select
              value={formData.province_id}
              onChange={(e) => setFormData({ ...formData, province_id: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
            >
              <option value="">Select Province</option>
              {provinces.map(prov => (
                <option key={prov.id} value={prov.id}>{prov.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Funding Source</label>
            <select
              value={formData.funding_source_id}
              onChange={(e) => setFormData({ ...formData, funding_source_id: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
            >
              <option value="">Select Funding Source</option>
              {fundingSources.map(fs => (
                <option key={fs.id} value={fs.id}>{fs.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Cost Centre</label>
            <select
              value={formData.cost_centre_id}
              onChange={(e) => setFormData({ ...formData, cost_centre_id: e.target.value })}
              disabled={!formData.department_id}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red disabled:bg-slate-100"
            >
              <option value="">Select Cost Centre</option>
              {filteredCostCentres.map(cc => (
                <option key={cc.id} value={cc.id}>{cc.code} — {cc.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Expense Code <span className="text-slate-400 text-xs">(approved budget line)</span></label>
            <select
              value={formData.expense_code_registry_id}
              onChange={(e) => setFormData({ ...formData, expense_code_registry_id: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red font-mono text-sm"
            >
              <option value="">Select Expense Code</option>
              {filteredCodes.map(c => (
                <option key={c.id} value={c.id}>{c.full_expense_code}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Section B: Request Details */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section B: Request Details</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Purpose of Expenditure <span className="text-red-500">*</span></label>
            <textarea
              value={formData.purpose}
              onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
              rows={3}
              placeholder="Describe the purpose of this expenditure..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Justification <span className="text-red-500">*</span></label>
            <textarea
              value={formData.justification}
              onChange={(e) => setFormData({ ...formData, justification: e.target.value })}
              rows={3}
              placeholder="Provide justification for this expenditure..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
            />
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Required By Date</label>
              <input
                type="date"
                value={formData.required_by_date}
                onChange={(e) => setFormData({ ...formData, required_by_date: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
              />
            </div>
            <LookupSelect label="Urgency Level" value={formData.urgency_level_id} options={urgencyLevels} placeholder="Select urgency" onChange={(value, option) => setFormData({ ...formData, urgency_level_id: value, urgency_level: option?.code || "" })} />
            <LookupSelect label="Procurement Method" value={formData.procurement_method_id} options={procurementMethods} placeholder="Select method" canAdd addTable="procurement_methods" addLabel="+ Add Procurement Method" onRefresh={async () => setProcurementMethods(await loadLookup('procurement_methods'))} onChange={(value, option) => setFormData({ ...formData, procurement_method_id: value, procurement_method: option?.code || "" })} />
          </div>
        </div>
      </div>

      {/* Section C: Item Details */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Section C: Item Details</h2>
          <button
            onClick={addItem}
            className="px-3 py-1.5 bg-png-red text-white rounded-lg text-sm font-medium hover:bg-png-maroon flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </button>
        </div>
        <div className="space-y-4">
          {items.map((item, index) => (
            <div key={index} className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-slate-700">Item {index + 1}</span>
                {items.length > 1 && (
                  <button onClick={() => removeItem(index)} className="text-red-600 hover:text-red-700">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Item Description <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={item.item_description}
                    onChange={(e) => {
                      const newItems = [...items]
                      newItems[index].item_description = e.target.value
                      setItems(newItems)
                    }}
                    placeholder="Enter item description"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    value={item.quantity || ""}
                    onChange={(e) => {
                      const newItems = [...items]
                      newItems[index].quantity = parseFloat(e.target.value) || 0
                      setItems(newItems)
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Unit Price (K)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={item.estimated_unit_price || ""}
                    onChange={(e) => {
                      const newItems = [...items]
                      newItems[index].estimated_unit_price = parseFloat(e.target.value) || 0
                      setItems(newItems)
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
                  />
                </div>
                <LookupSelect label="Unit of Measure" value={item.unit_of_measure_id} options={units} placeholder="Select unit" canAdd addTable="units_of_measure" addLabel="+ Add Unit" onRefresh={async () => setUnits(await loadLookup('units_of_measure'))} onChange={(value, option) => {
                  const newItems = [...items]
                  newItems[index].unit_of_measure_id = value
                  newItems[index].unit_of_measure = option?.name || ""
                  setItems(newItems)
                }} />
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Total (K)</label>
                  <input
                    type="text"
                    value={(item.quantity * item.estimated_unit_price).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    disabled
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 font-medium"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between p-4 bg-slate-50 rounded-lg">
          <span className="font-semibold text-slate-900">Total Estimated Amount:</span>
          <span className="text-xl font-bold text-slate-900">K {totalEstimate.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        </div>
      </div>

      {/* Section D: Supplier / Service Provider Control */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section D: Supplier / Service Provider Control</h2>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={formData.supplier_not_required}
              onChange={(event) => setFormData({ ...formData, supplier_not_required: event.target.checked })}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-png-red"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-900">Supplier not required for this expenditure</span>
              <span className="block text-sm text-slate-600">Use only for legitimate non-supplier expenditure. Do not create fake GENERAL, N/A, or placeholder suppliers.</span>
            </span>
          </label>
          {formData.supplier_not_required && (
            <div className="mt-4 grid md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Expenditure Type <span className="text-red-500">*</span></label>
                <input value={formData.supplier_not_required_expenditure_type} onChange={(event) => setFormData({ ...formData, supplier_not_required_expenditure_type: event.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" placeholder="e.g. Internal statutory charge" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Authorized Reason <span className="text-red-500">*</span></label>
                <input value={formData.supplier_not_required_reason} onChange={(event) => setFormData({ ...formData, supplier_not_required_reason: event.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" placeholder="Why no supplier is required" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Comments</label>
                <input value={formData.supplier_not_required_comments} onChange={(event) => setFormData({ ...formData, supplier_not_required_comments: event.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red" placeholder="Optional approval notes" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section E: Quotations (Minimum 3 Required) */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Section E: Quotations <span className="text-red-500">*</span></h2>
            <p className="text-sm text-slate-600 mt-1">Minimum 3 quotations required for supplier-based expenditure. Select the quotation whose approved supplier will be committed.</p>
          </div>
          <button
            onClick={addQuotation}
            className="px-3 py-1.5 bg-png-red text-white rounded-lg text-sm font-medium hover:bg-png-maroon flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Quotation
          </button>
        </div>
        <div className="space-y-4">
          {quotations.map((quot, index) => (
            <div key={index} className={`border rounded-lg p-4 ${quot.is_selected ? 'border-green-500 bg-green-50' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-slate-700">Quotation {index + 1}</span>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="selected_quotation"
                    checked={quot.is_selected}
                    onChange={() => {
                      const newQuots = quotations.map((q, i) => ({
                        ...q,
                        is_selected: i === index
                      }))
                      setQuotations(newQuots)
                    }}
                    className="h-4 w-4 text-green-600"
                  />
                  <span className="text-sm text-slate-700">Select</span>
                </label>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
                <LookupSelect label="Supplier Name" required value={quot.supplier_id} options={suppliers} placeholder="Search approved supplier" canAdd addTable="suppliers" addLabel="+ Register Supplier" emptyLabel="No approved suppliers found. Register a supplier, then submit/verify/approve it in Supplier Management before final FF3 approval." addFields={[{ name: 'legal_name', label: 'Legal Name', required: true }, { name: 'trading_name', label: 'Trading Name' }, { name: 'supplier_type', label: 'Supplier Type', placeholder: 'GOODS_SUPPLIER or SERVICE_PROVIDER' }, { name: 'ipa_registration_number', label: 'IPA Registration Number' }, { name: 'tin', label: 'TIN' }, { name: 'primary_contact_name', label: 'Primary Contact' }, { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email' }]} createVia={async (form) => {
                  const result = await createSupplier({
                    legal_name: form.legal_name,
                    trading_name: form.trading_name,
                    supplier_type: form.supplier_type || 'GOODS_SUPPLIER',
                    ipa_registration_number: form.ipa_registration_number,
                    tin: form.tin,
                    primary_contact_name: form.primary_contact_name,
                    phone: form.phone,
                    email: form.email,
                  })
                  if (result.requires_review) throw new Error('POSSIBLE DUPLICATE SUPPLIER. Review Supplier Management before continuing.')
                  if (!result.supplier) throw new Error('Supplier registration did not return a supplier record.')
                  return { ...result.supplier, id: result.supplier.id, code: result.supplier.supplier_code, name: result.supplier.supplier_name }
                }} onRefresh={async () => setSuppliers(await loadLookup('suppliers', { order: 'supplier_name' }))} onChange={(value, option) => {
                  const newQuots = [...quotations]
                  newQuots[index].supplier_id = value
                  newQuots[index].supplier_name = option?.name || ""
                  setQuotations(newQuots)
                }} />
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quotation Number</label>
                  <input
                    type="text"
                    value={quot.quotation_number}
                    onChange={(e) => {
                      const newQuots = [...quotations]
                      newQuots[index].quotation_number = e.target.value
                      setQuotations(newQuots)
                    }}
                    placeholder="Quote #"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quote Date</label>
                  <input
                    type="date"
                    value={quot.quotation_date}
                    onChange={(e) => {
                      const newQuots = [...quotations]
                      newQuots[index].quotation_date = e.target.value
                      setQuotations(newQuots)
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Amount (K) <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    step="0.01"
                    value={quot.quotation_amount || ""}
                    onChange={(e) => {
                      const newQuots = [...quotations]
                      newQuots[index].quotation_amount = parseFloat(e.target.value) || 0
                      setQuotations(newQuots)
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
                  />
                </div>
              </div>
              {/* Quotation File Upload */}
              <div className="mt-3">
                <label className="block text-sm font-medium text-slate-700 mb-1">Quotation Document</label>
                {quot.attachment_url ? (
                  <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                    <FileText className="h-4 w-4 text-green-600" />
                    <a href={quot.attachment_url} target="_blank" rel="noopener noreferrer" className="text-sm text-green-700 hover:underline flex-1 truncate">
                      {quot.attachment_name || 'View Attachment'}
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        const newQuots = [...quotations]
                        newQuots[index].attachment_url = ""
                        newQuots[index].attachment_name = ""
                        setQuotations(newQuots)
                      }}
                      className="p-1 hover:bg-green-100 rounded"
                    >
                      <X className="h-4 w-4 text-green-600" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 p-2 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50">
                    {uploadingQuotation === index ? (
                      <Loader2 className="h-4 w-4 text-png-red animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 text-slate-400" />
                    )}
                    <span className="text-sm text-slate-600">
                      {uploadingQuotation === index ? 'Uploading...' : 'Upload PDF or Image'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => e.target.files?.[0] && handleQuotationUpload(index, e.target.files[0])}
                      className="hidden"
                      disabled={uploadingQuotation !== null}
                    />
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Section E: Supporting Documents */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section E: Supporting Documents</h2>
        <p className="text-sm text-slate-600 mb-4">Upload any supporting documents such as specifications, approvals, or other relevant files.</p>

        {/* Upload Area */}
        <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 hover:border-png-gold transition-colors">
          {uploadingDoc ? (
            <Loader2 className="h-8 w-8 text-png-red animate-spin mb-2" />
          ) : (
            <Upload className="h-8 w-8 text-slate-400 mb-2" />
          )}
          <span className="text-sm font-medium text-slate-700">
            {uploadingDoc ? 'Uploading...' : 'Click to upload supporting documents'}
          </span>
          <span className="text-xs text-slate-500 mt-1">PDF, JPG, PNG up to 10MB</span>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
            onChange={(e) => e.target.files?.[0] && handleDocUpload(e.target.files[0])}
            className="hidden"
            disabled={uploadingDoc}
          />
        </label>

        {/* Uploaded Documents List */}
        {supportingDocs.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium text-slate-700">Uploaded Documents ({supportingDocs.length})</p>
            {supportingDocs.map((doc, index) => (
              <div key={doc.id} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <FileText className="h-5 w-5 text-png-red" />
                <div className="flex-1 min-w-0">
                  <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-png-red hover:underline truncate block">
                    {doc.name}
                  </a>
                  <p className="text-xs text-slate-500">{(doc.size / 1024).toFixed(1)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeDoc(index)}
                  className="p-1 hover:bg-slate-200 rounded"
                >
                  <X className="h-4 w-4 text-slate-500" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section F: Budget Validation */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Section F: Budget Validation</h2>
          {selectedCode && (
            <span className="font-mono text-xs px-2 py-1 rounded-lg bg-png-red/5 text-png-red border border-png-gold/40">{selectedCode.full_expense_code}</span>
          )}
        </div>
        {budgetCheck?.hasAllocation ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-500 mb-1">{selectedCode ? "Position for the selected expense code" : "Position for the selected section"}</p>
            <BudgetLine label="Approved Budget (Revised)" amount={budgetCheck.revised} />
            <BudgetLine label="Released (cash available)" amount={budgetCheck.released} />
            <BudgetLine label="Pending Requests" amount={budgetCheck.pending} />
            <BudgetLine label="Committed" amount={budgetCheck.committed} />
            <BudgetLine label="Actual Expenditure" amount={budgetCheck.spent} />
            <BudgetLine label="Available Balance" amount={budgetCheck.available} isTotal />
            <div className="border-t border-slate-200 pt-2 mt-2">
              <BudgetLine label="This Request" amount={totalEstimate} highlight />
              <BudgetLine label="Available After This Request" amount={budgetCheck.available - totalEstimate} />
              <BudgetLine label="Projected Available After Pending" amount={budgetCheck.projectedAvailableAfterPending - totalEstimate} />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {(formData.expense_code_registry_id || formData.section_id) && (
              <div className="mb-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> Exact budget allocation is required. {budgetCheck?.mappingStatus === 'BUDGET_MAPPING_REQUIRED_AMBIGUOUS' ? 'Multiple allocations match this request.' : 'No confirmed budget allocation found yet.'}
              </div>
            )}
            <BudgetLine label="Quarterly Released" amount={budgetInfo.quarterly_released} />
            <BudgetLine label="Available Balance" amount={budgetInfo.available_balance} isTotal />
            <div className="border-t border-slate-200 pt-2 mt-2">
              <BudgetLine label="This Request" amount={totalEstimate} highlight />
            </div>
          </div>
        )}
        {totalEstimate > 0 && (
          <div className={`mt-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
            totalEstimate <= effectiveAvailable ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {totalEstimate <= effectiveAvailable ? (
              <><CheckCircle2 className="h-4 w-4" /><span className="font-medium">Within Budget — sufficient funds available (K {effectiveAvailable.toLocaleString()} remaining)</span></>
            ) : (
              <><AlertCircle className="h-4 w-4" /><span className="font-medium">Insufficient Funds — exceeds available balance of K {effectiveAvailable.toLocaleString()}</span></>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 z-10">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <Link
            href="/dashboard/ff3"
            className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </Link>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveDraft}
              disabled={submitting}
              className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save as Draft
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="px-6 py-2 bg-png-red text-white rounded-lg font-medium hover:bg-png-maroon disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit for Approval
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function BudgetLine({ label, amount, isNegative = false, isTotal = false, highlight = false }: {
  label: string
  amount: number
  isNegative?: boolean
  isTotal?: boolean
  highlight?: boolean
}) {
  return (
    <div className={`flex items-center justify-between py-1 ${isTotal ? 'text-lg font-bold' : ''} ${highlight ? 'text-png-red font-semibold' : ''}`}>
      <span className={isTotal ? 'text-slate-900' : 'text-slate-700'}>{label}</span>
      <span className={`${isTotal ? 'text-green-700' : isNegative ? 'text-red-600' : 'text-slate-900'}`}>
        K {amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  )
}
