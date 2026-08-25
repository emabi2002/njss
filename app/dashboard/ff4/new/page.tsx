"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Save, Send, ArrowLeft, AlertCircle, CheckCircle2, Upload, Loader2, FileText, X } from "lucide-react"
import { uploadFile, BUCKETS, type UploadedFile } from "@/lib/storage"
import { LookupSelect, type LookupOption } from "@/components/LookupSelect"
import { loadActiveUsers, loadLookup } from "@/lib/lookups"
import { createFF4Controlled, createSupplier, getPayableCommitments, type PayableCommitmentRow } from "@/lib/api"
import { supabase } from "@/lib/supabase"

type PayableFF3 = PayableCommitmentRow & {
  id: string
  committed_amount: number
  remaining_balance: number
}

type FF3ImportItem = {
  id: string
  line_number: number
  item_code: string | null
  item_description: string
  specifications: string | null
  quantity: number
  unit_of_measure: string | null
  estimated_unit_price: number | null
  total_amount: number | null
}

type FF3ImportQuotation = {
  id: string
  supplier_id: string | null
  supplier_name: string
  quotation_number: string | null
  quotation_date: string | null
  quotation_amount: number
  is_selected: boolean
}

type PaymentLineDraft = {
  line_number: number
  source: "FF3_ITEM" | "SELECTED_QUOTE" | "INVOICE" | "MANUAL"
  reference: string
  description: string
  quantity: number
  unit: string
  unit_price: number
  tax_amount: number
  deduction_amount: number
  notes: string
}

const newPaymentLine = (lineNumber: number): PaymentLineDraft => ({
  line_number: lineNumber,
  source: "MANUAL",
  reference: "",
  description: "",
  quantity: 0,
  unit: "",
  unit_price: 0,
  tax_amount: 0,
  deduction_amount: 0,
  notes: "",
})

const lineGross = (line: PaymentLineDraft) => (Number(line.quantity) || 0) * (Number(line.unit_price) || 0)
const money = (value: number) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const isBlankPaymentLine = (line: PaymentLineDraft) =>
  !line.reference.trim() &&
  !line.description.trim() &&
  !line.unit.trim() &&
  !line.notes.trim() &&
  Number(line.quantity || 0) === 0 &&
  Number(line.unit_price || 0) === 0 &&
  Number(line.tax_amount || 0) === 0 &&
  Number(line.deduction_amount || 0) === 0

export default function NewFF4Page() {
  const router = useRouter()
  const activeFinancialYear = new Date().getFullYear()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [availableFF3s, setAvailableFF3s] = useState<PayableFF3[]>([])
  const [selectedFF3, setSelectedFF3] = useState<PayableFF3 | null>(null)
  const [payeeTypes, setPayeeTypes] = useState<LookupOption[]>([])
  const [paymentMethods, setPaymentMethods] = useState<LookupOption[]>([])
  const [suppliers, setSuppliers] = useState<LookupOption[]>([])
  const [users, setUsers] = useState<LookupOption[]>([])

  const [ff3ImportItems, setFf3ImportItems] = useState<FF3ImportItem[]>([])
  const [ff3ImportQuotations, setFf3ImportQuotations] = useState<FF3ImportQuotation[]>([])
  const [loadingFf3Lines, setLoadingFf3Lines] = useState(false)
  const [paymentLines, setPaymentLines] = useState<PaymentLineDraft[]>([newPaymentLine(1)])

  const [invoiceFile, setInvoiceFile] = useState<UploadedFile | null>(null)
  const [receiptFile, setReceiptFile] = useState<UploadedFile | null>(null)
  const [uploadingInvoice, setUploadingInvoice] = useState(false)
  const [uploadingReceipt, setUploadingReceipt] = useState(false)

  const [formData, setFormData] = useState({
    ff3_header_id: "",
    commitment_id: "",
    payee_type: "SUPPLIER",
    payee_type_id: "",
    payee_name: "",
    supplier_id: "",
    payee_user_id: "",
    supplier_code: "",
    invoice_number: "",
    invoice_date: "",
    claim_reference: "",
    payment_description: "",
    gross_amount: 0,
    tax_amount: 0,
    deductions: 0,
    payment_method: "EFT",
    payment_method_id: "",
    external_payment_reference: "",
    remarks: "",
  })

  const fetchApprovedFF3s = useCallback(async () => {
    try {
      const [payeeTypeRows, paymentMethodRows, supplierRows, userRows, commitmentRows] = await Promise.all([
        loadLookup("payee_types"),
        loadLookup("payment_methods"),
        loadLookup("suppliers", { order: "supplier_name" }),
        loadActiveUsers(),
        getPayableCommitments(activeFinancialYear),
      ])
      setPayeeTypes(payeeTypeRows)
      setPaymentMethods(paymentMethodRows)
      setSuppliers(supplierRows)
      setUsers(userRows)
      setFormData((current) => ({
        ...current,
        payee_type_id: current.payee_type_id || payeeTypeRows.find((row) => row.code === current.payee_type)?.id || "",
        payment_method_id: current.payment_method_id || paymentMethodRows.find((row) => row.code === current.payment_method)?.id || "",
      }))
      setAvailableFF3s(
        commitmentRows.map((row) => ({
          ...row,
          id: row.ff3_header_id,
          committed_amount: row.current_commitment,
          remaining_balance: row.available_for_ff4,
        }))
      )
    } catch (err) {
      console.error("Error fetching approved FF3s:", err)
    } finally {
      setLoading(false)
    }
  }, [activeFinancialYear])

  const loadFF3ImportRows = async (ff3HeaderId: string) => {
    if (!ff3HeaderId) {
      setFf3ImportItems([])
      setFf3ImportQuotations([])
      return
    }
    setLoadingFf3Lines(true)
    try {
      const [itemsRes, quotationsRes] = await Promise.all([
        supabase
          .from("ff3_items")
          .select("id, line_number, item_code, item_description, specifications, quantity, unit_of_measure, estimated_unit_price, total_amount")
          .eq("ff3_header_id", ff3HeaderId)
          .order("line_number"),
        supabase
          .from("ff3_quotations")
          .select("id, supplier_id, supplier_name, quotation_number, quotation_date, quotation_amount, is_selected")
          .eq("ff3_header_id", ff3HeaderId)
          .order("created_at"),
      ])
      if (itemsRes.error) throw itemsRes.error
      if (quotationsRes.error) throw quotationsRes.error
      setFf3ImportItems((itemsRes.data || []) as FF3ImportItem[])
      setFf3ImportQuotations((quotationsRes.data || []) as FF3ImportQuotation[])
    } catch (err) {
      console.error("Error loading FF3 import rows:", err)
      setError(err instanceof Error ? err.message : "Could not load FF3 line items for import.")
      setFf3ImportItems([])
      setFf3ImportQuotations([])
    } finally {
      setLoadingFf3Lines(false)
    }
  }

  useEffect(() => {
    // Data fetch on mount is the intended effect here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchApprovedFF3s()
  }, [fetchApprovedFF3s])

  const renumberPaymentLines = (rows: PaymentLineDraft[]) => rows.map((line, index) => ({ ...line, line_number: index + 1 }))
  const updatePaymentLine = (index: number, patch: Partial<PaymentLineDraft>) =>
    setPaymentLines((rows) => rows.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)))
  const addPaymentLine = () => setPaymentLines((rows) => [...rows, newPaymentLine(rows.length + 1)])
  const removePaymentLine = (index: number) =>
    setPaymentLines((rows) => {
      const next = rows.filter((_, lineIndex) => lineIndex !== index)
      return renumberPaymentLines(next.length ? next : [newPaymentLine(1)])
    })

  const importFF3LineItems = () => {
    if (!ff3ImportItems.length) {
      setError("No FF3 item rows were found to import into the payment worksheet.")
      return
    }
    const rows = ff3ImportItems.map((item, index) => ({
      line_number: index + 1,
      source: "FF3_ITEM" as const,
      reference: item.item_code || `FF3 Line ${item.line_number}`,
      description: [item.item_description, item.specifications].filter(Boolean).join(" — "),
      quantity: Number(item.quantity || 0),
      unit: item.unit_of_measure || "",
      unit_price: Number(item.estimated_unit_price || 0),
      tax_amount: 0,
      deduction_amount: 0,
      notes: `Imported from ${selectedFF3?.ff3_number || "selected FF3"} line ${item.line_number}`,
    }))
    setPaymentLines(rows)
    setError("")
  }

  const importSelectedQuotation = () => {
    const quotation = ff3ImportQuotations.find((row) => row.is_selected) || ff3ImportQuotations[0]
    if (!quotation) {
      setError("No FF3 quotation rows were found to import into the payment worksheet.")
      return
    }
    setPaymentLines([
      {
        line_number: 1,
        source: "SELECTED_QUOTE",
        reference: quotation.quotation_number || `Quote from ${quotation.supplier_name}`,
        description: `Selected quotation payable to ${quotation.supplier_name}`,
        quantity: 1,
        unit: "Quote",
        unit_price: Number(quotation.quotation_amount || 0),
        tax_amount: 0,
        deduction_amount: 0,
        notes: quotation.quotation_date ? `Quotation date: ${quotation.quotation_date}` : "Imported from FF3 quotation register",
      },
    ])
    setError("")
  }

  const handleFF3Select = async (ff3Id: string) => {
    const ff3 = availableFF3s.find((f) => f.id === ff3Id)
    setSelectedFF3(ff3 || null)
    setFf3ImportItems([])
    setFf3ImportQuotations([])
    setPaymentLines([newPaymentLine(1)])
    setFormData((prev) => ({
      ...prev,
      ff3_header_id: ff3Id,
      commitment_id: ff3?.commitment_id || "",
      supplier_id: ff3?.supplier_id || prev.supplier_id,
      supplier_code: ff3?.supplier_code || prev.supplier_code,
      payee_name: ff3?.supplier_name || prev.payee_name,
      payment_description: ff3?.purpose ? `Payment for ${ff3.ff3_number}: ${ff3.purpose}` : prev.payment_description,
      gross_amount: 0,
      tax_amount: 0,
      deductions: 0,
    }))
    if (ff3Id) await loadFF3ImportRows(ff3Id)
  }

  const handleInvoiceUpload = async (file: File) => {
    if (!file) return
    setUploadingInvoice(true)
    try {
      const tempId = `invoice-${Date.now()}`
      const uploaded = await uploadFile(BUCKETS.FF4_ATTACHMENTS, tempId, file)
      setInvoiceFile(uploaded)
    } catch (err) {
      console.error("Upload error:", err)
      setError("Failed to upload invoice")
    } finally {
      setUploadingInvoice(false)
    }
  }

  const handleReceiptUpload = async (file: File) => {
    if (!file) return
    setUploadingReceipt(true)
    try {
      const tempId = `receipt-${Date.now()}`
      const uploaded = await uploadFile(BUCKETS.FF4_ATTACHMENTS, tempId, file)
      setReceiptFile(uploaded)
    } catch (err) {
      console.error("Upload error:", err)
      setError("Failed to upload receipt")
    } finally {
      setUploadingReceipt(false)
    }
  }

  const populatedPaymentLines = paymentLines.filter((line) => !isBlankPaymentLine(line))
  const worksheetGrossAmount = populatedPaymentLines.reduce((sum, line) => sum + lineGross(line), 0)
  const worksheetTaxAmount = populatedPaymentLines.reduce((sum, line) => sum + (Number(line.tax_amount) || 0), 0)
  const worksheetDeductionAmount = populatedPaymentLines.reduce((sum, line) => sum + (Number(line.deduction_amount) || 0), 0)

  const grossAmount = populatedPaymentLines.length ? Number(worksheetGrossAmount.toFixed(2)) : formData.gross_amount
  const taxAmount = populatedPaymentLines.length ? Number(worksheetTaxAmount.toFixed(2)) : formData.tax_amount
  const deductionAmount = populatedPaymentLines.length ? Number(worksheetDeductionAmount.toFixed(2)) : formData.deductions

  const paymentLineSummary = populatedPaymentLines.map((line) => ({
    line_number: line.line_number,
    source: line.source,
    reference: line.reference,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unit_price: line.unit_price,
    gross_amount: lineGross(line),
    tax_amount: line.tax_amount,
    deduction_amount: line.deduction_amount,
    net_amount: lineGross(line) - (Number(line.tax_amount) || 0) - (Number(line.deduction_amount) || 0),
    notes: line.notes,
  }))

  const paymentLinesPayload = paymentLineSummary.map((line) => ({
    line_number: line.line_number,
    source: line.source,
    reference: line.reference || null,
    description: line.description || line.reference || "Payment line",
    quantity: Number(line.quantity || 0),
    unit: line.unit || null,
    unit_price: Number(line.unit_price || 0),
    gross_amount: Number(line.gross_amount || 0),
    tax_amount: Number(line.tax_amount || 0),
    deduction_amount: Number(line.deduction_amount || 0),
    net_amount: Number(line.net_amount || 0),
    notes: line.notes || null,
  }))

  const netAmount = grossAmount - taxAmount - deductionAmount

  const hasControlledPayee = formData.payee_type === "EMPLOYEE" ? Boolean(formData.payee_user_id) : Boolean(formData.supplier_id)
  const canSubmit = Boolean(
    formData.ff3_header_id &&
      formData.commitment_id &&
      hasControlledPayee &&
      netAmount > 0 &&
      (selectedFF3 ? netAmount <= selectedFF3.remaining_balance : true)
  )

  const handleSaveDraft = async () => {
    await saveFF4("DRAFT")
  }

  const handleSubmit = async () => {
    await saveFF4("SUBMITTED")
  }

  const saveFF4 = async (status: "DRAFT" | "SUBMITTED") => {
    setError("")
    setSuccess("")
    setSubmitting(true)

    try {
      const attachments = [
        invoiceFile && { file_name: invoiceFile.name, file_type: invoiceFile.type, file_url: invoiceFile.url, attachment_type: "INVOICE" },
        receiptFile && { file_name: receiptFile.name, file_type: receiptFile.type, file_url: receiptFile.url, attachment_type: "SUPPORTING_DOCUMENT" },
      ].filter(Boolean) as Array<{ file_name: string; file_type: string; file_url: string; attachment_type: string }>

      const result = await createFF4Controlled(
        {
          ff3_header_id: formData.ff3_header_id,
          commitment_id: formData.commitment_id,
          payee_type: formData.payee_type,
          payee_type_id: formData.payee_type_id || null,
          payee_name: formData.payee_name,
          supplier_id: formData.supplier_id || null,
          payee_user_id: formData.payee_user_id || null,
          supplier_code: formData.supplier_code || null,
          invoice_number: formData.invoice_number || null,
          invoice_date: formData.invoice_date || null,
          claim_reference: formData.claim_reference || null,
          payment_description: formData.payment_description || (populatedPaymentLines.length ? paymentLineSummary.map((line) => line.description).filter(Boolean).join("; ") : null),
          gross_amount: grossAmount,
          tax_amount: taxAmount,
          deductions: deductionAmount,
          payment_method: formData.payment_method,
          payment_method_id: formData.payment_method_id || null,
          external_payment_reference: formData.external_payment_reference || null,
          remarks: formData.remarks || null,
          payment_lines: paymentLinesPayload,
          is_partial_payment: selectedFF3 ? netAmount < selectedFF3.outstanding_commitment : false,
          attachments,
        },
        status === "SUBMITTED"
      )

      const header = result.header as { ff4_number?: string } | undefined

      setSuccess(`FF4 ${header?.ff4_number || ""} ${status === "DRAFT" ? "saved as draft" : "submitted for verification"}!`)

      setTimeout(() => {
        router.push("/dashboard/ff4")
      }, 1500)
    } catch (err: unknown) {
      console.error("Error saving FF4:", err)
      setError(err instanceof Error ? err.message : "Failed to save FF4. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/ff4" className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">New FF4 Expense</h1>
          <p className="text-slate-600 mt-1">Finance Form 4 - Expense and Payment Request</p>
        </div>
      </div>

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

      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
          <div>
            <p className="font-medium text-green-900">FF4 Must Link to an Existing Commitment</p>
            <p className="text-sm text-green-700 mt-1">
              {availableFF3s.length > 0
                ? `${availableFF3s.length} commitment(s) with available balances found.`
                : "No active commitments with available balance. Approve an FF3 commitment first."}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section A: Linked Requisition</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Select FF3 Commitment <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.ff3_header_id}
              onChange={(e) => handleFF3Select(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select an approved FF3 commitment...</option>
              {availableFF3s.map((ff3) => (
                <option key={ff3.id} value={ff3.id}>
                  {ff3.ff3_number} - {ff3.purpose} ({ff3.commitment_number}, Balance: K {ff3.remaining_balance.toLocaleString()})
                </option>
              ))}
            </select>
          </div>

          {selectedFF3 && (
            <div className="bg-slate-50 rounded-lg p-4">
              <h3 className="font-medium text-slate-900 mb-3">Commitment Details</h3>
              <div className="grid md:grid-cols-5 gap-4">
                <div>
                  <p className="text-xs text-slate-600">Commitment Number</p>
                  <p className="font-medium text-slate-900">{selectedFF3.commitment_number || "Pending"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Committed Amount</p>
                  <p className="font-medium text-slate-900">K {selectedFF3.current_commitment.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Outstanding Commitment</p>
                  <p className="font-medium text-amber-600">K {selectedFF3.outstanding_commitment.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Pending FF4s</p>
                  <p className="font-medium text-slate-900">K {selectedFF3.pending_ff4_amount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Balance After This FF4</p>
                  <p className="font-medium text-png-red">K {Math.max(selectedFF3.remaining_balance - netAmount, 0).toLocaleString()}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section B: Payee Details</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <LookupSelect
            label="Payee Type"
            selectOnly
            value={formData.payee_type_id}
            options={payeeTypes}
            placeholder="Select payee type"
            onChange={(value, option) =>
              setFormData({ ...formData, payee_type_id: value, payee_type: option?.code || "", payee_name: "", supplier_id: "", payee_user_id: "", supplier_code: "" })
            }
          />
          {formData.payee_type === "EMPLOYEE" ? (
            <LookupSelect
              label="Employee Payee"
              required
              value={formData.payee_user_id}
              options={users}
              placeholder="Select employee"
              onChange={(value, option) => setFormData({ ...formData, payee_user_id: value, payee_name: option?.name || "" })}
            />
          ) : (
            <LookupSelect
              label="Payee / Supplier"
              required
              selectOnly
              value={formData.supplier_id}
              options={suppliers}
              placeholder="Search supplier/payee"
              canAdd
              addTable="suppliers"
              addLabel="+ Quick Add Supplier"
              emptyLabel="No active suppliers found. Quick add a supplier to continue."
              addFields={[
                { name: "legal_name", label: "Supplier / Business Name", required: true },
                { name: "primary_contact_name", label: "Contact Person" },
                { name: "phone", label: "Phone" },
                { name: "email", label: "Email" },
                { name: "physical_address", label: "Address" },
                { name: "ipa_registration_number", label: "IPA Registration" },
                { name: "tin", label: "TIN" },
              ]}
              createVia={async (form) => {
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
              }}
              onRefresh={async () => setSuppliers(await loadLookup("suppliers", { order: "supplier_name" }))}
              onChange={(value, option) => setFormData({ ...formData, supplier_id: value, payee_name: option?.name || "", supplier_code: option?.code || "" })}
            />
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Supplier Code</label>
            <input type="text" value={formData.supplier_code} readOnly placeholder="Auto-populated from supplier" className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Invoice Number</label>
            <input
              type="text"
              value={formData.invoice_number}
              onChange={(e) => setFormData({ ...formData, invoice_number: e.target.value })}
              placeholder="Enter invoice number"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Invoice Date</label>
            <input
              type="date"
              value={formData.invoice_date}
              onChange={(e) => setFormData({ ...formData, invoice_date: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Claim Reference</label>
            <input
              type="text"
              value={formData.claim_reference}
              onChange={(e) => setFormData({ ...formData, claim_reference: e.target.value })}
              placeholder="Optional claim reference"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Section C: Payment / Invoice Line Worksheet</h2>
            <p className="mt-1 text-sm text-slate-600">
              Import the selected FF3 requisition lines or selected quotation into this spreadsheet-style worksheet. Gross, tax, deductions and net payable are calculated from the rows below.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={importFF3LineItems}
              disabled={!selectedFF3 || loadingFf3Lines || ff3ImportItems.length === 0}
              className="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingFf3Lines ? "Loading FF3 lines..." : `Import FF3 Lines (${ff3ImportItems.length})`}
            </button>
            <button
              type="button"
              onClick={importSelectedQuotation}
              disabled={!selectedFF3 || loadingFf3Lines || ff3ImportQuotations.length === 0}
              className="rounded-lg border border-green-700 px-3 py-1.5 text-sm font-semibold text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Import Selected Quote ({ff3ImportQuotations.filter((row) => row.is_selected).length || ff3ImportQuotations.length})
            </button>
            <button
              type="button"
              onClick={addPaymentLine}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Add Invoice Line
            </button>
          </div>
        </div>

        {selectedFF3 ? (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            FF3 import source: <span className="font-semibold">{selectedFF3.ff3_number}</span>. Use FF3 Lines when the invoice follows the requisition spreadsheet, or Selected Quote when the payment is a single invoice against the selected supplier quotation.
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Select an FF3 commitment in Section A to enable spreadsheet import from FF3 line items or quotations.
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payment Description</label>
            <textarea
              value={formData.payment_description}
              onChange={(e) => setFormData({ ...formData, payment_description: e.target.value })}
              rows={2}
              placeholder="Describe the payment or let the imported worksheet lines populate the description."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[1280px] w-full border-collapse text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-12 border-b border-slate-200 px-2 py-2 text-right">#</th>
                  <th className="w-36 border-b border-slate-200 px-2 py-2">Source</th>
                  <th className="w-44 border-b border-slate-200 px-2 py-2">Invoice / Quote / FF3 Ref</th>
                  <th className="w-[300px] border-b border-slate-200 px-2 py-2">Line Description</th>
                  <th className="w-24 border-b border-slate-200 px-2 py-2 text-right">Qty</th>
                  <th className="w-28 border-b border-slate-200 px-2 py-2">Unit</th>
                  <th className="w-32 border-b border-slate-200 px-2 py-2 text-right">Unit Price (K)</th>
                  <th className="w-32 border-b border-slate-200 px-2 py-2 text-right">Gross (K)</th>
                  <th className="w-28 border-b border-slate-200 px-2 py-2 text-right">Tax (K)</th>
                  <th className="w-32 border-b border-slate-200 px-2 py-2 text-right">Deductions (K)</th>
                  <th className="w-32 border-b border-slate-200 px-2 py-2 text-right">Net (K)</th>
                  <th className="w-44 border-b border-slate-200 px-2 py-2">Notes</th>
                  <th className="w-20 border-b border-slate-200 px-2 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {paymentLines.map((line, index) => {
                  const gross = lineGross(line)
                  const net = gross - (Number(line.tax_amount) || 0) - (Number(line.deduction_amount) || 0)
                  return (
                    <tr key={index} className={`${index % 2 === 0 ? "bg-white" : "bg-slate-50/60"} align-top`}>
                      <td className="border-b border-slate-100 px-2 py-2 text-right font-semibold text-slate-600">{index + 1}</td>
                      <td className="border-b border-slate-100 px-2 py-1.5">
                        <select
                          value={line.source}
                          onChange={(e) => updatePaymentLine(index, { source: e.target.value as PaymentLineDraft["source"] })}
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-600"
                        >
                          <option value="FF3_ITEM">FF3 Item</option>
                          <option value="SELECTED_QUOTE">Selected Quote</option>
                          <option value="INVOICE">Invoice</option>
                          <option value="MANUAL">Manual</option>
                        </select>
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5">
                        <input
                          value={line.reference}
                          onChange={(e) => updatePaymentLine(index, { reference: e.target.value })}
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-600"
                          placeholder="INV / Quote / line ref"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5">
                        <input
                          value={line.description}
                          onChange={(e) => updatePaymentLine(index, { description: e.target.value })}
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-600"
                          placeholder="Goods or service supplied"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.quantity || ""}
                          onChange={(e) => updatePaymentLine(index, { quantity: Number(e.target.value) || 0 })}
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-green-600"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5">
                        <input
                          value={line.unit}
                          onChange={(e) => updatePaymentLine(index, { unit: e.target.value })}
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-600"
                          placeholder="unit"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unit_price || ""}
                          onChange={(e) => updatePaymentLine(index, { unit_price: Number(e.target.value) || 0 })}
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-green-600"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-2 py-2 text-right font-semibold text-slate-900">{money(gross)}</td>
                      <td className="border-b border-slate-100 px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.tax_amount || ""}
                          onChange={(e) => updatePaymentLine(index, { tax_amount: Number(e.target.value) || 0 })}
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-green-600"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.deduction_amount || ""}
                          onChange={(e) => updatePaymentLine(index, { deduction_amount: Number(e.target.value) || 0 })}
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-green-600"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-2 py-2 text-right font-semibold text-green-700">{money(net)}</td>
                      <td className="border-b border-slate-100 px-2 py-1.5">
                        <input
                          value={line.notes}
                          onChange={(e) => updatePaymentLine(index, { notes: e.target.value })}
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-600"
                          placeholder="optional"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => removePaymentLine(index)}
                          className="rounded-md p-2 text-red-600 hover:bg-red-50"
                          aria-label={`Remove payment line ${index + 1}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 rounded-lg bg-slate-50 p-4 md:grid-cols-4">
            <AmountTotal label="Gross Amount" amount={grossAmount} />
            <AmountTotal label="Tax Amount" amount={taxAmount} />
            <AmountTotal label="Deductions" amount={deductionAmount} />
            <AmountTotal label="Net Amount" amount={netAmount} strong />
          </div>

          {selectedFF3 && netAmount > selectedFF3.remaining_balance && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" />
              <span>Net amount exceeds available commitment balance of K {selectedFF3.remaining_balance.toLocaleString()}</span>
            </div>
          )}

          {selectedFF3 && netAmount > 0 && netAmount <= selectedFF3.remaining_balance && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              <span>Within commitment balance - Payment can proceed</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section D: Payment Method</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <LookupSelect
            label="Payment Method"
            value={formData.payment_method_id}
            options={paymentMethods}
            placeholder="Select payment method"
            canAdd
            addTable="payment_methods"
            addLabel="+ Add Payment Method"
            onRefresh={async () => setPaymentMethods(await loadLookup("payment_methods"))}
            onChange={(value, option) => setFormData({ ...formData, payment_method_id: value, payment_method: option?.code || "" })}
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">External Payment Reference</label>
            <input
              type="text"
              value={formData.external_payment_reference}
              onChange={(e) => setFormData({ ...formData, external_payment_reference: e.target.value })}
              placeholder="To be filled after payment is processed"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Remarks</label>
            <textarea
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              rows={2}
              placeholder="Optional processing notes"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section E: Attachments</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            {invoiceFile ? (
              <div className="border-2 border-green-300 bg-green-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <FileText className="h-8 w-8 text-green-600" />
                  <div className="flex-1 min-w-0">
                    <a href={invoiceFile.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-green-700 hover:underline truncate block">
                      {invoiceFile.name}
                    </a>
                    <p className="text-xs text-green-600">{(invoiceFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button type="button" onClick={() => setInvoiceFile(null)} className="p-1 hover:bg-green-100 rounded">
                    <X className="h-5 w-5 text-green-600" />
                  </button>
                </div>
              </div>
            ) : (
              <label className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer block">
                {uploadingInvoice ? <Loader2 className="h-8 w-8 mx-auto text-blue-500 animate-spin mb-2" /> : <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />}
                <p className="text-sm font-medium text-slate-700">{uploadingInvoice ? "Uploading..." : "Upload Invoice"}</p>
                <p className="text-xs text-slate-500 mt-1">PDF, JPG, PNG up to 10MB</p>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => e.target.files?.[0] && handleInvoiceUpload(e.target.files[0])}
                  className="hidden"
                  disabled={uploadingInvoice}
                />
              </label>
            )}
          </div>

          <div>
            {receiptFile ? (
              <div className="border-2 border-green-300 bg-green-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <FileText className="h-8 w-8 text-green-600" />
                  <div className="flex-1 min-w-0">
                    <a href={receiptFile.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-green-700 hover:underline truncate block">
                      {receiptFile.name}
                    </a>
                    <p className="text-xs text-green-600">{(receiptFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button type="button" onClick={() => setReceiptFile(null)} className="p-1 hover:bg-green-100 rounded">
                    <X className="h-5 w-5 text-green-600" />
                  </button>
                </div>
              </div>
            ) : (
              <label className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer block">
                {uploadingReceipt ? <Loader2 className="h-8 w-8 mx-auto text-blue-500 animate-spin mb-2" /> : <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />}
                <p className="text-sm font-medium text-slate-700">{uploadingReceipt ? "Uploading..." : "Upload Receipt/Delivery Note"}</p>
                <p className="text-xs text-slate-500 mt-1">PDF, JPG, PNG up to 10MB</p>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => e.target.files?.[0] && handleReceiptUpload(e.target.files[0])}
                  className="hidden"
                  disabled={uploadingReceipt}
                />
              </label>
            )}
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 z-10">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <Link href="/dashboard/ff4" className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50">
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
              className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit for Verification
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AmountTotal({ label, amount, strong = false }: { label: string; amount: number; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-right ${strong ? "text-2xl font-bold text-green-700" : "text-lg font-bold text-slate-900"}`}>K {money(amount)}</p>
    </div>
  )
}
