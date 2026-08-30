"use client"

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { BarChart3, FileDown, FileSpreadsheet, Loader2, Play, Printer, TableProperties } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'
import { exportToCSV, exportToExcel, exportToPDF, printRows, rowsToPdfTable, type ExportRow } from '@/lib/export'
import ManagementReportPreview, {
  type ManagementDrilldown,
  type ManagementReportResponse,
} from '@/components/reports/ManagementReportPreview'

const REPORTS = [
  { id: 'management-financial-summary', name: 'Management Financial Summary', description: 'Approved budget, funding, releases, commitments, actual expenditure and available balance.' },
  { id: 'department-financial-position', name: 'Department Financial Position', description: 'Authoritative financial position grouped by Department.' },
  { id: 'section-financial-position', name: 'Section Financial Position', description: 'Authoritative financial position grouped by Section.' },
  { id: 'cost-centre-financial-position', name: 'Cost Centre Financial Position', description: 'Budget and expenditure position grouped by Cost Centre.' },
  { id: 'expense-code-financial-position', name: 'Expense Code Financial Position', description: 'Budget and expenditure position by full Expense / Finance Code.' },
  { id: 'funding-source-financial-position', name: 'Funding Source Financial Position', description: 'Approved, funded, released and spent position by Funding Source.' },
  { id: 'ff3-ff4-transaction-trace', name: 'FF3 to FF4 Transaction Trace', description: 'Trace requisition, commitment, FF4, supplier/payee, payment and reconciliation.' },
] as const

type ExportFormat = 'pdf' | 'excel' | 'csv' | 'print'

type DrillHistory = {
  response: ManagementReportResponse
  selectedReport: string
}

function exportRows(response: ManagementReportResponse): ExportRow[] {
  return response.rows.map((row) => {
    const output: ExportRow = {}
    for (const column of response.columns) {
      const value = row[column.key]
      if (value === undefined || value === null) output[column.label] = ''
      else if (typeof value === 'boolean') output[column.label] = value ? 'Yes' : 'No'
      else if (typeof value === 'number' || typeof value === 'string') output[column.label] = value
      else output[column.label] = String(value)
    }
    return output
  })
}

export default function ManagementReportsPage() {
  const currentYear = new Date().getFullYear()
  const [selectedReport, setSelectedReport] = useState<string>('management-financial-summary')
  const [financialYear, setFinancialYear] = useState(currentYear)
  const [startDate, setStartDate] = useState(`${currentYear}-01-01`)
  const [endDate, setEndDate] = useState(`${currentYear}-12-31`)
  const [status, setStatus] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [response, setResponse] = useState<ManagementReportResponse | null>(null)
  const [history, setHistory] = useState<DrillHistory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const [dirty, setDirty] = useState(false)

  const sections = useMemo(() => {
    const all = response?.lookups.sections || []
    return departmentId ? all.filter((section) => section.department_id === departmentId) : all
  }, [departmentId, response?.lookups.sections])

  const loadReport = async (
    reportId: string,
    extraParams: Record<string, string> = {},
    options: { pushHistory?: boolean; useCurrentResponseFilters?: boolean } = {},
  ) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.set('report', reportId)
      params.set('financialYear', String(financialYear))
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      if (status) params.set('status', status)

      const baseFilters = options.useCurrentResponseFilters && response
        ? response.appliedFilters
        : {
            departmentId: departmentId || null,
            sectionId: sectionId || null,
            costCentreId: null,
            expenseCodeRegistryId: null,
            fundingSourceId: null,
          }

      for (const key of ['departmentId', 'sectionId', 'costCentreId', 'expenseCodeRegistryId', 'fundingSourceId'] as const) {
        const value = extraParams[key] ?? baseFilters[key]
        if (value) params.set(key, value)
      }

      const reportResponse = await authFetch(`/api/reports/management?${params.toString()}`)
      const payload = await reportResponse.json() as ManagementReportResponse & { error?: string }
      if (!reportResponse.ok) throw new Error(payload.error || 'Unable to load management report.')

      if (options.pushHistory && response) {
        setHistory((current) => [...current, { response, selectedReport }])
      }

      setResponse(payload)
      setSelectedReport(reportId)
      if (payload.scope.mode === 'SECTION') {
        setDepartmentId(payload.scope.departmentId || '')
        setSectionId(payload.scope.sectionId || '')
      }
      setDirty(false)
    } catch (loadError) {
      console.error('Management report load failed:', loadError)
      setError(loadError instanceof Error ? loadError.message : 'Unable to load management report.')
    } finally {
      setLoading(false)
    }
  }

  const markChanged = () => {
    setDirty(true)
    setHistory([])
  }

  const runSelectedReport = async () => {
    setHistory([])
    await loadReport(selectedReport)
  }

  const drillDown = async (drilldown: ManagementDrilldown) => {
    await loadReport(drilldown.report, drilldown.params, { pushHistory: true, useCurrentResponseFilters: true })
  }

  const goBack = () => {
    setHistory((current) => {
      const previous = current[current.length - 1]
      if (!previous) return current
      setResponse(previous.response)
      setSelectedReport(previous.selectedReport)
      setDirty(false)
      return current.slice(0, -1)
    })
  }

  const runExport = async (format: ExportFormat) => {
    if (!response || dirty || exporting) return
    const records = exportRows(response)
    if (!records.length) {
      setError('There are no authorised rows to export for this report.')
      return
    }

    setExporting(format)
    setError('')
    try {
      const stamp = new Date().toISOString().split('T')[0]
      const filename = `${response.report}_${response.financialYear}_${stamp}`
      const subtitle = `FY${response.financialYear} • ${response.scope.label}`
      if (format === 'csv') {
        exportToCSV(filename, records)
      } else if (format === 'excel') {
        exportToExcel(filename, records, { title: response.title, subtitle, sheetName: 'Management Report' })
      } else {
        const { columns, rows } = rowsToPdfTable(records)
        if (format === 'print') printRows({ title: response.title, subtitle, columns, rows })
        else exportToPDF({ title: response.title, subtitle, columns, rows, filename })
      }
    } catch (exportError) {
      console.error('Management report export failed:', exportError)
      setError('Unable to export the current authorised report result.')
    } finally {
      setExporting(null)
    }
  }

  const sectionLocked = response?.scope.mode === 'SECTION'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-png-red" />
            <h1 className="text-2xl font-bold text-slate-900">Management Reports & Drill-Down</h1>
          </div>
          <p className="mt-1 text-slate-600">Authoritative financial reporting from Budget through FF3, Commitment, FF4, Payment and Reconciliation.</p>
        </div>
        <Link href="/dashboard/reports" className="text-sm font-medium text-png-red hover:text-png-maroon">
          All Reports →
        </Link>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Management Report</label>
            <select
              value={selectedReport}
              onChange={(event) => { setSelectedReport(event.target.value); markChanged() }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-png-red"
            >
              {REPORTS.map((report) => <option key={report.id} value={report.id}>{report.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-500">{REPORTS.find((report) => report.id === selectedReport)?.description}</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Financial Year</label>
            <input
              type="number"
              min={2000}
              max={2200}
              value={financialYear}
              onChange={(event) => {
                const year = Number(event.target.value)
                setFinancialYear(year)
                setStartDate(`${year}-01-01`)
                setEndDate(`${year}-12-31`)
                markChanged()
              }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-png-red"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
            <select
              value={status}
              onChange={(event) => { setStatus(event.target.value); markChanged() }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-png-red"
            >
              <option value="">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="APPROVED">Approved</option>
              <option value="COMMITTED">Committed</option>
              <option value="VERIFIED">Verified</option>
              <option value="PROCESSED">Processed</option>
              <option value="PAID">Paid</option>
              <option value="RECONCILED">Reconciled</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(event) => { setStartDate(event.target.value); markChanged() }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-png-red"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(event) => { setEndDate(event.target.value); markChanged() }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-png-red"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Department</label>
            <select
              value={departmentId}
              disabled={sectionLocked}
              onChange={(event) => { setDepartmentId(event.target.value); setSectionId(''); markChanged() }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-png-red"
            >
              <option value="">All Departments</option>
              {(response?.lookups.departments || []).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Section</label>
            <select
              value={sectionId}
              disabled={sectionLocked}
              onChange={(event) => { setSectionId(event.target.value); markChanged() }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-png-red"
            >
              <option value="">All Sections</option>
              {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => void runSelectedReport()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-png-red px-4 py-2 text-sm font-semibold text-white hover:bg-png-maroon disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run Report
          </button>

          <div className="h-6 w-px bg-slate-200" />

          <button type="button" onClick={() => void runExport('pdf')} disabled={!response || dirty || !!exporting} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-40">
            {exporting === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} PDF
          </button>
          <button type="button" onClick={() => void runExport('excel')} disabled={!response || dirty || !!exporting} className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 disabled:opacity-40">
            {exporting === 'excel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel
          </button>
          <button type="button" onClick={() => void runExport('csv')} disabled={!response || dirty || !!exporting} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-40">
            {exporting === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <TableProperties className="h-4 w-4" />} CSV
          </button>
          <button type="button" onClick={() => void runExport('print')} disabled={!response || dirty || !!exporting} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-40">
            {exporting === 'print' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Print
          </button>

          {dirty && <span className="text-xs font-medium text-amber-700">Filters changed — run the report before exporting.</span>}
        </div>
      </div>

      {!response && !loading && !error && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Choose the report and filters above, then click <span className="font-semibold text-slate-700">Run Report</span> to load the authorised result.
        </div>
      )}

      <ManagementReportPreview
        response={response}
        loading={loading}
        error={error}
        canGoBack={history.length > 0}
        onBack={goBack}
        onDrillDown={(next) => void drillDown(next)}
      />
    </div>
  )
}
