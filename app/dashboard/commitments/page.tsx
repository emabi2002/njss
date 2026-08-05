"use client"

import Link from "next/link"
import { FileCheck, DollarSign, CheckCircle2 } from "lucide-react"

export default function CommitmentsPage() {
  const commitments = [
    {
      id: "1",
      commitment_number: "CMT-2025-00001",
      ff3_number: "FF3-2025-00001",
      commitment_date: "2025-02-05",
      purpose: "Staff travel to Lae for National Court registry support",
      committed_amount: 5800,
      paid_amount: 3600,
      remaining_balance: 2200,
      status: "PARTIALLY_PAID",
      section: "Accounts Section",
      account: "5210 - Domestic Travel"
    },
  ]

  const totals = commitments.reduce((acc, item) => ({
    committed_amount: acc.committed_amount + item.committed_amount,
    paid_amount: acc.paid_amount + item.paid_amount,
    remaining_balance: acc.remaining_balance + item.remaining_balance
  }), { committed_amount: 0, paid_amount: 0, remaining_balance: 0 })

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Commitment Ledger</h1>
        <p className="text-slate-600 mt-1">Financial Year 2025 - Active Commitments</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
              <FileCheck className="h-6 w-6" />
            </div>
          </div>
          <h3 className="text-sm font-medium text-slate-600 mb-1">Total Committed</h3>
          <p className="text-2xl font-bold text-slate-900">K {totals.committed_amount.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-green-100 text-green-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
          </div>
          <h3 className="text-sm font-medium text-slate-600 mb-1">Amount Paid</h3>
          <p className="text-2xl font-bold text-slate-900">K {totals.paid_amount.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-amber-100 text-amber-600">
              <DollarSign className="h-6 w-6" />
            </div>
          </div>
          <h3 className="text-sm font-medium text-slate-600 mb-1">Remaining Balance</h3>
          <p className="text-2xl font-bold text-slate-900">K {totals.remaining_balance.toLocaleString()}</p>
        </div>
      </div>

      {/* Formula Info */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Commitment Formula</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono bg-green-100 text-green-700 px-2 py-1 rounded font-semibold">Remaining Balance</span>
          <span>=</span>
          <span className="font-mono bg-slate-100 px-2 py-1 rounded">Commitment Amount</span>
          <span>-</span>
          <span className="font-mono bg-slate-100 px-2 py-1 rounded">Actual Paid</span>
        </div>
        <p className="text-sm text-slate-600 mt-3">
          Commitments are created when FF3 requisitions are approved. Payments via FF4 reduce the remaining balance.
        </p>
      </div>

      {/* Commitments Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Commitment #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Linked FF3</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Purpose</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Committed</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Paid</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Balance</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {commitments.map((commitment) => (
                <tr key={commitment.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-blue-600">{commitment.commitment_number}</td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/ff3/${commitment.ff3_number}`} className="text-sm text-blue-600 hover:text-blue-700">
                      {commitment.ff3_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {new Date(commitment.commitment_date).toLocaleDateString('en-GB')}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900 max-w-xs truncate">{commitment.purpose}</td>
                  <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">K {commitment.committed_amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-green-600 text-right font-medium">K {commitment.paid_amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold">
                    <span className={commitment.remaining_balance > 0 ? "text-amber-600" : "text-slate-400"}>
                      K {commitment.remaining_balance.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                      Partially Paid
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Progress */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Payment Progress</h2>
        {commitments.map((commitment) => {
          const percentage = (commitment.paid_amount / commitment.committed_amount) * 100
          return (
            <div key={commitment.id}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-700">{commitment.commitment_number}</span>
                <span className="text-sm text-slate-600">
                  K {commitment.paid_amount.toLocaleString()} / K {commitment.committed_amount.toLocaleString()}
                </span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-green-600 rounded-full" style={{ width: `${percentage}%` }} />
              </div>
              <p className="text-xs text-slate-500 mt-1">{percentage.toFixed(1)}% paid</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
