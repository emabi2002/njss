"use client"

import { useState, useEffect } from "react"
import {
  ClipboardList, Search, Filter, Calendar, User, FileText,
  DollarSign, Clock, ChevronLeft, ChevronRight, Loader2,
  Download, RefreshCw, CheckCircle2, XCircle, Edit, Trash2,
  Eye, Send, CreditCard, AlertCircle, ChevronDown, FileSpreadsheet
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/AuthContext"
import { AccessDenied } from "@/components/AccessDenied"
import { exportToCSV, exportToPDF, rowsToPdfTable, type ExportRow } from "@/lib/export"

type AuditLog = {
  id: string
  user_id: string | null
  user_email: string | null
  user_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  entity_reference: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  changes: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

const ITEMS_PER_PAGE = 20

export default function AuditLogPage() {
  const { can } = useAuth()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  // Filters
  const [filters, setFilters] = useState({
    search: "",
    entityType: "",
    action: "",
    dateFrom: "",
    dateTo: "",
    userId: ""
  })

  useEffect(() => {
    fetchAuditLogs()
  }, [page, filters.entityType, filters.action, filters.dateFrom, filters.dateTo])

  async function fetchAuditLogs() {
    setLoading(true)
    try {
      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE - 1)

      if (filters.entityType) {
        query = query.eq('entity_type', filters.entityType)
      }
      if (filters.action) {
        query = query.eq('action', filters.action)
      }
      if (filters.dateFrom) {
        query = query.gte('created_at', filters.dateFrom)
      }
      if (filters.dateTo) {
        query = query.lte('created_at', filters.dateTo + 'T23:59:59')
      }

      const { data, error, count } = await query

      if (error) throw error

      setLogs(data || [])
      setTotalCount(count || 0)
    } catch (err) {
      console.error('Error fetching audit logs:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    setPage(1)
    fetchAuditLogs()
  }

  const resetFilters = () => {
    setFilters({
      search: "",
      entityType: "",
      action: "",
      dateFrom: "",
      dateTo: "",
      userId: ""
    })
    setPage(1)
  }

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE)

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'CREATE': return <FileText className="h-4 w-4 text-green-600" />
      case 'UPDATE': return <Edit className="h-4 w-4 text-blue-600" />
      case 'DELETE': return <Trash2 className="h-4 w-4 text-red-600" />
      case 'APPROVE': return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'REJECT': return <XCircle className="h-4 w-4 text-red-600" />
      case 'SUBMIT': return <Send className="h-4 w-4 text-blue-600" />
      case 'PAYMENT': return <CreditCard className="h-4 w-4 text-green-600" />
      case 'CANCEL': return <XCircle className="h-4 w-4 text-orange-600" />
      default: return <ClipboardList className="h-4 w-4 text-slate-600" />
    }
  }

  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE': return 'bg-green-100 text-green-700'
      case 'UPDATE': return 'bg-blue-100 text-blue-700'
      case 'DELETE': return 'bg-red-100 text-red-700'
      case 'APPROVE': return 'bg-green-100 text-green-700'
      case 'REJECT': return 'bg-red-100 text-red-700'
      case 'SUBMIT': return 'bg-blue-100 text-blue-700'
      case 'PAYMENT': return 'bg-emerald-100 text-emerald-700'
      case 'CANCEL': return 'bg-orange-100 text-orange-700'
      default: return 'bg-slate-100 text-slate-700'
    }
  }

  const getEntityIcon = (entityType: string) => {
    switch (entityType) {
      case 'FF3': return <FileText className="h-4 w-4 text-blue-600" />
      case 'FF4': return <DollarSign className="h-4 w-4 text-green-600" />
      case 'USER': return <User className="h-4 w-4 text-purple-600" />
      default: return <ClipboardList className="h-4 w-4 text-slate-600" />
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return formatDate(dateStr)
  }

  const buildAuditRows = (): ExportRow[] =>
    logs.map((log) => ({
      Timestamp: formatDate(log.created_at),
      User: log.user_name || 'System',
      Email: log.user_email || '-',
      Action: log.action,
      Entity: log.entity_type,
      Reference: log.entity_reference || '-',
      Change: log.changes && typeof log.changes === 'object' && 'old_status' in log.changes
        ? `${(log.changes as Record<string, unknown>).old_status} -> ${(log.changes as Record<string, unknown>).new_status}`
        : log.changes ? JSON.stringify(log.changes) : '',
    }))

  const handleExport = (format: 'csv' | 'pdf') => {
    setExportMenuOpen(false)
    const rows = buildAuditRows()
    if (rows.length === 0) return
    const stamp = new Date().toISOString().split('T')[0]
    if (format === 'csv') {
      exportToCSV(`audit-log_${stamp}`, rows)
    } else {
      const table = rowsToPdfTable(rows)
      exportToPDF({ title: 'Audit Trail', subtitle: 'CRMS', columns: table.columns, rows: table.rows, filename: `audit-log_${stamp}` })
    }
  }

  if (!can('audit.view')) {
    return <AccessDenied title="Audit Log" />
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ClipboardList className="h-7 w-7 text-slate-700" />
            Audit Log
          </h1>
          <p className="text-slate-600 mt-1">Track all system activities and changes</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAuditLogs}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <div className="relative">
            <button
              onClick={() => setExportMenuOpen((o) => !o)}
              disabled={logs.length === 0}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {exportMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setExportMenuOpen(false)} />
                <div className="absolute right-0 mt-1 w-44 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-40">
                  <button onClick={() => handleExport('csv')} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    <FileSpreadsheet className="h-4 w-4 text-green-600" /> Export CSV
                  </button>
                  <button onClick={() => handleExport('pdf')} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    <FileText className="h-4 w-4 text-red-600" /> Export PDF
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by reference..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Entity Type</label>
            <select
              value={filters.entityType}
              onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Types</option>
              <option value="FF3">FF3 Requisitions</option>
              <option value="FF4">FF4 Expenses</option>
              <option value="USER">Users</option>
              <option value="BUDGET">Budget</option>
              <option value="COMMITMENT">Commitments</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Action</label>
            <select
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Actions</option>
              <option value="CREATE">Create</option>
              <option value="UPDATE">Update</option>
              <option value="DELETE">Delete</option>
              <option value="APPROVE">Approve</option>
              <option value="REJECT">Reject</option>
              <option value="SUBMIT">Submit</option>
              <option value="PAYMENT">Payment</option>
              <option value="CANCEL">Cancel</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">From Date</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">To Date</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-slate-600">
            Showing {logs.length} of {totalCount} records
          </p>
          <button
            onClick={resetFilters}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12">
            <ClipboardList className="h-12 w-12 mx-auto text-slate-300 mb-4" />
            <h3 className="text-lg font-medium text-slate-900">No audit logs found</h3>
            <p className="text-slate-600 mt-1">System activities will appear here.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Timestamp</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">User</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Entity</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Reference</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Changes</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-slate-400" />
                          <div>
                            <p className="text-sm text-slate-900">{getTimeAgo(log.created_at)}</p>
                            <p className="text-xs text-slate-500">{formatDate(log.created_at)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center">
                            <User className="h-4 w-4 text-slate-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900">{log.user_name || 'System'}</p>
                            <p className="text-xs text-slate-500">{log.user_email || '-'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                          {getActionIcon(log.action)}
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full text-xs font-medium">
                          {getEntityIcon(log.entity_type)}
                          {log.entity_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-blue-600">{log.entity_reference || '-'}</p>
                      </td>
                      <td className="px-4 py-3">
                        {log.changes ? (
                          <p className="text-sm text-slate-600">
                            {typeof log.changes === 'object' && 'old_status' in log.changes && 'new_status' in log.changes
                              ? `${log.changes.old_status} → ${log.changes.new_status}`
                              : JSON.stringify(log.changes).slice(0, 50) + '...'
                            }
                          </p>
                        ) : (
                          <span className="text-sm text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="p-2 hover:bg-slate-100 rounded text-slate-600"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {logs.map((log) => (
                <div key={log.id} className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                        {getActionIcon(log.action)}
                        {log.action}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-xs font-medium">
                        {log.entity_type}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">{getTimeAgo(log.created_at)}</span>
                  </div>
                  <p className="text-sm font-medium text-blue-600">{log.entity_reference || '-'}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    By {log.user_name || 'System'} {log.user_email ? `(${log.user_email})` : ''}
                  </p>
                  {log.changes && typeof log.changes === 'object' && 'old_status' in log.changes && (
                    <p className="text-xs text-slate-600 mt-2">
                      Status: {String(log.changes.old_status)} → {String(log.changes.new_status)}
                    </p>
                  )}
                  <button
                    onClick={() => setSelectedLog(log)}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    View Details →
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <span className="text-sm text-slate-600">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Audit Log Details</h3>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="p-2 hover:bg-slate-100 rounded"
                >
                  <XCircle className="h-5 w-5 text-slate-500" />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase">Timestamp</label>
                  <p className="text-sm text-slate-900 mt-1">{formatDate(selectedLog.created_at)}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase">User</label>
                  <p className="text-sm text-slate-900 mt-1">{selectedLog.user_name || 'System'}</p>
                  <p className="text-xs text-slate-500">{selectedLog.user_email || '-'}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase">Action</label>
                  <p className="mt-1">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${getActionColor(selectedLog.action)}`}>
                      {getActionIcon(selectedLog.action)}
                      {selectedLog.action}
                    </span>
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase">Entity</label>
                  <p className="text-sm text-slate-900 mt-1">{selectedLog.entity_type}</p>
                  <p className="text-xs text-blue-600">{selectedLog.entity_reference || '-'}</p>
                </div>
              </div>

              {selectedLog.changes && (
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase">Changes</label>
                  <pre className="mt-1 p-3 bg-slate-50 rounded-lg text-xs text-slate-700 overflow-x-auto">
                    {JSON.stringify(selectedLog.changes, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.old_values && (
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase">Old Values</label>
                  <pre className="mt-1 p-3 bg-red-50 rounded-lg text-xs text-slate-700 overflow-x-auto">
                    {JSON.stringify(selectedLog.old_values, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.new_values && (
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase">New Values</label>
                  <pre className="mt-1 p-3 bg-green-50 rounded-lg text-xs text-slate-700 overflow-x-auto">
                    {JSON.stringify(selectedLog.new_values, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.ip_address && (
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase">IP Address</label>
                  <p className="text-sm text-slate-900 mt-1">{selectedLog.ip_address}</p>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-slate-200 bg-slate-50">
              <button
                onClick={() => setSelectedLog(null)}
                className="w-full px-4 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
