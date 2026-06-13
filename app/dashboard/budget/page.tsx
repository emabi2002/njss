"use client"

import { Wallet, TrendingUp, DollarSign, FileText } from "lucide-react"

export default function BudgetControlPage() {
  const budgetAllocations = [
    {
      id: "1",
      account_code: "5210",
      account_name: "Domestic Travel",
      section: "Accounts Section",
      original_budget: 115000,
      supplemental_budget: 10000,
      revised_budget: 125000,
      quarterly_released: 62500,
      committed: 5800,
      actual_expenditure: 3600,
      available_balance: 53100
    },
    {
      id: "2",
      account_code: "5340",
      account_name: "Professional Services",
      section: "Accounts Section",
      original_budget: 70000,
      supplemental_budget: 0,
      revised_budget: 70000,
      quarterly_released: 17500,
      committed: 0,
      actual_expenditure: 0,
      available_balance: 17500
    },
    {
      id: "3",
      account_code: "5320",
      account_name: "IT Equipment",
      section: "Procurement Section",
      original_budget: 150000,
      supplemental_budget: 0,
      revised_budget: 150000,
      quarterly_released: 50000,
      committed: 22500,
      actual_expenditure: 0,
      available_balance: 27500
    },
  ]

  const totals = budgetAllocations.reduce((acc, item) => ({
    original_budget: acc.original_budget + item.original_budget,
    supplemental_budget: acc.supplemental_budget + item.supplemental_budget,
    revised_budget: acc.revised_budget + item.revised_budget,
    quarterly_released: acc.quarterly_released + item.quarterly_released,
    committed: acc.committed + item.committed,
    actual_expenditure: acc.actual_expenditure + item.actual_expenditure,
    available_balance: acc.available_balance + item.available_balance
  }), {
    original_budget: 0,
    supplemental_budget: 0,
    revised_budget: 0,
    quarterly_released: 0,
    committed: 0,
    actual_expenditure: 0,
    available_balance: 0
  })

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Budget Control</h1>
        <p className="text-slate-600 mt-1">Financial Year 2025 - Budget Allocations and Utilization</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <SummaryCard
          title="Total Budget"
          value={totals.revised_budget}
          subtitle={`+K ${totals.supplemental_budget.toLocaleString()} supplemental`}
          icon={<Wallet className="h-6 w-6" />}
          color="blue"
        />
        <SummaryCard
          title="Released (Q1-Q2)"
          value={totals.quarterly_released}
          subtitle={`${((totals.quarterly_released / totals.revised_budget) * 100).toFixed(1)}% of budget`}
          icon={<TrendingUp className="h-6 w-6" />}
          color="green"
        />
        <SummaryCard
          title="Committed"
          value={totals.committed}
          subtitle={`${((totals.committed / totals.quarterly_released) * 100).toFixed(1)}% of released`}
          icon={<FileText className="h-6 w-6" />}
          color="amber"
        />
        <SummaryCard
          title="Available Balance"
          value={totals.available_balance}
          subtitle={`${((totals.available_balance / totals.quarterly_released) * 100).toFixed(1)}% remaining`}
          icon={<DollarSign className="h-6 w-6" />}
          color="purple"
        />
      </div>

      {/* Budget Formula */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Budget Control Formulas</h2>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono bg-slate-100 px-2 py-1 rounded">Revised Budget</span>
            <span>=</span>
            <span className="font-mono bg-slate-100 px-2 py-1 rounded">Original Budget</span>
            <span>+</span>
            <span className="font-mono bg-slate-100 px-2 py-1 rounded">Supplemental Budget</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono bg-green-100 text-green-700 px-2 py-1 rounded font-semibold">Available Balance</span>
            <span>=</span>
            <span className="font-mono bg-slate-100 px-2 py-1 rounded">Quarterly Released</span>
            <span>-</span>
            <span className="font-mono bg-slate-100 px-2 py-1 rounded">Committed</span>
            <span>-</span>
            <span className="font-mono bg-slate-100 px-2 py-1 rounded">Actual Expenditure</span>
          </div>
        </div>
      </div>

      {/* Budget Allocations Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Budget Allocations</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Account</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Section</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Original</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Suppl.</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Revised</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Released</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Committed</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Expended</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Available</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {budgetAllocations.map((allocation) => {
                const utilization = allocation.quarterly_released > 0
                  ? ((allocation.committed + allocation.actual_expenditure) / allocation.quarterly_released) * 100
                  : 0
                return (
                  <tr key={allocation.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{allocation.account_code}</div>
                      <div className="text-sm text-slate-600">{allocation.account_name}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{allocation.section}</td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right">K {allocation.original_budget.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      {allocation.supplemental_budget > 0 ? (
                        <span className="text-green-600">+K {allocation.supplemental_budget.toLocaleString()}</span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">K {allocation.revised_budget.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-blue-600 text-right font-medium">K {allocation.quarterly_released.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-amber-600 text-right">K {allocation.committed.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-purple-600 text-right">K {allocation.actual_expenditure.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold">
                      <span className={allocation.available_balance > 0 ? "text-green-700" : "text-red-600"}>
                        K {allocation.available_balance.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${
                        utilization > 80 ? "bg-red-100 text-red-700" :
                        utilization > 60 ? "bg-amber-100 text-amber-700" :
                        "bg-green-100 text-green-700"
                      }`}>
                        {utilization.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-4 py-3" colSpan={2}>TOTAL</td>
                <td className="px-4 py-3 text-sm text-slate-900 text-right">K {totals.original_budget.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-green-600 text-right">+K {totals.supplemental_budget.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-slate-900 text-right">K {totals.revised_budget.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-blue-600 text-right">K {totals.quarterly_released.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-amber-600 text-right">K {totals.committed.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-purple-600 text-right">K {totals.actual_expenditure.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-green-700 text-right">K {totals.available_balance.toLocaleString()}</td>
                <td className="px-4 py-3"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ title, value, subtitle, icon, color }: {
  title: string
  value: number
  subtitle: string
  icon: React.ReactNode
  color: "blue" | "green" | "amber" | "purple"
}) {
  const colorClasses = {
    blue: "bg-blue-100 text-blue-600",
    green: "bg-green-100 text-green-600",
    amber: "bg-amber-100 text-amber-600",
    purple: "bg-purple-100 text-purple-600"
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>{icon}</div>
      </div>
      <h3 className="text-sm font-medium text-slate-600 mb-1">{title}</h3>
      <p className="text-2xl font-bold text-slate-900 mb-1">K {value.toLocaleString()}</p>
      <p className="text-xs text-slate-500">{subtitle}</p>
    </div>
  )
}
