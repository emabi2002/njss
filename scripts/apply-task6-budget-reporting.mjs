import fs from 'node:fs'

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Task 6 transform anchor not found: ${label}`)
  return source.replace(from, to)
}

// -----------------------------------------------------------------------------
// lib/api.ts
// -----------------------------------------------------------------------------
const apiPath = 'lib/api.ts'
let api = fs.readFileSync(apiPath, 'utf8')

api = replaceOnce(api,
`  actual_expenditure: number
  available_amount: number`,
`  actual_expenditure: number
  original_budget: number
  supplemental_budget: number
  revision_adjustment: number
  current_revised_budget: number
  budget_available: number
  released_available: number
  available_amount: number`,
'authoritative budget lineage type fields')

api = replaceOnce(api,
`export type CommitmentTransaction = {`,
`export type BudgetRevisionHistoryReportRow = {
  budget_revision_id: string
  revision_number: string
  budget_year: number
  division_id: string
  division_code: string | null
  division_name: string | null
  revision_type: string
  status: string
  reason: string
  authority_reference: string | null
  supporting_reference: string | null
  effective_date: string
  parent_submission_id: string
  parent_submission_number: string | null
  revision_submission_id: string
  revision_submission_number: string | null
  requested_by: string | null
  requested_by_email: string | null
  approved_by: string | null
  created_at: string
  approved_at: string | null
  line_count: number
  original_budget: number
  current_revised_budget_before: number
  revision_adjustment: number
  proposed_revised_budget: number
  actual_expenditure_at_submission: number
  outstanding_commitment_at_submission: number
  protected_minimum_at_submission: number
  actual_expenditure_at_approval: number
  outstanding_commitment_at_approval: number
  protected_minimum_at_approval: number
}

export type CommitmentTransaction = {`,
'budget revision history type')

const budgetByCodeBlock = `export async function getBudgetByCode(financialYear: number) {
  const { data, error } = await supabase
    .from('v_authoritative_budget_position')
    .select('*')
    .eq('financial_year', financialYear)
  if (error) throw error
  const scoped = await filterRowsToCurrentScope(data)
  return (scoped || []).map((row) => {
    const r = row as AuthoritativeBudgetPosition
    return {
      ...r,
      revised_budget: r.approved_budget || 0,
      committed_amount: r.outstanding_commitment || 0,
    }
  })
}
`
api = replaceOnce(api, budgetByCodeBlock,
`export async function getBudgetByCode(financialYear: number) {
  const { data, error } = await supabase
    .from('v_authoritative_budget_position')
    .select('*')
    .eq('financial_year', financialYear)
  if (error) throw error
  const scoped = await filterRowsToCurrentScope(data)
  return (scoped || []).map((row) => {
    const r = row as AuthoritativeBudgetPosition
    return {
      ...r,
      revised_budget: r.current_revised_budget ?? r.approved_budget ?? 0,
      committed_amount: r.outstanding_commitment || 0,
    }
  })
}

export async function getBudgetRevisionHistoryReport(financialYear: number) {
  const { data, error } = await supabase
    .from('v_budget_revision_history_report')
    .select('*')
    .eq('budget_year', financialYear)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as BudgetRevisionHistoryReportRow[]
}
`,
'budget revision history API function')

fs.writeFileSync(apiPath, api)

// -----------------------------------------------------------------------------
// app/dashboard/budget/page.tsx
// -----------------------------------------------------------------------------
const pagePath = 'app/dashboard/budget/page.tsx'
let page = fs.readFileSync(pagePath, 'utf8')

page = replaceOnce(page,
`import { Wallet, TrendingUp, DollarSign, FileText, Loader2, Layers, Hash, Building2, Play, CheckCircle2, AlertCircle, Download, RefreshCw, Banknote } from "lucide-react"`,
`import { Wallet, TrendingUp, DollarSign, FileText, Loader2, Layers, Hash, Building2, Play, CheckCircle2, AlertCircle, Download, RefreshCw, Banknote, History } from "lucide-react"`,
'Budget Control icons')

page = replaceOnce(page,
`import { getBudgetByCode, getConsolidations, consolidateDepartmentBudget, getDepartments, getReleases, getAllocationsForRelease, createQuarterlyRelease } from "@/lib/api"`,
`import { getBudgetByCode, getBudgetRevisionHistoryReport, getConsolidations, consolidateDepartmentBudget, getDepartments, getReleases, getAllocationsForRelease, createQuarterlyRelease } from "@/lib/api"`,
'Budget Control API import')

page = replaceOnce(page,
`  revised_budget: number
  approved_budget?: number`,
`  revised_budget: number
  original_budget?: number
  supplemental_budget?: number
  revision_adjustment?: number
  current_revised_budget?: number
  budget_available?: number
  released_available?: number
  approved_budget?: number`,
'CodeRow lineage fields')

page = replaceOnce(page,
`type BudgetPeriodOption = { id: string; period_number: number; period_code: string; period_name: string }
type Tab = "code" | "centre" | "releases" | "consolidation"`,
`type BudgetPeriodOption = { id: string; period_number: number; period_code: string; period_name: string }
type RevisionHistoryRow = {
  budget_revision_id: string
  revision_number: string
  division_code: string | null
  division_name: string | null
  revision_type: string
  status: string
  reason: string
  authority_reference: string | null
  effective_date: string
  created_at: string
  approved_at: string | null
  original_budget: number
  current_revised_budget_before: number
  revision_adjustment: number
  proposed_revised_budget: number
  actual_expenditure_at_submission: number
  outstanding_commitment_at_submission: number
  protected_minimum_at_submission: number
}
type Tab = "code" | "centre" | "releases" | "revisions" | "consolidation"`,
'revision history UI type')

page = replaceOnce(page,
`export default function BudgetControlPage() {
  const { can } = useAuth()
  const [tab, setTab] = useState<Tab>("code")`,
`export default function BudgetControlPage() {
  const { can } = useAuth()
  const canViewRevisionReport = can("budget.revision.report")
  const [tab, setTab] = useState<Tab>("code")`,
'revision report permission')

page = replaceOnce(page,
`  const [allocations, setAllocations] = useState<Allocation[]>([])

  const fetchData = useCallback(async () => {`,
`  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [revisionHistory, setRevisionHistory] = useState<RevisionHistoryRow[]>([])

  const fetchData = useCallback(async () => {`,
'revision history state')

page = replaceOnce(page,
`      const [codeData, consData, deptData, relData, allocData, cycleRes] = await Promise.all([
        getBudgetByCode(year),
        getConsolidations(year),
        getDepartments(),
        getReleases(year),
        getAllocationsForRelease(year),
        supabase.from("budget_cycles").select("id, budget_year, name, status").order("budget_year", { ascending: false }),
      ])`,
`      const [codeData, consData, deptData, relData, allocData, cycleRes, revisionData] = await Promise.all([
        getBudgetByCode(year),
        getConsolidations(year),
        getDepartments(),
        getReleases(year),
        getAllocationsForRelease(year),
        supabase.from("budget_cycles").select("id, budget_year, name, status").order("budget_year", { ascending: false }),
        canViewRevisionReport ? getBudgetRevisionHistoryReport(year) : Promise.resolve([]),
      ])`,
'fetch revision history')

page = replaceOnce(page,
`      setAllocations((allocData || []) as unknown as Allocation[])
      const cycleRows`,
`      setAllocations((allocData || []) as unknown as Allocation[])
      setRevisionHistory((revisionData || []) as unknown as RevisionHistoryRow[])
      const cycleRows`,
'set revision history')

page = replaceOnce(page,
`  }, [year])`,
`  }, [year, canViewRevisionReport])`,
'fetchData dependencies')

const oldTotals = `  const totals = useMemo(() => {
    const approved = rows.reduce((s, r) => s + (r.approved_budget ?? r.revised_budget ?? 0), 0)
    const funded = rows.reduce((s, r) => s + (r.funded_amount || 0), 0)
    const released = rows.reduce((s, r) => s + (r.released_amount || 0), 0)
    const pending = rows.reduce((s, r) => s + (r.pending_amount || 0), 0)
    const committed = rows.reduce((s, r) => s + (r.outstanding_commitment ?? r.committed_amount ?? 0), 0)
    const actual = rows.reduce((s, r) => s + (r.actual_expenditure || 0), 0)
    const available = rows.reduce((s, r) => s + (r.available_amount ?? ((r.released_amount || 0) - (r.outstanding_commitment ?? r.committed_amount ?? 0) - (r.actual_expenditure || 0))), 0)
    const unfunded = rows.reduce((s, r) => s + (r.unfunded_amount ?? ((r.approved_budget ?? r.revised_budget ?? 0) - (r.funded_amount || 0))), 0)
    const unreleased = rows.reduce((s, r) => s + (r.unreleased_funding ?? ((r.funded_amount || 0) - (r.released_amount || 0))), 0)
    return { approved, funded, released, pending, committed, actual, available, unfunded, unreleased }
  }, [rows])`
page = replaceOnce(page, oldTotals,
`  const totals = useMemo(() => {
    const original = rows.reduce((s, r) => s + (r.original_budget || 0), 0)
    const supplementary = rows.reduce((s, r) => s + (r.supplemental_budget || 0), 0)
    const revisionAdjustment = rows.reduce((s, r) => s + (r.revision_adjustment || 0), 0)
    const currentRevised = rows.reduce((s, r) => s + (r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0), 0)
    const funded = rows.reduce((s, r) => s + (r.funded_amount || 0), 0)
    const released = rows.reduce((s, r) => s + (r.released_amount || 0), 0)
    const pending = rows.reduce((s, r) => s + (r.pending_amount || 0), 0)
    const committed = rows.reduce((s, r) => s + (r.outstanding_commitment ?? r.committed_amount ?? 0), 0)
    const actual = rows.reduce((s, r) => s + (r.actual_expenditure || 0), 0)
    const budgetAvailable = rows.reduce((s, r) => s + (r.budget_available ?? ((r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0) - (r.outstanding_commitment ?? r.committed_amount ?? 0) - (r.actual_expenditure || 0))), 0)
    const releasedAvailable = rows.reduce((s, r) => s + (r.released_available ?? r.available_amount ?? ((r.released_amount || 0) - (r.outstanding_commitment ?? r.committed_amount ?? 0) - (r.actual_expenditure || 0))), 0)
    const unfunded = rows.reduce((s, r) => s + (r.unfunded_amount ?? ((r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0) - (r.funded_amount || 0))), 0)
    const unreleased = rows.reduce((s, r) => s + (r.unreleased_funding ?? ((r.funded_amount || 0) - (r.released_amount || 0))), 0)
    return { original, supplementary, revisionAdjustment, currentRevised, funded, released, pending, committed, actual, budgetAvailable, releasedAvailable, unfunded, unreleased }
  }, [rows])`,
'totals lineage and dual availability')

page = replaceOnce(page,
`    const map = new Map<string, { label: string; approved: number; funded: number; released: number; pending: number; committed: number; actual: number; unfunded: number; unreleased: number }>()`,
`    const map = new Map<string, { label: string; original: number; supplementary: number; revisionAdjustment: number; currentRevised: number; funded: number; released: number; pending: number; committed: number; actual: number; budgetAvailable: number; releasedAvailable: number; unfunded: number; unreleased: number }>()`,
'cost-centre aggregate type')

page = replaceOnce(page,
`      const approved = r.approved_budget ?? r.revised_budget ?? 0
      const committed = r.outstanding_commitment ?? r.committed_amount ?? 0
      const e = map.get(key) || { label, approved: 0, funded: 0, released: 0, pending: 0, committed: 0, actual: 0, unfunded: 0, unreleased: 0 }
      e.approved += approved
      e.funded += r.funded_amount || 0`,
`      const original = r.original_budget || 0
      const supplementary = r.supplemental_budget || 0
      const revisionAdjustment = r.revision_adjustment || 0
      const currentRevised = r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0
      const committed = r.outstanding_commitment ?? r.committed_amount ?? 0
      const actual = r.actual_expenditure || 0
      const budgetAvailable = r.budget_available ?? (currentRevised - committed - actual)
      const releasedAvailable = r.released_available ?? r.available_amount ?? ((r.released_amount || 0) - committed - actual)
      const e = map.get(key) || { label, original: 0, supplementary: 0, revisionAdjustment: 0, currentRevised: 0, funded: 0, released: 0, pending: 0, committed: 0, actual: 0, budgetAvailable: 0, releasedAvailable: 0, unfunded: 0, unreleased: 0 }
      e.original += original
      e.supplementary += supplementary
      e.revisionAdjustment += revisionAdjustment
      e.currentRevised += currentRevised
      e.funded += r.funded_amount || 0`,
'cost-centre lineage accumulation')

page = replaceOnce(page,
`      e.actual += r.actual_expenditure || 0
      e.unfunded += r.unfunded_amount ?? (approved - (r.funded_amount || 0))
      e.unreleased += r.unreleased_funding ?? ((r.funded_amount || 0) - (r.released_amount || 0))`,
`      e.actual += actual
      e.budgetAvailable += budgetAvailable
      e.releasedAvailable += releasedAvailable
      e.unfunded += r.unfunded_amount ?? (currentRevised - (r.funded_amount || 0))
      e.unreleased += r.unreleased_funding ?? ((r.funded_amount || 0) - (r.released_amount || 0))`,
'cost-centre dual availability accumulation')

page = replaceOnce(page,
`    return Array.from(map.values()).sort((a, b) => b.approved - a.approved)`,
`    return Array.from(map.values()).sort((a, b) => b.currentRevised - a.currentRevised)`,
'cost-centre sort')

page = replaceOnce(page,
`    () => byCentre.slice(0, 8).map((c) => ({ name: c.label.split(" — ")[0], available: Math.max(0, c.released - c.committed - c.actual), used: c.committed + c.actual })),`,
`    () => byCentre.slice(0, 8).map((c) => ({ name: c.label.split(" — ")[0], available: Math.max(0, c.releasedAvailable), used: c.committed + c.actual })),`,
'chart released availability')

page = replaceOnce(page,
`        "Approved (K)": r.revised_budget || 0,
        "Released (K)": r.released_amount || 0,
        "Committed (K)": r.committed_amount || 0,
        "Actual (K)": r.actual_expenditure || 0,
        "Available (K)": (r.released_amount || 0) - (r.committed_amount || 0) - (r.actual_expenditure || 0),`,
`        "Original Budget (K)": r.original_budget || 0,
        "Supplementary (K)": r.supplemental_budget || 0,
        "Revision Adjustment (K)": r.revision_adjustment || 0,
        "Current Revised Budget (K)": r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0,
        "Released (K)": r.released_amount || 0,
        "Committed (K)": r.outstanding_commitment ?? r.committed_amount ?? 0,
        "Actual (K)": r.actual_expenditure || 0,
        "Budget Available (K)": r.budget_available ?? ((r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0) - (r.outstanding_commitment ?? r.committed_amount ?? 0) - (r.actual_expenditure || 0)),
        "Released Available (K)": r.released_available ?? r.available_amount ?? ((r.released_amount || 0) - (r.outstanding_commitment ?? r.committed_amount ?? 0) - (r.actual_expenditure || 0)),`,
'expense-code export lineage')

page = replaceOnce(page,
`        "Approved (K)": c.approved,
        "Funded (K)": c.funded,`,
`        "Original Budget (K)": c.original,
        "Supplementary (K)": c.supplementary,
        "Revision Adjustment (K)": c.revisionAdjustment,
        "Current Revised Budget (K)": c.currentRevised,
        "Funded (K)": c.funded,`,
'cost-centre export lineage')

page = replaceOnce(page,
`        "Available (K)": c.released - c.committed - c.actual,
        "Unfunded (K)": c.unfunded,`,
`        "Budget Available (K)": c.budgetAvailable,
        "Released Available (K)": c.releasedAvailable,
        "Unfunded (K)": c.unfunded,`,
'cost-centre export availability')

page = replaceOnce(page,
`    } else {
      emit("consolidations", "Budget Consolidations", consolidations.map((c) => ({`,
`    } else if (tab === "revisions") {
      emit("budget_revision_history", "Budget Revision History", revisionHistory.map((r) => ({
        Revision: r.revision_number,
        Division: r.division_code || r.division_name || "-",
        Type: r.revision_type,
        Status: r.status,
        "Original Budget (K)": r.original_budget || 0,
        "Current Before (K)": r.current_revised_budget_before || 0,
        "Revision Adjustment (K)": r.revision_adjustment || 0,
        "Proposed Revised (K)": r.proposed_revised_budget || 0,
        "Actual at Submission (K)": r.actual_expenditure_at_submission || 0,
        "Commitments at Submission (K)": r.outstanding_commitment_at_submission || 0,
        "Protected Minimum (K)": r.protected_minimum_at_submission || 0,
        "Effective Date": r.effective_date,
      })))
    } else {
      emit("consolidations", "Budget Consolidations", consolidations.map((c) => ({`,
'revision history export')

page = replaceOnce(page,
`    { key: "releases", label: "Releases", icon: Banknote },
    { key: "consolidation", label: "Consolidation", icon: Building2 },`,
`    { key: "releases", label: "Releases", icon: Banknote },
    ...(canViewRevisionReport ? [{ key: "revisions" as Tab, label: "Revision History", icon: History }] : []),
    { key: "consolidation", label: "Consolidation", icon: Building2 },`,
'revision history tab')

const oldCards = `      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-9 gap-4">
        <SummaryCard title="Approved" value={totals.approved} subtitle="Annual ceiling" icon={<Wallet className="h-6 w-6" />} tone="maroon" />
        <SummaryCard title="Funded" value={totals.funded} subtitle="Actual allocations" icon={<Banknote className="h-6 w-6" />} tone="gold" />
        <SummaryCard title="Released" value={totals.released} subtitle="Cash made available" icon={<Banknote className="h-6 w-6" />} tone="gold" />
        <SummaryCard title="Pending" value={totals.pending} subtitle="Submitted FF3" icon={<AlertCircle className="h-6 w-6" />} tone="slate" />
        <SummaryCard title="Committed" value={totals.committed} subtitle="Outstanding" icon={<FileText className="h-6 w-6" />} tone="slate" />
        <SummaryCard title="Actual" value={totals.actual} subtitle="Paid to date" icon={<DollarSign className="h-6 w-6" />} tone="red" />
        <SummaryCard title="Available" value={totals.available} subtitle="Released − Com − Act" icon={<TrendingUp className="h-6 w-6" />} tone="green" />
        <SummaryCard title="Unfunded" value={totals.unfunded} subtitle="Approved − Funded" icon={<Layers className="h-6 w-6" />} tone="red" />
        <SummaryCard title="Unreleased Funding" value={totals.unreleased} subtitle="Funded − Released" icon={<Hash className="h-6 w-6" />} tone="maroon" />
      </div>`
page = replaceOnce(page, oldCards,
`      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <SummaryCard title="Original Budget" value={totals.original} subtitle="Approved baseline" icon={<Wallet className="h-6 w-6" />} tone="maroon" />
        <SummaryCard title="Supplementary" value={totals.supplementary} subtitle="Additional authority" icon={<Layers className="h-6 w-6" />} tone="gold" />
        <SummaryCard title="Revision Adjustment" value={totals.revisionAdjustment} subtitle="Net approved movements" icon={<History className="h-6 w-6" />} tone="slate" />
        <SummaryCard title="Current Revised Budget" value={totals.currentRevised} subtitle="Current authoritative ceiling" icon={<Wallet className="h-6 w-6" />} tone="maroon" />
        <SummaryCard title="Funded" value={totals.funded} subtitle="Actual allocations" icon={<Banknote className="h-6 w-6" />} tone="gold" />
        <SummaryCard title="Released" value={totals.released} subtitle="Cash made available" icon={<Banknote className="h-6 w-6" />} tone="gold" />
        <SummaryCard title="Pending" value={totals.pending} subtitle="Submitted FF3" icon={<AlertCircle className="h-6 w-6" />} tone="slate" />
        <SummaryCard title="Committed" value={totals.committed} subtitle="Outstanding" icon={<FileText className="h-6 w-6" />} tone="slate" />
        <SummaryCard title="Actual" value={totals.actual} subtitle="Paid to date" icon={<DollarSign className="h-6 w-6" />} tone="red" />
        <SummaryCard title="Budget Available" value={totals.budgetAvailable} subtitle="Revised − Com − Act" icon={<TrendingUp className="h-6 w-6" />} tone="green" />
        <SummaryCard title="Released Available" value={totals.releasedAvailable} subtitle="Released − Com − Act" icon={<TrendingUp className="h-6 w-6" />} tone="green" />
        <SummaryCard title="Unfunded" value={totals.unfunded} subtitle="Revised − Funded" icon={<Layers className="h-6 w-6" />} tone="red" />
        <SummaryCard title="Unreleased Funding" value={totals.unreleased} subtitle="Funded − Released" icon={<Hash className="h-6 w-6" />} tone="maroon" />
      </div>`,
'summary cards')

page = replaceOnce(page,
`      ) : tab === "releases" ? (
        <ReleasesView year={year} releases={releases} allocations={allocations} periods={periods} canRelease={can("budget.release")} onChanged={fetchData} />
      ) : (
        <ConsolidationView`,
`      ) : tab === "releases" ? (
        <ReleasesView year={year} releases={releases} allocations={allocations} periods={periods} canRelease={can("budget.release")} onChanged={fetchData} />
      ) : tab === "revisions" ? (
        <RevisionHistoryView rows={revisionHistory} />
      ) : (
        <ConsolidationView`,
'tab rendering')

page = replaceOnce(page,
`              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Approved</th>`,
`              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Original Budget</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Supplementary</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Revision Adjustment</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Current Revised Budget</th>`,
'expense-code table budget headers')

page = replaceOnce(page,
`              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Available</th>`,
`              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Budget Available</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Released Available</th>`,
'expense-code table dual availability headers')

page = replaceOnce(page,
`              const approved = r.approved_budget ?? r.revised_budget ?? 0
              const funded = r.funded_amount || 0
              const committed = r.outstanding_commitment ?? r.committed_amount ?? 0
              const avail = r.available_amount ?? ((r.released_amount || 0) - committed - (r.actual_expenditure || 0))
              const unfunded = r.unfunded_amount ?? (approved - funded)`,
`              const original = r.original_budget || 0
              const supplementary = r.supplemental_budget || 0
              const revisionAdjustment = r.revision_adjustment || 0
              const approved = r.current_revised_budget ?? r.approved_budget ?? r.revised_budget ?? 0
              const funded = r.funded_amount || 0
              const committed = r.outstanding_commitment ?? r.committed_amount ?? 0
              const budgetAvail = r.budget_available ?? (approved - committed - (r.actual_expenditure || 0))
              const avail = r.released_available ?? r.available_amount ?? ((r.released_amount || 0) - committed - (r.actual_expenditure || 0))
              const unfunded = r.unfunded_amount ?? (approved - funded)`,
'expense-code row calculations')

page = replaceOnce(page,
`                  <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">K {approved.toLocaleString()}</td>`,
`                  <td className="px-4 py-3 text-sm text-slate-900 text-right">K {original.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-png-gold-strong text-right">K {supplementary.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right">K {revisionAdjustment.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">K {approved.toLocaleString()}</td>`,
'expense-code row lineage cells')

page = replaceOnce(page,
`                  <td className="px-4 py-3 text-sm text-right font-semibold"><span className={avail >= 0 ? "text-green-700" : "text-red-600"}>K {avail.toLocaleString()}</span></td>`,
`                  <td className="px-4 py-3 text-sm text-right font-semibold"><span className={budgetAvail >= 0 ? "text-green-700" : "text-red-600"}>K {budgetAvail.toLocaleString()}</span></td>
                  <td className="px-4 py-3 text-sm text-right font-semibold"><span className={avail >= 0 ? "text-green-700" : "text-red-600"}>K {avail.toLocaleString()}</span></td>`,
'expense-code row availability cells')

page = replaceOnce(page,
`function ByCentreView({ byCentre, chartData }: { byCentre: { label: string; approved: number; funded: number; released: number; pending: number; committed: number; actual: number; unfunded: number; unreleased: number }[]; chartData: { name: string; available: number; used: number }[] }) {`,
`function ByCentreView({ byCentre, chartData }: { byCentre: { label: string; original: number; supplementary: number; revisionAdjustment: number; currentRevised: number; funded: number; released: number; pending: number; committed: number; actual: number; budgetAvailable: number; releasedAvailable: number; unfunded: number; unreleased: number }[]; chartData: { name: string; available: number; used: number }[] }) {`,
'cost-centre view type')

page = replaceOnce(page,
`                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Approved</th>`,
`                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Original Budget</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Supplementary</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Revision Adjustment</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Current Revised Budget</th>`,
'cost-centre table budget headers')

page = replaceOnce(page,
`                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Available</th>`,
`                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Budget Available</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Released Available</th>`,
'cost-centre availability headers')

page = replaceOnce(page,
`              {byCentre.map((c, i) => {
                const avail = c.released - c.committed - c.actual
                return (`,
`              {byCentre.map((c, i) => {
                const avail = c.releasedAvailable
                return (`,
'cost-centre availability')

page = replaceOnce(page,
`                    <td className="px-4 py-3 text-sm text-slate-900 text-right">K {c.approved.toLocaleString()}</td>`,
`                    <td className="px-4 py-3 text-sm text-slate-900 text-right">K {c.original.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-png-gold-strong text-right">K {c.supplementary.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 text-right">K {c.revisionAdjustment.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">K {c.currentRevised.toLocaleString()}</td>`,
'cost-centre lineage cells')

page = replaceOnce(page,
`                    <td className="px-4 py-3 text-sm text-right font-semibold"><span className={avail >= 0 ? "text-green-700" : "text-red-600"}>K {avail.toLocaleString()}</span></td>`,
`                    <td className="px-4 py-3 text-sm text-right font-semibold"><span className={c.budgetAvailable >= 0 ? "text-green-700" : "text-red-600"}>K {c.budgetAvailable.toLocaleString()}</span></td>
                    <td className="px-4 py-3 text-sm text-right font-semibold"><span className={avail >= 0 ? "text-green-700" : "text-red-600"}>K {avail.toLocaleString()}</span></td>`,
'cost-centre dual availability cells')

page = replaceOnce(page,
`function ReleasesView({ year, releases, allocations, periods, canRelease, onChanged }: {`,
`function RevisionHistoryView({ rows }: { rows: RevisionHistoryRow[] }) {
  if (rows.length === 0) return <EmptyState message="No budget revisions have been recorded for this financial year." />
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Revision</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Division</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Original Budget</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Current Before</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Revision Adjustment</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Proposed Revised</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Actual at Submit</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Commitments at Submit</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Protected Minimum</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Effective</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.budget_revision_id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-mono font-medium text-png-red">{r.revision_number}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{r.division_code || r.division_name || "-"}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{r.revision_type}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{r.status}</td>
                <td className="px-4 py-3 text-sm text-right">K {(r.original_budget || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right">K {(r.current_revised_budget_before || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right">K {(r.revision_adjustment || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right font-medium">K {(r.proposed_revised_budget || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right">K {(r.actual_expenditure_at_submission || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right">K {(r.outstanding_commitment_at_submission || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right">K {(r.protected_minimum_at_submission || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{r.effective_date || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ReleasesView({ year, releases, allocations, periods, canRelease, onChanged }: {`,
'revision history table')

fs.writeFileSync(pagePath, page)
console.log('Task 6 Budget Control reporting transforms applied')
