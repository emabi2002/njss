"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, Hash, Loader2, RefreshCw, Save, Search, ShieldCheck } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { supabase } from "@/lib/supabase"

type Ledger = {
  id: string
  finance_code: string
  standard_description: string
  expense_code_registry_id: string | null
}

type PostingCode = {
  id: string
  full_expense_code: string
  description: string | null
  department_id: string | null
  section_id: string | null
  cost_centre_id: string | null
  expense_ledger_id: string | null
  chart_of_account_id: string | null
}

type Account = { id: string; account_code: string; account_name: string }
type NamedCode = { id: string; code: string; name: string }

type MappingRow = Ledger & {
  posting: PostingCode | null
  account: Account | null
  department: NamedCode | null
  section: NamedCode | null
  costCentre: NamedCode | null
  ready: boolean
}

export default function FinanceMappingPage() {
  const { roles, can } = useAuth()
  const isSystemAdministrator = roles.includes("System Administrator")
  const canManage = isSystemAdministrator && (can("masterdata.manage") || can("registry.manage") || can("all"))

  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [postingCodes, setPostingCodes] = useState<PostingCode[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [departments, setDepartments] = useState<NamedCode[]>([])
  const [sections, setSections] = useState<NamedCode[]>([])
  const [costCentres, setCostCentres] = useState<NamedCode[]>([])
  const [selectedLedgerId, setSelectedLedgerId] = useState("")
  const [selectedPostingId, setSelectedPostingId] = useState("")
  const [selectedAccountId, setSelectedAccountId] = useState("")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const [ledgerResult, postingResult, accountResult, departmentResult, sectionResult, costCentreResult] = await Promise.all([
        supabase.from("expense_ledger").select("id, finance_code, standard_description, expense_code_registry_id").eq("is_active", true).eq("is_posting", true).order("finance_code"),
        supabase.from("expense_code_registry").select("id, full_expense_code, description, department_id, section_id, cost_centre_id, expense_ledger_id, chart_of_account_id").eq("is_active", true).order("full_expense_code"),
        supabase.from("chart_of_accounts").select("id, account_code, account_name").eq("is_active", true).order("account_code"),
        supabase.from("departments").select("id, code, name").eq("is_active", true).order("code"),
        supabase.from("sections").select("id, code, name").eq("is_active", true).order("code"),
        supabase.from("cost_centres").select("id, code, name").eq("is_active", true).order("code"),
      ])
      for (const result of [ledgerResult, postingResult, accountResult, departmentResult, sectionResult, costCentreResult]) {
        if (result.error) throw result.error
      }
      setLedgers((ledgerResult.data || []) as Ledger[])
      setPostingCodes((postingResult.data || []) as PostingCode[])
      setAccounts((accountResult.data || []) as Account[])
      setDepartments((departmentResult.data || []) as NamedCode[])
      setSections((sectionResult.data || []) as NamedCode[])
      setCostCentres((costCentreResult.data || []) as NamedCode[])
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not load Finance mapping master data." })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const postingById = useMemo(() => new Map(postingCodes.map((row) => [row.id, row])), [postingCodes])
  const accountById = useMemo(() => new Map(accounts.map((row) => [row.id, row])), [accounts])
  const departmentById = useMemo(() => new Map(departments.map((row) => [row.id, row])), [departments])
  const sectionById = useMemo(() => new Map(sections.map((row) => [row.id, row])), [sections])
  const costCentreById = useMemo(() => new Map(costCentres.map((row) => [row.id, row])), [costCentres])

  const rows = useMemo<MappingRow[]>(() => ledgers.map((ledger) => {
    const posting = ledger.expense_code_registry_id ? postingById.get(ledger.expense_code_registry_id) || null : null
    const account = posting?.chart_of_account_id ? accountById.get(posting.chart_of_account_id) || null : null
    const department = posting?.department_id ? departmentById.get(posting.department_id) || null : null
    const section = posting?.section_id ? sectionById.get(posting.section_id) || null : null
    const costCentre = posting?.cost_centre_id ? costCentreById.get(posting.cost_centre_id) || null : null
    const ready = Boolean(
      posting &&
      posting.expense_ledger_id === ledger.id &&
      account &&
      department &&
      costCentre,
    )
    return { ...ledger, posting, account, department, section, costCentre, ready }
  }), [ledgers, postingById, accountById, departmentById, sectionById, costCentreById])

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) => [
      row.finance_code,
      row.standard_description,
      row.posting?.full_expense_code,
      row.account?.account_code,
      row.account?.account_name,
      row.costCentre?.code,
    ].some((value) => String(value || "").toLowerCase().includes(needle)))
  }, [rows, search])

  const selectedLedger = ledgers.find((row) => row.id === selectedLedgerId) || null
  const selectedPosting = postingCodes.find((row) => row.id === selectedPostingId) || null

  const chooseLedger = (ledgerId: string) => {
    setSelectedLedgerId(ledgerId)
    const ledger = ledgers.find((row) => row.id === ledgerId)
    const posting = ledger?.expense_code_registry_id ? postingById.get(ledger.expense_code_registry_id) : undefined
    setSelectedPostingId(posting?.id || "")
    setSelectedAccountId(posting?.chart_of_account_id || "")
    setMessage(null)
  }

  const choosePosting = (postingId: string) => {
    setSelectedPostingId(postingId)
    const posting = postingById.get(postingId)
    setSelectedAccountId(posting?.chart_of_account_id || "")
  }

  const save = async () => {
    if (!selectedLedgerId || !selectedPostingId || !selectedAccountId) {
      setMessage({ type: "err", text: "Finance Code, Posting Code and Chart of Accounts are all required." })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc("njss_set_finance_posting_mapping", {
        p_expense_ledger_id: selectedLedgerId,
        p_expense_code_registry_id: selectedPostingId,
        p_chart_of_account_id: selectedAccountId,
        p_user_email: null,
      })
      if (error) throw error
      setMessage({ type: "ok", text: "Finance posting mapping saved. Revalidate the related approved budget before activation." })
      await load()
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not save the Finance posting mapping." })
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">Finance Mapping is restricted to the System Administrator.</div>
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#A97C12]"><ShieldCheck className="h-4 w-4" /> System Administration · Finance Master Data</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Finance Mapping</h1>
          <p className="mt-1 max-w-4xl text-sm text-slate-600">Maintain the authoritative Finance Code → Posting Code → Chart of Accounts chain used by Operational Budget Activation. Mapping changes do not alter approved budget values.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
      </div>

      {message && <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{message.type === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}<span>{message.text}</span></div>}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2"><Hash className="h-5 w-5 text-[#A97C12]" /><h2 className="font-semibold text-slate-900">Set authoritative posting mapping</h2></div>
        <div className="grid gap-4 lg:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">Finance Code
            <select value={selectedLedgerId} onChange={(e) => chooseLedger(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="">Select Finance Code...</option>{ledgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.finance_code} — {ledger.standard_description}</option>)}</select>
          </label>
          <label className="text-sm font-medium text-slate-700">Posting Code
            <select value={selectedPostingId} onChange={(e) => choosePosting(e.target.value)} disabled={!selectedLedgerId} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm disabled:bg-slate-100"><option value="">Select Posting Code...</option>{postingCodes.filter((posting) => !posting.expense_ledger_id || posting.expense_ledger_id === selectedLedgerId).map((posting) => <option key={posting.id} value={posting.id}>{posting.full_expense_code} — {posting.description || "No description"}</option>)}</select>
          </label>
          <label className="text-sm font-medium text-slate-700">Chart of Accounts
            <select value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)} disabled={!selectedPostingId} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm disabled:bg-slate-100"><option value="">Select Chart of Accounts...</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.account_code} — {account.account_name}</option>)}</select>
          </label>
        </div>
        {selectedLedger && selectedPosting && <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 md:grid-cols-3"><span><strong>Finance Code:</strong> {selectedLedger.finance_code}</span><span><strong>Posting Code:</strong> {selectedPosting.full_expense_code}</span><span><strong>Cost Centre:</strong> {selectedPosting.cost_centre_id ? costCentreById.get(selectedPosting.cost_centre_id)?.code || "Unresolved" : "Missing"}</span></div>}
        <div className="mt-4 flex justify-end"><button type="button" onClick={save} disabled={saving || !selectedLedgerId || !selectedPostingId || !selectedAccountId} className="inline-flex items-center gap-2 rounded-lg bg-[#132A44] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1C3B5A] disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Mapping</button></div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-slate-900">Finance mapping register</h2><p className="text-xs text-slate-500">A Ready mapping has a reciprocal Finance/Posting link plus active account and organisational dimensions.</p></div><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search mappings..." className="rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" /></div></div>
        {loading ? <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-[#132A44]" /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Finance Code</th><th className="px-4 py-3">Finance Description</th><th className="px-4 py-3">Department</th><th className="px-4 py-3">Cost Centre</th><th className="px-4 py-3">Posting Code</th><th className="px-4 py-3">Chart of Accounts</th><th className="px-4 py-3">Mapping Status</th><th className="px-4 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleRows.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-mono font-semibold text-[#8B1E2D]">{row.finance_code}</td><td className="px-4 py-3 text-slate-700">{row.standard_description}</td><td className="px-4 py-3">{row.department ? `${row.department.code} — ${row.department.name}` : "—"}</td><td className="px-4 py-3">{row.costCentre ? `${row.costCentre.code} — ${row.costCentre.name}` : "—"}</td><td className="px-4 py-3 font-mono">{row.posting?.full_expense_code || "—"}</td><td className="px-4 py-3">{row.account ? `${row.account.account_code} — ${row.account.account_name}` : "—"}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{row.ready ? "Ready" : "Incomplete"}</span></td><td className="px-4 py-3"><button type="button" onClick={() => chooseLedger(row.id)} className="text-xs font-semibold text-[#132A44] hover:underline">Edit Mapping</button></td></tr>)}</tbody></table>{visibleRows.length === 0 && <div className="py-12 text-center text-sm text-slate-500">No Finance Codes match the current search.</div>}</div>}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><strong>Control:</strong> mapping maintenance never changes the approved Finance Code or approved amount on a budget line. After any mapping change, return to Budget Activation and run Prepare Activation/Revalidate before submission to the Registrar.</div>
    </div>
  )
}
