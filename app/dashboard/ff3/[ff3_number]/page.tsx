"use client"

import { useState, useEffect, use } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, FileText, CheckCircle2, XCircle, Clock, AlertCircle,
  User, Calendar, DollarSign, Building2, MapPin, Loader2, Send,
  ThumbsUp, ThumbsDown, MessageSquare, Download
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { approveFF3, getFF3Approvals } from "@/lib/api"
import { generateFF3PDF, downloadPDF, type FF3PDFData } from "@/lib/pdf"
import { useAuth } from "@/contexts/AuthContext"

type FF3Status = "DRAFT" | "SUBMITTED" | "ENDORSED_SUPERVISOR" | "ENDORSED_SECTION_HEAD" | "APPROVED" | "REJECTED" | "EXPIRED"

type FF3Header = {
  id: string
  ff3_number: string
  financial_year: number
  request_date: string
  purpose: string
  justification: string
  required_by_date: string | null
  urgency_level: string | null
  procurement_method: string | null
  status: FF3Status
  total_estimated_amount: number | null
  is_within_budget: boolean | null
  created_at: string
  submitted_date: string | null
  approved_date: string | null
  department: { code: string; name: string } | null
  section: { code: string; name: string } | null
  province: { code: string; name: string } | null
  funding_source: { code: string; name: string } | null
}

type FF3Item = {
  id: string
  line_number: number
  item_description: string
  specifications: string | null
  quantity: number
  unit_of_measure: string | null
  estimated_unit_price: number | null
}

type FF3Quotation = {
  id: string
  supplier_name: string
  quotation_number: string | null
  quotation_date: string | null
  quotation_amount: number
  is_selected: boolean
}

type FF3Approval = {
  id: string
  approval_level: string
  action_taken: string
  comments: string | null
  action_date: string
}

export default function FF3DetailPage({ params }: { params: Promise<{ ff3_number: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const { can } = useAuth()
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [header, setHeader] = useState<FF3Header | null>(null)
  const [items, setItems] = useState<FF3Item[]>([])
  const [quotations, setQuotations] = useState<FF3Quotation[]>([])
  const [approvals, setApprovals] = useState<FF3Approval[]>([])
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectComments, setRejectComments] = useState("")
  const [approvalComments, setApprovalComments] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    fetchFF3Detail()
  }, [resolvedParams.ff3_number])

  async function fetchFF3Detail() {
    try {
      // Fetch header
      const { data: headerData, error: headerError } = await supabase
        .from('ff3_headers')
        .select(`
          *,
          department:departments(code, name),
          section:sections(code, name),
          province:provinces(code, name),
          funding_source:funding_sources(code, name)
        `)
        .eq('ff3_number', resolvedParams.ff3_number)
        .single()

      if (headerError) throw headerError
      setHeader(headerData)

      // Fetch items
      const { data: itemsData, error: itemsError } = await supabase
        .from('ff3_items')
        .select('*')
        .eq('ff3_header_id', headerData.id)
        .order('line_number')

      if (itemsError) throw itemsError
      setItems(itemsData || [])

      // Fetch quotations
      const { data: quotsData, error: quotsError } = await supabase
        .from('ff3_quotations')
        .select('*')
        .eq('ff3_header_id', headerData.id)

      if (quotsError) throw quotsError
      setQuotations(quotsData || [])

      // Fetch approvals
      const approvalsData = await getFF3Approvals(headerData.id)
      setApprovals(approvalsData || [])

    } catch (err) {
      console.error('Error fetching FF3:', err)
      setError('Failed to load FF3 details')
    } finally {
      setLoading(false)
    }
  }

  async function handleApproval(action: 'ENDORSE_SUPERVISOR' | 'ENDORSE_SECTION_HEAD' | 'APPROVE') {
    if (!header) return
    setActionLoading(true)
    setError("")
    setSuccess("")

    try {
      await approveFF3(header.id, action, approvalComments)
      setSuccess(`FF3 ${header.ff3_number} has been ${action === 'APPROVE' ? 'approved' : 'endorsed'}!`)
      setApprovalComments("")
      fetchFF3Detail()
    } catch (err) {
      console.error('Error approving FF3:', err)
      setError('Failed to process approval. Please try again.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleReject() {
    if (!header || !rejectComments.trim()) return
    setActionLoading(true)
    setError("")
    setSuccess("")

    try {
      await approveFF3(header.id, 'REJECT', rejectComments)
      setSuccess(`FF3 ${header.ff3_number} has been rejected.`)
      setShowRejectModal(false)
      setRejectComments("")
      fetchFF3Detail()
    } catch (err) {
      console.error('Error rejecting FF3:', err)
      setError('Failed to reject. Please try again.')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!header) {
    return (
      <div className="text-center py-12">
        <FileText className="h-12 w-12 mx-auto text-slate-300 mb-4" />
        <h2 className="text-xl font-semibold text-slate-900">FF3 Not Found</h2>
        <p className="text-slate-600 mt-2">The requested FF3 requisition could not be found.</p>
        <Link href="/dashboard/ff3" className="mt-4 inline-block text-blue-600 hover:text-blue-700">
          ← Back to FF3 List
        </Link>
      </div>
    )
  }

  const canEndorseSupervisor = header.status === 'SUBMITTED' && can('ff3.endorse')
  const canEndorseSectionHead = header.status === 'ENDORSED_SUPERVISOR' && can('ff3.endorse')
  const canApprove = header.status === 'ENDORSED_SECTION_HEAD' && can('ff3.approve')
  const canReject = ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD'].includes(header.status) && (can('ff3.reject') || can('ff3.approve'))
  const isTerminal = ['APPROVED', 'REJECTED', 'EXPIRED'].includes(header.status)
  const hasAnyAction = canEndorseSupervisor || canEndorseSectionHead || canApprove || canReject

  // Handle PDF export
  const handleExportPDF = () => {
    const pdfData: FF3PDFData = {
      ff3_number: header.ff3_number,
      financial_year: header.financial_year,
      request_date: header.request_date,
      status: header.status,
      department: header.department?.name,
      section: header.section?.name,
      province: header.province?.name,
      funding_source: header.funding_source?.name,
      purpose: header.purpose,
      justification: header.justification,
      required_by_date: header.required_by_date || undefined,
      urgency_level: header.urgency_level || undefined,
      procurement_method: header.procurement_method || undefined,
      total_estimated_amount: header.total_estimated_amount || 0,
      is_within_budget: header.is_within_budget || false,
      items: items.map(item => ({
        line_number: item.line_number,
        item_description: item.item_description,
        quantity: item.quantity,
        unit_of_measure: item.unit_of_measure || undefined,
        estimated_unit_price: item.estimated_unit_price || 0,
      })),
      quotations: quotations.map(q => ({
        supplier_name: q.supplier_name,
        quotation_number: q.quotation_number || undefined,
        quotation_date: q.quotation_date || undefined,
        quotation_amount: q.quotation_amount,
        is_selected: q.is_selected,
      })),
      approvals: approvals.map(a => ({
        approval_level: a.approval_level,
        action_taken: a.action_taken,
        action_date: a.action_date,
        comments: a.comments || undefined,
      })),
    }

    const doc = generateFF3PDF(pdfData)
    downloadPDF(doc, `${header.ff3_number}.pdf`)
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/ff3" className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{header.ff3_number}</h1>
              <StatusBadge status={header.status} />
            </div>
            <p className="text-slate-600 mt-1">Finance Form 3 - Requisition Details</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {header.urgency_level && (
            <UrgencyBadge urgency={header.urgency_level} />
          )}
          <button
            onClick={handleExportPDF}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Export PDF
          </button>
        </div>
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

      {/* Requisition Header Info */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Requisition Information</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <InfoField icon={<Calendar className="h-4 w-4" />} label="Request Date" value={new Date(header.request_date).toLocaleDateString('en-GB')} />
          <InfoField icon={<Calendar className="h-4 w-4" />} label="Financial Year" value={header.financial_year.toString()} />
          <InfoField icon={<Building2 className="h-4 w-4" />} label="Department" value={header.department?.name || '-'} />
          <InfoField icon={<Building2 className="h-4 w-4" />} label="Section" value={header.section?.name || '-'} />
          <InfoField icon={<MapPin className="h-4 w-4" />} label="Province" value={header.province?.name || '-'} />
          <InfoField icon={<DollarSign className="h-4 w-4" />} label="Funding Source" value={header.funding_source?.name || '-'} />
          <InfoField icon={<Calendar className="h-4 w-4" />} label="Required By" value={header.required_by_date ? new Date(header.required_by_date).toLocaleDateString('en-GB') : '-'} />
          <InfoField icon={<FileText className="h-4 w-4" />} label="Procurement Method" value={header.procurement_method || '-'} />
        </div>
      </div>

      {/* Purpose & Justification */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Purpose & Justification</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-600">Purpose of Expenditure</label>
            <p className="mt-1 text-slate-900">{header.purpose}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600">Justification</label>
            <p className="mt-1 text-slate-900">{header.justification || '-'}</p>
          </div>
        </div>
      </div>

      {/* Items Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Requisition Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">#</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Description</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Qty</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Unit</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Unit Price</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-sm text-slate-600">{item.line_number}</td>
                  <td className="px-4 py-3 text-sm text-slate-900">{item.item_description}</td>
                  <td className="px-4 py-3 text-sm text-slate-900 text-right">{item.quantity}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{item.unit_of_measure || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-900 text-right">K {(item.estimated_unit_price || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">K {(item.quantity * (item.estimated_unit_price || 0)).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr>
                <td colSpan={5} className="px-4 py-3 text-sm font-semibold text-slate-900 text-right">Total Estimated Amount:</td>
                <td className="px-4 py-3 text-lg font-bold text-slate-900 text-right">K {(header.total_estimated_amount || 0).toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Quotations */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Quotations ({quotations.length})</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {quotations.map((quot, index) => (
            <div key={quot.id} className={`border rounded-lg p-4 ${quot.is_selected ? 'border-green-500 bg-green-50' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-600">Quotation {index + 1}</span>
                {quot.is_selected && (
                  <span className="px-2 py-0.5 bg-green-600 text-white text-xs rounded-full">Selected</span>
                )}
              </div>
              <p className="font-semibold text-slate-900">{quot.supplier_name}</p>
              <p className="text-sm text-slate-600 mt-1">{quot.quotation_number || 'No quote #'}</p>
              {quot.quotation_date && (
                <p className="text-xs text-slate-500 mt-1">{new Date(quot.quotation_date).toLocaleDateString('en-GB')}</p>
              )}
              <p className="text-lg font-bold text-slate-900 mt-2">K {quot.quotation_amount.toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Budget Validation */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Budget Validation</h2>
        <div className={`p-4 rounded-lg flex items-center gap-3 ${header.is_within_budget ? 'bg-green-50' : 'bg-red-50'}`}>
          {header.is_within_budget ? (
            <>
              <CheckCircle2 className="h-6 w-6 text-green-600" />
              <div>
                <p className="font-semibold text-green-900">Within Budget</p>
                <p className="text-sm text-green-700">Sufficient funds available for this requisition</p>
              </div>
            </>
          ) : (
            <>
              <AlertCircle className="h-6 w-6 text-red-600" />
              <div>
                <p className="font-semibold text-red-900">Exceeds Budget</p>
                <p className="text-sm text-red-700">This requisition exceeds the available budget</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Approval History */}
      {approvals.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Approval History</h2>
          <div className="space-y-4">
            {approvals.map((approval) => (
              <div key={approval.id} className="flex items-start gap-4 p-4 bg-slate-50 rounded-lg">
                <div className={`p-2 rounded-full ${approval.action_taken === 'APPROVED' ? 'bg-green-100' : 'bg-red-100'}`}>
                  {approval.action_taken === 'APPROVED' ? (
                    <ThumbsUp className="h-4 w-4 text-green-600" />
                  ) : (
                    <ThumbsDown className="h-4 w-4 text-red-600" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-slate-900">{approval.approval_level.replace(/_/g, ' ')}</p>
                    <span className="text-sm text-slate-500">{new Date(approval.action_date).toLocaleString('en-GB')}</span>
                  </div>
                  <p className={`text-sm ${approval.action_taken === 'APPROVED' ? 'text-green-600' : 'text-red-600'}`}>
                    {approval.action_taken}
                  </p>
                  {approval.comments && (
                    <p className="text-sm text-slate-600 mt-2 flex items-start gap-2">
                      <MessageSquare className="h-4 w-4 mt-0.5" />
                      {approval.comments}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approval Actions */}
      {!isTerminal && hasAnyAction && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 z-10">
          <div className="max-w-[1600px] mx-auto">
            {/* Comments input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">Approval Comments (Optional)</label>
              <input
                type="text"
                value={approvalComments}
                onChange={(e) => setApprovalComments(e.target.value)}
                placeholder="Add comments for your approval decision..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center justify-between">
              <Link
                href="/dashboard/ff3"
                className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
              >
                Back to List
              </Link>

              <div className="flex items-center gap-3">
                {canReject && (
                  <button
                    onClick={() => setShowRejectModal(true)}
                    disabled={actionLoading}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    <XCircle className="h-4 w-4" />
                    Reject
                  </button>
                )}

                {canEndorseSupervisor && (
                  <button
                    onClick={() => handleApproval('ENDORSE_SUPERVISOR')}
                    disabled={actionLoading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Endorse (Supervisor)
                  </button>
                )}

                {canEndorseSectionHead && (
                  <button
                    onClick={() => handleApproval('ENDORSE_SECTION_HEAD')}
                    disabled={actionLoading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Endorse (Section Head)
                  </button>
                )}

                {canApprove && (
                  <button
                    onClick={() => handleApproval('APPROVE')}
                    disabled={actionLoading}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Approve & Create Commitment
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Reject FF3 Requisition</h3>
            <p className="text-sm text-slate-600 mb-4">
              Please provide a reason for rejecting this requisition. This will be recorded in the approval history.
            </p>
            <textarea
              value={rejectComments}
              onChange={(e) => setRejectComments(e.target.value)}
              placeholder="Enter rejection reason..."
              rows={4}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 mb-4"
            />
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectComments.trim() || actionLoading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Confirm Rejection
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

function StatusBadge({ status }: { status: FF3Status }) {
  const statusConfig: Record<FF3Status, { label: string; classes: string }> = {
    DRAFT: { label: "Draft", classes: "bg-slate-100 text-slate-700" },
    SUBMITTED: { label: "Submitted", classes: "bg-blue-100 text-blue-700" },
    ENDORSED_SUPERVISOR: { label: "Supervisor Endorsed", classes: "bg-blue-100 text-blue-700" },
    ENDORSED_SECTION_HEAD: { label: "Pending Approval", classes: "bg-amber-100 text-amber-700" },
    APPROVED: { label: "Approved", classes: "bg-green-100 text-green-700" },
    REJECTED: { label: "Rejected", classes: "bg-red-100 text-red-700" },
    EXPIRED: { label: "Expired", classes: "bg-slate-100 text-slate-700" },
  }

  const config = statusConfig[status]

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${config.classes}`}>
      {status === 'APPROVED' && <CheckCircle2 className="h-4 w-4" />}
      {status === 'REJECTED' && <XCircle className="h-4 w-4" />}
      {['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD'].includes(status) && <Clock className="h-4 w-4" />}
      {config.label}
    </span>
  )
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const urgencyConfig: Record<string, string> = {
    LOW: "bg-slate-100 text-slate-700",
    MEDIUM: "bg-amber-100 text-amber-700",
    HIGH: "bg-orange-100 text-orange-700",
    URGENT: "bg-red-100 text-red-700"
  }

  return (
    <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${urgencyConfig[urgency] || urgencyConfig.MEDIUM}`}>
      {urgency}
    </span>
  )
}
