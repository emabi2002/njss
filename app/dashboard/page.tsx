"use client"

import { useEffect, useState } from "react"
import { FileText, DollarSign, TrendingUp, Clock, CheckCircle2, Wallet, BarChart3, Layers, Calculator } from "lucide-react"
import Link from "next/link"
import { supabase, isSupabaseNetworkEnabled } from "@/lib/supabase"
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
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
  section: { name: string } | null
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

type ManagementSummaryRow = {
  financial_year: number
  approved_budget?: number
  funded_amount?: number
  released_amount?: number
  pending_ff3?: number
  outstanding_commitments?: number
  actual_expenditure?: number
  available_balance?: number
  unfunded_budget?: number
  unreleased_funding?: number
  projected_available_after_pending?: number
  ff3_awaiting_action?: number
  ff4_awaiting_verification?: number
  ff4_awaiting_approval?: number
  ff4_processed_awaiting_payment?: number
  paid_awaiting_reconciliation?: number
}

type CostCentrePositionRow = {
  cost_centre_code?: string | null
  cost_centre_name?: string | null
  section_name?: string | null
  approved_budget?: number
  available_balance?: number
}

type QuarterlyExpenditureRow = { quarter?: number; actual_expenditure?: number }
type FinancialYearRow = { year?: number }

type ReleaseRow = { quarter?: number; released_amount?: number }
type BudgetSubmissionRow = { status?: string; total_proposed_budget?: number }
type StatusRow = { status?: string }

type DashboardQueryResult<T = Record<string, unknown>> = { data: T[] | null }

// PNG Judiciary brand palette
const COLORS = {
  maroon: '#4c0f16',
  red: '#8a1420',
  gold: '#d4af37',
  goldSoft: '#e3c876',
  green: '#15803d',
  slate: '#64748b',
}

const PIE_COLORS = ['#15803d', '#d4af37', '#8a1420', '#cbd5e1']

const DASHBOARD_QUERY_TIMEOUT_MS = 9000

async function withDashboardTimeout<T extends DashboardQueryResult>(
  query: PromiseLike<T>,
  fallback: DashboardQueryResult = { data: [] },
  label: string
): Promise<DashboardQueryResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(query as PromiseLike<DashboardQueryResult>),
      new Promise<DashboardQueryResult>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(`Dashboard query timed out: ${label}`)
          resolve(fallback)
        }, DASHBOARD_QUERY_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    console.warn(`Dashboard query failed: ${label}`, error)
    return fallback
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export default function DashboardPage() {
  const currentYear = new Date().getFullYear()
  const offlineQuarterlyData = ['Q1', 'Q2', 'Q3', 'Q4'].map((quarter) => ({ quarter, released: 0, spent: 0 }))
  const [selectedFinancialYear, setSelectedFinancialYear] = useState(currentYear)
  const [availableFinancialYears, setAvailableFinancialYears] = useState<number[]>([currentYear])
  const [loading, setLoading] = useState(isSupabaseNetworkEnabled)
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummary>({
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
  })
  const [pendingFF3s, setPendingFF3s] = useState<PendingFF3[]>([])
  const [ff3Stats, setFf3Stats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 })
  const [ff4Stats, setFf4Stats] = useState({ total: 0, pending: 0, paid: 0, reconciled: 0 })
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyData[]>(offlineQuarterlyData)
  const [centreSpend, setCentreSpend] = useState<CentreSpend[]>([])
  const [budgetPrepStats, setBudgetPrepStats] = useState<BudgetPreparationStats>({
    draft: 0,
    submitted: 0,
    returned: 0,
    reviewed: 0,
    approved: 0,
    approvedValue: 0
  })

  useEffect(() => {
    if (!isSupabaseNetworkEnabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false)
      return
    }

    async function fetchDashboardData() {
      try {
        const [yearsRes, summaryRes, releasesRes, quarterlyExpenditureRes, costCentreRes, budgetSubmissionsRes, pendingRes, allFF3sRes, allFF4sRes] = await Promise.all([
          withDashboardTimeout(
            supabase.from('financial_years').select('year').order('year', { ascending: false }),
            { data: [] },
            'financial_years',
          ),
          withDashboardTimeout(
            supabase.from('v_management_financial_summary').select('*').eq('financial_year', selectedFinancialYear),
            { data: [] },
            'v_management_financial_summary',
          ),
          withDashboardTimeout(
            supabase.from('quarterly_releases').select('quarter, released_amount').eq('financial_year', selectedFinancialYear).order('quarter'),
            { data: [] },
            'quarterly_releases',
          ),
          withDashboardTimeout(
            supabase.from('v_quarterly_expenditure_summary').select('quarter, actual_expenditure').eq('financial_year', selectedFinancialYear),
            { data: [] },
            'v_quarterly_expenditure_summary',
          ),
          withDashboardTimeout(
            supabase.from('v_cost_centre_financial_position').select('cost_centre_code, cost_centre_name, section_name, approved_budget, available_balance').eq('financial_year', selectedFinancialYear),
            { data: [] },
            'v_cost_centre_financial_position',
          ),
          withDashboardTimeout(
            supabase.from('divisional_budget_submissions').select('status, total_proposed_budget').eq('budget_year', selectedFinancialYear),
            { data: [] },
            'divisional_budget_submissions',
          ),
          withDashboardTimeout(
            supabase
              .from('ff3_headers')
              .select('ff3_number, purpose, total_estimated_amount, status, urgency_level, created_at, section:sections(name)')
              .eq('financial_year', selectedFinancialYear)
              .in('status', ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD'])
              .order('created_at', { ascending: false })
              .limit(5),
            { data: [] },
            'pending_ff3_headers',
          ),
          withDashboardTimeout(
            supabase.from('ff3_headers').select('status').eq('financial_year', selectedFinancialYear),
            { data: [] },
            'ff3_stats',
          ),
          withDashboardTimeout(
            supabase.from('ff4_headers').select('status').eq('financial_year', selectedFinancialYear),
            { data: [] },
            'ff4_stats',
          ),
        ])

        const financialYears = (yearsRes.data || []) as FinancialYearRow[]
        const managementSummary = ((summaryRes.data || []) as ManagementSummaryRow[])[0]
        const releases = (releasesRes.data || []) as ReleaseRow[]
        const quarterlyExpenditureRows = (quarterlyExpenditureRes.data || []) as QuarterlyExpenditureRow[]
        const costCentreRows = (costCentreRes.data || []) as CostCentrePositionRow[]
        const budgetSubmissions = (budgetSubmissionsRes.data || []) as BudgetSubmissionRow[]
        const pending = (pendingRes.data || []) as PendingFF3[]
        const allFF3s = (allFF3sRes.data || []) as StatusRow[]
        const allFF4s = (allFF4sRes.data || []) as StatusRow[]

        const yearValues = Array.from(new Set([currentYear, selectedFinancialYear, ...financialYears.map((row) => row.year).filter((year): year is number => typeof year === 'number')])).sort((a, b) => b - a)
        setAvailableFinancialYears(yearValues)

        setBudgetSummary({
          approvedBudget: managementSummary?.approved_budget || 0,
          fundedAmount: managementSummary?.funded_amount || 0,
          releasedAmount: managementSummary?.released_amount || 0,
          pendingFF3: managementSummary?.pending_ff3 || 0,
          outstandingCommitments: managementSummary?.outstanding_commitments || 0,
          actualExpenditure: managementSummary?.actual_expenditure || 0,
          availableBalance: managementSummary?.available_balance || 0,
          unfundedBudget: managementSummary?.unfunded_budget || 0,
          unreleasedFunding: managementSummary?.unreleased_funding || 0,
          projectedAvailableAfterPending: managementSummary?.projected_available_after_pending || 0,
        })

        const quarterNames = ['Q1', 'Q2', 'Q3', 'Q4']
        const qData = quarterNames.map((q, i) => {
          const quarterNumber = i + 1
          const released = releases
            .filter((release) => release.quarter === quarterNumber)
            .reduce((sum, release) => sum + (release.released_amount || 0), 0)
          const spent = quarterlyExpenditureRows
            .filter((expenditure) => expenditure.quarter === quarterNumber)
            .reduce((sum, expenditure) => sum + (expenditure.actual_expenditure || 0), 0)
          return { quarter: q, released, spent }
        })
        setQuarterlyData(qData)

        setCentreSpend(
          costCentreRows
            .map((row) => ({
              name: row.cost_centre_code || row.cost_centre_name || row.section_name || 'Unassigned',
              approved: row.approved_budget || 0,
              available: row.available_balance || 0,
            }))
            .sort((a, b) => b.approved - a.approved)
            .slice(0, 6)
        )

        setBudgetPrepStats({
          draft: budgetSubmissions.filter((budget) => budget.status === 'DRAFT').length,
          submitted: budgetSubmissions.filter((budget) => budget.status === 'SUBMITTED' || budget.status === 'RESUBMITTED').length,
          returned: budgetSubmissions.filter((budget) => budget.status === 'RETURNED').length,
          reviewed: budgetSubmissions.filter((budget) => budget.status === 'REVIEWED').length,
          approved: budgetSubmissions.filter((budget) => budget.status === 'APPROVED').length,
          approvedValue: budgetSubmissions
            .filter((budget) => budget.status === 'APPROVED')
            .reduce((sum, budget) => sum + (budget.total_proposed_budget || 0), 0),
        })

        const now = Date.now()
        const pendingWithDays = pending.map(ff3 => ({
          ...ff3,
          section: ff3.section as unknown as { name: string } | null,
          daysWaiting: Math.floor((now - new Date(ff3.created_at).getTime()) / (1000 * 60 * 60 * 24))
        })) as PendingFF3[]
        setPendingFF3s(pendingWithDays)

        setFf3Stats({
          total: allFF3s.length,
          pending: allFF3s.filter(f => !!f.status && ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD'].includes(f.status)).length,
          approved: allFF3s.filter(f => f.status === 'APPROVED').length,
          rejected: allFF3s.filter(f => f.status === 'REJECTED').length
        })

        setFf4Stats({
          total: allFF4s.length,
          pending: (managementSummary?.ff4_awaiting_verification || 0) + (managementSummary?.ff4_awaiting_approval || 0) + (managementSummary?.ff4_processed_awaiting_payment || 0),
          paid: managementSummary?.paid_awaiting_reconciliation || allFF4s.filter(f => f.status === 'PAID').length,
          reconciled: allFF4s.filter(f => f.status === 'RECONCILED').length
        })

      } catch (error) {
        console.error('Error fetching dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [currentYear, selectedFinancialYear])

  const budgetPieData = [
    { name: 'Available', value: budgetSummary.availableBalance },
    { name: 'Outstanding Commitments', value: budgetSummary.outstandingCommitments },
    { name: 'Actual Expenditure', value: budgetSummary.actualExpenditure },
    { name: 'Unreleased Funding', value: budgetSummary.unreleasedFunding },
  ].filter(d => d.value > 0)

  const ff3PieData = [
    { name: 'Approved', value: ff3Stats.approved, color: COLORS.green },
    { name: 'Pending', value: ff3Stats.pending, color: COLORS.gold },
    { name: 'Rejected', value: ff3Stats.rejected, color: COLORS.red },
  ].filter(d => d.value > 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-png-red"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-600 mt-1">Financial Year {selectedFinancialYear} Overview</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <label className="flex items-center gap-2">
            <span className="font-medium text-slate-700">Financial Year</span>
            <select
              value={selectedFinancialYear}
              onChange={(event) => setSelectedFinancialYear(Number(event.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-png-red"
            >
              {availableFinancialYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <div className="hidden sm:flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Last updated: {new Date().toLocaleString('en-GB')}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          title="Approved Budget"
          value={`K ${budgetSummary.approvedBudget.toLocaleString()}`}
          subtitle="Authorised budget lines"
          icon={<Wallet className="h-5 w-5" />}
          tone="maroon"
        />
        <MetricCard
          title="Funded Amount"
          value={`K ${budgetSummary.fundedAmount.toLocaleString()}`}
          subtitle={`${((budgetSummary.fundedAmount / budgetSummary.approvedBudget) * 100 || 0).toFixed(0)}% of approved budget`}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="gold"
        />
        <MetricCard
          title="Released Amount"
          value={`K ${budgetSummary.releasedAmount.toLocaleString()}`}
          subtitle={`${((budgetSummary.releasedAmount / budgetSummary.fundedAmount) * 100 || 0).toFixed(0)}% of funded amount`}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="green"
        />
        <MetricCard
          title="Pending FF3"
          value={`K ${budgetSummary.pendingFF3.toLocaleString()}`}
          subtitle="Awaiting workflow action"
          icon={<Clock className="h-5 w-5" />}
          tone="red"
        />
        <MetricCard
          title="Outstanding Commitments"
          value={`K ${budgetSummary.outstandingCommitments.toLocaleString()}`}
          subtitle="Committed but unpaid"
          icon={<FileText className="h-5 w-5" />}
          tone="red"
        />
        <MetricCard
          title="Actual Expenditure"
          value={`K ${budgetSummary.actualExpenditure.toLocaleString()}`}
          subtitle={`${((budgetSummary.actualExpenditure / budgetSummary.releasedAmount) * 100 || 0).toFixed(1)}% of released amount`}
          icon={<DollarSign className="h-5 w-5" />}
          tone="maroon"
        />
        <MetricCard
          title="Available Balance"
          value={`K ${budgetSummary.availableBalance.toLocaleString()}`}
          subtitle="Released less commitments and actuals"
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="green"
        />
        <MetricCard
          title="Unfunded / Unreleased"
          value={`K ${(budgetSummary.unfundedBudget + budgetSummary.unreleasedFunding).toLocaleString()}`}
          subtitle={`Unfunded K ${budgetSummary.unfundedBudget.toLocaleString()} • Unreleased K ${budgetSummary.unreleasedFunding.toLocaleString()}`}
          icon={<Layers className="h-5 w-5" />}
          tone="gold"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Budget Allocation</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={budgetPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {budgetPieData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `K ${Number(value).toLocaleString()}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Release, Commitment & Expenditure Position</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={quarterlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="quarter" stroke="#64748b" />
                <YAxis stroke="#64748b" tickFormatter={(v) => `K${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(value) => `K ${Number(value).toLocaleString()}`} />
                <Legend />
                <Bar dataKey="released" name="Released" fill={COLORS.maroon} radius={[4, 4, 0, 0]} />
                <Bar dataKey="spent" name="Spent" fill={COLORS.gold} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Calculator className="h-5 w-5 text-png-red" /> Budget Preparation
            </h2>
            <Link href="/dashboard/budget-template" className="text-sm text-png-red hover:text-png-maroon font-medium">Open Grid →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <PlanStat label="Draft" value={budgetPrepStats.draft} tone="slate" />
            <PlanStat label="Submitted" value={budgetPrepStats.submitted} tone="gold" />
            <PlanStat label="Returned" value={budgetPrepStats.returned} tone="gold" />
            <PlanStat label="Reviewed" value={budgetPrepStats.reviewed} tone="slate" />
            <PlanStat label="Approved" value={budgetPrepStats.approved} tone="green" />
          </div>
          <div className="mt-4 p-4 rounded-lg bg-png-red/5 border border-png-gold/30">
            <p className="text-xs font-medium text-png-red/70 uppercase tracking-wide">Total Approved Budget</p>
            <p className="text-2xl font-bold text-png-maroon mt-1">K {budgetPrepStats.approvedValue.toLocaleString()}</p>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Layers className="h-5 w-5 text-png-gold" /> Budget by Cost Centre
            </h2>
            <Link href="/dashboard/budget" className="text-sm text-png-red hover:text-png-maroon font-medium">Budget Control →</Link>
          </div>
          {centreSpend.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={centreSpend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" tickFormatter={(v) => `K${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => `K ${Number(value).toLocaleString()}`} />
                  <Legend />
                  <Bar dataKey="approved" name="Approved" fill={COLORS.maroon} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="available" name="Available" fill={COLORS.gold} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400">
              <Layers className="h-10 w-10 mb-2 text-slate-200" />
              <p className="text-sm">No approved Excel budget yet — approve a Budget Preparation submission to populate cost-centre budgets.</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">FF3 Requisitions</h2>
            <Link href="/dashboard/ff3" className="text-sm text-png-red hover:text-png-maroon">
              View All →
            </Link>
          </div>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="text-center p-3 bg-slate-50 rounded-lg">
              <p className="text-2xl font-bold text-slate-900">{ff3Stats.total}</p>
              <p className="text-xs text-slate-600">Total</p>
            </div>
            <div className="text-center p-3 bg-png-gold/15 rounded-lg">
              <p className="text-2xl font-bold text-png-maroon">{ff3Stats.pending}</p>
              <p className="text-xs text-slate-600">Pending</p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-600">{ff3Stats.approved}</p>
              <p className="text-xs text-slate-600">Approved</p>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <p className="text-2xl font-bold text-red-600">{ff3Stats.rejected}</p>
              <p className="text-xs text-slate-600">Rejected</p>
            </div>
          </div>
          {ff3PieData.length > 0 && (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={ff3PieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={60}
                    dataKey="value"
                  >
                    {ff3PieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">FF4 Expenses</h2>
            <Link href="/dashboard/ff4" className="text-sm text-png-red hover:text-png-maroon">
              View All →
            </Link>
          </div>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="text-center p-3 bg-slate-50 rounded-lg">
              <p className="text-2xl font-bold text-slate-900">{ff4Stats.total}</p>
              <p className="text-xs text-slate-600">Total</p>
            </div>
            <div className="text-center p-3 bg-png-red/10 rounded-lg">
              <p className="text-2xl font-bold text-png-red">{ff4Stats.pending}</p>
              <p className="text-xs text-slate-600">Awaiting action</p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-600">{ff4Stats.paid}</p>
              <p className="text-xs text-slate-600">Paid</p>
            </div>
            <div className="text-center p-3 bg-png-gold/15 rounded-lg">
              <p className="text-2xl font-bold text-png-maroon">{ff4Stats.reconciled}</p>
              <p className="text-xs text-slate-600">Reconciled</p>
            </div>
          </div>
          {centreSpend.length > 0 && (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={centreSpend} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={(v) => `K${(v/1000).toFixed(0)}k`} stroke="#64748b" />
                  <YAxis type="category" dataKey="name" width={100} stroke="#64748b" fontSize={12} />
                  <Tooltip formatter={(value) => `K ${Number(value).toLocaleString()}`} />
                  <Bar dataKey="approved" name="Approved" fill={COLORS.gold} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-slate-200">
          <div className="p-6 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Clock className="h-5 w-5 text-png-gold" />
              FF3 Pending Approvals ({ff3Stats.pending})
            </h2>
          </div>
          {pendingFF3s.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {pendingFF3s.map((ff3) => (
                <PendingItem
                  key={ff3.ff3_number}
                  number={ff3.ff3_number}
                  description={ff3.purpose}
                  amount={`K ${(ff3.total_estimated_amount || 0).toLocaleString()}`}
                  status={ff3.status.replace(/_/g, ' ')}
                  urgency={ff3.urgency_level || 'MEDIUM'}
                  daysWaiting={ff3.daysWaiting || 0}
                />
              ))}
              <div className="p-4 text-center">
                <Link href="/dashboard/ff3" className="text-sm text-png-red hover:text-png-maroon font-medium">
                  View All FF3 Requisitions →
                </Link>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-slate-500">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-200" />
              <p className="text-sm">No pending FF3 approvals</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Available Balance Formula</h2>
          <div className="space-y-3">
            <BalanceLine label="Released Amount" amount={budgetSummary.releasedAmount} />
            <BalanceLine label="Less: Pending FF3" amount={-budgetSummary.pendingFF3} isNegative />
            <BalanceLine label="Less: Outstanding Commitments" amount={-budgetSummary.outstandingCommitments} isNegative />
            <BalanceLine label="Less: Actual Expenditure" amount={-budgetSummary.actualExpenditure} isNegative />
            <div className="border-t border-slate-200 pt-3 mt-3">
              <BalanceLine label="Available Balance" amount={budgetSummary.availableBalance} isTotal />
              <BalanceLine label="Projected After Pending FF3" amount={budgetSummary.projectedAvailableAfterPending} />
            </div>
          </div>

          <div className="mt-6 p-4 bg-slate-50 rounded-lg">
            <h3 className="text-sm font-medium text-slate-700 mb-2">Budget Utilization</h3>
            <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden">
              <div className="flex h-full">
                <div
                  className="bg-png-red h-full"
                  style={{ width: `${(budgetSummary.actualExpenditure / budgetSummary.releasedAmount * 100) || 0}%` }}
                  title="Spent"
                />
                <div
                  className="bg-png-gold h-full"
                  style={{ width: `${(budgetSummary.outstandingCommitments / budgetSummary.releasedAmount * 100) || 0}%` }}
                  title="Committed"
                />
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-slate-600">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-png-red rounded-full"></span>
                Spent: {((budgetSummary.actualExpenditure / budgetSummary.releasedAmount * 100) || 0).toFixed(1)}%
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-png-gold rounded-full"></span>
                Committed: {((budgetSummary.outstandingCommitments / budgetSummary.releasedAmount * 100) || 0).toFixed(1)}%
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-slate-300 rounded-full"></span>
                Available: {((budgetSummary.availableBalance / budgetSummary.releasedAmount * 100) || 0).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
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
    green: "bg-green-100 text-green-700"
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className={`p-2 rounded-lg ${toneClasses[tone]}`}>
          {icon}
        </div>
      </div>
      <h3 className="text-xs font-medium text-slate-600 uppercase">{title}</h3>
      <p className="text-xl font-bold text-slate-900 mt-1">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
    </div>
  )
}

function PlanStat({ label, value, tone }: { label: string; value: number; tone: "slate" | "gold" | "green" }) {
  const toneClasses = {
    slate: "bg-slate-50 text-slate-900",
    gold: "bg-png-gold/15 text-png-maroon",
    green: "bg-green-50 text-green-700",
  }
  return (
    <div className={`text-center p-3 rounded-lg ${toneClasses[tone]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-slate-600 mt-0.5">{label}</p>
    </div>
  )
}

function BalanceLine({ label, amount, isNegative = false, isTotal = false }: {
  label: string
  amount: number
  isNegative?: boolean
  isTotal?: boolean
}) {
  const formatAmount = (num: number) => {
    const absNum = Math.abs(num)
    return `K ${absNum.toLocaleString()}`
  }

  return (
    <div className={`flex items-center justify-between ${isTotal ? 'text-lg font-bold' : ''}`}>
      <span className={isTotal ? 'text-slate-900' : 'text-slate-700'}>{label}</span>
      <span className={`${isTotal ? 'text-green-700' : isNegative ? 'text-red-600' : 'text-slate-900'}`}>
        {formatAmount(amount)}
      </span>
    </div>
  )
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
    URGENT: "bg-red-100 text-red-700"
  }

  return (
    <div className="p-4 hover:bg-slate-50">
      <div className="flex items-start justify-between mb-2">
        <div>
          <Link href={`/dashboard/ff3/${number}`} className="font-semibold text-slate-900 hover:text-png-red">
            {number}
          </Link>
          <p className="text-sm text-slate-600 mt-1 line-clamp-1">{description}</p>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-medium ${urgencyColors[urgency] || urgencyColors.MEDIUM}`}>
          {urgency}
        </span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">{status}</span>
        <div className="flex items-center gap-4">
          <span className="text-png-maroon">{daysWaiting}d waiting</span>
          <span className="font-semibold text-slate-900">{amount}</span>
        </div>
      </div>
    </div>
  )
}
