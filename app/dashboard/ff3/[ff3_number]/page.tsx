"use client"

import { useCallback, useEffect, use, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft, FileText, CheckCircle2, XCircle, Clock, AlertCircle,
  Calendar, DollarSign, Building2, MapPin, Loader2, Send,
  ThumbsUp, ThumbsDown, MessageSquare, Download
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { approveFF3, getFF3Approvals, type AuthoritativeBudgetPosition } from "@/lib/api"
import { checkFF3BudgetAvailability, type FF3BudgetCheck } from "@/lib/ff3-budget"
import { generateFF3PDF, downloadPDF, type FF3PDFData } from "@/lib/pdf"
import { useAuth } from "@/contexts/AuthContext"

type FF3Status = "DRAFT" | "SUBMITTED" | "ENDORSED_SUPERVISOR" | "ENDORSED_SECTION_HEAD" | "APPROVED" | "COMMITTED" | "REJECTED" | "CANCELLED" | "RETURNED" | "EXPIRED"

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
  budget_allocation_id: string | null
  budget_mapping_status: string | null
  budget_control_status: string | null
  budget_control_source: string | null
  budget_expense_ledger_id: string | null
  budget_current_approved_amount: number | null
  budget_available_amount: number | null
  budget_shortfall_amount: number | null
  budget_checked_at: string | null
  cost_centre_id: string | null
  expense_code_registry_id: string | null
  department_id: string | null
  section_id: string | null
  funding_source_id: string | null
  project_id: string | null
  created_at: string
  submitted_date: string | null
  approved_date: string | null
  department: { code: string; name: string } | null
  section: { code: string; name: string } | null
  province: { code: string; name: string } | null
  funding_source: { code: string; name: string } | null
}

type FF3Item = { id: string; line_number: number; item_description: string; specifications: string | null; quantity: number; unit_of_measure: string | null; estimated_unit_price: number | null }
type FF3Quotation = { id: string; supplier_name: string; quotation_number: string | null; quotation_date: string | null; quotation_amount: number; is_selected: boolean }
type FF3Approval = { id: string; approval_level: string; action_taken: string; comments: string | null; action_date: string }
type CommitmentSummary = { id: string; commitment_number: string; original_committed_amount: number | null; current_committed_amount: number | null; committed_amount: number; paid_amount: number; outstanding_amount: number | null; status: string }

const money = (value: number) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function FF3DetailPage({ params }: { params: Promise<{ ff3_number: string }> }) {
  const resolvedParams = use(params)
  const { can } = useAuth()
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [header, setHeader] = useState<FF3Header | null>(null)
  const [items, setItems] = useState<FF3Item[]>([])
  const [quotations, setQuotations] = useState<FF3Quotation[]>([])
  const [approvals, setApprovals] = useState<FF3Approval[]>([])
  const [financialPosition, setFinancialPosition] = useState<AuthoritativeBudgetPosition | null>(null)
  const [budgetCheck, setBudgetCheck] = useState<FF3BudgetCheck | null>(null)
  const [commitment, setCommitment] = useState<CommitmentSummary | null>(null)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectComments, setRejectComments] = useState("")
  const [approvalComments, setApprovalComments] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const fetchFF3Detail = useCallback(async () => {
    try {
      const { data: headerData, error: headerError } = await supabase
        .from('ff3_headers')
        .select(`*, department:departments(code, name), section:sections(code, name), province:provinces(code, name), funding_source:funding_sources(code, name)`)
        .eq('ff3_number', resolvedParams.ff3_number)
        .single()
      if (headerError) throw headerError
      setHeader(headerData as FF3Header)

      const [{ data: itemsData, error: itemsError }, { data: quotsData, error: quotsError }, approvalsData, { data: commitmentData }] = await Promise.all([
        supabase.from('ff3_items').select('*').eq('ff3_header_id', headerData.id).order('line_number'),
        supabase.from('ff3_quotations').select('*').eq('ff3_header_id', headerData.id),
        getFF3Approvals(headerData.id),
        supabase.from('ff3_commitments').select('id, commitment_number, original_committed_amount, current_committed_amount, committed_amount, paid_amount, outstanding_amount, status').eq('ff3_header_id', headerData.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (itemsError) throw itemsError
      if (quotsError) throw quotsError
      setItems(itemsData || [])
      setQuotations(quotsData || [])
      setApprovals(approvalsData || [])
      setCommitment(commitmentData as CommitmentSummary | null)

      try {
        if (headerData.department_id && headerData.section_id && headerData.expense_code_registry_id) {
          const liveBudget = await checkFF3BudgetAvailability({
            financialYear: headerData.financial_year,
            departmentId: headerData.department_id,
            sectionId: headerData.section_id,
            expenseCodeId: headerData.expense_code_registry_id,
            costCentreId: headerData.cost_centre_id,
            fundingSourceId: headerData.funding_source_id,
            projectId: headerData.project_id,
            amount: Number(headerData.total_estimated_amount || 0),
          })
          setBudgetCheck(liveBudget)
        } else {
          setBudgetCheck(null)
        }
      } catch (budgetError) {
        console.error('Error fetching live FF3 budget position:', budgetError)
        setBudgetCheck(null)
      }

      if (headerData.budget_allocation_id) {
        const { data: positionData } = await supabase.from('v_authoritative_budget_position').select('*').eq('budget_allocation_id', headerData.budget_allocation_id).maybeSingle()
        setFinancialPosition(positionData as AuthoritativeBudgetPosition | null)
      } else {
        setFinancialPosition(null)
      }
    } catch (err) {
      console.error('Error fetching FF3:', err)
      setError('Failed to load FF3 details')
    } finally { setLoading(false) }
  }, [resolvedParams.ff3_number])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchFF3Detail()
  }, [fetchFF3Detail])

  async function handleApproval(action: 'ENDORSE_SUPERVISOR' | 'ENDORSE_SECTION_HEAD' | 'APPROVE') {
    if (!header) return
    setActionLoading(true); setError(""); setSuccess("")
    try {
      await approveFF3(header.id, action, approvalComments)
      setSuccess(`FF3 ${header.ff3_number} has been ${action === 'APPROVE' ? 'approved and committed' : 'endorsed'}!`)
      setApprovalComments("")
      await fetchFF3Detail()
    } catch (err) {
      console.error('Error approving FF3:', err)
      setError(err instanceof Error ? err.message : 'Failed to process approval. Please try again.')
    } finally { setActionLoading(false) }
  }

  async function handleReject() {
    if (!header || !rejectComments.trim()) return
    setActionLoading(true); setError(""); setSuccess("")
    try {
      await approveFF3(header.id, 'REJECT', rejectComments)
      setSuccess(`FF3 ${header.ff3_number} has been rejected.`)
      setShowRejectModal(false); setRejectComments("")
      await fetchFF3Detail()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject. Please try again.')
    } finally { setActionLoading(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>
  if (!header) return <div className="text-center py-12"><FileText className="h-12 w-12 mx-auto text-slate-300 mb-4" /><h2 className="text-xl font-semibold">FF3 Not Found</h2><Link href="/dashboard/ff3" className="mt-4 inline-block text-blue-600">← Back to FF3 List</Link></div>

  const liveBlocked = budgetCheck?.budgetControlStatus === 'INSUFFICIENT_BUDGET_BLOCKED'
  const canEndorseSupervisor = header.status === 'SUBMITTED' && can('ff3.endorse')
  const canEndorseSectionHead = header.status === 'ENDORSED_SUPERVISOR' && can('ff3.endorse')
  const canApprovePermission = header.status === 'ENDORSED_SECTION_HEAD' && can('ff3.approve')
  const canApprove = canApprovePermission && !liveBlocked
  const canReject = ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD'].includes(header.status) && (can('ff3.reject') || can('ff3.approve'))
  const isTerminal = ['APPROVED', 'COMMITTED', 'REJECTED', 'CANCELLED', 'RETURNED', 'EXPIRED'].includes(header.status)
  const hasAnyAction = canEndorseSupervisor || canEndorseSectionHead || canApprovePermission || canReject

  const handleExportPDF = () => {
    const pdfData: FF3PDFData = {
      ff3_number: header.ff3_number, financial_year: header.financial_year, request_date: header.request_date,
      status: header.status, department: header.department?.name, section: header.section?.name,
      province: header.province?.name, funding_source: header.funding_source?.name,
      purpose: header.purpose, justification: header.justification,
      required_by_date: header.required_by_date || undefined, urgency_level: header.urgency_level || undefined,
      procurement_method: header.procurement_method || undefined, total_estimated_amount: header.total_estimated_amount || 0,
      is_within_budget: !liveBlocked,
      items: items.map(item => ({ line_number: item.line_number, item_description: item.item_description, quantity: item.quantity, unit_of_measure: item.unit_of_measure || undefined, estimated_unit_price: item.estimated_unit_price || 0 })),
      quotations: quotations.map(q => ({ supplier_name: q.supplier_name, quotation_number: q.quotation_number || undefined, quotation_date: q.quotation_date || undefined, quotation_amount: q.quotation_amount, is_selected: q.is_selected })),
      approvals: approvals.map(a => ({ approval_level: a.approval_level, action_taken: a.action_taken, action_date: a.action_date, comments: a.comments || undefined })),
    }
    downloadPDF(generateFF3PDF(pdfData), `${header.ff3_number}.pdf`)
  }

  return (
    <div className="space-y-6 pb-28">
      <div className="flex items-center justify-between"><div className="flex items-center gap-4"><Link href="/dashboard/ff3" className="p-2 hover:bg-slate-100 rounded-lg"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link><div><div className="flex items-center gap-3"><h1 className="text-2xl font-bold text-slate-900">{header.ff3_number}</h1><StatusBadge status={header.status} /></div><p className="text-slate-600 mt-1">Finance Form 3 - Requisition Details</p></div></div><div className="flex items-center gap-3">{header.urgency_level && <UrgencyBadge urgency={header.urgency_level} />}<button onClick={handleExportPDF} className="px-4 py-2 bg-slate-100 rounded-lg flex items-center gap-2"><Download className="h-4 w-4" />Export PDF</button></div></div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3"><AlertCircle className="h-5 w-5 text-red-600" /><p className="text-red-700">{error}</p></div>}
      {success && <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex gap-3"><CheckCircle2 className="h-5 w-5 text-green-600" /><p className="text-green-700">{success}</p></div>}

      {liveBlocked && <div className="rounded-xl border-2 border-red-300 bg-red-50 p-5 text-red-900"><div className="flex items-center gap-2 text-lg font-bold"><AlertCircle className="h-6 w-6" />INSUFFICIENT BUDGET – COMMITMENT BLOCKED</div><p className="mt-2 text-sm">Managerial review may continue, but this FF3 cannot create a financial commitment or receive final financial approval until the K {money(budgetCheck.shortfall)} shortfall is funded. The Division may reduce or return the request, or initiate a reallocation for Registrar consideration.</p></div>}

      <div className="bg-white rounded-lg border border-slate-200 p-6"><h2 className="text-lg font-semibold mb-4">Requisition Information</h2><div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"><InfoField icon={<Calendar className="h-4 w-4" />} label="Request Date" value={new Date(header.request_date).toLocaleDateString('en-GB')} /><InfoField icon={<Calendar className="h-4 w-4" />} label="Financial Year" value={header.financial_year.toString()} /><InfoField icon={<Building2 className="h-4 w-4" />} label="Department" value={header.department?.name || '-'} /><InfoField icon={<Building2 className="h-4 w-4" />} label="Section" value={header.section?.name || '-'} /><InfoField icon={<MapPin className="h-4 w-4" />} label="Province" value={header.province?.name || '-'} /><InfoField icon={<DollarSign className="h-4 w-4" />} label="Funding Source" value={header.funding_source?.name || '-'} /><InfoField icon={<Calendar className="h-4 w-4" />} label="Required By" value={header.required_by_date ? new Date(header.required_by_date).toLocaleDateString('en-GB') : '-'} /><InfoField icon={<FileText className="h-4 w-4" />} label="Procurement Method" value={header.procurement_method || '-'} /></div></div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-semibold">Live Budget Position</h2>{commitment && <Link href="/dashboard/commitments" className="text-sm font-medium text-png-red">View Commitment {commitment.commitment_number}</Link>}</div>
        {budgetCheck?.hasAllocation ? <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-3"><FinancialTile label="Current Approved Budget" amount={budgetCheck.currentApproved} /><FinancialTile label="Commitments" amount={budgetCheck.committed} /><FinancialTile label="Actual Expenditure" amount={budgetCheck.spent} /><FinancialTile label="AVAILABLE" amount={budgetCheck.available} strong={!liveBlocked} /><FinancialTile label="This FF3 Request" amount={header.total_estimated_amount || 0} /><FinancialTile label="Shortfall" amount={budgetCheck.shortfall} warning={liveBlocked} /></div> : <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">A unique authoritative budget mapping is not currently available. Status: {budgetCheck?.mappingStatus || header.budget_mapping_status || 'BUDGET_MAPPING_REQUIRED'}.</div>}
        {budgetCheck && <p className="mt-3 text-xs text-slate-500">Control source: {budgetCheck.budgetControlSource === 'SIMPLIFIED_ACTIVE' ? 'Active Head Office Annual Budget' : 'Legacy allocation/release compatibility engine'} · Last refreshed on this page load.</p>}
        {!budgetCheck && financialPosition && <p className="mt-3 text-xs text-slate-500">Legacy allocation snapshot available: K {money(financialPosition.available_amount)}.</p>}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6"><h2 className="text-lg font-semibold mb-4">Purpose & Justification</h2><div className="space-y-4"><div><label className="text-sm font-medium text-slate-600">Purpose of Expenditure</label><p className="mt-1 text-slate-900">{header.purpose}</p></div><div><label className="text-sm font-medium text-slate-600">Justification</label><p className="mt-1 text-slate-900">{header.justification || '-'}</p></div></div></div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden"><div className="p-6 border-b"><h2 className="text-lg font-semibold">Requisition Items</h2></div><div className="overflow-x-auto"><table className="w-full"><thead className="bg-slate-50"><tr><th className="px-4 py-3 text-left">#</th><th className="px-4 py-3 text-left">Description</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-left">Unit</th><th className="px-4 py-3 text-right">Unit Price</th><th className="px-4 py-3 text-right">Total</th></tr></thead><tbody className="divide-y">{items.map(item => <tr key={item.id}><td className="px-4 py-3">{item.line_number}</td><td className="px-4 py-3">{item.item_description}</td><td className="px-4 py-3 text-right">{item.quantity}</td><td className="px-4 py-3">{item.unit_of_measure || '-'}</td><td className="px-4 py-3 text-right">K {money(item.estimated_unit_price || 0)}</td><td className="px-4 py-3 text-right font-medium">K {money(item.quantity * (item.estimated_unit_price || 0))}</td></tr>)}</tbody><tfoot className="bg-slate-50"><tr><td colSpan={5} className="px-4 py-3 text-right font-semibold">Total Estimated Amount:</td><td className="px-4 py-3 text-right text-lg font-bold">K {money(header.total_estimated_amount || 0)}</td></tr></tfoot></table></div></div>

      <div className="bg-white rounded-lg border border-slate-200 p-6"><h2 className="text-lg font-semibold mb-4">Quotations ({quotations.length})</h2><div className="grid md:grid-cols-3 gap-4">{quotations.map((quot, index) => <div key={quot.id} className={`border rounded-lg p-4 ${quot.is_selected ? 'border-green-500 bg-green-50' : 'border-slate-200'}`}><div className="flex justify-between mb-2"><span className="text-sm text-slate-600">Quotation {index + 1}</span>{quot.is_selected && <span className="px-2 py-0.5 bg-green-600 text-white text-xs rounded-full">Selected</span>}</div><p className="font-semibold">{quot.supplier_name}</p><p className="text-sm text-slate-600">{quot.quotation_number || 'No quote #'}</p><p className="text-lg font-bold mt-2">K {money(quot.quotation_amount)}</p></div>)}</div></div>

      {approvals.length > 0 && <div className="bg-white rounded-lg border border-slate-200 p-6"><h2 className="text-lg font-semibold mb-4">Approval History</h2><div className="space-y-4">{approvals.map(approval => <div key={approval.id} className="flex items-start gap-4 p-4 bg-slate-50 rounded-lg"><div className="p-2 rounded-full bg-slate-100">{approval.action_taken === 'APPROVED' ? <ThumbsUp className="h-4 w-4 text-green-600" /> : <ThumbsDown className="h-4 w-4 text-slate-600" />}</div><div className="flex-1"><div className="flex justify-between"><p className="font-medium">{approval.approval_level.replace(/_/g, ' ')}</p><span className="text-sm text-slate-500">{new Date(approval.action_date).toLocaleString('en-GB')}</span></div><p className="text-sm">{approval.action_taken}</p>{approval.comments && <p className="text-sm text-slate-600 mt-2 flex gap-2"><MessageSquare className="h-4 w-4" />{approval.comments}</p>}</div></div>)}</div></div>}

      {!isTerminal && hasAnyAction && <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 z-10"><div className="max-w-[1600px] mx-auto"><div className="mb-3"><input type="text" value={approvalComments} onChange={(e) => setApprovalComments(e.target.value)} placeholder="Approval comments (optional)" className="w-full px-3 py-2 border rounded-lg" /></div><div className="flex justify-between"><Link href="/dashboard/ff3" className="px-4 py-2 border rounded-lg">Back to List</Link><div className="flex gap-3">{canReject && <button onClick={() => setShowRejectModal(true)} disabled={actionLoading} className="px-4 py-2 bg-red-600 text-white rounded-lg flex gap-2"><XCircle className="h-4 w-4" />Reject</button>}{canEndorseSupervisor && <button onClick={() => void handleApproval('ENDORSE_SUPERVISOR')} disabled={actionLoading} className="px-4 py-2 bg-blue-600 text-white rounded-lg flex gap-2"><Send className="h-4 w-4" />Endorse (Supervisor)</button>}{canEndorseSectionHead && <button onClick={() => void handleApproval('ENDORSE_SECTION_HEAD')} disabled={actionLoading} className="px-4 py-2 bg-blue-600 text-white rounded-lg flex gap-2"><Send className="h-4 w-4" />Endorse (Section Head)</button>}{canApprovePermission && <button onClick={() => void handleApproval('APPROVE')} disabled={actionLoading || !canApprove} title={liveBlocked ? 'Commitment blocked until the budget shortfall is funded' : undefined} className="px-6 py-2 bg-green-600 text-white rounded-lg flex gap-2 disabled:opacity-50 disabled:cursor-not-allowed"><CheckCircle2 className="h-4 w-4" />{liveBlocked ? 'COMMITMENT BLOCKED' : 'Approve & Create Commitment'}</button>}</div></div></div></div>}

      {showRejectModal && <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="bg-white rounded-lg p-6 w-full max-w-md mx-4"><h3 className="text-lg font-semibold mb-4">Reject FF3 Requisition</h3><textarea value={rejectComments} onChange={(e) => setRejectComments(e.target.value)} placeholder="Enter rejection reason..." rows={4} className="w-full px-3 py-2 border rounded-lg mb-4" /><div className="flex justify-end gap-3"><button onClick={() => setShowRejectModal(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button onClick={() => void handleReject()} disabled={!rejectComments.trim() || actionLoading} className="px-4 py-2 bg-red-600 text-white rounded-lg">Confirm Rejection</button></div></div></div>}
    </div>
  )
}

function InfoField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div><div className="flex items-center gap-2 text-slate-600 mb-1">{icon}<span className="text-sm font-medium">{label}</span></div><p className="text-slate-900">{value}</p></div> }
function FinancialTile({ label, amount, strong, warning }: { label: string; amount: number; strong?: boolean; warning?: boolean }) { return <div className={`rounded-lg border p-3 ${warning ? 'border-red-200 bg-red-50' : strong ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-slate-50'}`}><p className="text-xs font-medium uppercase text-slate-500">{label}</p><p className={`mt-2 text-lg font-bold ${warning ? 'text-red-700' : strong ? 'text-green-700' : 'text-slate-900'}`}>K {money(amount)}</p></div> }
function StatusBadge({ status }: { status: FF3Status }) { const map: Record<FF3Status, string> = { DRAFT:'bg-slate-100 text-slate-700', SUBMITTED:'bg-blue-100 text-blue-700', ENDORSED_SUPERVISOR:'bg-blue-100 text-blue-700', ENDORSED_SECTION_HEAD:'bg-amber-100 text-amber-700', APPROVED:'bg-green-100 text-green-700', COMMITTED:'bg-green-100 text-green-700', REJECTED:'bg-red-100 text-red-700', CANCELLED:'bg-red-100 text-red-700', RETURNED:'bg-amber-100 text-amber-700', EXPIRED:'bg-slate-100 text-slate-700' }; return <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${map[status]}`}>{['APPROVED','COMMITTED'].includes(status) && <CheckCircle2 className="h-4 w-4" />}{['REJECTED','CANCELLED'].includes(status) && <XCircle className="h-4 w-4" />}{['SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD','RETURNED'].includes(status) && <Clock className="h-4 w-4" />}{status.replace(/_/g,' ')}</span> }
function UrgencyBadge({ urgency }: { urgency: string }) { const map: Record<string,string> = { LOW:'bg-slate-100 text-slate-700', MEDIUM:'bg-amber-100 text-amber-700', HIGH:'bg-orange-100 text-orange-700', URGENT:'bg-red-100 text-red-700' }; return <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${map[urgency] || map.MEDIUM}`}>{urgency}</span> }
