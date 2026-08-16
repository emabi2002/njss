"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertCircle, Building2, CheckCircle2, Loader2, Plus, Search } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import {
  createSupplier,
  getSupplierCommitmentPosition,
  getSupplierRegisterRows,
  updateSupplier,
  type SupplierPayload,
  type SupplierRegisterRow,
} from "@/lib/api"

type CommitmentPosition = {
  supplier_id: string
  ff3_number: string | null
  commitment_number: string | null
  financial_year: number | null
  department: string | null
  section: string | null
  finance_code: string | null
  original_commitment: number | null
  current_commitment: number | null
  externally_recorded_paid_amount: number | null
  outstanding_commitment: number | null
  commitment_status: string | null
}

type SupplierForm = SupplierPayload & { is_active?: boolean; allowPossibleDuplicate?: boolean }

const blankSupplier: SupplierForm = {
  legal_name: "",
  primary_contact_name: "",
  phone: "",
  email: "",
  physical_address: "",
  ipa_registration_number: "",
  tin: "",
  is_active: true,
}

export default function SupplierRegisterPage() {
  const { can } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("ACTIVE")
  const [suppliers, setSuppliers] = useState<SupplierRegisterRow[]>([])
  const [selected, setSelected] = useState<SupplierRegisterRow | null>(null)
  const [transactions, setTransactions] = useState<CommitmentPosition[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null)
  const [form, setForm] = useState<SupplierForm>(blankSupplier)

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
    async function loadTransactions() {
      if (!selected) {
        setTransactions([])
        return
      }
      try {
        const rows = await getSupplierCommitmentPosition(selected.id)
        if (!cancelled) setTransactions(rows as CommitmentPosition[])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load supplier transactions")
      }
    }
    loadTransactions()
    return () => { cancelled = true }
  }, [selected])

  const filteredSuppliers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return suppliers.filter((supplier) => {
      const isActive = supplier.status !== "INACTIVE"
      const matchesStatus = statusFilter === "ALL" || (statusFilter === "ACTIVE" ? isActive : !isActive)
      const matchesQuery = !needle || [
        supplier.supplier_code,
        supplier.supplier_name,
        supplier.legal_name,
        supplier.trading_name,
        supplier.primary_contact_name,
        supplier.phone,
        supplier.email,
        supplier.ipa_registration_number,
        supplier.tin,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))
      return matchesStatus && matchesQuery
    })
  }, [suppliers, query, statusFilter])

  const totalSpend = useMemo(() => transactions.reduce((sum, row) => sum + Number(row.externally_recorded_paid_amount || 0), 0), [transactions])
  const totalCommitted = useMemo(() => transactions.reduce((sum, row) => sum + Number(row.current_commitment || 0), 0), [transactions])
  const outstanding = useMemo(() => transactions.reduce((sum, row) => sum + Number(row.outstanding_commitment || 0), 0), [transactions])
  const registerSpend = useMemo(() => suppliers.reduce((sum, supplier) => sum + Number(supplier.total_spend || supplier.actual_expenditure || 0), 0), [suppliers])

  function openCreate() {
    setEditingSupplierId(null)
    setForm(blankSupplier)
    setShowForm(true)
    setError("")
    setSuccess("")
  }

  function openEdit(supplier: SupplierRegisterRow) {
    setEditingSupplierId(supplier.id)
    setForm({
      legal_name: supplier.supplier_name || "",
      primary_contact_name: supplier.primary_contact_name || "",
      phone: supplier.phone || "",
      email: supplier.email || "",
      physical_address: supplier.physical_address || supplier.address || "",
      ipa_registration_number: supplier.ipa_registration_number || "",
      tin: supplier.tin || "",
      is_active: supplier.status !== "INACTIVE",
    })
    setShowForm(true)
    setError("")
    setSuccess("")
  }

  async function handleSaveSupplier() {
    if (!form.legal_name.trim()) return
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      if (editingSupplierId) {
        await updateSupplier(editingSupplierId, form)
        setSuccess("Supplier updated.")
      } else {
        const result = await createSupplier(form, Boolean(form.allowPossibleDuplicate))
        if (result.requires_review) {
          setError("Possible duplicate supplier found. Use the existing supplier if it is the same business, or tick duplicate override if this is genuinely different.")
          return
        }
        setSuccess("Supplier added and ready to use.")
      }
      setShowForm(false)
      setForm(blankSupplier)
      await fetchSuppliers()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save supplier")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Supplier Register</h1>
          <p className="mt-1 text-slate-600">Simple supplier reference list for tracing expenditure from quotations through FF3, commitments and FF4 payments.</p>
        </div>
        {can("supplier.create") && <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-png-red px-4 py-2 text-sm font-semibold text-white hover:bg-png-maroon"><Plus className="h-4 w-4" /> Quick Add Supplier</button>}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
        This is not a supplier approval, compliance, procurement registration, or performance system. Suppliers are basic reference records used to report total spend.
      </div>

      {error && <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="h-4 w-4" />{error}</div>}
      {success && <div className="flex gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700"><CheckCircle2 className="h-4 w-4" />{success}</div>}

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Suppliers" value={suppliers.length} />
        <SummaryCard label="Active" value={suppliers.filter((supplier) => supplier.status !== "INACTIVE").length} />
        <SummaryCard label="Inactive" value={suppliers.filter((supplier) => supplier.status === "INACTIVE").length} />
        <SummaryCard label="Recorded Spend" value={`K ${registerSpend.toLocaleString()}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-[1fr_160px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search supplier name, code, contact, phone, IPA or TIN" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-png-red" />
            </div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ALL">All</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">Supplier Code</th>
                  <th className="px-4 py-3 text-left">Supplier Name</th>
                  <th className="px-4 py-3 text-left">Contact</th>
                  <th className="px-4 py-3 text-left">Phone</th>
                  <th className="px-4 py-3 text-right">Total Spend</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSuppliers.map((supplier) => (
                  <tr key={supplier.id} onClick={() => setSelected(supplier)} className={`cursor-pointer hover:bg-slate-50 ${selected?.id === supplier.id ? "bg-red-50/40" : ""}`}>
                    <td className="px-4 py-3 font-medium text-png-red">{supplier.supplier_code}</td>
                    <td className="px-4 py-3"><div className="font-medium text-slate-900">{supplier.supplier_name}</div><div className="text-xs text-slate-500">{supplier.email || supplier.ipa_registration_number || supplier.tin || "Basic supplier record"}</div></td>
                    <td className="px-4 py-3 text-sm text-slate-600">{supplier.primary_contact_name || "-"}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{supplier.phone || "-"}</td>
                    <td className="px-4 py-3 text-right font-medium">K {Number(supplier.total_spend || supplier.actual_expenditure || 0).toLocaleString()}</td>
                    <td className="px-4 py-3"><StatusBadge active={supplier.status !== "INACTIVE"} /></td>
                  </tr>
                ))}
                {filteredSuppliers.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500">No suppliers found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="rounded-lg border border-slate-200 bg-white p-5">
          {selected ? (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-png-red">{selected.supplier_code}</p>
                  <h2 className="text-xl font-bold text-slate-900">{selected.supplier_name}</h2>
                </div>
                <StatusBadge active={selected.status !== "INACTIVE"} />
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <Info label="Contact" value={selected.primary_contact_name} />
                <Info label="Phone" value={selected.phone} />
                <Info label="Email" value={selected.email} />
                <Info label="IPA/TIN" value={[selected.ipa_registration_number, selected.tin].filter(Boolean).join(" / ")} />
                <div className="col-span-2"><Info label="Address" value={selected.physical_address || selected.address} /></div>
              </div>

              {can("supplier.edit") && <button onClick={() => openEdit(selected)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">Edit Basic Details</button>}

              <div className="grid grid-cols-3 gap-3">
                <SummaryCard label="Committed" value={`K ${totalCommitted.toLocaleString()}`} compact />
                <SummaryCard label="Actual Spend" value={`K ${totalSpend.toLocaleString()}`} compact />
                <SummaryCard label="Outstanding" value={`K ${outstanding.toLocaleString()}`} compact />
              </div>

              <section className="rounded-lg border border-slate-200 p-4">
                <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900"><Building2 className="h-4 w-4" /> FF3 / Commitment / FF4 Trace</h3>
                <div className="space-y-2">
                  {transactions.map((row, index) => (
                    <div key={`${row.commitment_number}-${index}`} className="rounded border border-slate-100 p-2 text-sm">
                      <Link href={row.ff3_number ? `/dashboard/ff3/${row.ff3_number}` : "#"} className="font-medium text-png-red">{row.ff3_number || "FF3"}</Link>
                      <div>{row.commitment_number || "No commitment number"} — K {Number(row.current_commitment || 0).toLocaleString()} committed</div>
                      <div className="text-xs text-slate-500">Actual spend K {Number(row.externally_recorded_paid_amount || 0).toLocaleString()} · Outstanding K {Number(row.outstanding_commitment || 0).toLocaleString()} · {row.finance_code || row.section || "No expense code"}</div>
                    </div>
                  ))}
                  {transactions.length === 0 && <p className="text-sm text-slate-500">No FF3 commitments or FF4 expenditure linked to this supplier yet.</p>}
                </div>
              </section>
            </div>
          ) : (
            <div className="py-16 text-center text-slate-500"><Building2 className="mx-auto mb-3 h-10 w-10 text-slate-300" />Select a supplier to view transactions.</div>
          )}
        </aside>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
            <div className="border-b border-slate-200 p-4">
              <h2 className="text-lg font-bold text-slate-900">{editingSupplierId ? "Edit Supplier" : "Quick Add Supplier"}</h2>
              <p className="text-sm text-slate-500">Only basic supplier reference details are required.</p>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <TextField label="Supplier / Business Name" required value={form.legal_name} onChange={(value) => setForm({ ...form, legal_name: value })} />
              <TextField label="Contact Person" value={form.primary_contact_name || ""} onChange={(value) => setForm({ ...form, primary_contact_name: value })} />
              <TextField label="Phone" value={form.phone || ""} onChange={(value) => setForm({ ...form, phone: value })} />
              <TextField label="Email" value={form.email || ""} onChange={(value) => setForm({ ...form, email: value })} />
              <TextField label="IPA Registration" value={form.ipa_registration_number || ""} onChange={(value) => setForm({ ...form, ipa_registration_number: value })} />
              <TextField label="TIN" value={form.tin || ""} onChange={(value) => setForm({ ...form, tin: value })} />
              <div className="md:col-span-2"><TextField label="Address" value={form.physical_address || ""} onChange={(value) => setForm({ ...form, physical_address: value })} /></div>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.is_active !== false} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />Active</label>
              {!editingSupplierId && <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2"><input type="checkbox" checked={Boolean(form.allowPossibleDuplicate)} onChange={(event) => setForm({ ...form, allowPossibleDuplicate: event.target.checked })} />Allow if this is genuinely different from a possible duplicate. Exact IPA/TIN duplicates remain blocked.</label>}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium">Cancel</button>
              <button disabled={saving || !form.legal_name.trim()} onClick={handleSaveSupplier} className="rounded-lg bg-png-red px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{editingSupplierId ? "Save Supplier" : "Add Supplier"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, compact }: { label: string; value: number | string; compact?: boolean }) {
  return <div className={`rounded-lg border border-slate-200 bg-white ${compact ? "p-3" : "p-4"}`}><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={`${compact ? "text-base" : "text-2xl"} mt-2 font-bold text-slate-900`}>{value}</p></div>
}

function StatusBadge({ active }: { active: boolean }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{active ? "Active" : "Inactive"}</span>
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <div><p className="text-xs font-medium uppercase text-slate-500">{label}</p><p className="text-sm text-slate-900">{value || "-"}</p></div>
}

function TextField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-slate-700">{label} {required && <span className="text-red-500">*</span>}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red" /></label>
}
