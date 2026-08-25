from pathlib import Path

PAGE = Path("app/dashboard/budget/funding/page.tsx")
API = Path("lib/api.ts")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


page = PAGE.read_text()

page = replace_once(
    page,
    'import { AlertCircle, Banknote, CheckCircle2, FileCheck, Layers, Loader2, Plus, ReceiptText, RefreshCw, ShieldCheck, Wallet } from "lucide-react"\nimport {',
    'import { AlertCircle, Banknote, CheckCircle2, FileCheck, Layers, Loader2, Plus, ReceiptText, RefreshCw, ShieldCheck, Wallet } from "lucide-react"\nimport { useRouter } from "next/navigation"\nimport {',
    "next router import",
)

page = replace_once(
    page,
    '  createFundingAuthority,\n  createFundingReceipt,\n  getAllocationsForRelease,',
    '  createFundingAuthority,\n  createFundingReceipt,\n  createFundingSource,\n  getAllocationsForRelease,',
    "funding source api import",
)

page = replace_once(
    page,
    'export default function FundingManagementPage() {\n  const { can } = useAuth()\n  const [tab, setTab] = useState<Tab>("authorities")',
    'export default function FundingManagementPage() {\n  const { can } = useAuth()\n  const router = useRouter()\n  const [tab, setTab] = useState<Tab>("authorities")',
    "router initialization",
)

page = replace_once(
    page,
    '  const [budgetLines, setBudgetLines] = useState<ReleaseAllocation[]>([])\n  const [sources, setSources] = useState<FundingSource[]>([])\n\n  const load = useCallback(async () => {',
    '  const [budgetLines, setBudgetLines] = useState<ReleaseAllocation[]>([])\n  const [sources, setSources] = useState<FundingSource[]>([])\n  const canCreateFunding = can("funding.create")\n  const canManageFundingSources = can("masterdata.manage") || can("registry.manage") || can("users.manage")\n  const canCreateBudgetLine = can("budget.template.create") || can("budget.template.edit") || can("budget.template.submit") || can("budget.template")\n\n  const load = useCallback(async () => {',
    "governed lookup permissions",
)

page = replace_once(
    page,
    '        <AuthoritiesPanel year={year} authorities={authorities} sources={sources} canCreate={can("funding.create")} canSubmit={can("funding.submit")} canVerify={can("funding.verify")} canApprove={can("funding.approve")} canReject={can("funding.reject")} onAction={onAction} />\n      ) : tab === "receipts" ? (\n        <ReceiptsPanel authorities={authorities} receipts={receipts} canCreate={can("funding.create")} canSubmit={can("funding.submit")} canVerify={can("funding.verify")} canApprove={can("funding.approve")} canReject={can("funding.reject")} onAction={onAction} />\n      ) : (\n        <AllocationsPanel receipts={receipts} allocations={allocations} budgetLines={budgetLines} canAllocate={can("funding.allocate")} canApprove={can("funding.allocation.approve")} onAction={onAction} />',
    '        <AuthoritiesPanel year={year} authorities={authorities} sources={sources} canCreate={canCreateFunding} canManageSources={canManageFundingSources} canSubmit={can("funding.submit")} canVerify={can("funding.verify")} canApprove={can("funding.approve")} canReject={can("funding.reject")} onAction={onAction} />\n      ) : tab === "receipts" ? (\n        <ReceiptsPanel authorities={authorities} receipts={receipts} canCreate={canCreateFunding} canSubmit={can("funding.submit")} canVerify={can("funding.verify")} canApprove={can("funding.approve")} canReject={can("funding.reject")} onCreateAuthority={() => setTab("authorities")} onAction={onAction} />\n      ) : (\n        <AllocationsPanel receipts={receipts} allocations={allocations} budgetLines={budgetLines} canAllocate={can("funding.allocate")} canApprove={can("funding.allocation.approve")} onCreateReceipt={canCreateFunding ? () => setTab("receipts") : undefined} onCreateBudgetLine={canCreateBudgetLine ? () => router.push("/dashboard/budget-template") : undefined} onAction={onAction} />',
    "panel lookup routing",
)

page = replace_once(
    page,
    'function AuthoritiesPanel({ year, authorities, sources, canCreate, canSubmit, canVerify, canApprove, canReject, onAction }: {\n  year: number\n  authorities: FundingAuthorityRow[]\n  sources: FundingSource[]\n  canCreate: boolean',
    'function AuthoritiesPanel({ year, authorities, sources, canCreate, canManageSources, canSubmit, canVerify, canApprove, canReject, onAction }: {\n  year: number\n  authorities: FundingAuthorityRow[]\n  sources: FundingSource[]\n  canCreate: boolean\n  canManageSources: boolean',
    "authority panel source permission",
)

page = replace_once(
    page,
    '  const [form, setForm] = useState({ authority_type: "NJSS_ALLOCATION", funding_source_id: "", source_agency: "NJSS", approved_amount: "", effective_date: today(), description: "", supporting_document_name: "", supporting_document_url: "" })\n\n  const submit = () => onAction(() => createFundingAuthority({',
    '  const [form, setForm] = useState({ authority_type: "NJSS_ALLOCATION", funding_source_id: "", source_agency: "NJSS", approved_amount: "", effective_date: today(), description: "", supporting_document_name: "", supporting_document_url: "" })\n  const [showSourceForm, setShowSourceForm] = useState(false)\n  const [newSource, setNewSource] = useState({ code: "", name: "", source_type: "" })\n\n  const addFundingSource = () => onAction(async () => {\n    const created = await createFundingSource({ code: newSource.code, name: newSource.name, source_type: clean(newSource.source_type), is_active: true })\n    setForm((current) => ({ ...current, funding_source_id: created.id }))\n    setNewSource({ code: "", name: "", source_type: "" })\n    setShowSourceForm(false)\n  }, "Funding source added and selected.")\n\n  const submit = () => onAction(() => createFundingAuthority({',
    "funding source state and create action",
)

page = replace_once(
    page,
    '          <Select label="Funding Source" value={form.funding_source_id} onChange={(v) => setForm({ ...form, funding_source_id: v })} options={[{ value: "", label: "Not restricted" }, ...sources.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))]} className="md:col-span-3" />',
    '          <Select label="Funding Source" value={form.funding_source_id} onChange={(v) => setForm({ ...form, funding_source_id: v })} options={[{ value: "", label: "Not restricted" }, ...sources.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))]} onAdd={canManageSources ? () => setShowSourceForm((open) => !open) : undefined} addTitle="Add funding source" className="md:col-span-3" />',
    "funding source add button",
)

page = replace_once(
    page,
    '          <button onClick={submit} disabled={!form.approved_amount} className="md:col-span-1 px-3 py-2 mt-5 rounded-lg bg-png-red text-white text-sm font-medium disabled:opacity-50"><Plus className="h-4 w-4 mx-auto" /></button>\n        </div>\n      </div>}',
    '          <button onClick={submit} disabled={!form.approved_amount} className="md:col-span-1 px-3 py-2 mt-5 rounded-lg bg-png-red text-white text-sm font-medium disabled:opacity-50"><Plus className="h-4 w-4 mx-auto" /></button>\n        </div>\n        {showSourceForm && canManageSources && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">\n          <div className="flex items-center justify-between gap-3 mb-3">\n            <h3 className="text-sm font-semibold text-emerald-900">Create Funding Source</h3>\n            <button type="button" onClick={() => setShowSourceForm(false)} className="text-xs font-medium text-slate-600 hover:text-slate-900">Cancel</button>\n          </div>\n          <div className="grid md:grid-cols-12 gap-3">\n            <Field label="Source Code" value={newSource.code} onChange={(v) => setNewSource({ ...newSource, code: v })} className="md:col-span-3" />\n            <Field label="Source Name" value={newSource.name} onChange={(v) => setNewSource({ ...newSource, name: v })} className="md:col-span-4" />\n            <Field label="Source Type" value={newSource.source_type} onChange={(v) => setNewSource({ ...newSource, source_type: v })} className="md:col-span-3" />\n            <div className="md:col-span-1 mt-5 flex items-center justify-center rounded-lg border border-emerald-200 bg-white px-2 py-2 text-xs font-medium text-emerald-700">Active</div>\n            <button type="button" onClick={addFundingSource} disabled={!newSource.code.trim() || !newSource.name.trim()} className="md:col-span-1 mt-5 rounded-lg bg-emerald-600 px-3 py-2 text-white disabled:opacity-50" title="Save funding source"><Plus className="h-4 w-4 mx-auto" /></button>\n          </div>\n        </div>}\n      </div>}',
    "inline funding source form",
)

page = replace_once(
    page,
    'function ReceiptsPanel({ authorities, receipts, canCreate, canSubmit, canVerify, canApprove, canReject, onAction }: {\n  authorities: FundingAuthorityRow[]\n  receipts: FundingReceiptRow[]\n  canCreate: boolean',
    'function ReceiptsPanel({ authorities, receipts, canCreate, canSubmit, canVerify, canApprove, canReject, onCreateAuthority, onAction }: {\n  authorities: FundingAuthorityRow[]\n  receipts: FundingReceiptRow[]\n  canCreate: boolean',
    "receipt panel callback signature",
)

page = replace_once(
    page,
    '  canReject: boolean\n  onAction: (fn: () => Promise<unknown>, success: string) => Promise<void>\n}) {\n  const approvedAuthorities = authorities.filter((a) => a.status === "APPROVED")',
    '  canReject: boolean\n  onCreateAuthority: () => void\n  onAction: (fn: () => Promise<unknown>, success: string) => Promise<void>\n}) {\n  const approvedAuthorities = authorities.filter((a) => a.status === "APPROVED")',
    "receipt panel callback type",
)

page = replace_once(
    page,
    '        <Select label="Approved Authority" value={form.funding_authority_id} onChange={(v) => setForm({ ...form, funding_authority_id: v })} options={[{ value: "", label: "Select authority" }, ...approvedAuthorities.map((a) => ({ value: a.id, label: `${a.authority_number} · ${fmt(a.approved_amount)} · balance ${fmt(a.authority_remaining)}` }))]} className="md:col-span-5" />',
    '        <Select label="Approved Authority" value={form.funding_authority_id} onChange={(v) => setForm({ ...form, funding_authority_id: v })} options={[{ value: "", label: "Select authority" }, ...approvedAuthorities.map((a) => ({ value: a.id, label: `${a.authority_number} · ${fmt(a.approved_amount)} · balance ${fmt(a.authority_remaining)}` }))]} onAdd={onCreateAuthority} addTitle="Create funding authority" className="md:col-span-5" />',
    "approved authority add action",
)

page = replace_once(
    page,
    'function AllocationsPanel({ receipts, allocations, budgetLines, canAllocate, canApprove, onAction }: {\n  receipts: FundingReceiptRow[]\n  allocations: FundingAllocationRow[]\n  budgetLines: ReleaseAllocation[]\n  canAllocate: boolean\n  canApprove: boolean\n  onAction: (fn: () => Promise<unknown>, success: string) => Promise<void>',
    'function AllocationsPanel({ receipts, allocations, budgetLines, canAllocate, canApprove, onCreateReceipt, onCreateBudgetLine, onAction }: {\n  receipts: FundingReceiptRow[]\n  allocations: FundingAllocationRow[]\n  budgetLines: ReleaseAllocation[]\n  canAllocate: boolean\n  canApprove: boolean\n  onCreateReceipt?: () => void\n  onCreateBudgetLine?: () => void\n  onAction: (fn: () => Promise<unknown>, success: string) => Promise<void>',
    "allocation panel callbacks",
)

page = replace_once(
    page,
    '        <Select label="Available Receipt" value={form.funding_receipt_id} onChange={(v) => setForm({ ...form, funding_receipt_id: v })} options={[{ value: "", label: "Select receipt" }, ...availableReceipts.map((r) => ({ value: r.id, label: `${r.receipt_number} · available ${fmt(r.receipt_unallocated_balance)}` }))]} className="md:col-span-4" />',
    '        <Select label="Available Receipt" value={form.funding_receipt_id} onChange={(v) => setForm({ ...form, funding_receipt_id: v })} options={[{ value: "", label: "Select receipt" }, ...availableReceipts.map((r) => ({ value: r.id, label: `${r.receipt_number} · available ${fmt(r.receipt_unallocated_balance)}` }))]} onAdd={onCreateReceipt} addTitle="Create funding receipt" className="md:col-span-4" />',
    "available receipt add action",
)

page = replace_once(
    page,
    '        <Select label="Approved Budget Line" value={form.budget_allocation_id} onChange={(v) => setForm({ ...form, budget_allocation_id: v })} options={[{ value: "", label: "Select budget line" }, ...budgetLines.map((b) => ({ value: b.id, label: `${b.full_expense_code || b.cost_centre_code || "Budget"} · approved ${fmt(b.revised_budget)} · funded ${fmt(b.funded)}` }))]} className="md:col-span-4" />',
    '        <Select label="Approved Budget Line" value={form.budget_allocation_id} onChange={(v) => setForm({ ...form, budget_allocation_id: v })} options={[{ value: "", label: "Select budget line" }, ...budgetLines.map((b) => ({ value: b.id, label: `${b.full_expense_code || b.cost_centre_code || "Budget"} · approved ${fmt(b.revised_budget)} · funded ${fmt(b.funded)}` }))]} onAdd={onCreateBudgetLine} addTitle="Create approved budget line" className="md:col-span-4" />',
    "approved budget line add action",
)

page = replace_once(
    page,
    'function Select({ label, value, onChange, options, className = "" }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; className?: string }) {\n  return <label className={className}><span className="block text-xs font-medium text-slate-500 mb-1">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red">{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>\n}',
    'function Select({ label, value, onChange, options, onAdd, addTitle, className = "" }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; onAdd?: () => void; addTitle?: string; className?: string }) {\n  return <div className={className}><span className="block text-xs font-medium text-slate-500 mb-1">{label}</span><div className="flex items-center gap-2"><select value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red">{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{onAdd && <button type="button" onClick={onAdd} title={addTitle || `Add ${label}`} aria-label={addTitle || `Add ${label}`} className="shrink-0 rounded-lg border border-emerald-600 bg-emerald-600 p-2 text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"><Plus className="h-4 w-4" /></button>}</div></div>\n}',
    "select add affordance",
)

PAGE.write_text(page)

api = API.read_text()
old_api = '''export async function getFundingSources() {
  const { data, error } = await supabase
    .from('funding_sources')
    .select('*')
    .eq('is_active', true)
    .order('name')

  if (error) throw error
  return data as FundingSource[]
}
'''
new_api = old_api + '''\nexport async function createFundingSource(input: { code: string; name: string; source_type?: string | null; is_active?: boolean }) {
  const code = input.code.trim().toUpperCase()
  const name = input.name.trim()
  if (!code || !name) throw new Error('Funding source code and name are required')

  const { data: existing, error: existingError } = await supabase
    .from('funding_sources')
    .select('*')
    .ilike('code', code)
    .limit(1)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    if (!existing.is_active) throw new Error(`Funding source ${code} already exists but is inactive. Reactivate it in master data before using it.`)
    return existing as FundingSource
  }

  const { data, error } = await supabase
    .from('funding_sources')
    .insert({ code, name, source_type: input.source_type?.trim() || null, is_active: input.is_active ?? true })
    .select('*')
    .single()
  if (error) throw error
  return data as FundingSource
}
'''
api = replace_once(api, old_api, new_api, "createFundingSource api")
API.write_text(api)

print("Funding lookup add actions applied.")
