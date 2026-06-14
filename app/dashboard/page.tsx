"use client"

import { useEffect, useState } from "react"
import { FileText, DollarSign, TrendingUp, Clock, CheckCircle2, Wallet, BarChart3, Calendar, Layers } from "lucide-react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from "recharts"

type BudgetSummary = {
  totalBudget: number
  quarterlyReleased: number
  committedAmount: number
  actualExpenditure: number
  availableBalance: number
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

type PlanStats = { total: number; draft: number; inflight: number; confirmed: number; value: number }

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

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummary>({
    totalBudget: 0,
    quarterlyReleased: 0,
    committedAmount: 0,
    actualExpenditure: 0,
    availableBalance: 0
  })
  const [pendingFF3s, setPendingFF3s] = useState<PendingFF3[]>([])
  const [ff3Stats, setFf3Stats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 })
  const [ff4Stats, setFf4Stats] = useState({ total: 0, pending: 0, paid: 0, reconciled: 0 })
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyData[]>([])
  const [centreSpend, setCentreSpend] = useState<CentreSpend[]>([])
  const [planStats, setPlanStats] = useState<PlanStats>({ total: 0, draft: 0, inflight: 0, confirmed: 0, value: 0 })

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        // Fetch budget allocations
        const { data: allocations } = await supabase
          .from('budget_allocations')
          .select('original_budget, supplemental_budget')
          .eq('financial_year', 2025)
          .eq('is_active', true)

        // Fetch quarterly releases
        const { data: releases } = await supabase
          .from('quarterly_releases')
          .select('quarter, released_amount')
          .eq('financial_year', 2025)
          .order('quarter')

        // Fetch commitments
        const { data: commitments } = await supabase
          .from('ff3_commitments')
          .select('committed_amount, paid_amount')
          .eq('financial_year', 2025)

        // Calculate totals
        const totalBudget = allocations?.reduce((sum, a) => sum + (a.original_budget || 0) + (a.supplemental_budget || 0), 0) || 0
        const quarterlyReleased = releases?.reduce((sum, r) => sum + (r.released_amount || 0), 0) || 0
        const committedAmount = commitments?.reduce((sum, c) => sum + ((c.committed_amount || 0) - (c.paid_amount || 0)), 0) || 0
        const actualExpenditure = commitments?.reduce((sum, c) => sum + (c.paid_amount || 0), 0) || 0
        const availableBalance = quarterlyReleased - committedAmount - actualExpenditure

        setBudgetSummary({
          totalBudget,
          quarterlyReleased,
          committedAmount,
          actualExpenditure,
          availableBalance
        })

        // Set quarterly chart data
        const quarterNames = ['Q1', 'Q2', 'Q3', 'Q4']
        const qData = quarterNames.map((q, i) => {
          const release = releases?.find(r => r.quarter === i + 1)
          return {
            quarter: q,
            released: release?.released_amount || 0,
            spent: i < 2 ? (release?.released_amount || 0) * 0.7 : 0 // Simulated spent data
          }
        })
        setQuarterlyData(qData)

        // Budget by cost centre (from the consolidated v_budget_by_code view)
        const { data: codeRows } = await supabase
          .from('v_budget_by_code')
          .select('cost_centre_code, cost_centre_name, section_name, revised_budget, committed_amount, actual_expenditure')
          .eq('financial_year', 2025)
        const centreMap = new Map<string, { approved: number; used: number }>()
        ;(codeRows || []).forEach((r) => {
          const key = (r.cost_centre_code as string) || (r.section_name as string) || 'Unassigned'
          const e = centreMap.get(key) || { approved: 0, used: 0 }
          e.approved += (r.revised_budget as number) || 0
          e.used += ((r.committed_amount as number) || 0) + ((r.actual_expenditure as number) || 0)
          centreMap.set(key, e)
        })
        setCentreSpend(
          Array.from(centreMap.entries())
            .map(([name, v]) => ({ name, approved: v.approved, available: v.approved - v.used }))
            .sort((a, b) => b.approved - a.approved)
            .slice(0, 6)
        )

        // Annual plan statistics
        const { data: plans } = await supabase
          .from('annual_plan_headers')
          .select('status, total_planned_budget')
          .eq('financial_year', 2025)
        const inflightStatuses = ['SUBMITTED', 'REVIEWED', 'APPROVED_BY_DEPARTMENT', 'AUTHORIZED_BY_REGISTRAR']
        setPlanStats({
          total: plans?.length || 0,
          draft: plans?.filter((p) => p.status === 'DRAFT' || p.status === 'RETURNED_FOR_CORRECTION').length || 0,
          inflight: plans?.filter((p) => inflightStatuses.includes(p.status)).length || 0,
          confirmed: plans?.filter((p) => p.status === 'BUDGET_CONFIRMED').length || 0,
          value: plans?.reduce((s, p) => s + (p.total_planned_budget || 0), 0) || 0,
        })

        // Fetch pending FF3s
        const { data: pending } = await supabase
          .from('ff3_headers')
          .select(`
            ff3_number,
            purpose,
            total_estimated_amount,
            status,
            urgency_level,
            created_at,
            section:sections(name)
          `)
          .in('status', ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD'])
          .order('created_at', { ascending: false })
          .limit(5)

        const now = Date.now()
        const pendingWithDays = (pending || []).map(ff3 => ({
          ...ff3,
          section: ff3.section as unknown as { name: string } | null,
          daysWaiting: Math.floor((now - new Date(ff3.created_at).getTime()) / (1000 * 60 * 60 * 24))
        })) as PendingFF3[]
        setPendingFF3s(pendingWithDays)

        // Fetch FF3 stats
        const { data: allFF3s } = await supabase
          .from('ff3_headers')
          .select('status')
          .eq('financial_year', 2025)

        setFf3Stats({
          total: allFF3s?.length || 0,
          pending: allFF3s?.filter(f => ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD'].includes(f.status)).length || 0,
          approved: allFF3s?.filter(f => f.status === 'APPROVED').length || 0,
          rejected: allFF3s?.filter(f => f.status === 'REJECTED').length || 0
        })

        // Fetch FF4 stats
        const { data: allFF4s } = await supabase
          .from('ff4_headers')
          .select('status')
          .eq('financial_year', 2025)

        setFf4Stats({
          total: allFF4s?.length || 0,
          pending: allFF4s?.filter(f => ['SUBMITTED', 'VERIFIED', 'APPROVED', 'PROCESSED'].includes(f.status)).length || 0,
          paid: allFF4s?.filter(f => f.status === 'PAID').length || 0,
          reconciled: allFF4s?.filter(f => f.status === 'RECONCILED').length || 0
        })

      } catch (error) {
        console.error('Error fetching dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [])

  // Prepare pie chart data
  const budgetPieData = [
    { name: 'Available', value: budgetSummary.availableBalance },
    { name: 'Committed', value: budgetSummary.committedAmount },
    { name: 'Spent', value: budgetSummary.actualExpenditure },
    { name: 'Unreleased', value: budgetSummary.totalBudget - budgetSummary.quarterlyReleased },
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
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-600 mt-1">Financial Year 2025 Overview</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <BarChart3 className="h-4 w-4" />
          Last updated: {new Date().toLocaleString('en-GB')}
        </div>
      </div>

      {/* Budget Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Total Budget"
          value={`K ${budgetSummary.totalBudget.toLocaleString()}`}
          subtitle="Original + Supplemental"
          icon={<Wallet className="h-5 w-5" />}
          tone="maroon"
        />
        <MetricCard
          title="Released"
          value={`K ${budgetSummary.quarterlyReleased.toLocaleString()}`}
          subtitle={`${((budgetSummary.quarterlyReleased / budgetSummary.totalBudget) * 100 || 0).toFixed(0)}% of budget`}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="gold"
        />
        <MetricCard
          title="Committed"
          value={`K ${budgetSummary.committedAmount.toLocaleString()}`}
          subtitle="Active commitments"
          icon={<FileText className="h-5 w-5" />}
          tone="red"
        />
        <MetricCard
          title="Spent"
          value={`K ${budgetSummary.actualExpenditure.toLocaleString()}`}
          subtitle={`${((budgetSummary.actualExpenditure / budgetSummary.quarterlyReleased) * 100 || 0).toFixed(1)}% of released`}
          icon={<DollarSign className="h-5 w-5" />}
          tone="maroon"
        />
        <MetricCard
          title="Available"
          value={`K ${budgetSummary.availableBalance.toLocaleString()}`}
          subtitle="Ready to commit"
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="green"
        />
      </div>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Budget Allocation Pie Chart */}
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

        {/* Quarterly Releases & Spending */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Quarterly Releases & Spending</h2>
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

      {/* Planning Row — Annual Plans + Budget by Cost Centre */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Annual Plans status */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-png-red" /> Annual Plans
            </h2>
            <Link href="/dashboard/plans" className="text-sm text-png-red hover:text-png-maroon font-medium">View All →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <PlanStat label="Total Plans" value={planStats.total} tone="slate" />
            <PlanStat label="Draft / Returned" value={planStats.draft} tone="slate" />
            <PlanStat label="In Workflow" value={planStats.inflight} tone="gold" />
            <PlanStat label="Budget Confirmed" value={planStats.confirmed} tone="green" />
          </div>
          <div className="mt-4 p-4 rounded-lg bg-png-red/5 border border-png-gold/30">
            <p className="text-xs font-medium text-png-red/70 uppercase tracking-wide">Total Planned Value</p>
            <p className="text-2xl font-bold text-png-maroon mt-1">K {planStats.value.toLocaleString()}</p>
          </div>
        </div>

        {/* Budget by Cost Centre */}
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
              <p className="text-sm">No confirmed budget yet — confirm an annual plan to populate cost-centre budgets.</p>
            </div>
          )}
        </div>
      </div>

      {/* FF3 and FF4 Stats */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* FF3 Status Distribution */}
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

        {/* FF4 Status Distribution */}
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
              <p className="text-xs text-slate-600">Processing</p>
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

      {/* Pending Approvals */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* FF3 Pending Approvals */}
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

        {/* Budget Balance Trend */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Available Balance Formula</h2>
          <div className="space-y-3">
            <BalanceLine label="Quarterly Released" amount={budgetSummary.quarterlyReleased} />
            <BalanceLine label="Less: Commitments" amount={-budgetSummary.committedAmount} isNegative />
            <BalanceLine label="Less: Actual Expenditure" amount={-budgetSummary.actualExpenditure} isNegative />
            <div className="border-t border-slate-200 pt-3 mt-3">
              <BalanceLine label="Available Balance" amount={budgetSummary.availableBalance} isTotal />
            </div>
          </div>

          <div className="mt-6 p-4 bg-slate-50 rounded-lg">
            <h3 className="text-sm font-medium text-slate-700 mb-2">Budget Utilization</h3>
            <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden">
              <div className="flex h-full">
                <div
                  className="bg-png-red h-full"
                  style={{ width: `${(budgetSummary.actualExpenditure / budgetSummary.quarterlyReleased * 100) || 0}%` }}
                  title="Spent"
                />
                <div
                  className="bg-png-gold h-full"
                  style={{ width: `${(budgetSummary.committedAmount / budgetSummary.quarterlyReleased * 100) || 0}%` }}
                  title="Committed"
                />
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-slate-600">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-png-red rounded-full"></span>
                Spent: {((budgetSummary.actualExpenditure / budgetSummary.quarterlyReleased * 100) || 0).toFixed(1)}%
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-png-gold rounded-full"></span>
                Committed: {((budgetSummary.committedAmount / budgetSummary.quarterlyReleased * 100) || 0).toFixed(1)}%
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-slate-300 rounded-full"></span>
                Available: {((budgetSummary.availableBalance / budgetSummary.quarterlyReleased * 100) || 0).toFixed(1)}%
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
