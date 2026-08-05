"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Plus, Download, Search, Eye, Edit, CheckCircle2, Clock, XCircle, FileText, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/AuthContext"

type FF3Status = "DRAFT" | "SUBMITTED" | "ENDORSED_SUPERVISOR" | "ENDORSED_SECTION_HEAD" | "APPROVED" | "REJECTED" | "EXPIRED"

type FF3Record = {
  id: string
  ff3_number: string
  request_date: string
  purpose: string
  total_estimated_amount: number
  status: FF3Status
  urgency_level: string
  created_at: string
  section: { name: string } | null
}

export default function FF3ListPage() {
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [searchQuery, setSearchQuery] = useState("")
  const [ff3Records, setFf3Records] = useState<FF3Record[]>([])
  const [stats, setStats] = useState({ total: 0, draft: 0, pending: 0, approved: 0, rejected: 0 })
  const { can } = useAuth()

  const fetchFF3Records = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('ff3_headers')
        .select(`
          id,
          ff3_number,
          request_date,
          purpose,
          total_estimated_amount,
          status,
          urgency_level,
          created_at,
          section:sections(name)
        `)
        .eq('financial_year', 2025)
        .order('created_at', { ascending: false })

      if (statusFilter !== 'ALL') {
        if (statusFilter === 'PENDING') {
          query = query.in('status', ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD'])
        } else {
          query = query.eq('status', statusFilter)
        }
      }

      const { data, error } = await query

      if (error) throw error

      setFf3Records((data || []) as unknown as FF3Record[])

      // Calculate stats from all records
      const { data: allRecords } = await supabase
        .from('ff3_headers')
        .select('status')
        .eq('financial_year', 2025)

      if (allRecords) {
        setStats({
          total: allRecords.length,
          draft: allRecords.filter(r => r.status === 'DRAFT').length,
          pending: allRecords.filter(r => ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD'].includes(r.status)).length,
          approved: allRecords.filter(r => r.status === 'APPROVED').length,
          rejected: allRecords.filter(r => r.status === 'REJECTED').length
        })
      }

    } catch (err) {
      console.error('Error fetching FF3 records:', err)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    // Data fetch on mount / filter change is the intended effect here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchFF3Records()
  }, [fetchFF3Records])

  const filteredRecords = ff3Records.filter(record => {
    if (!searchQuery) return true
    const search = searchQuery.toLowerCase()
    return (
      record.ff3_number.toLowerCase().includes(search) ||
      record.purpose.toLowerCase().includes(search) ||
      record.section?.name.toLowerCase().includes(search)
    )
  })

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">FF3 Requisitions</h1>
          <p className="text-slate-600 mt-1">Finance Form 3 - Requisition and Commitment Requests</p>
        </div>
        {can('ff3.create') && (
          <Link
            href="/dashboard/ff3/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            New FF3 Requisition
          </Link>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Draft" value={stats.draft} />
        <StatCard label="Pending" value={stats.pending} />
        <StatCard label="Approved" value={stats.approved} />
        <StatCard label="Rejected" value={stats.rejected} />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by FF3 number, purpose, or section..."
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
            <option value="PENDING">Pending Approval</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <button className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50 flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {/* FF3 Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-500">
            <FileText className="h-12 w-12 mb-2 text-slate-300" />
            <p>No FF3 requisitions found</p>
            <Link href="/dashboard/ff3/new" className="mt-2 text-blue-600 hover:text-blue-700 text-sm font-medium">
              Create your first requisition →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    FF3 Number
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Purpose
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Section
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Urgency
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
                        href={`/dashboard/ff3/${record.ff3_number}`}
                        className="font-medium text-blue-600 hover:text-blue-700"
                      >
                        {record.ff3_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {new Date(record.request_date).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 max-w-xs truncate">
                      {record.purpose}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {record.section?.name || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">
                      K {(record.total_estimated_amount || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={record.status} />
                    </td>
                    <td className="px-4 py-3">
                      <UrgencyBadge urgency={record.urgency_level || 'MEDIUM'} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/dashboard/ff3/${record.ff3_number}`}
                          className="p-2 hover:bg-slate-100 rounded"
                          title="View"
                        >
                          <Eye className="h-4 w-4 text-slate-600" />
                        </Link>
                        {record.status === "DRAFT" && (
                          <Link
                            href={`/dashboard/ff3/${record.ff3_number}/edit`}
                            className="p-2 hover:bg-slate-100 rounded"
                            title="Edit"
                          >
                            <Edit className="h-4 w-4 text-slate-600" />
                          </Link>
                        )}
                      </div>
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

function StatusBadge({ status }: { status: FF3Status }) {
  const statusConfig: Record<FF3Status, { label: string; icon: typeof FileText; classes: string }> = {
    DRAFT: { label: "Draft", icon: FileText, classes: "bg-slate-100 text-slate-700" },
    SUBMITTED: { label: "Submitted", icon: Clock, classes: "bg-blue-100 text-blue-700" },
    ENDORSED_SUPERVISOR: { label: "Supervisor Endorsed", icon: Clock, classes: "bg-blue-100 text-blue-700" },
    ENDORSED_SECTION_HEAD: { label: "Pending Approval", icon: Clock, classes: "bg-amber-100 text-amber-700" },
    APPROVED: { label: "Approved", icon: CheckCircle2, classes: "bg-green-100 text-green-700" },
    REJECTED: { label: "Rejected", icon: XCircle, classes: "bg-red-100 text-red-700" },
    EXPIRED: { label: "Expired", icon: XCircle, classes: "bg-slate-100 text-slate-700" },
  }

  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.classes}`}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  )
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const urgencyConfig: Record<string, string> = {
    LOW: "bg-slate-100 text-slate-700",
    MEDIUM: "bg-amber-100 text-amber-700",
    HIGH: "bg-orange-100 text-orange-700",
    URGENT: "bg-red-100 text-red-700"
  }

  return (
    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${urgencyConfig[urgency] || urgencyConfig.MEDIUM}`}>
      {urgency}
    </span>
  )
}
