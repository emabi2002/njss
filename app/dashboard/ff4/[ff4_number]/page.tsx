"use client"

import { useState, useEffect, use } from "react"
import Link from "next/link"
import {
  ArrowLeft, FileText, CheckCircle2, XCircle, Clock, AlertCircle,
  Calendar, DollarSign, Building2, Loader2, CreditCard, Receipt,
  ThumbsUp, ThumbsDown, MessageSquare, Banknote, Download
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { approveFF4 } from "@/lib/api"
import { generateFF4PDF, downloadPDF, type FF4PDFData } from "@/lib/pdf"
import { useAuth } from "@/contexts/AuthContext"

type FF4Status = "DRAFT" | "SUBMITTED" | "VERIFIED" | "APPROVED" | "PROCESSED" | "PAID" | "RECONCILED" | "CANCELLED"

type FF4Header = {
  id: string
  ff4_number: string
  financial_year: number
  payment_request_date: string
  payee_type: string | null
  payee_name: string
  supplier_code: string | null
  invoice_number: string | null
  invoice_date: string | null
  claim_reference: string | null
  payment_description: string | null
  gross_amount: number
  tax_amount: number
  deductions: number
  net_amount: number
  payment_method: string | null
  external_payment_reference: string | null
  payment_date: string | null
  status: FF4Status
  created_at: string
  submitted_date: string | null
  ff3: { ff3_number: string; purpose: string } | null
  commitment: { commitment_number: string; committed_amount: number; paid_amount: number } | null
}

export default function FF4DetailPage({ params }: { params: Promise<{ ff4_number: string }> }) {
  const resolvedParams = use(params)
  const { can } = useAuth()
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [header, setHeader] = useState<FF4Header | null>(null)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [cancelComments, setCancelComments] = useState("")
  const [paymentReference, setPaymentReference] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    fetchFF4Detail()
  }, [resolvedParams.ff4_number])

  async function fetchFF4Detail() {
    try {
      const { data, error: fetchError } = await supabase
        .from('ff4_headers')
        .select(`
          *,
          ff3:ff3_headers(ff3_number, purpose),
          commitment:ff3_commitments(commitment_number, committed_amount, paid_amount)
        `)
        .eq('ff4_number', resolvedParams.ff4_number)
        .single()

      if (fetchError) throw fetchError
      setHeader(data)
    } catch (err) {
      console.error('Error fetching FF4:', err)
      setError('Failed to load FF4 details')
    } finally {
      setLoading(false)
    }
  }

  async function handleAction(action: 'VERIFY' | 'APPROVE' | 'PROCESS' | 'RECONCILE') {
    if (!header) return
    setActionLoading(true)
    setError("")
    setSuccess("")

    try {
      await approveFF4(header.id, action)
      const actionLabels = {
        'VERIFY': 'verified',
        'APPROVE': 'approved',
        'PROCESS': 'processed',
        'RECONCILE': 'reconciled'
      }
      setSuccess(`FF4 ${header.ff4_number} has been ${actionLabels[action]}!`)
      fetchFF4Detail()
    } catch (err) {
      console.error('Error processing FF4:', err)
      setError('Failed to process action. Please try again.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleMarkPaid() {
    if (!header || !paymentReference.trim()) return
    setActionLoading(true)
    setError("")
    setSuccess("")

    try {
      await approveFF4(header.id, 'MARK_PAID', paymentReference)
      setSuccess(`FF4 ${header.ff4_number} has been marked as paid!`)
      setShowPaymentModal(false)
      setPaymentReference("")
      fetchFF4Detail()
    } catch (err) {
      console.error('Error marking as paid:', err)
      setError('Failed to mark as paid. Please try again.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleCancel() {
    if (!header) return
    setActionLoading(true)
    setError("")
    setSuccess("")

    try {
      await approveFF4(header.id, 'CANCEL', undefined, cancelComments)
      setSuccess(`FF4 ${header.ff4_number} has been cancelled.`)
      setShowCancelModal(false)
      setCancelComments("")
      fetchFF4Detail()
    } catch (err) {
      console.error('Error cancelling FF4:', err)
      setError('Failed to cancel. Please try again.')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    )
  }

  if (!header) {
    return (
      <div className="text-center py-12">
        <FileText className="h-12 w-12 mx-auto text-slate-300 mb-4" />
        <h2 className="text-xl font-semibold text-slate-900">FF4 Not Found</h2>
        <p className="text-slate-600 mt-2">The requested FF4 expense could not be found.</p>
        <Link href="/dashboard/ff4" className="mt-4 inline-block text-green-600 hover:text-green-700">
          ← Back to FF4 List
        </Link>
      </div>
    )
  }

  const canVerify = header.status === 'SUBMITTED' && can('ff4.verify')
  const canApprove = header.status === 'VERIFIED' && can('ff4.process')
  const canProcess = header.status === 'APPROVED' && can('ff4.process')
  const canMarkPaid = header.status === 'PROCESSED' && can('ff4.process')
  const canReconcile = header.status === 'PAID' && can('ff4.process')
  const canCancel = ['DRAFT', 'SUBMITTED', 'VERIFIED'].includes(header.status) && (can('ff4.create') || can('ff4.process'))
  const isTerminal = ['RECONCILED', 'CANCELLED'].includes(header.status)
  const hasAnyAction = canVerify || canApprove || canProcess || canMarkPaid || canReconcile || canCancel

  // Handle PDF export
  const handleExportPDF = () => {
    const pdfData: FF4PDFData = {
      ff4_number: header.ff4_number,
      financial_year: header.financial_year,
      payment_request_date: header.payment_request_date,
      status: header.status,
      ff3_number: header.ff3?.ff3_number,
      ff3_purpose: header.ff3?.purpose,
      commitment_number: header.commitment?.commitment_number,
      payee_type: header.payee_type || undefined,
      payee_name: header.payee_name,
      supplier_code: header.supplier_code || undefined,
      invoice_number: header.invoice_number || undefined,
      invoice_date: header.invoice_date || undefined,
      payment_description: header.payment_description || undefined,
      gross_amount: header.gross_amount,
      tax_amount: header.tax_amount,
      deductions: header.deductions,
      net_amount: header.net_amount,
      payment_method: header.payment_method || undefined,
      external_payment_reference: header.external_payment_reference || undefined,
      payment_date: header.payment_date || undefined,
    }

    const doc = generateFF4PDF(pdfData)
    downloadPDF(doc, `${header.ff4_number}.pdf`)
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/ff4" className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{header.ff4_number}</h1>
              <StatusBadge status={header.status} />
            </div>
            <p className="text-slate-600 mt-1">Finance Form 4 - Expense Details</p>
          </div>
        </div>
        <button
          onClick={handleExportPDF}
          className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 flex items-center gap-2"
        >
          <Download className="h-4 w-4" />
          Export PDF
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
          <p className="text-green-700">{success}</p>
        </div>
      )}

      {/* Linked FF3/Commitment */}
      {header.ff3 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-blue-900 mb-4">Linked Requisition</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-blue-700">FF3 Number</p>
              <Link href={`/dashboard/ff3/${header.ff3.ff3_number}`} className="font-semibold text-blue-900 hover:underline">
                {header.ff3.ff3_number}
              </Link>
            </div>
            <div>
              <p className="text-sm text-blue-700">Purpose</p>
              <p className="font-medium text-blue-900">{header.ff3.purpose}</p>
            </div>
            {header.commitment && (
              <>
                <div>
                  <p className="text-sm text-blue-700">Commitment Number</p>
                  <p className="font-semibold text-blue-900">{header.commitment.commitment_number}</p>
                </div>
                <div>
                  <p className="text-sm text-blue-700">Commitment Balance</p>
                  <p className="font-semibold text-blue-900">
                    K {((header.commitment.committed_amount || 0) - (header.commitment.paid_amount || 0)).toLocaleString()}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Payee Information */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Payee Information</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <InfoField icon={<Building2 className="h-4 w-4" />} label="Payee Type" value={header.payee_type || '-'} />
          <InfoField icon={<Building2 className="h-4 w-4" />} label="Payee Name" value={header.payee_name} />
          <InfoField icon={<FileText className="h-4 w-4" />} label="Supplier Code" value={header.supplier_code || '-'} />
          <InfoField icon={<Calendar className="h-4 w-4" />} label="Financial Year" value={header.financial_year.toString()} />
        </div>
      </div>

      {/* Invoice Details */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Invoice Details</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <InfoField icon={<Receipt className="h-4 w-4" />} label="Invoice Number" value={header.invoice_number || '-'} />
          <InfoField icon={<Calendar className="h-4 w-4" />} label="Invoice Date" value={header.invoice_date ? new Date(header.invoice_date).toLocaleDateString('en-GB') : '-'} />
          <InfoField icon={<FileText className="h-4 w-4" />} label="Claim Reference" value={header.claim_reference || '-'} />
          <InfoField icon={<Calendar className="h-4 w-4" />} label="Request Date" value={new Date(header.payment_request_date).toLocaleDateString('en-GB')} />
        </div>
        {header.payment_description && (
          <div className="mt-4">
            <label className="text-sm font-medium text-slate-600">Payment Description</label>
            <p className="mt-1 text-slate-900">{header.payment_description}</p>
          </div>
        )}
      </div>

      {/* Payment Amount */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Payment Amount</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2">
            <span className="text-slate-700">Gross Amount</span>
            <span className="text-slate-900 font-medium">K {(header.gross_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-slate-700">Less: Tax</span>
            <span className="text-red-600">- K {(header.tax_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-slate-700">Less: Deductions</span>
            <span className="text-red-600">- K {(header.deductions || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="border-t border-slate-200 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-slate-900">Net Amount Payable</span>
              <span className="text-2xl font-bold text-green-700">K {(header.net_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Payment Details */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Payment Details</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <InfoField icon={<CreditCard className="h-4 w-4" />} label="Payment Method" value={header.payment_method || '-'} />
          <InfoField icon={<Banknote className="h-4 w-4" />} label="Payment Reference" value={header.external_payment_reference || 'Pending'} />
          <InfoField icon={<Calendar className="h-4 w-4" />} label="Payment Date" value={header.payment_date ? new Date(header.payment_date).toLocaleDateString('en-GB') : 'Pending'} />
          <InfoField icon={<DollarSign className="h-4 w-4" />} label="Status" value={header.status} />
        </div>
      </div>

      {/* Workflow Progress */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Workflow Progress</h2>
        <div className="flex items-center justify-between">
          {['SUBMITTED', 'VERIFIED', 'APPROVED', 'PROCESSED', 'PAID', 'RECONCILED'].map((step, index) => {
            const stepIndex = ['SUBMITTED', 'VERIFIED', 'APPROVED', 'PROCESSED', 'PAID', 'RECONCILED'].indexOf(header.status)
            const currentIndex = index
            const isCompleted = currentIndex <= stepIndex
            const isCurrent = step === header.status

            return (
              <div key={step} className="flex items-center">
                <div className={`flex flex-col items-center ${index > 0 ? 'ml-4' : ''}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    isCompleted ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-500'
                  } ${isCurrent ? 'ring-4 ring-green-200' : ''}`}>
                    {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : <span>{index + 1}</span>}
                  </div>
                  <span className={`text-xs mt-2 ${isCompleted ? 'text-green-700 font-medium' : 'text-slate-500'}`}>
                    {step}
                  </span>
                </div>
                {index < 5 && (
                  <div className={`w-12 h-1 mx-2 ${currentIndex < stepIndex ? 'bg-green-600' : 'bg-slate-200'}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Action Buttons */}
      {!isTerminal && hasAnyAction && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 z-10">
          <div className="max-w-[1600px] mx-auto flex items-center justify-between">
            <Link
              href="/dashboard/ff4"
              className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
            >
              Back to List
            </Link>

            <div className="flex items-center gap-3">
              {canCancel && (
                <button
                  onClick={() => setShowCancelModal(true)}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                >
                  <XCircle className="h-4 w-4" />
                  Cancel
                </button>
              )}

              {canVerify && (
                <button
                  onClick={() => handleAction('VERIFY')}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Verify
                </button>
              )}

              {canApprove && (
                <button
                  onClick={() => handleAction('APPROVE')}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
                  Approve
                </button>
              )}

              {canProcess && (
                <button
                  onClick={() => handleAction('PROCESS')}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  Process Payment
                </button>
              )}

              {canMarkPaid && (
                <button
                  onClick={() => setShowPaymentModal(true)}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                >
                  <Banknote className="h-4 w-4" />
                  Mark as Paid
                </button>
              )}

              {canReconcile && (
                <button
                  onClick={() => handleAction('RECONCILE')}
                  disabled={actionLoading}
                  className="px-6 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Reconcile
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment Reference Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Mark Payment as Paid</h3>
            <p className="text-sm text-slate-600 mb-4">
              Enter the external payment reference number from your banking/payment system.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">Payment Reference *</label>
              <input
                type="text"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="e.g., EFT-2025-001234"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowPaymentModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleMarkPaid}
                disabled={!paymentReference.trim() || actionLoading}
                className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Cancel FF4 Expense</h3>
            <p className="text-sm text-slate-600 mb-4">
              Are you sure you want to cancel this expense? This action cannot be undone.
            </p>
            <textarea
              value={cancelComments}
              onChange={(e) => setCancelComments(e.target.value)}
              placeholder="Enter cancellation reason (optional)..."
              rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 mb-4"
            />
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
              >
                Keep Expense
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-slate-600 mb-1">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-slate-900">{value}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: FF4Status }) {
  const statusConfig: Record<FF4Status, { label: string; classes: string }> = {
    DRAFT: { label: "Draft", classes: "bg-slate-100 text-slate-700" },
    SUBMITTED: { label: "Submitted", classes: "bg-blue-100 text-blue-700" },
    VERIFIED: { label: "Verified", classes: "bg-blue-100 text-blue-700" },
    APPROVED: { label: "Approved", classes: "bg-green-100 text-green-700" },
    PROCESSED: { label: "Processed", classes: "bg-amber-100 text-amber-700" },
    PAID: { label: "Paid", classes: "bg-green-100 text-green-700" },
    RECONCILED: { label: "Reconciled", classes: "bg-purple-100 text-purple-700" },
    CANCELLED: { label: "Cancelled", classes: "bg-red-100 text-red-700" },
  }

  const config = statusConfig[status]

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${config.classes}`}>
      {status === 'PAID' && <CheckCircle2 className="h-4 w-4" />}
      {status === 'RECONCILED' && <CheckCircle2 className="h-4 w-4" />}
      {status === 'CANCELLED' && <XCircle className="h-4 w-4" />}
      {['SUBMITTED', 'VERIFIED', 'PROCESSED'].includes(status) && <Clock className="h-4 w-4" />}
      {config.label}
    </span>
  )
}
