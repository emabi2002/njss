"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, Banknote, CheckCircle2, FileCheck, Layers, Loader2, Plus, ReceiptText, RefreshCw, ShieldCheck, Wallet } from "lucide-react"
import {
  allocateFunding,
  approveFundingAllocation,
  createFundingAuthority,
  createFundingReceipt,
  getAllocationsForRelease,
  getFundingAllocations,
  getFundingAuthorities,
  getFundingReceipts,
  getFundingSources,
  transitionFundingAuthority,
  transitionFundingReceipt,
  type FundingAllocationRow,
  type FundingAuthorityRow,
  type FundingReceiptRow,
} from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"
import type { FundingSource } from "@/lib/supabase"

type Tab = "authorities" | "receipts" | "allocations"
type ReleaseAllocation = Awaited<ReturnType<typeof getAllocationsForRelease>>[number]
type Notice = { type: "ok" | "err"; text: string } | null

const AUTHORITY_TYPES = [
  "GOVERNMENT_APPROPRIATION",
  "WARRANT",
  "DJAG_ALLOCATION",
  "TREASURY_FINANCE_AUTHORITY",
  "SUPPLEMENTAL_ALLOCATION",
  "DONOR_GRANT",
  "DEVELOPMENT_PARTNER",
  "TRUST_FUND",
  "PROJECT_FUNDING",
  "OTHER",
]

const fmt = (n: number | null | undefined) => `K ${(n || 0).toLocaleString()}`
const today = () => new Date().toISOString().split("T")[0]
const clean = (value: string) => value.trim() || null

export default function FundingManagementPage() {
  const { can } = useAuth()
  const [tab, setTab] = useState<Tab>("authorities")
  const [year, setYear] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>(null)
  const [authorities, setAuthorities] = useState<FundingAuthorityRow[]>([])
  const [receipts, setReceipts] = useState<FundingReceiptRow[]>([])
  const [allocations, setAllocations] = useState<FundingAllocationRow[]>([])
  const [budgetLines, setBudgetLines] = useState<ReleaseAllocation[]>([])
  const [sources, setSources] = useState<FundingSource[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setNotice(null)
    try {
      const [authRows, receiptRows, allocationRows, budgetRows, sourceRows] = await Promise.all([
        getFundingAuthorities(year),
        getFundingReceipts(year),
        getFundingAllocations(year),
        getAllocationsForRelease(year),
        getFundingSources(),
      ])
      setAuthorities(authRows || [])
      setReceipts(receiptRows || [])
      setAllocations(allocationRows || [])
      setBudgetLines(budgetRows || [])
      setSources(sourceRows || [])
    } catch (err) {
      setNotice({ type: "err", text: err instanceof Error ? err.message : "Unable to load funding management data." })
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const totals = useMemo(() => {
    const authority = authorities.filter((r) => r.status === "APPROVED").reduce((s, r) => s + (r.approved_amount || 0), 0)
    const received = receipts.filter((r) => r.status === "APPROVED").reduce((s, r) => s + (r.amount_received || 0), 0)
    const allocated = allocations.filter((r) => r.status === "APPROVED").reduce((s, r) => s + (r.allocated_amount || 0), 0)
    const unreleased = allocations.filter((r) => r.status === "APPROVED").reduce((s, r) => s + (r.allocation_unreleased_balance || 0), 0)
    return { authority, received, allocated, unreleased }
  }, [authorities, receipts, allocations])

  const onAction = async (fn: () => Promise<unknown>, success: string) => {
    setNotice(null)
    try {
      await fn()
      setNotice({ type: "ok", text: success })
      await load()
    } catch (err) {
      setNotice({ type: "err", text: err instanceof Error ? err.message : "Funding operation failed." })
    }
  }

  const tabs: { key: Tab; label: string; icon: typeof Wallet }[] = [
    { key: "authorities", label: "Funding Authorities", icon: ShieldCheck },
    { key: "receipts", label: "Funding Receipts", icon: ReceiptText },
    { key: "allocations", label: "Funding Allocations", icon: Layers },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Banknote className="h-7 w-7 text-png-red" /> Funding Management</h1>
          <p className="text-slate-600 mt-1">Phase 1 controls for authority, receipt, allocation and budget-release funding identity.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value) || new Date().getFullYear())} className="w-28 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button onClick={load} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50" title="Refresh"><RefreshCw className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard title="Approved Authorities" value={totals.authority} tone="maroon" icon={<ShieldCheck className="h-5 w-5" />} />
        <MetricCard title="Approved Receipts" value={totals.received} tone="gold" icon={<ReceiptText className="h-5 w-5" />} />
        <MetricCard title="Funded Allocations" value={totals.allocated} tone="green" icon={<Wallet className="h-5 w-5" />} />
        <MetricCard title="Unreleased Funding" value={totals.unreleased} tone="slate" icon={<Banknote className="h-5 w-5" />} />
      </div>

      {notice && <NoticeBox notice={notice} />}

      <div className="flex flex-wrap gap-2">
        {tabs.map((item) => {
          const Icon = item.icon
          return <button key={item.key} onClick={() => setTab(item.key)} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 border ${tab === item.key ? "bg-png-red/10 border-png-gold/40 text-png-red" : "border-transparent text-slate-600 hover:bg-slate-100"}`}><Icon className="h-4 w-4" /> {item.label}</button>
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div>
      ) : tab === "authorities" ? (
        <AuthoritiesPanel year={year} authorities={authorities} sources={sources} canCreate={can("funding.create")} canSubmit={can("funding.submit")} canVerify={can("funding.verify")} canApprove={can("funding.approve")} canReject={can("funding.reject")} onAction={onAction} />
      ) : tab === "receipts" ? (
        <ReceiptsPanel authorities={authorities} receipts={receipts} canCreate={can("funding.create")} canSubmit={can("funding.submit")} canVerify={can("funding.verify")} canApprove={can("funding.approve")} canReject={can("funding.reject")} onAction={onAction} />
      ) : (
        <AllocationsPanel receipts={receipts} allocations={allocations} budgetLines={budgetLines} canAllocate={can("funding.allocate")} canApprove={can("funding.allocation.approve")} onAction={onAction} />
      )}
    </div>
  )
}

function AuthoritiesPanel({ year, authorities, sources, canCreate, canSubmit, canVerify, canApprove, canReject, onAction }: {
  year: number
  authorities: FundingAuthorityRow[]
  sources: FundingSource[]
  canCreate: boolean
  canSubmit: boolean
  canVerify: boolean
  canApprove: boolean
  canReject: boolean
  onAction: (fn: () => Promise<unknown>, success: string) => Promise<void>
}) {
  const [form, setForm] = useState({ authority_type: "DJAG_ALLOCATION", funding_source_id: "", source_agency: "DJAG", approved_amount: "", effective_date: today(), description: "", supporting_document_name: "", supporting_document_url: "" })

  const submit = () => onAction(() => createFundingAuthority({
    financial_year: year,
    authority_type: form.authority_type,
    funding_source_id: clean(form.funding_source_id),
    source_agency: clean(form.source_agency),
    approved_amount: parseFloat(form.approved_amount),
    effective_date: form.effective_date,
    description: clean(form.description),
    supporting_document_name: clean(form.supporting_document_name),
    supporting_document_url: clean(form.supporting_document_url),
  }), "Funding authority created.").then(() => setForm((f) => ({ ...f, approved_amount: "", description: "" })))

  return (
    <div className="space-y-4">
      {canCreate && <div className="bg-white rounded-lg border border-png-gold/40 p-5">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-4"><Plus className="h-4 w-4 text-png-red" /> Create Funding Authority</h2>
        <div className="grid md:grid-cols-12 gap-3">
          <Select label="Type" value={form.authority_type} onChange={(v) => setForm({ ...form, authority_type: v })} options={AUTHORITY_TYPES.map((v) => ({ value: v, label: v.replaceAll("_", " ") }))} className="md:col-span-3" />
          <Select label="Funding Source" value={form.funding_source_id} onChange={(v) => setForm({ ...form, funding_source_id: v })} options={[{ value: "", label: "Not restricted" }, ...sources.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))]} className="md:col-span-3" />
          <Field label="Source Agency" value={form.source_agency} onChange={(v) => setForm({ ...form, source_agency: v })} className="md:col-span-2" />
          <Field label="Amount (K)" type="number" value={form.approved_amount} onChange={(v) => setForm({ ...form, approved_amount: v })} className="md:col-span-2" />
          <Field label="Effective Date" type="date" value={form.effective_date} onChange={(v) => setForm({ ...form, effective_date: v })} className="md:col-span-2" />
          <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} className="md:col-span-5" />
          <Field label="Document Name" value={form.supporting_document_name} onChange={(v) => setForm({ ...form, supporting_document_name: v })} className="md:col-span-3" />
          <Field label="Document URL" value={form.supporting_document_url} onChange={(v) => setForm({ ...form, supporting_document_url: v })} className="md:col-span-3" />
          <button onClick={submit} disabled={!form.approved_amount} className="md:col-span-1 px-3 py-2 mt-5 rounded-lg bg-png-red text-white text-sm font-medium disabled:opacity-50"><Plus className="h-4 w-4 mx-auto" /></button>
        </div>
      </div>}
      <DataCard title="Funding Authority Register" empty="No funding authorities yet.">
        <table className="w-full min-w-[980px]"><thead><tr className="text-xs uppercase text-slate-500 bg-slate-50"><Th>Authority</Th><Th>Type</Th><Th>Source</Th><Th>Status</Th><Th right>Approved</Th><Th right>Receipts</Th><Th right>Remaining</Th><Th>Actions</Th></tr></thead><tbody className="divide-y divide-slate-100">
          {authorities.map((row) => <tr key={row.id} className="hover:bg-slate-50"><Td strong>{row.authority_number || "Draft"}</Td><Td>{row.authority_type.replaceAll("_", " ")}</Td><Td>{row.funding_source_name || row.source_agency || "-"}</Td><Td><Status status={row.status} /></Td><Td right>{fmt(row.approved_amount)}</Td><Td right>{fmt(row.approved_receipts)}</Td><Td right>{fmt(row.authority_remaining)}</Td><Td><WorkflowButtons status={row.status} canSubmit={canSubmit} canVerify={canVerify} canApprove={canApprove} canReject={canReject} onAction={(a) => onAction(() => transitionFundingAuthority(row.id, a), `Authority ${a.toLowerCase()} completed.`)} /></Td></tr>)}
        </tbody></table>
      </DataCard>
    </div>
  )
}

function ReceiptsPanel({ authorities, receipts, canCreate, canSubmit, canVerify, canApprove, canReject, onAction }: {
  authorities: FundingAuthorityRow[]
  receipts: FundingReceiptRow[]
  canCreate: boolean
  canSubmit: boolean
  canVerify: boolean
  canApprove: boolean
  canReject: boolean
  onAction: (fn: () => Promise<unknown>, success: string) => Promise<void>
}) {
  const approvedAuthorities = authorities.filter((a) => a.status === "APPROVED")
  const [form, setForm] = useState({ funding_authority_id: "", amount_received: "", receipt_date: today(), finance_ifms_reference: "", bank_reference: "", description: "" })
  const selected = authorities.find((a) => a.id === form.funding_authority_id)
  const submit = () => onAction(() => createFundingReceipt({
    funding_authority_id: form.funding_authority_id,
    receipt_date: form.receipt_date,
    amount_received: parseFloat(form.amount_received),
    finance_ifms_reference: clean(form.finance_ifms_reference),
    bank_reference: clean(form.bank_reference),
    description: clean(form.description),
  }), "Funding receipt created.").then(() => setForm((f) => ({ ...f, amount_received: "", finance_ifms_reference: "", bank_reference: "" })))

  return <div className="space-y-4">
    {canCreate && <div className="bg-white rounded-lg border border-png-gold/40 p-5">
      <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-4"><ReceiptText className="h-4 w-4 text-png-red" /> Create Funding Receipt</h2>
      <div className="grid md:grid-cols-12 gap-3">
        <Select label="Approved Authority" value={form.funding_authority_id} onChange={(v) => setForm({ ...form, funding_authority_id: v })} options={[{ value: "", label: "Select authority" }, ...approvedAuthorities.map((a) => ({ value: a.id, label: `${a.authority_number} · ${fmt(a.approved_amount)} · balance ${fmt(a.authority_remaining)}` }))]} className="md:col-span-5" />
        <Field label="Receipt Amount (K)" type="number" value={form.amount_received} onChange={(v) => setForm({ ...form, amount_received: v })} className="md:col-span-2" />
        <Field label="Receipt Date" type="date" value={form.receipt_date} onChange={(v) => setForm({ ...form, receipt_date: v })} className="md:col-span-2" />
        <Field label="Finance/IFMS Ref" value={form.finance_ifms_reference} onChange={(v) => setForm({ ...form, finance_ifms_reference: v })} className="md:col-span-2" />
        <button onClick={submit} disabled={!form.funding_authority_id || !form.amount_received} className="md:col-span-1 px-3 py-2 mt-5 rounded-lg bg-png-red text-white text-sm font-medium disabled:opacity-50"><Plus className="h-4 w-4 mx-auto" /></button>
      </div>
      {selected && <p className="mt-3 text-xs text-slate-600">Authority amount <b>{fmt(selected.approved_amount)}</b> · Previous approved receipts <b>{fmt(selected.approved_receipts)}</b> · Authority balance <b className="text-png-maroon">{fmt(selected.authority_remaining)}</b></p>}
    </div>}
    <DataCard title="Funding Receipt Register" empty="No funding receipts yet.">
      <table className="w-full min-w-[1020px]"><thead><tr className="text-xs uppercase text-slate-500 bg-slate-50"><Th>Receipt</Th><Th>Authority</Th><Th>Status</Th><Th>Date</Th><Th right>Amount</Th><Th right>Previous Receipts</Th><Th right>Authority Balance</Th><Th right>Unallocated</Th><Th>Actions</Th></tr></thead><tbody className="divide-y divide-slate-100">
        {receipts.map((row) => <tr key={row.id} className="hover:bg-slate-50"><Td strong>{row.receipt_number || "Draft"}</Td><Td>{row.authority_number || "-"}</Td><Td><Status status={row.status} /></Td><Td>{row.receipt_date}</Td><Td right>{fmt(row.amount_received)}</Td><Td right>{fmt(row.previous_approved_receipts)}</Td><Td right>{fmt(row.authority_balance_before_this_receipt)}</Td><Td right>{fmt(row.receipt_unallocated_balance)}</Td><Td><WorkflowButtons status={row.status} canSubmit={canSubmit} canVerify={canVerify} canApprove={canApprove} canReject={canReject} onAction={(a) => onAction(() => transitionFundingReceipt(row.id, a), `Receipt ${a.toLowerCase()} completed.`)} /></Td></tr>)}
      </tbody></table>
    </DataCard>
  </div>
}

function AllocationsPanel({ receipts, allocations, budgetLines, canAllocate, canApprove, onAction }: {
  receipts: FundingReceiptRow[]
  allocations: FundingAllocationRow[]
  budgetLines: ReleaseAllocation[]
  canAllocate: boolean
  canApprove: boolean
  onAction: (fn: () => Promise<unknown>, success: string) => Promise<void>
}) {
  const availableReceipts = receipts.filter((r) => r.status === "APPROVED" && (r.receipt_unallocated_balance || 0) > 0)
  const [form, setForm] = useState({ funding_receipt_id: "", budget_allocation_id: "", allocated_amount: "", allocation_date: today(), notes: "" })
  const receipt = receipts.find((r) => r.id === form.funding_receipt_id)
  const line = budgetLines.find((b) => b.id === form.budget_allocation_id)
  const maxAllocation = Math.max(0, Math.min(receipt?.receipt_unallocated_balance || 0, (line?.revised_budget || 0) - (line?.funded || 0)))
  const submit = () => onAction(() => allocateFunding({
    funding_receipt_id: form.funding_receipt_id,
    budget_allocation_id: form.budget_allocation_id,
    allocated_amount: parseFloat(form.allocated_amount),
    allocation_date: form.allocation_date,
    notes: clean(form.notes),
  }), "Funding allocation recorded as DRAFT for separate approval.").then(() => setForm((f) => ({ ...f, allocated_amount: "", notes: "" })))

  return <div className="space-y-4">
    {canAllocate && <div className="bg-white rounded-lg border border-png-gold/40 p-5">
      <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-4"><Layers className="h-4 w-4 text-png-red" /> Allocate Actual Funding to Approved Budget</h2>
      <div className="grid md:grid-cols-12 gap-3">
        <Select label="Available Receipt" value={form.funding_receipt_id} onChange={(v) => setForm({ ...form, funding_receipt_id: v })} options={[{ value: "", label: "Select receipt" }, ...availableReceipts.map((r) => ({ value: r.id, label: `${r.receipt_number} · available ${fmt(r.receipt_unallocated_balance)}` }))]} className="md:col-span-4" />
        <Select label="Approved Budget Line" value={form.budget_allocation_id} onChange={(v) => setForm({ ...form, budget_allocation_id: v })} options={[{ value: "", label: "Select budget line" }, ...budgetLines.map((b) => ({ value: b.id, label: `${b.full_expense_code || b.cost_centre_code || "Budget"} · approved ${fmt(b.revised_budget)} · funded ${fmt(b.funded)}` }))]} className="md:col-span-4" />
        <Field label="Amount (K)" type="number" value={form.allocated_amount} onChange={(v) => setForm({ ...form, allocated_amount: v })} className="md:col-span-2" />
        <Field label="Date" type="date" value={form.allocation_date} onChange={(v) => setForm({ ...form, allocation_date: v })} className="md:col-span-1" />
        <button onClick={submit} disabled={!form.funding_receipt_id || !form.budget_allocation_id || !form.allocated_amount} className="md:col-span-1 px-3 py-2 mt-5 rounded-lg bg-png-red text-white text-sm font-medium disabled:opacity-50"><Plus className="h-4 w-4 mx-auto" /></button>
      </div>
      <p className="mt-3 text-xs text-slate-600">Funding allocations are always created as DRAFT and require a separate approval step.</p>
      {(receipt || line) && <p className="mt-2 text-xs text-slate-600">Receipt balance <b>{fmt(receipt?.receipt_unallocated_balance)}</b> · Approved budget <b>{fmt(line?.revised_budget)}</b> · Existing funded <b>{fmt(line?.funded)}</b> · Existing released <b>{fmt(line?.released)}</b> · Maximum allocation <b className="text-png-maroon">{fmt(maxAllocation)}</b></p>}
    </div>}
    <DataCard title="Funding Allocation Report" empty="No funding allocations yet.">
      <table className="w-full min-w-[1080px]"><thead><tr className="text-xs uppercase text-slate-500 bg-slate-50"><Th>Allocation</Th><Th>Receipt</Th><Th>Budget Line</Th><Th>Status</Th><Th right>Approved Budget</Th><Th right>Allocated</Th><Th right>Released</Th><Th right>Unreleased</Th><Th>Actions</Th></tr></thead><tbody className="divide-y divide-slate-100">
        {allocations.map((row) => <tr key={row.id} className="hover:bg-slate-50"><Td strong>{row.allocation_number || "Draft"}</Td><Td>{row.receipt_number || "-"}</Td><Td><span className="font-mono text-xs">{row.full_expense_code || row.cost_centre_code || "-"}</span><div className="text-xs text-slate-400">{row.department_name || ""}</div></Td><Td><Status status={row.status} /></Td><Td right>{fmt(row.approved_budget)}</Td><Td right>{fmt(row.allocated_amount)}</Td><Td right>{fmt(row.released_from_allocation)}</Td><Td right>{fmt(row.allocation_unreleased_balance)}</Td><Td>{row.status === "DRAFT" && canApprove ? <button onClick={() => onAction(() => approveFundingAllocation(row.id), "Funding allocation approved.")} className="px-2 py-1 text-xs rounded bg-green-100 text-green-700 font-medium"><FileCheck className="h-3 w-3 inline mr-1" /> Approve</button> : <span className="text-xs text-slate-400">-</span>}</Td></tr>)}
      </tbody></table>
    </DataCard>
  </div>
}

function WorkflowButtons({ status, canSubmit, canVerify, canApprove, canReject, onAction }: { status: string; canSubmit: boolean; canVerify: boolean; canApprove: boolean; canReject: boolean; onAction: (action: "SUBMIT" | "VERIFY" | "APPROVE" | "REJECT") => void }) {
  return <div className="flex flex-wrap gap-1">
    {status === "DRAFT" && canSubmit && <ActionButton label="Submit" onClick={() => onAction("SUBMIT")} />}
    {status === "SUBMITTED" && canVerify && <ActionButton label="Verify" onClick={() => onAction("VERIFY")} />}
    {status === "VERIFIED" && canApprove && <ActionButton label="Approve" onClick={() => onAction("APPROVE")} />}
    {["DRAFT", "SUBMITTED", "VERIFIED"].includes(status) && canReject && <ActionButton label="Reject" danger onClick={() => onAction("REJECT")} />}
  </div>
}

function ActionButton({ label, onClick, danger = false }: { label: string; onClick: () => void; danger?: boolean }) {
  return <button onClick={onClick} className={`px-2 py-1 rounded text-xs font-medium ${danger ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{label}</button>
}

function MetricCard({ title, value, icon, tone }: { title: string; value: number; icon: React.ReactNode; tone: "maroon" | "gold" | "green" | "slate" }) {
  const tones = { maroon: "bg-png-maroon/10 text-png-maroon", gold: "bg-png-gold/20 text-png-maroon", green: "bg-green-100 text-green-700", slate: "bg-slate-100 text-slate-600" }
  return <div className="bg-white rounded-lg border border-slate-200 p-5"><div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tones[tone]}`}>{icon}</div><p className="mt-3 text-xs uppercase tracking-wide text-slate-500 font-medium">{title}</p><p className="text-2xl font-bold text-slate-900 mt-1">{fmt(value)}</p></div>
}

function NoticeBox({ notice }: { notice: Exclude<Notice, null> }) {
  return <div className={`rounded-lg border p-3 text-sm flex items-center gap-2 ${notice.type === "ok" ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"}`}>{notice.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {notice.text}</div>
}

function DataCard({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  return <div className="bg-white rounded-lg border border-slate-200 overflow-hidden"><div className="px-5 py-4 border-b border-slate-200"><h2 className="font-semibold text-slate-900">{title}</h2></div><div className="overflow-x-auto">{children || <p className="p-6 text-sm text-slate-500">{empty}</p>}</div></div>
}

function Field({ label, value, onChange, type = "text", className = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; className?: string }) {
  return <label className={className}><span className="block text-xs font-medium text-slate-500 mb-1">{label}</span><input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red" /></label>
}

function Select({ label, value, onChange, options, className = "" }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; className?: string }) {
  return <label className={className}><span className="block text-xs font-medium text-slate-500 mb-1">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red">{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
}

function Status({ status }: { status: string }) {
  const classes = status === "APPROVED" ? "bg-green-600 text-white" : status === "REJECTED" || status === "CANCELLED" ? "bg-red-100 text-red-700" : status === "VERIFIED" ? "bg-png-gold/25 text-png-maroon" : "bg-slate-100 text-slate-700"
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${classes}`}>{status}</span>
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-4 py-3 font-semibold ${right ? "text-right" : "text-left"}`}>{children}</th>
}

function Td({ children, right = false, strong = false }: { children: React.ReactNode; right?: boolean; strong?: boolean }) {
  return <td className={`px-4 py-3 text-sm ${right ? "text-right" : "text-left"} ${strong ? "font-semibold text-png-red" : "text-slate-700"}`}>{children}</td>
}
