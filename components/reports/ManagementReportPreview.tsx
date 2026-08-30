"use client"

import Link from 'next/link'
import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from 'lucide-react'

export type ManagementDrilldown = {
  report: string
  params: Record<string, string>
}

export type ManagementReportColumn = {
  key: string
  label: string
  kind?: 'text' | 'money' | 'number' | 'date' | 'status'
}

export type ManagementReportScope = {
  mode: 'SYSTEM' | 'SECTION'
  label: string
  departmentId: string | null
  sectionId: string | null
  province: { id: string; name: string } | null
  courtLocation: { id: string; name: string } | null
  department: { id: string; name: string } | null
  section: { id: string; name: string } | null
}

export type ManagementReportRow = Record<string, unknown> & {
  drilldown?: ManagementDrilldown
  ff3Href?: string
  ff4Href?: string
}

export type ManagementReportResponse = {
  report: string
  title: string
  financialYear: number
  scope: ManagementReportScope
  appliedFilters: Record<string, string | null>
  columns: ManagementReportColumn[]
  rows: ManagementReportRow[]
  totals?: Record<string, number>
  lookups: {
    departments: Array<{ id: string; name: string }>
    sections: Array<{ id: string; department_id: string | null; name: string }>
  }
}

function renderValue(value: unknown, kind?: ManagementReportColumn['kind']) {
  if (value === null || value === undefined || value === '') return '—'
  if (kind === 'money') return `K ${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (kind === 'number') return Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })
  if (kind === 'date') {
    const parsed = new Date(String(value))
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString('en-GB')
  }
  return String(value)
}

function StatusValue({ value }: { value: unknown }) {
  const label = value ? String(value).replace(/_/g, ' ') : '—'
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
      {label}
    </span>
  )
}

export default function ManagementReportPreview({
  response,
  loading,
  error,
  canGoBack,
  onBack,
  onDrillDown,
}: {
  response: ManagementReportResponse | null
  loading: boolean
  error?: string
  canGoBack: boolean
  onBack: () => void
  onDrillDown: (drilldown: ManagementDrilldown) => void
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-png-red" />
        <p className="mt-3 text-sm text-slate-600">Loading authorised report data…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    )
  }

  if (!response) return null

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              {canGoBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </button>
              )}
              <h2 className="text-lg font-semibold text-slate-900">{response.title}</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">Financial Year {response.financialYear}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${response.scope.mode === 'SYSTEM' ? 'bg-png-red/10 text-png-red' : 'bg-png-gold/20 text-png-maroon'}`}>
            {response.scope.mode === 'SYSTEM' ? 'System-wide Report' : 'Section Report'}
          </span>
        </div>

        <div className="mt-4 rounded-lg border border-png-gold/30 bg-png-red/5 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-png-red/70">Report Scope</p>
          <p className="mt-1 text-sm font-medium text-slate-900">{response.scope.label}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {response.columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {column.label}
                </th>
              ))}
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {response.rows.length === 0 ? (
              <tr>
                <td colSpan={response.columns.length + 1} className="px-4 py-10 text-center text-slate-500">
                  No authorised records were found for this report and scope.
                </td>
              </tr>
            ) : response.rows.map((row, rowIndex) => (
              <tr key={`${response.report}-${rowIndex}`} className="hover:bg-slate-50/70">
                {response.columns.map((column) => (
                  <td key={column.key} className="whitespace-nowrap px-4 py-3 text-slate-700">
                    {column.kind === 'status'
                      ? <StatusValue value={row[column.key]} />
                      : renderValue(row[column.key], column.kind)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {row.drilldown && (
                      <button
                        type="button"
                        onClick={() => onDrillDown(row.drilldown as ManagementDrilldown)}
                        className="inline-flex items-center gap-1 rounded-md border border-png-gold/50 bg-png-gold/10 px-2.5 py-1.5 text-xs font-medium text-png-maroon hover:bg-png-gold/20"
                      >
                        Drill Down
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {row.ff3Href && (
                      <Link href={String(row.ff3Href)} className="inline-flex items-center gap-1 text-xs font-medium text-png-red hover:text-png-maroon">
                        Open FF3 <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}
                    {row.ff4Href && (
                      <Link href={String(row.ff4Href)} className="inline-flex items-center gap-1 text-xs font-medium text-png-red hover:text-png-maroon">
                        Open FF4 <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">
        {response.rows.length.toLocaleString()} authorised row(s) returned. Drill-down queries remain constrained to the same server-enforced scope.
      </div>
    </div>
  )
}
