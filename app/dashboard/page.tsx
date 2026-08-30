"use client"

import { useEffect, useState } from "react"
import {
  BarChart3,
  Calculator,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Layers,
  MapPin,
  TrendingUp,
  Wallet,
} from "lucide-react"
import Link from "next/link"
import { authFetch } from "@/lib/auth-fetch"
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type BudgetSummary = {
  approvedBudget: number
  fundedAmount: number
  releasedAmount: number
  pendingFF3: number
  outstandingCommitments: number
  actualExpenditure: number
  availableBalance: number
  unfundedBudget: number
  unreleasedFunding: number
  projectedAvailableAfterPending: number
}

type PendingFF3 = {
  ff3_number: string
  purpose: string
  total_estimated_amount: number
  status: string
  urgency_level: string
  created_at: string
  daysWaiting?: number
}

type QuarterlyData = {
  quarter: string
  released: number
  spent: number
}

type CentreSpend = {
  name: string
  approved: number
  available: number
}

type BudgetPreparationStats = {
  draft: number
  submitted: number
  returned: number
  reviewed: number
  approved: number
  approvedValue: number
}

type DashboardStats = {
  total: number
  pending: number
  approved?: number
  rejected?: number
  paid?: number
  reconciled?: number
}

type DashboardScope = {
  mode: "NATIONAL" | "SECTION"
  label: string
  province: { id: string; name: string } | null
  courtLocation: { id: string; name: string } | null
  department: { id: string; name: string } | null
  section: { id: string; name: string } | null
}

type DashboardPayload = {
  financialYear: number
  availableFinancialYears: number[]
  scope: DashboardScope
  summary: BudgetSummary
  quarterlyData: QuarterlyData[]
  centreSpend: CentreSpend[]
  budgetPrepStats: BudgetPreparationStats
  pendingFF3s: PendingFF3[]
  ff3Stats: Required<Pick<DashboardStats, "total" | "pending">> & { approved: number; rejected: number }
  ff4Stats: Required<Pick<DashboardStats, "total" | "pending">> & { paid: number; reconciled: number }
}

const COLORS = {
  maroon: "#4c0f16",
  red: "#8a1420",
  gold: "#d4af37",
  green: "#15803d",
}

const PIE_COLORS = ["#15803d", "#d4af37", "#8a1420", "#cbd5e1"]

const EMPTY_SUMMARY: BudgetSummary = {
  approvedBudget: 0,
  fundedAmount: 0,
  releasedAmount: 0,
  pendingFF3: 0,
  outstandingCommitments: 0,
  actualExpenditure: 0,
  availableBalance: 0,
  unfundedBudget: 0,
  unreleasedFunding: 0,
  projectedAvailableAfterPending: 0,
}

const EMPTY_BUDGET_PREP: BudgetPreparationStats = {
  draft: 0,
  submitted: 0,
  returned: 0,
  reviewed: 0,
  approved: 0,
  approvedValue: 0,
}

export default function DashboardPage() {
  const currentYear = new Date().getFullYear()
  const [selectedFinancialYear, setSelectedFinancialYear] = useState(currentYear)
  const [availableFinancialYears, setAvailableFinancialYears] = useState<number[]>([currentYear])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [scope, setScope] = useState<DashboardScope | null>(null)
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummary>(EMPTY_SUMMARY)
  const [pendingFF3s, setPendingFF3s] = useState<PendingFF3[]>([])
  const [ff3Stats, setFf3Stats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 })
  const [ff4Stats, setFf4Stats] = useState({ total: 0, pending: 0, paid: 0, reconciled: 0 })
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyData[]>([
    { quarter: "Q1", released: 0, spent: 0 },
    { quarter: "Q2", released: 0, spent: 0 },
    { quarter: "Q3", released: 0, spent: 0 },
    { quarter: "Q4", released: 0, spent: 0 },
  ])
  const [centreSpend, setCentreSpend] = useState<CentreSpend[]>([])
  const [budgetPrepStats, setBudgetPrepStats] = useState<BudgetPreparationStats>(EMPTY_BUDGET_PREP)

  useEffect(() => {
    let cancelled = false

    async function fetchDashboardData() {
      setLoading(true)
      setError("")
      try {
        const response = await authFetch(`/api/dashboard?financialYear=${selectedFinancialYear}`)
        const body = await response.json().catch(() => ({})) as DashboardPayload & { error?: string }
        if (!response.ok) {
          throw new Error(body.error || "Unable to load dashboard data")
        }
        if (cancelled) return

        setScope(body.scope)
        setAvailableFinancialYears(body.availableFinancialYears?.length ? body.availableFinancialYears : [selectedFinancialYear])
        setBudgetSummary(body.summary || EMPTY_SUMMARY)
        setQuarterlyData(body.quarterlyData || [])
        setCentreSpend(body.centreSpend || [])
        setBudgetPrepStats(body.budgetPrepStats || EMPTY_BUDGET_PREP)
        setPendingFF3s(body.pendingFF3s || [])
        setFf3Stats(body.ff3Stats || { total: 0, pending: 0, approved: 0, rejected: 0 })
        setFf4Stats(body.ff4Stats || { total: 0, pending: 0, paid: 0, reconciled: 0 })
      } catch (cause) {
        if (!cancelled) {
          console.error("Error fetching scoped dashboard data:", cause)
          setError(cause instanceof Error ? cause.message : "Unable to load dashboard data")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchDashboardData()
    return () => {
      cancelled = true
    }
  }, [selectedFinancialYear])

  const budgetPieData = [
    { name: "Available", value: budgetSummary.availableBalance },
    { name: "Outstanding Commitments", value: budgetSummary.outstandingCommitments },
    { name: "Actual Expenditure", value: budgetSummary.actualExpenditure },
    { name: "Unreleased Funding", value: budgetSummary.unreleasedFunding },
  ].filter((item) => item.value > 0)

  const ff3PieData = [
    { name: "Approved", value: ff3Stats.approved, color: COLORS.green },
    { name: "Pending", value: ff3Stats.pending, color: COLORS.gold },
    { name: "Rejected", value: ff3Stats.rejected, color: COLORS.red },
  ].filter((item) => item.value > 0)

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-png-red" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
        <h1 className="text-lg font-semibold">Dashboard unavailable</h1>
        <p className="mt-2 text-sm">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-slate-600">Financial Year {selectedFinancialYear} Overview</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <label className="flex items-center gap-2">
            <span className="font-medium text-slate-700">Financial Year</span>
            <select
              value={selectedFinancialYear}
              onChange={(event) => setSelectedFinancialYear(Number(event.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-png-red"
            >
              {availableFinancialYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
          <div className="hidden items-center gap-2 sm:flex">
            <BarChart3 className="h-4 w-4" />
            Last updated: {new Date().toLocaleString("en-GB")}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-png-gold/50 bg-png-gold/10 px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-png-maroon" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-png-maroon">Dashboard Scope:</p>
              <p className="font-semibold text-slate-900">{scope?.label || "Assigned scope"}</p>
              {scope?.mode === "SECTION" && (
                <p className="mt-1 text-xs text-slate-600">Only records belonging to this assigned section are included in every figure and chart.</p>
              )}
            </div>
          </div>
          <span className="self-start rounded-full border border-png-gold/60 bg-white px-3 py-1 text-xs font-semibold text-png-maroon sm:self-center">
            {scope?.mode === "NATIONAL" ? "National View" : "Section View"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Approved Budget" value={`K ${budgetSummary.approvedBudget.toLocaleString()}`} subtitle="Authorised budget lines" icon={<Wallet className="h-5 w-5" />} tone="maroon" />
        <MetricCard title="Funded Amount" value={`K ${budgetSummary.fundedAmount.toLocaleString()}`} subtitle={`${percentage(budgetSummary.fundedAmount, budgetSummary.approvedBudget).toFixed(0)}% of approved budget`} icon={<TrendingUp className="h-5 w-5" />} tone="gold" />
        <MetricCard title="Released Amount" value={`K ${budgetSummary.releasedAmount.toLocaleString()}`} subtitle={`${percentage(budgetSummary.releasedAmount, budgetSummary.fundedAmount).toFixed(0)}% of funded amount`} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
        <MetricCard title="Pending FF3" value={`K ${budgetSummary.pendingFF3.toLocaleString()}`} subtitle="Awaiting workflow action" icon={<Clock className="h-5 w-5" />} tone="red" />
        <MetricCard title="Outstanding Commitments" value={`K ${budgetSummary.outstandingCommitments.toLocaleString()}`} subtitle="Committed but unpaid" icon={<FileText className="h-5 w-5" />} tone="red" />
        <MetricCard title="Actual Expenditure" value={`K ${budgetSummary.actualExpenditure.toLocaleString()}`} subtitle={`${percentage(budgetSummary.actualExpenditure, budgetSummary.releasedAmount).toFixed(1)}% of released amount`} icon={<DollarSign className="h-5 w-5" />} tone="maroon" />
        <MetricCard title="Available Balance" value={`K ${budgetSummary.availableBalance.toLocaleString()}`} subtitle="Released less commitments and actuals" icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
        <MetricCard title="Unfunded / Unreleased" value={`K ${(budgetSummary.unfundedBudget + budgetSummary.unreleasedFunding).toLocaleString()}`} subtitle={`Unfunded K ${budgetSummary.unfundedBudget.toLocaleString()} • Unreleased K ${budgetSummary.unreleasedFunding.toLocaleString()}`} icon={<Layers className="h-5 w-5" />} tone="gold" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Budget Allocation">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={budgetPieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value" label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={false}>
                  {budgetPieData.map((_, index) => <Cell key={`budget-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => `K ${Number(value).toLocaleString()}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Release, Commitment & Expenditure Position">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={quarterlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="quarter" stroke="#64748b" />
                <YAxis stroke="#64748b" tickFormatter={(value) => `K${(Number(value) / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value) => `K ${Number(value).toLocaleString()}`} />
                <Legend />
                <Bar dataKey="released" name="Released" fill={COLORS.maroon} radius={[4, 4, 0, 0]} />
                <Bar dataKey="spent" name="Spent" fill={COLORS.gold} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Calculator className="h-5 w-5 text-png-red" /> Budget Preparation</h2>
            <Link href="/dashboard/budget-template" className="text-sm font-medium text-png-red hover:text-png-maroon">Open Grid →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <PlanStat label="Draft" value={budgetPrepStats.draft} tone="slate" />
            <PlanStat label="Submitted" value={budgetPrepStats.submitted} tone="gold" />
            <PlanStat label="Returned" value={budgetPrepStats.returned} tone="gold" />
            <PlanStat label="Reviewed" value={budgetPrepStats.reviewed} tone="slate" />
            <PlanStat label="Approved" value={budgetPrepStats.approved} tone="green" />
          </div>
          <div className="mt-4 rounded-lg border border-png-gold/30 bg-png-red/5 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-png-red/70">Total Approved Budget</p>
            <p className="mt-1 text-2xl font-bold text-png-maroon">K {budgetPrepStats.approvedValue.toLocaleString()}</p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Layers className="h-5 w-5 text-png-gold" /> Budget by Cost Centre</h2>
            <Link href="/dashboard/budget" className="text-sm font-medium text-png-red hover:text-png-maroon">Budget Control →</Link>
          </div>
          {centreSpend.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={centreSpend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" tickFormatter={(value) => `K${(Number(value) / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => `K ${Number(value).toLocaleString()}`} />
                  <Legend />
                  <Bar dataKey="approved" name="Approved" fill={COLORS.maroon} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="available" name="Available" fill={COLORS.gold} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center text-slate-400">
              <Layers className="mb-2 h-10 w-10 text-slate-200" />
              <p className="text-sm">No approved budget position exists for this dashboard scope.</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <WorkflowPanel title="FF3 Requisitions" href="/dashboard/ff3" stats={[
          ["Total", ff3Stats.total, "slate"],
          ["Pending", ff3Stats.pending, "gold"],
          ["Approved", ff3Stats.approved, "green"],
          ["Rejected", ff3Stats.rejected, "red"],
        ]}>
          {ff3PieData.length > 0 && (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={ff3PieData} cx="50%" cy="50%" outerRadius={60} dataKey="value">
                    {ff3PieData.map((entry, index) => <Cell key={`ff3-${index}`} fill={entry.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </WorkflowPanel>

        <WorkflowPanel title="FF4 Expenses" href="/dashboard/ff4" stats={[
          ["Total", ff4Stats.total, "slate"],
          ["Awaiting action", ff4Stats.pending, "red"],
          ["Paid", ff4Stats.paid, "green"],
          ["Reconciled", ff4Stats.reconciled, "gold"],
        ]}>
          {centreSpend.length > 0 && (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={centreSpend} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={(value) => `K${(Number(value) / 1000).toFixed(0)}k`} stroke="#64748b" />
                  <YAxis type="category" dataKey="name" width={100} stroke="#64748b" fontSize={12} />
                  <Tooltip formatter={(value) => `K ${Number(value).toLocaleString()}`} />
                  <Bar dataKey="approved" name="Approved" fill={COLORS.gold} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </WorkflowPanel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Clock className="h-5 w-5 text-png-gold" /> FF3 Pending Approvals ({ff3Stats.pending})</h2>
          </div>
          {pendingFF3s.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {pendingFF3s.map((ff3) => (
                <PendingItem
                  key={ff3.ff3_number}
                  number={ff3.ff3_number}
                  description={ff3.purpose}
                  amount={`K ${(ff3.total_estimated_amount || 0).toLocaleString()}`}
                  status={ff3.status.replace(/_/g, " ")}
                  urgency={ff3.urgency_level || "MEDIUM"}
                  daysWaiting={ff3.daysWaiting || 0}
                />
              ))}
              <div className="p-4 text-center"><Link href="/dashboard/ff3" className="text-sm font-medium text-png-red hover:text-png-maroon">View All FF3 Requisitions →</Link></div>
            </div>
          ) : (
            <div className="p-6 text-center text-slate-500"><CheckCircle2 className="mx-auto mb-2 h-12 w-12 text-green-200" /><p className="text-sm">No pending FF3 approvals in this dashboard scope</p></div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Available Balance Formula</h2>
          <div className="space-y-3">
            <BalanceLine label="Released Amount" amount={budgetSummary.releasedAmount} />
            <BalanceLine label="Less: Pending FF3" amount={-budgetSummary.pendingFF3} isNegative />
            <BalanceLine label="Less: Outstanding Commitments" amount={-budgetSummary.outstandingCommitments} isNegative />
            <BalanceLine label="Less: Actual Expenditure" amount={-budgetSummary.actualExpenditure} isNegative />
            <div className="mt-3 border-t border-slate-200 pt-3">
              <BalanceLine label="Available Balance" amount={budgetSummary.availableBalance} isTotal />
              <BalanceLine label="Projected After Pending FF3" amount={budgetSummary.projectedAvailableAfterPending} />
            </div>
          </div>

          <div className="mt-6 rounded-lg bg-slate-50 p-4">
            <h3 className="mb-2 text-sm font-medium text-slate-700">Budget Utilization</h3>
            <div className="h-4 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="flex h-full">
                <div className="h-full bg-png-red" style={{ width: `${percentage(budgetSummary.actualExpenditure, budgetSummary.releasedAmount)}%` }} title="Spent" />
                <div className="h-full bg-png-gold" style={{ width: `${percentage(budgetSummary.outstandingCommitments, budgetSummary.releasedAmount)}%` }} title="Committed" />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <LegendKey color="bg-png-red" label={`Spent: ${percentage(budgetSummary.actualExpenditure, budgetSummary.releasedAmount).toFixed(1)}%`} />
              <LegendKey color="bg-png-gold" label={`Committed: ${percentage(budgetSummary.outstandingCommitments, budgetSummary.releasedAmount).toFixed(1)}%`} />
              <LegendKey color="bg-slate-300" label={`Available: ${percentage(budgetSummary.availableBalance, budgetSummary.releasedAmount).toFixed(1)}%`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function percentage(value: number, total: number) {
  if (!total) return 0
  return Math.max(0, Math.min(100, (value / total) * 100))
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-6"><h2 className="mb-4 text-lg font-semibold text-slate-900">{title}</h2>{children}</div>
}

function MetricCard({ title, value, subtitle, icon, tone }: {
  title: string
  value: string
  subtitle: string
  icon: React.ReactNode
  tone: "maroon" | "gold" | "red" | "green"
}) {
  const toneClasses = {
    maroon: "bg-png-maroon/10 text-png-maroon",
    gold: "bg-png-gold/20 text-png-maroon",
    red: "bg-png-red/10 text-png-red",
    green: "bg-green-100 text-green-700",
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between"><div className={`rounded-lg p-2 ${toneClasses[tone]}`}>{icon}</div></div>
      <h3 className="text-xs font-medium uppercase text-slate-600">{title}</h3>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
    </div>
  )
}

function PlanStat({ label, value, tone }: { label: string; value: number; tone: "slate" | "gold" | "green" }) {
  const toneClasses = {
    slate: "bg-slate-50 text-slate-900",
    gold: "bg-png-gold/15 text-png-maroon",
    green: "bg-green-50 text-green-700",
  }
  return <div className={`rounded-lg p-3 text-center ${toneClasses[tone]}`}><p className="text-2xl font-bold">{value}</p><p className="mt-0.5 text-xs text-slate-600">{label}</p></div>
}

function WorkflowPanel({ title, href, stats, children }: {
  title: string
  href: string
  stats: Array<[string, number, "slate" | "gold" | "green" | "red"]>
  children: React.ReactNode
}) {
  const classes = {
    slate: "bg-slate-50 text-slate-900",
    gold: "bg-png-gold/15 text-png-maroon",
    green: "bg-green-50 text-green-600",
    red: "bg-png-red/10 text-png-red",
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-900">{title}</h2><Link href={href} className="text-sm text-png-red hover:text-png-maroon">View All →</Link></div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value, tone]) => <div key={label} className={`rounded-lg p-3 text-center ${classes[tone]}`}><p className="text-2xl font-bold">{value}</p><p className="text-xs text-slate-600">{label}</p></div>)}
      </div>
      {children}
    </div>
  )
}

function BalanceLine({ label, amount, isNegative = false, isTotal = false }: {
  label: string
  amount: number
  isNegative?: boolean
  isTotal?: boolean
}) {
  return (
    <div className={`flex items-center justify-between ${isTotal ? "text-lg font-bold" : ""}`}>
      <span className={isTotal ? "text-slate-900" : "text-slate-700"}>{label}</span>
      <span className={isTotal ? "text-green-700" : isNegative ? "text-red-600" : "text-slate-900"}>K {Math.abs(amount).toLocaleString()}</span>
    </div>
  )
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${color}`} />{label}</span>
}

function PendingItem({ number, description, amount, status, urgency, daysWaiting }: {
  number: string
  description: string
  amount: string
  status: string
  urgency: string
  daysWaiting: number
}) {
  const urgencyColors: Record<string, string> = {
    LOW: "bg-slate-100 text-slate-700",
    MEDIUM: "bg-png-gold/20 text-png-maroon",
    HIGH: "bg-orange-100 text-orange-700",
    URGENT: "bg-red-100 text-red-700",
  }
  return (
    <div className="p-4 hover:bg-slate-50">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={`/dashboard/ff3/${number}`} className="font-semibold text-slate-900 hover:text-png-red">{number}</Link>
          <p className="mt-1 line-clamp-1 text-sm text-slate-600">{description}</p>
        </div>
        <span className={`rounded px-2 py-1 text-xs font-medium ${urgencyColors[urgency] || urgencyColors.MEDIUM}`}>{urgency}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-slate-500">{status}</span>
        <div className="flex items-center gap-4"><span className="text-png-maroon">{daysWaiting}d waiting</span><span className="font-semibold text-slate-900">{amount}</span></div>
      </div>
    </div>
  )
}
