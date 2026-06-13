"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Save, Send, ArrowLeft, AlertCircle, CheckCircle2, Upload, Loader2, FileText, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { uploadFile, BUCKETS, type UploadedFile } from "@/lib/storage"

type ApprovedFF3 = {
  id: string
  ff3_number: string
  purpose: string
  commitment_id: string | null
  commitment_number: string | null
  committed_amount: number
  paid_amount: number
  remaining_balance: number
}

export default function NewFF4Page() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [availableFF3s, setAvailableFF3s] = useState<ApprovedFF3[]>([])
  const [selectedFF3, setSelectedFF3] = useState<ApprovedFF3 | null>(null)

  // File upload state
  const [invoiceFile, setInvoiceFile] = useState<UploadedFile | null>(null)
  const [receiptFile, setReceiptFile] = useState<UploadedFile | null>(null)
  const [uploadingInvoice, setUploadingInvoice] = useState(false)
  const [uploadingReceipt, setUploadingReceipt] = useState(false)

  const [formData, setFormData] = useState({
    ff3_header_id: "",
    commitment_id: "",
    payee_type: "SUPPLIER",
    payee_name: "",
    supplier_code: "",
    invoice_number: "",
    invoice_date: "",
    claim_reference: "",
    payment_description: "",
    gross_amount: 0,
    tax_amount: 0,
    deductions: 0,
    payment_method: "EFT",
    external_payment_reference: "",
    remarks: ""
  })

  const fetchApprovedFF3s = useCallback(async () => {
    try {
      // Fetch approved FF3s with their commitments
      const { data: ff3s, error: ff3Error } = await supabase
        .from('ff3_headers')
        .select('id, ff3_number, purpose')
        .eq('status', 'APPROVED')
        .eq('financial_year', 2025)

      if (ff3Error) throw ff3Error

      // Fetch commitments for these FF3s
      const ff3Ids = ff3s?.map(f => f.id) || []

      if (ff3Ids.length > 0) {
        const { data: commitments, error: comError } = await supabase
          .from('ff3_commitments')
          .select('id, commitment_number, ff3_header_id, committed_amount, paid_amount')
          .in('ff3_header_id', ff3Ids)
          .in('status', ['ACTIVE', 'PARTIALLY_PAID'])

        if (comError) throw comError

        // Combine FF3s with their commitments
        const ff3WithCommitments = ff3s?.map(ff3 => {
          const commitment = commitments?.find(c => c.ff3_header_id === ff3.id)
          return {
            id: ff3.id,
            ff3_number: ff3.ff3_number,
            purpose: ff3.purpose,
            commitment_id: commitment?.id || null,
            commitment_number: commitment?.commitment_number || null,
            committed_amount: commitment?.committed_amount || 0,
            paid_amount: commitment?.paid_amount || 0,
            remaining_balance: (commitment?.committed_amount || 0) - (commitment?.paid_amount || 0)
          }
        }).filter(f => f.remaining_balance > 0) || []

        setAvailableFF3s(ff3WithCommitments)
      }

    } catch (err) {
      console.error('Error fetching approved FF3s:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Data fetch on mount is the intended effect here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchApprovedFF3s()
  }, [fetchApprovedFF3s])

  const handleFF3Select = (ff3Id: string) => {
    const ff3 = availableFF3s.find(f => f.id === ff3Id)
    setSelectedFF3(ff3 || null)
    setFormData(prev => ({
      ...prev,
      ff3_header_id: ff3Id,
      commitment_id: ff3?.commitment_id || ""
    }))
  }

  // Handle invoice file upload
  const handleInvoiceUpload = async (file: File) => {
    if (!file) return
    setUploadingInvoice(true)
    try {
      const tempId = `invoice-${Date.now()}`
      const uploaded = await uploadFile(BUCKETS.FF4_ATTACHMENTS, tempId, file)
      setInvoiceFile(uploaded)
    } catch (err) {
      console.error('Upload error:', err)
      setError('Failed to upload invoice')
    } finally {
      setUploadingInvoice(false)
    }
  }

  // Handle receipt file upload
  const handleReceiptUpload = async (file: File) => {
    if (!file) return
    setUploadingReceipt(true)
    try {
      const tempId = `receipt-${Date.now()}`
      const uploaded = await uploadFile(BUCKETS.FF4_ATTACHMENTS, tempId, file)
      setReceiptFile(uploaded)
    } catch (err) {
      console.error('Upload error:', err)
      setError('Failed to upload receipt')
    } finally {
      setUploadingReceipt(false)
    }
  }

  const netAmount = formData.gross_amount - formData.tax_amount - formData.deductions

  const canSubmit = formData.ff3_header_id && formData.payee_name && formData.gross_amount > 0 &&
    (selectedFF3 ? netAmount <= selectedFF3.remaining_balance : true)

  const handleSaveDraft = async () => {
    await saveFF4('DRAFT')
  }

  const handleSubmit = async () => {
    await saveFF4('SUBMITTED')
  }

  const saveFF4 = async (status: 'DRAFT' | 'SUBMITTED') => {
    setError("")
    setSuccess("")
    setSubmitting(true)

    try {
      const { data: header, error: headerError } = await supabase
        .from('ff4_headers')
        .insert({
          financial_year: 2025,
          ff3_header_id: formData.ff3_header_id || null,
          commitment_id: formData.commitment_id || null,
          payee_type: formData.payee_type,
          payee_name: formData.payee_name,
          supplier_code: formData.supplier_code || null,
          invoice_number: formData.invoice_number || null,
          invoice_date: formData.invoice_date || null,
          claim_reference: formData.claim_reference || null,
          payment_description: formData.payment_description || null,
          gross_amount: formData.gross_amount,
          tax_amount: formData.tax_amount,
          deductions: formData.deductions,
          payment_method: formData.payment_method,
          external_payment_reference: formData.external_payment_reference || null,
          status: status,
          submitted_date: status === 'SUBMITTED' ? new Date().toISOString() : null
        })
        .select()
        .single()

      if (headerError) throw headerError

      setSuccess(`FF4 ${header.ff4_number} ${status === 'DRAFT' ? 'saved as draft' : 'submitted for verification'}!`)

      setTimeout(() => {
        router.push('/dashboard/ff4')
      }, 1500)

    } catch (err: unknown) {
      console.error('Error saving FF4:', err)
      setError(err instanceof Error ? err.message : 'Failed to save FF4. Please try again.')
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
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/ff4" className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">New FF4 Expense</h1>
          <p className="text-slate-600 mt-1">Finance Form 4 - Expense and Payment Request</p>
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

      {/* Info Banner */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
          <div>
            <p className="font-medium text-green-900">FF4 Must Link to Approved FF3</p>
            <p className="text-sm text-green-700 mt-1">
              {availableFF3s.length > 0
                ? `${availableFF3s.length} approved FF3(s) with available balance found.`
                : 'No approved FF3s with available balance. Please approve an FF3 first.'}
            </p>
          </div>
        </div>
      </div>

      {/* Section A: Link to FF3/Commitment */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section A: Linked Requisition</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Select Approved FF3 <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.ff3_header_id}
              onChange={(e) => handleFF3Select(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select an approved FF3...</option>
              {availableFF3s.map((ff3) => (
                <option key={ff3.id} value={ff3.id}>
                  {ff3.ff3_number} - {ff3.purpose} (Balance: K {ff3.remaining_balance.toLocaleString()})
                </option>
              ))}
            </select>
          </div>

          {selectedFF3 && (
            <div className="bg-slate-50 rounded-lg p-4">
              <h3 className="font-medium text-slate-900 mb-3">Commitment Details</h3>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-slate-600">Commitment Number</p>
                  <p className="font-medium text-slate-900">{selectedFF3.commitment_number || 'Pending'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Committed Amount</p>
                  <p className="font-medium text-slate-900">K {selectedFF3.committed_amount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Already Paid</p>
                  <p className="font-medium text-green-600">K {selectedFF3.paid_amount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Available Balance</p>
                  <p className="font-medium text-amber-600">K {selectedFF3.remaining_balance.toLocaleString()}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section B: Payee Details */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section B: Payee Details</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payee Type</label>
            <select
              value={formData.payee_type}
              onChange={(e) => setFormData({ ...formData, payee_type: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="SUPPLIER">Supplier</option>
              <option value="CONTRACTOR">Contractor</option>
              <option value="EMPLOYEE">Employee</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Payee Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.payee_name}
              onChange={(e) => setFormData({ ...formData, payee_name: e.target.value })}
              placeholder="Enter payee/supplier name"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Supplier Code</label>
            <input
              type="text"
              value={formData.supplier_code}
              onChange={(e) => setFormData({ ...formData, supplier_code: e.target.value })}
              placeholder="Optional supplier code"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
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

      {/* Section C: Payment Details */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section C: Payment Details</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payment Description</label>
            <textarea
              value={formData.payment_description}
              onChange={(e) => setFormData({ ...formData, payment_description: e.target.value })}
              rows={3}
              placeholder="Describe the payment..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Gross Amount (K) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.gross_amount || ""}
                onChange={(e) => setFormData({ ...formData, gross_amount: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tax Amount (K)</label>
              <input
                type="number"
                step="0.01"
                value={formData.tax_amount || ""}
                onChange={(e) => setFormData({ ...formData, tax_amount: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Deductions (K)</label>
              <input
                type="number"
                step="0.01"
                value={formData.deductions || ""}
                onChange={(e) => setFormData({ ...formData, deductions: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-slate-900">Net Amount:</span>
              <span className="text-2xl font-bold text-slate-900">
                K {netAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
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

      {/* Section D: Payment Method */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section D: Payment Method</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
            <select
              value={formData.payment_method}
              onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="EFT">Electronic Funds Transfer (EFT)</option>
              <option value="CHEQUE">Cheque</option>
              <option value="DIRECT_DEPOSIT">Direct Deposit</option>
              <option value="CASH">Cash</option>
            </select>
          </div>
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
        </div>
      </div>

      {/* Section E: Attachments */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Section E: Attachments</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {/* Invoice Upload */}
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
                  <button
                    type="button"
                    onClick={() => setInvoiceFile(null)}
                    className="p-1 hover:bg-green-100 rounded"
                  >
                    <X className="h-5 w-5 text-green-600" />
                  </button>
                </div>
              </div>
            ) : (
              <label className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer block">
                {uploadingInvoice ? (
                  <Loader2 className="h-8 w-8 mx-auto text-blue-500 animate-spin mb-2" />
                ) : (
                  <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                )}
                <p className="text-sm font-medium text-slate-700">
                  {uploadingInvoice ? 'Uploading...' : 'Upload Invoice'}
                </p>
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

          {/* Receipt Upload */}
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
                  <button
                    type="button"
                    onClick={() => setReceiptFile(null)}
                    className="p-1 hover:bg-green-100 rounded"
                  >
                    <X className="h-5 w-5 text-green-600" />
                  </button>
                </div>
              </div>
            ) : (
              <label className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer block">
                {uploadingReceipt ? (
                  <Loader2 className="h-8 w-8 mx-auto text-blue-500 animate-spin mb-2" />
                ) : (
                  <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                )}
                <p className="text-sm font-medium text-slate-700">
                  {uploadingReceipt ? 'Uploading...' : 'Upload Receipt/Delivery Note'}
                </p>
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

      {/* Action Buttons */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 z-10">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <Link
            href="/dashboard/ff4"
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
