"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertCircle, CheckCircle2, DollarSign, FileCheck, Loader2, RotateCcw } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { adjustCommitment, getCommitmentTransactions, type CommitmentTransaction } from "@/lib/api"
import { getActiveFinancialYear } from "@/lib/financial-year"
import { useAuth } from "@/contexts/AuthContext"

type Commitment = {
  id: string
  commitment_number: string
  commitment_date: string
  committed_amount: number
  original_committed_amount: number | null
  current_committed_amount: number | null
  paid_amount: number
  outstanding_amount: number | null
  status: string
  ff3: { ff3_number: string; purpose: string | null; section: { name: string } | null; department: { name: string } | null } | null
  budget_allocation: { cost_centre: { code: string | null; name: string | null } | null; expense_code: { full_expense_code: string | null } | null; funding_source: { name: string | null } | null } | null
}

type AdjustmentDraft = {
  action: 'INCREASE' | 'DECREASE' | 'CANCEL' | 'RELEASE_UNUSED_BALANCE'
  amount: string
  reason: string
  reference: string
}

export default function CommitmentsPage() {
  const [activeFinancialYear, setActiveFinancialYear] = useState(new Date().getFullYear())
  const { can } = useAuth()
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<Record<string, CommitmentTransaction[]>>({})
  const [drafts, setDrafts] = useState<Record<string, AdjustmentDraft>>({})

  const fetchCommitments = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error: fetchError } = await supabase
        .from('ff3_commitments')
        .select('id, commitment_number, commitment_date, committed_amount, original_committed_amount, current_committed_amount, paid_amount, outstanding_amount, status, ff3:ff3_headers(ff3_number, purpose, section:sections(name), department:departments(name)), budget_allocation:budget_allocations(cost_centre:cost_centres(code, name), expense_code:expense_code_registry(full_expense_code), funding_source:funding_sources(name))')
        .eq('financial_year', activeFinancialYear)
        .order('commitment_date', { ascending: false })
      if (fetchError) throw fetchError
      setCommitments((data || []) as unknown as Commitment[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commitments')
    } finally {
      setLoading(false)
    }
  }, [activeFinancialYear])

  useEffect(() => {
    getActiveFinancialYear().then(setActiveFinancialYear).catch(() => undefined)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCommitments()
  }, [fetchCommitments])

  async function toggleLedger(commitmentId: string) {
    const next = expandedId === commitmentId ? null : commitmentId
    setExpandedId(next)
    if (next && !transactions[commitmentId]) {
      const rows = await getCommitmentTransactions(commitmentId)
      setTransactions((current) => ({ ...current, [commitmentId]: rows }))
    }
  }

  async function postAdjustment(commitment: Commitment) {
    const draft = drafts[commitment.id]
    if (!draft?.reason.trim()) {
      setError('Reason is required for every commitment movement.')
      return
    }
    if ((draft.action === 'INCREASE' || draft.action === 'DECREASE') && Number(draft.amount || 0) <= 0) {
      setError('Increase and decrease amounts must be greater than zero.')
      return
    }
    setPosting(true)
    setError("")
    setSuccess("")
    try {
      await adjustCommitment({
        commitment_id: commitment.id,
        action: draft.action,
        amount: draft.action === 'CANCEL' || draft.action === 'RELEASE_UNUSED_BALANCE' ? null : Number(draft.amount),
        reason: draft.reason,
        reference: draft.reference || null,
      })
      setSuccess(`Commitment ${commitment.commitment_number} ${draft.action.replace(/_/g, ' ').toLowerCase()} posted to the ledger.`)
      setTransactions((current) => ({ ...current, [commitment.id]: [] }))
      setDrafts((current) => ({ ...current, [commitment.id]: { action: 'DECREASE', amount: '', reason: '', reference: '' } }))
      await fetchCommitments()
      const rows = await getCommitmentTransactions(commitment.id)
      setTransactions((current) => ({ ...current, [commitment.id]: rows }))
      setExpandedId(commitment.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commitment adjustment failed')
    } finally {
      setPosting(false)
    }
  }

  const totals = useMemo(() => commitments.reduce((acc, item) => ({
    original: acc.original + (item.original_committed_amount || item.committed_amount || 0),
    current: acc.current + (item.current_committed_amount || item.committed_amount || 0),
    paid: acc.paid + (item.paid_amount || 0),
    outstanding: acc.outstanding + (item.outstanding_amount ?? ((item.current_committed_amount || item.committed_amount || 0) - (item.paid_amount || 0)))
  }), { original: 0, current: 0, paid: 0, outstanding: 0 }), [commitments])

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Commitment Ledger</h1>
        <p className="text-slate-600 mt-1">Financial Year {activeFinancialYear} — immutable commitment movements from FF3 approvals and controlled adjustments</p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex gap-2"><AlertCircle className="h-4 w-4" />{error}</div>}
      {success && <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700 flex gap-2"><CheckCircle2 className="h-4 w-4" />{success}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <SummaryCard icon={<FileCheck className="h-6 w-6" />} label="Original Commitment" amount={totals.original} />
        <SummaryCard icon={<RotateCcw className="h-6 w-6" />} label="Current Commitment" amount={totals.current} />
        <SummaryCard icon={<CheckCircle2 className="h-6 w-6" />} label="Actual Paid" amount={totals.paid} />
        <SummaryCard icon={<DollarSign className="h-6 w-6" />} label="Outstanding" amount={totals.outstanding} />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Authoritative Formula</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono bg-green-100 text-green-700 px-2 py-1 rounded font-semibold">Available</span>
          <span>=</span>
          <span className="font-mono bg-slate-100 px-2 py-1 rounded">Released</span>
          <span>-</span>
          <span className="font-mono bg-slate-100 px-2 py-1 rounded">Outstanding Commitment</span>
          <span>-</span>
          <span className="font-mono bg-slate-100 px-2 py-1 rounded">Actual Expenditure</span>
        </div>
        <p className="text-sm text-slate-600 mt-3">Every movement below is posted through a server-side database RPC and preserved in <code>commitment_transactions</code>.</p>
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Department / Section</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Cost Centre / Finance Code</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Original</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Current</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Paid</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Outstanding</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Ledger</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {commitments.map((commitment) => {
                  const current = commitment.current_committed_amount || commitment.committed_amount || 0
                  const outstanding = commitment.outstanding_amount ?? (current - (commitment.paid_amount || 0))
                  const draft = drafts[commitment.id] || { action: 'DECREASE', amount: '', reason: '', reference: '' }
                  const canAdjust = can('commitment.adjust') || can('commitment.cancel') || can('commitment.release')
                  return (
                    <FragmentRow
                      key={commitment.id}
                      commitment={commitment}
                      current={current}
                      outstanding={outstanding}
                      expanded={expandedId === commitment.id}
                      transactions={transactions[commitment.id] || []}
                      draft={draft}
                      canAdjust={canAdjust}
                      posting={posting}
                      onToggle={() => toggleLedger(commitment.id)}
                      onDraftChange={(next) => setDrafts((currentDrafts) => ({ ...currentDrafts, [commitment.id]: next }))}
                      onPost={() => postAdjustment(commitment)}
                    />
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

function SummaryCard({ icon, label, amount }: { icon: React.ReactNode; label: string; amount: number }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <div className="p-2 rounded-lg bg-png-red/10 text-png-red w-fit mb-4">{icon}</div>
      <h3 className="text-sm font-medium text-slate-600 mb-1">{label}</h3>
      <p className="text-2xl font-bold text-slate-900">K {(amount || 0).toLocaleString()}</p>
    </div>
  )
}

function FragmentRow(props: {
  commitment: Commitment
  current: number
  outstanding: number
  expanded: boolean
  transactions: CommitmentTransaction[]
  draft: AdjustmentDraft
  canAdjust: boolean
  posting: boolean
  onToggle: () => void
  onDraftChange: (next: AdjustmentDraft) => void
  onPost: () => void
}) {
  const { commitment, current, outstanding, expanded, transactions, draft, canAdjust, posting, onToggle, onDraftChange, onPost } = props
  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3 font-medium text-png-red">{commitment.commitment_number}</td>
        <td className="px-4 py-3">{commitment.ff3?.ff3_number ? <Link href={`/dashboard/ff3/${commitment.ff3.ff3_number}`} className="text-sm text-png-red hover:text-png-maroon">{commitment.ff3.ff3_number}</Link> : <span className="text-sm text-slate-400">-</span>}</td>
        <td className="px-4 py-3 text-sm text-slate-700">{commitment.ff3?.department?.name || '-'}<br /><span className="text-slate-500">{commitment.ff3?.section?.name || '-'}</span></td>
        <td className="px-4 py-3 text-sm text-slate-700">{commitment.budget_allocation?.cost_centre?.code || '-'}<br /><span className="font-mono text-xs">{commitment.budget_allocation?.expense_code?.full_expense_code || '-'}</span></td>
        <td className="px-4 py-3 text-sm text-right">K {(commitment.original_committed_amount || commitment.committed_amount || 0).toLocaleString()}</td>
        <td className="px-4 py-3 text-sm text-right font-medium">K {current.toLocaleString()}</td>
        <td className="px-4 py-3 text-sm text-green-600 text-right font-medium">K {(commitment.paid_amount || 0).toLocaleString()}</td>
        <td className="px-4 py-3 text-sm text-right font-semibold"><span className={outstanding > 0 ? "text-amber-600" : "text-slate-400"}>K {outstanding.toLocaleString()}</span></td>
        <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{commitment.status.replace(/_/g, ' ')}</span></td>
        <td className="px-4 py-3 text-right"><button onClick={onToggle} className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">{expanded ? 'Hide' : 'View'}</button></td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="bg-slate-50 px-6 py-5">
            <div className="grid lg:grid-cols-[1fr_320px] gap-5">
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Reference</th>
                      <th className="px-3 py-2 text-right">Increase</th>
                      <th className="px-3 py-2 text-right">Decrease</th>
                      <th className="px-3 py-2 text-right">Payment</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td className="px-3 py-2">{new Date(tx.transaction_date).toLocaleDateString('en-GB')}</td>
                        <td className="px-3 py-2 font-medium">{tx.transaction_type.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2">{tx.reference || '-'}</td>
                        <td className="px-3 py-2 text-right text-green-700">{['ORIGINAL_COMMITMENT','INCREASE','REVERSAL','ADJUSTMENT'].includes(tx.transaction_type) ? `K ${tx.amount.toLocaleString()}` : '-'}</td>
                        <td className="px-3 py-2 text-right text-red-700">{['DECREASE','RELEASE_UNUSED_BALANCE','CANCELLATION'].includes(tx.transaction_type) ? `K ${tx.amount.toLocaleString()}` : '-'}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{tx.transaction_type === 'PAYMENT_LIQUIDATION' ? `K ${tx.amount.toLocaleString()}` : '-'}</td>
                        <td className="px-3 py-2 text-right font-semibold">K {(tx.new_balance || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                    {transactions.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No ledger rows loaded.</td></tr>}
                  </tbody>
                </table>
              </div>
              {canAdjust && commitment.status !== 'CANCELLED' && (
                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                  <h3 className="font-semibold text-slate-900">Post Ledger Movement</h3>
                  <select value={draft.action} onChange={(event) => onDraftChange({ ...draft, action: event.target.value as AdjustmentDraft['action'] })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option value="INCREASE">Increase</option>
                    <option value="DECREASE">Decrease</option>
                    <option value="RELEASE_UNUSED_BALANCE">Release Unused Balance</option>
                    <option value="CANCEL">Cancel Commitment</option>
                  </select>
                  {['INCREASE','DECREASE'].includes(draft.action) && <input value={draft.amount} onChange={(event) => onDraftChange({ ...draft, amount: event.target.value })} type="number" min="0" placeholder="Amount" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />}
                  <input value={draft.reference} onChange={(event) => onDraftChange({ ...draft, reference: event.target.value })} placeholder="Supporting reference" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  <textarea value={draft.reason} onChange={(event) => onDraftChange({ ...draft, reason: event.target.value })} rows={3} placeholder="Reason / authorization comments" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  <button onClick={onPost} disabled={posting} className="w-full rounded-lg bg-png-red px-3 py-2 text-sm font-semibold text-white hover:bg-png-maroon disabled:opacity-50">Post Controlled Movement</button>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
