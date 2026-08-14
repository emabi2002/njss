"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CheckCircle2, DollarSign, FileCheck, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"

type Commitment = {
  id: string
  commitment_number: string
  commitment_date: string
  committed_amount: number
  paid_amount: number
  status: string
  ff3: { ff3_number: string; purpose: string | null; section: { name: string } | null } | null
  budget_allocation: { expense_code: { full_expense_code: string | null } | null } | null
}

export default function CommitmentsPage() {
  const activeFinancialYear = new Date().getFullYear()
  const [loading, setLoading] = useState(true)
  const [commitments, setCommitments] = useState<Commitment[]>([])

  useEffect(() => {
    async function fetchCommitments() {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('ff3_commitments')
          .select('id, commitment_number, commitment_date, committed_amount, paid_amount, status, ff3:ff3_headers(ff3_number, purpose, section:sections(name)), budget_allocation:budget_allocations(expense_code:expense_code_registry(full_expense_code))')
          .eq('financial_year', activeFinancialYear)
          .order('commitment_date', { ascending: false })
        if (error) throw error
        setCommitments((data || []) as unknown as Commitment[])
      } finally {
        setLoading(false)
      }
    }
    fetchCommitments()
  }, [activeFinancialYear])

  const totals = useMemo(() => commitments.reduce((acc, item) => ({
    committed_amount: acc.committed_amount + (item.committed_amount || 0),
    paid_amount: acc.paid_amount + (item.paid_amount || 0),
    remaining_balance: acc.remaining_balance + ((item.committed_amount || 0) - (item.paid_amount || 0))
  }), { committed_amount: 0, paid_amount: 0, remaining_balance: 0 }), [commitments])

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Commitment Ledger</h1>
        <p className="text-slate-600 mt-1">Financial Year {activeFinancialYear} - active commitments created from approved FF3s</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-png-red/10 text-png-red"><FileCheck className="h-6 w-6" /></div>
          </div>
          <h3 className="text-sm font-medium text-slate-600 mb-1">Total Committed</h3>
          <p className="text-2xl font-bold text-slate-900">K {totals.committed_amount.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-green-100 text-green-600"><CheckCircle2 className="h-6 w-6" /></div>
          </div>
          <h3 className="text-sm font-medium text-slate-600 mb-1">Amount Paid</h3>
          <p className="text-2xl font-bold text-slate-900">K {totals.paid_amount.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-png-gold/20 text-png-maroon"><DollarSign className="h-6 w-6" /></div>
          </div>
          <h3 className="text-sm font-medium text-slate-600 mb-1">Remaining Balance</h3>
          <p className="text-2xl font-bold text-slate-900">K {totals.remaining_balance.toLocaleString()}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Commitment Formula</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono bg-green-100 text-green-700 px-2 py-1 rounded font-semibold">Remaining Balance</span>
          <span>=</span>
          <span className="font-mono bg-slate-100 px-2 py-1 rounded">Commitment Amount</span>
          <span>-</span>
          <span className="font-mono bg-slate-100 px-2 py-1 rounded">Actual Paid</span>
        </div>
        <p className="text-sm text-slate-600 mt-3">Commitments are created when FF3 requisitions are approved. Payments via FF4 reduce the remaining balance.</p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {commitments.length === 0 ? (
          <div className="py-16 text-center text-slate-500">No commitments have been created for FY{activeFinancialYear}.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Commitment #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Linked FF3</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Purpose</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Finance Code</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Committed</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Paid</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Balance</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {commitments.map((commitment) => {
                  const remaining = (commitment.committed_amount || 0) - (commitment.paid_amount || 0)
                  return (
                    <tr key={commitment.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-png-red">{commitment.commitment_number}</td>
                      <td className="px-4 py-3">
                        {commitment.ff3?.ff3_number ? (
                          <Link href={`/dashboard/ff3/${commitment.ff3.ff3_number}`} className="text-sm text-png-red hover:text-png-maroon">{commitment.ff3.ff3_number}</Link>
                        ) : <span className="text-sm text-slate-400">-</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{new Date(commitment.commitment_date).toLocaleDateString('en-GB')}</td>
                      <td className="px-4 py-3 text-sm text-slate-900 max-w-xs truncate">{commitment.ff3?.purpose || '-'}</td>
                      <td className="px-4 py-3 text-sm font-mono text-slate-700">{commitment.budget_allocation?.expense_code?.full_expense_code || '-'}</td>
                      <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">K {(commitment.committed_amount || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-green-600 text-right font-medium">K {(commitment.paid_amount || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold"><span className={remaining > 0 ? "text-amber-600" : "text-slate-400"}>K {remaining.toLocaleString()}</span></td>
                      <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{commitment.status.replace(/_/g, ' ')}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
