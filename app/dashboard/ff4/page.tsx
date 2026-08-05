"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Plus, Search, Eye, DollarSign, CheckCircle2, Clock, Download, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/AuthContext"

type FF4Status = "DRAFT" | "SUBMITTED" | "VERIFIED" | "APPROVED" | "PROCESSED" | "PAID" | "RECONCILED" | "CANCELLED"

type FF4Record = {
  id: string
  ff4_number: string
  payment_request_date: string
  payee_name: string
  payment_description: string | null
  gross_amount: number
  net_amount: number
  status: FF4Status
  payment_date: string | null
  external_payment_reference: string | null
  ff3: { ff3_number: string } | null
  commitment: { commitment_number: string } | null
}

export default function FF4ListPage() {
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [searchQuery, setSearchQuery] = useState("")
  const [ff4Records, setFf4Records] = useState<FF4Record[]>([])
  const [stats, setStats] = useState({
    total: 0, draft: 0, pending: 0, verified: 0, paid: 0, reconciled: 0
  })
  const { can } = useAuth()

  const fetchFF4Records = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('ff4_headers')
        .select(`
          id,
          ff4_number,
          payment_request_date,
          payee_name,
          payment_description,
          gross_amount,
          net_amount,
          status,
          payment_date,
          external_payment_reference,
          ff3:ff3_headers(ff3_number),
          commitment:ff3_commitments(commitment_number)
        `)
        .eq('financial_year', 2025)
        .order('created_at', { ascending: false })

      if (statusFilter !== 'ALL') {
        query = query.eq('status', statusFilter)
      }

      const { data, error } = await query

      if (error) throw error

      setFf4Records((data || []) as unknown as FF4Record[])

      // Calculate stats
      const { data: allRecords } = await supabase
        .from('ff4_headers')
        .select('status')
        .eq('financial_year', 2025)

      if (allRecords) {
        setStats({
          total: allRecords.length,
          draft: allRecords.filter(r => r.status === 'DRAFT').length,
          pending: allRecords.filter(r => r.status === 'SUBMITTED').length,
          verified: allRecords.filter(r => r.status === 'VERIFIED').length,
          paid: allRecords.filter(r => r.status === 'PAID').length,
          reconciled: allRecords.filter(r => r.status === 'RECONCILED').length
        })
      }

    } catch (err) {
      console.error('Error fetching FF4 records:', err)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    // Data fetch on mount / filter change is the intended effect here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchFF4Records()
  }, [fetchFF4Records])

  const filteredRecords = ff4Records.filter(record => {
    if (!searchQuery) return true
    const search = searchQuery.toLowerCase()
    return (
      record.ff4_number.toLowerCase().includes(search) ||
      record.payee_name.toLowerCase().includes(search) ||
      record.payment_description?.toLowerCase().includes(search)
    )
  })

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">FF4 Expense Tracking</h1>
          <p className="text-slate-600 mt-1">Finance Form 4 - Expense and Payment Processing</p>
        </div>
        {can('ff4.create') && (
          <Link
            href="/dashboard/ff4/new"
            className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            New FF4 Expense
          </Link>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Draft" value={stats.draft} />
        <StatCard label="Pending" value={stats.pending} />
        <StatCard label="Verified" value={stats.verified} />
        <StatCard label="Paid" value={stats.paid} />
        <StatCard label="Reconciled" value={stats.reconciled} />
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <DollarSign className="h-5 w-5 text-blue-600 mt-0.5" />
          <div>
            <p className="font-medium text-blue-900">FF4 Payment Processing</p>
            <p className="text-sm text-blue-700 mt-1">
              FF4 forms are linked to approved FF3 requisitions and commitments. Payments are processed externally
              and payment references are recorded in this system for reconciliation.
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by FF4 number, payee, or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Status</option>
            <option value="DRAFT">Draft</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="VERIFIED">Verified</option>
            <option value="PAID">Paid</option>
            <option value="RECONCILED">Reconciled</option>
          </select>
          <button className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50 flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {/* FF4 Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-8 w-8 animate-spin text-green-600" />
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-500">
            <DollarSign className="h-12 w-12 mb-2 text-slate-300" />
            <p>No FF4 expense records found</p>
            <Link href="/dashboard/ff4/new" className="mt-2 text-green-600 hover:text-green-700 text-sm font-medium">
              Create your first expense →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    FF4 Number
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Linked FF3
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Payee
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Payment Ref
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/ff4/${record.ff4_number}`}
                        className="font-medium text-green-600 hover:text-green-700"
                      >
                        {record.ff4_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {record.ff3?.ff3_number ? (
                        <Link
                          href={`/dashboard/ff3/${record.ff3.ff3_number}`}
                          className="text-sm text-blue-600 hover:text-blue-700"
                        >
                          {record.ff3.ff3_number}
                        </Link>
                      ) : (
                        <span className="text-sm text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {new Date(record.payment_request_date).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900">
                      {record.payee_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate">
                      {record.payment_description || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">
                      K {(record.net_amount || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={record.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {record.external_payment_reference || "-"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/ff4/${record.ff4_number}`}
                        className="p-2 hover:bg-slate-100 rounded inline-flex"
                        title="View"
                      >
                        <Eye className="h-4 w-4 text-slate-600" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <p className="text-xs font-medium text-slate-600 uppercase mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: FF4Status }) {
  const statusConfig: Record<FF4Status, { label: string; classes: string }> = {
    DRAFT: { label: "Draft", classes: "bg-slate-100 text-slate-700" },
    SUBMITTED: { label: "Submitted", classes: "bg-blue-100 text-blue-700" },
    VERIFIED: { label: "Verified", classes: "bg-blue-100 text-blue-700" },
    APPROVED: { label: "Approved", classes: "bg-green-100 text-green-700" },
    PROCESSED: { label: "Processed", classes: "bg-green-100 text-green-700" },
    PAID: { label: "Paid", classes: "bg-green-100 text-green-700" },
    RECONCILED: { label: "Reconciled", classes: "bg-purple-100 text-purple-700" },
    CANCELLED: { label: "Cancelled", classes: "bg-red-100 text-red-700" },
  }

  const config = statusConfig[status]

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.classes}`}>
      {status === "PAID" && <CheckCircle2 className="h-3.5 w-3.5" />}
      {status === "SUBMITTED" && <Clock className="h-3.5 w-3.5" />}
      {config.label}
    </span>
  )
}
