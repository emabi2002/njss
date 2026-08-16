"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertCircle, Building2, CheckCircle2, Clock, FileText, Loader2, Plus, Search, ShieldCheck, XCircle } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import {
  addSupplierDocument,
  createSupplier,
  createSupplierFollowup,
  getSupplierCommitmentPosition,
  getSupplierDocuments,
  getSupplierRegisterRows,
  transitionSupplier,
  type SupplierPayload,
  type SupplierRegisterRow,
  type SupplierStatus,
} from "@/lib/api"

const SUPPLIER_TYPES = [
  "GOODS_SUPPLIER",
  "SERVICE_PROVIDER",
  "CONTRACTOR",
  "CONSULTANT",
  "ICT_PROVIDER",
  "MAINTENANCE_PROVIDER",
  "UTILITY_PROVIDER",
  "TRANSPORT_PROVIDER",
  "ACCOMMODATION_PROVIDER",
  "PROFESSIONAL_SERVICES",
  "WORKS_CONTRACTOR",
  "OTHER",
]

const DOCUMENT_TYPES = [
  "IPA_REGISTRATION",
  "TIN",
  "TAX_COMPLIANCE",
  "BUSINESS_LICENCE",
  "INSURANCE",
  "PROFESSIONAL_CERTIFICATION",
  "CONTRACT",
  "OTHER",
]

type CommitmentPosition = {
  supplier_id: string
  ff3_number: string | null
  commitment_number: string | null
  financial_year: number | null
  department: string | null
  section: string | null
  finance_code: string | null
  funding_source: string | null
  original_commitment: number | null
  current_commitment: number | null
  externally_recorded_paid_amount: number | null
  outstanding_commitment: number | null
  commitment_status: string | null
}

type SupplierDocument = {
  id: string
  supplier_id: string
  document_type: string
  document_number: string | null
  expiry_date: string | null
  verification_status: string
  expiry_bucket: string
  file_name: string | null
}

type NewSupplierForm = SupplierPayload & { allowPossibleDuplicate?: boolean }

export default function SupplierManagementPage() {
  const { can } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [complianceFilter, setComplianceFilter] = useState("ALL")
  const [suppliers, setSuppliers] = useState<SupplierRegisterRow[]>([])
  const [selected, setSelected] = useState<SupplierRegisterRow | null>(null)
  const [commitments, setCommitments] = useState<CommitmentPosition[]>([])
  const [documents, setDocuments] = useState<SupplierDocument[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newSupplier, setNewSupplier] = useState<NewSupplierForm>({ legal_name: "", supplier_type: "GOODS_SUPPLIER", country: "Papua New Guinea" })
  const [documentDraft, setDocumentDraft] = useState({ document_type: "IPA_REGISTRATION", document_number: "", expiry_date: "", notes: "" })
  const [followupDraft, setFollowupDraft] = useState({ issue_type: "GENERAL", issue_description: "", next_action: "", next_follow_up_date: "" })

  const fetchSuppliers = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await getSupplierRegisterRows()
      setSuppliers(rows)
      setSelected((current) => current ? rows.find((row) => row.id === current.id) || current : rows[0] || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load supplier register")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSuppliers()
  }, [fetchSuppliers])

  useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      if (!selected) {
        setCommitments([])
        setDocuments([])
        return
      }
      try {
        const [positionRows, documentRows] = await Promise.all([
          getSupplierCommitmentPosition(selected.id),
          getSupplierDocuments(selected.id),
        ])
        if (!cancelled) {
          setCommitments(positionRows as CommitmentPosition[])
          setDocuments(documentRows as SupplierDocument[])
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load supplier profile")
      }
    }
    loadProfile()
    return () => { cancelled = true }
  }, [selected])

  const filteredSuppliers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return suppliers.filter((supplier) => {
      const matchesQuery = !needle || [
        supplier.supplier_code,
        supplier.supplier_name,
        supplier.legal_name,
        supplier.trading_name,
        supplier.ipa_registration_number,
        supplier.tin,
        supplier.supplier_type,
        supplier.category_names,
        supplier.province,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))
      const matchesStatus = statusFilter === "ALL" || supplier.status === statusFilter
      const matchesCompliance = complianceFilter === "ALL" || supplier.compliance_status === complianceFilter
      return matchesQuery && matchesStatus && matchesCompliance
    })
  }, [suppliers, query, statusFilter, complianceFilter])

  const stats = useMemo(() => ({
    approved: suppliers.filter((s) => s.status === "APPROVED").length,
    pending: suppliers.filter((s) => s.status === "PENDING_VERIFICATION").length,
    active: suppliers.filter((s) => !["INACTIVE", "SUSPENDED", "REJECTED"].includes(s.status)).length,
    incomplete: suppliers.filter((s) => s.compliance_status === "INCOMPLETE").length,
    expired: suppliers.filter((s) => s.compliance_status === "EXPIRED").length,
    expiring: suppliers.filter((s) => s.compliance_status === "EXPIRING").length,
    withActiveCommitments: suppliers.filter((s) => Number(s.active_commitments || 0) > 0).length,
    totalActiveCommitment: suppliers.reduce((sum, s) => sum + Number(s.outstanding_commitment_value || 0), 0),
  }), [suppliers])

  async function handleCreateSupplier() {
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      const result = await createSupplier(newSupplier, Boolean(newSupplier.allowPossibleDuplicate))
      if (result.requires_review) {
        setError('POSSIBLE DUPLICATE SUPPLIER. Exact IPA/TIN duplicates are blocked; similar records require authorized review before creation.')
        return
      }
      setSuccess('Supplier created in DRAFT status. Submit, verify and approve it before it can be used for new commitments.')
      setShowCreate(false)
      setNewSupplier({ legal_name: "", supplier_type: "GOODS_SUPPLIER", country: "Papua New Guinea" })
      await fetchSuppliers()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create supplier")
    } finally {
      setSaving(false)
    }
  }

  async function handleTransition(action: 'SUBMIT' | 'VERIFY' | 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REACTIVATE') {
    if (!selected) return
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      await transitionSupplier(selected.id, action, `${action.replace(/_/g, ' ')} from Supplier Management`)
      setSuccess(`Supplier ${selected.supplier_code} ${action.toLowerCase().replace(/_/g, ' ')} completed.`)
      await fetchSuppliers()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Supplier workflow action failed")
    } finally {
      setSaving(false)
    }
  }

  async function handleAddDocument() {
    if (!selected) return
    setSaving(true)
    setError("")
    try {
      await addSupplierDocument(selected.id, documentDraft)
      setDocumentDraft({ document_type: "IPA_REGISTRATION", document_number: "", expiry_date: "", notes: "" })
      setSuccess('Compliance document recorded for supplier verification.')
      setDocuments((await getSupplierDocuments(selected.id)) as SupplierDocument[])
      await fetchSuppliers()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add supplier document")
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateFollowup() {
    if (!selected || !followupDraft.issue_description.trim()) return
    setSaving(true)
    setError("")
    try {
      await createSupplierFollowup(selected.id, followupDraft)
      setFollowupDraft({ issue_type: "GENERAL", issue_description: "", next_action: "", next_follow_up_date: "" })
      setSuccess('Supplier follow-up created manually. Later phases may create these automatically for receiving/service issues.')
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create supplier follow-up")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Supplier Management</h1>
          <p className="mt-1 text-slate-600">Authoritative supplier and service-provider register linked to quotations, FF3s and commitments. NJSS remains an internal records and financial-control system only.</p>
        </div>
        {can('supplier.create') && (
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-lg bg-png-red px-4 py-2 text-sm font-semibold text-white hover:bg-png-maroon">
            <Plus className="h-4 w-4" /> Register Supplier
          </button>
        )}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>System boundary:</strong> this page does not execute payments, transmit transactions to Finance, connect to banks, or record goods/service receipt. External Finance processing remains paper-based and outside NJSS.
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex gap-2"><AlertCircle className="h-4 w-4" />{error}</div>}
      {success && <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700 flex gap-2"><CheckCircle2 className="h-4 w-4" />{success}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <DashboardCard label="Approved Suppliers" value={stats.approved} onClick={() => setStatusFilter('APPROVED')} />
        <DashboardCard label="Pending Verification" value={stats.pending} onClick={() => setStatusFilter('PENDING_VERIFICATION')} />
        <DashboardCard label="Active Suppliers" value={stats.active} onClick={() => setStatusFilter('ALL')} />
        <DashboardCard label="Incomplete Compliance" value={stats.incomplete} onClick={() => setComplianceFilter('INCOMPLETE')} />
        <DashboardCard label="Expired Compliance" value={stats.expired} onClick={() => setComplianceFilter('EXPIRED')} />
        <DashboardCard label="Expiring Documents" value={stats.expiring} onClick={() => setComplianceFilter('EXPIRING')} />
        <DashboardCard label="Suppliers With Active Commitments" value={stats.withActiveCommitments} />
        <DashboardCard label="Outstanding Commitment Value" value={`K ${stats.totalActiveCommitment.toLocaleString()}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-[1fr_180px_180px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search code, legal name, trading name, IPA, TIN, type, category or province" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-png-red" />
            </div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="ALL">All Statuses</option>
              {['DRAFT','PENDING_VERIFICATION','VERIFIED','APPROVED','REJECTED','SUSPENDED','INACTIVE'].map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={complianceFilter} onChange={(event) => setComplianceFilter(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="ALL">All Compliance</option>
              {['COMPLIANT','INCOMPLETE','EXPIRING','EXPIRED'].map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">Code</th>
                  <th className="px-4 py-3 text-left">Supplier</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Category</th>
                  <th className="px-4 py-3 text-left">Contact</th>
                  <th className="px-4 py-3 text-left">Compliance</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Active Commitments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSuppliers.map((supplier) => (
                  <tr key={supplier.id} onClick={() => setSelected(supplier)} className={`cursor-pointer hover:bg-slate-50 ${selected?.id === supplier.id ? 'bg-red-50/40' : ''}`}>
                    <td className="px-4 py-3 font-medium text-png-red">{supplier.supplier_code}</td>
                    <td className="px-4 py-3"><div className="font-medium text-slate-900">{supplier.supplier_name}</div><div className="text-xs text-slate-500">{supplier.trading_name || 'No trading name'}</div></td>
                    <td className="px-4 py-3 text-sm text-slate-700">{supplier.supplier_type?.replace(/_/g, ' ') || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{supplier.category_names || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{supplier.primary_contact_name || '-'}<br />{supplier.phone || supplier.email || ''}</td>
                    <td className="px-4 py-3"><ComplianceBadge status={supplier.compliance_status} /></td>
                    <td className="px-4 py-3"><SupplierStatusBadge status={supplier.status} /></td>
                    <td className="px-4 py-3 text-right font-medium">{supplier.active_commitments || 0}</td>
                  </tr>
                ))}
                {filteredSuppliers.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">No suppliers match the current filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="rounded-lg border border-slate-200 bg-white p-5">
          {selected ? (
            <div className="space-y-5">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-png-red">{selected.supplier_code}</p>
                    <h2 className="text-xl font-bold text-slate-900">{selected.supplier_name}</h2>
                    <p className="text-sm text-slate-500">{selected.supplier_type?.replace(/_/g, ' ')}</p>
                  </div>
                  <SupplierStatusBadge status={selected.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <Info label="IPA" value={selected.ipa_registration_number} />
                  <Info label="TIN" value={selected.tin} />
                  <Info label="Contact" value={selected.primary_contact_name} />
                  <Info label="Phone" value={selected.phone} />
                  <Info label="Email" value={selected.email} />
                  <Info label="Province" value={selected.province} />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {selected.status === 'DRAFT' && can('supplier.submit') && <ActionButton label="Submit" onClick={() => handleTransition('SUBMIT')} />}
                {selected.status === 'PENDING_VERIFICATION' && can('supplier.verify') && <ActionButton label="Verify" onClick={() => handleTransition('VERIFY')} />}
                {selected.status === 'VERIFIED' && can('supplier.approve') && <ActionButton label="Approve" onClick={() => handleTransition('APPROVE')} />}
                {['DRAFT','PENDING_VERIFICATION','VERIFIED'].includes(selected.status) && can('supplier.reject') && <ActionButton label="Reject" danger onClick={() => handleTransition('REJECT')} />}
                {selected.status === 'APPROVED' && can('supplier.suspend') && <ActionButton label="Suspend" danger onClick={() => handleTransition('SUSPEND')} />}
                {['SUSPENDED','INACTIVE'].includes(selected.status) && can('supplier.reactivate') && <ActionButton label="Reactivate" onClick={() => handleTransition('REACTIVATE')} />}
              </div>

              <section className="rounded-lg border border-slate-200 p-4">
                <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900"><ShieldCheck className="h-4 w-4" /> Compliance</h3>
                <ComplianceBadge status={selected.compliance_status} />
                <div className="mt-3 space-y-2">
                  {documents.map((doc) => <div key={doc.id} className="rounded border border-slate-100 p-2 text-sm"><div className="font-medium">{doc.document_type.replace(/_/g, ' ')}</div><div className="text-slate-500">{doc.document_number || 'No number'} · {doc.expiry_bucket.replace(/_/g, ' ')}</div></div>)}
                  {documents.length === 0 && <p className="text-sm text-slate-500">No compliance documents recorded.</p>}
                </div>
                {can('supplier.compliance.manage') && (
                  <div className="mt-4 grid gap-2">
                    <select value={documentDraft.document_type} onChange={(event) => setDocumentDraft({ ...documentDraft, document_type: event.target.value })} className="rounded border border-slate-200 px-3 py-2 text-sm">{DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}</select>
                    <input value={documentDraft.document_number} onChange={(event) => setDocumentDraft({ ...documentDraft, document_number: event.target.value })} placeholder="Document number" className="rounded border border-slate-200 px-3 py-2 text-sm" />
                    <input value={documentDraft.expiry_date} onChange={(event) => setDocumentDraft({ ...documentDraft, expiry_date: event.target.value })} type="date" className="rounded border border-slate-200 px-3 py-2 text-sm" />
                    <button disabled={saving} onClick={handleAddDocument} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Add Compliance Document</button>
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 p-4">
                <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900"><FileText className="h-4 w-4" /> Transactions</h3>
                <div className="space-y-2">
                  {commitments.map((row, index) => <div key={`${row.commitment_number}-${index}`} className="rounded border border-slate-100 p-2 text-sm"><Link href={row.ff3_number ? `/dashboard/ff3/${row.ff3_number}` : '#'} className="font-medium text-png-red">{row.ff3_number || 'FF3'}</Link><div>{row.commitment_number || 'No commitment number'} · K {Number(row.outstanding_commitment || 0).toLocaleString()} outstanding</div><div className="text-xs text-slate-500">{row.department || '-'} · {row.finance_code || '-'}</div></div>)}
                  {commitments.length === 0 && <p className="text-sm text-slate-500">No linked FF3 commitments yet.</p>}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 p-4">
                <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900"><Clock className="h-4 w-4" /> Follow-up Foundation</h3>
                <p className="mb-3 text-sm text-slate-600">Manual Phase 3 follow-ups only. Later receiving/service phases may create follow-ups automatically.</p>
                {can('supplier.followup.manage') && <div className="grid gap-2"><input value={followupDraft.issue_type} onChange={(event) => setFollowupDraft({ ...followupDraft, issue_type: event.target.value })} placeholder="Issue type" className="rounded border border-slate-200 px-3 py-2 text-sm" /><textarea value={followupDraft.issue_description} onChange={(event) => setFollowupDraft({ ...followupDraft, issue_description: event.target.value })} placeholder="Issue description" rows={3} className="rounded border border-slate-200 px-3 py-2 text-sm" /><input value={followupDraft.next_action} onChange={(event) => setFollowupDraft({ ...followupDraft, next_action: event.target.value })} placeholder="Next action" className="rounded border border-slate-200 px-3 py-2 text-sm" /><input value={followupDraft.next_follow_up_date} onChange={(event) => setFollowupDraft({ ...followupDraft, next_follow_up_date: event.target.value })} type="date" className="rounded border border-slate-200 px-3 py-2 text-sm" /><button disabled={saving} onClick={handleCreateFollowup} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Create Follow-up</button></div>}
              </section>
            </div>
          ) : (
            <div className="py-16 text-center text-slate-500"><Building2 className="mx-auto mb-3 h-10 w-10 text-slate-300" />Select a supplier to view the profile.</div>
          )}
        </aside>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <h2 className="text-lg font-bold text-slate-900">Register Supplier / Service Provider</h2>
              <button onClick={() => setShowCreate(false)} className="rounded p-1 hover:bg-slate-100"><XCircle className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <TextField label="Legal Name" required value={newSupplier.legal_name} onChange={(value) => setNewSupplier({ ...newSupplier, legal_name: value })} />
              <TextField label="Trading Name" value={newSupplier.trading_name || ''} onChange={(value) => setNewSupplier({ ...newSupplier, trading_name: value })} />
              <SelectField label="Supplier Type" value={newSupplier.supplier_type || 'GOODS_SUPPLIER'} options={SUPPLIER_TYPES} onChange={(value) => setNewSupplier({ ...newSupplier, supplier_type: value })} />
              <TextField label="Category Codes" value={newSupplier.category_codes || ''} onChange={(value) => setNewSupplier({ ...newSupplier, category_codes: value })} placeholder="e.g. GOODS_SUPPLIER,ICT_PROVIDER" />
              <TextField label="IPA Registration Number" value={newSupplier.ipa_registration_number || ''} onChange={(value) => setNewSupplier({ ...newSupplier, ipa_registration_number: value })} />
              <TextField label="TIN" value={newSupplier.tin || ''} onChange={(value) => setNewSupplier({ ...newSupplier, tin: value })} />
              <TextField label="Primary Contact" value={newSupplier.primary_contact_name || ''} onChange={(value) => setNewSupplier({ ...newSupplier, primary_contact_name: value })} />
              <TextField label="Phone" value={newSupplier.phone || ''} onChange={(value) => setNewSupplier({ ...newSupplier, phone: value })} />
              <TextField label="Email" value={newSupplier.email || ''} onChange={(value) => setNewSupplier({ ...newSupplier, email: value })} />
              <TextField label="Province" value={newSupplier.province || ''} onChange={(value) => setNewSupplier({ ...newSupplier, province: value })} />
              <div className="md:col-span-2"><TextField label="Physical Address" value={newSupplier.physical_address || ''} onChange={(value) => setNewSupplier({ ...newSupplier, physical_address: value })} /></div>
              <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2"><input type="checkbox" checked={Boolean(newSupplier.allowPossibleDuplicate)} onChange={(event) => setNewSupplier({ ...newSupplier, allowPossibleDuplicate: event.target.checked })} />Authorized review: allow creation after possible-name duplicate warning. Exact IPA/TIN duplicates remain blocked.</label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 p-4"><button onClick={() => setShowCreate(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium">Cancel</button><button disabled={saving || !newSupplier.legal_name.trim()} onClick={handleCreateSupplier} className="rounded-lg bg-png-red px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Create Draft Supplier</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

function DashboardCard({ label, value, onClick }: { label: string; value: number | string; onClick?: () => void }) {
  return <button onClick={onClick} className="rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-png-red/40 hover:bg-red-50/30"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p></button>
}

function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  const classes: Record<string, string> = { APPROVED: 'bg-green-100 text-green-700', VERIFIED: 'bg-emerald-100 text-emerald-700', PENDING_VERIFICATION: 'bg-amber-100 text-amber-700', DRAFT: 'bg-slate-100 text-slate-700', REJECTED: 'bg-red-100 text-red-700', SUSPENDED: 'bg-red-100 text-red-700', INACTIVE: 'bg-slate-200 text-slate-600' }
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${classes[status] || classes.DRAFT}`}>{status.replace(/_/g, ' ')}</span>
}

function ComplianceBadge({ status }: { status: string }) {
  const classes: Record<string, string> = { COMPLIANT: 'bg-green-100 text-green-700', INCOMPLETE: 'bg-amber-100 text-amber-700', EXPIRING: 'bg-orange-100 text-orange-700', EXPIRED: 'bg-red-100 text-red-700' }
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${classes[status] || classes.INCOMPLETE}`}>{status}</span>
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <div><p className="text-xs font-medium uppercase text-slate-500">{label}</p><p className="text-sm text-slate-900">{value || '-'}</p></div>
}

function ActionButton({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`rounded-lg px-3 py-2 text-sm font-semibold text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-png-red hover:bg-png-maroon'}`}>{label}</button>
}

function TextField({ label, value, onChange, required, placeholder }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; placeholder?: string }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-slate-700">{label} {required && <span className="text-red-500">*</span>}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red" /></label>
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-slate-700">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red">{options.map((option) => <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>)}</select></label>
}
