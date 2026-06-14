"use client"

import { useState, useEffect } from "react"
import { FileText, Download, BarChart3, PieChart, TrendingUp, Loader2, CheckCircle2, AlertCircle, Files } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { generateFF3PDF, generateFF4PDF, downloadPDF, type FF3PDFData, type FF4PDFData } from "@/lib/pdf"
import { exportToCSV, exportToPDF, rowsToPdfTable, type ExportRow } from "@/lib/export"
import jsPDF from "jspdf"

type FF3Record = {
  id: string
  ff3_number: string
  financial_year: number
  request_date: string
  purpose: string
  justification: string
  required_by_date: string | null
  urgency_level: string | null
  procurement_method: string | null
  status: string
  total_estimated_amount: number | null
  is_within_budget: boolean | null
  department: { name: string } | null
  section: { name: string } | null
  province: { name: string } | null
  funding_source: { name: string } | null
}

type FF4Record = {
  id: string
  ff4_number: string
  financial_year: number
  payment_request_date: string
  status: string
  payee_type: string | null
  payee_name: string
  supplier_code: string | null
  invoice_number: string | null
  invoice_date: string | null
  payment_description: string | null
  gross_amount: number
  tax_amount: number
  deductions: number
  net_amount: number
  payment_method: string | null
  external_payment_reference: string | null
  payment_date: string | null
  ff3: { ff3_number: string; purpose: string } | null
  commitment: { commitment_number: string } | null
}

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = useState("")
  const [dateRange, setDateRange] = useState({ start: "2025-01-01", end: "2025-12-31" })
  const [filters, setFilters] = useState({
    department: "",
    section: "",
    status: ""
  })
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 })
  const [exportSuccess, setExportSuccess] = useState("")
  const [exportError, setExportError] = useState("")

  const reportCategories = [
    {
      category: "Planning & Budget Cycle",
      reports: [
        { id: "consolidated-budget", name: "Consolidated Department Budget", description: "Approved budget rolled up by department", icon: BarChart3 },
        { id: "budget-by-cost-centre", name: "Budget by Cost Centre", description: "Approved / committed / actual per cost centre", icon: PieChart },
        { id: "budget-by-code", name: "Budget by Expense Code", description: "Position for each full expense code", icon: BarChart3 },
        { id: "available-balance", name: "Available Balance Report", description: "Remaining balance per expense code", icon: TrendingUp },
        { id: "plans-by-section", name: "Annual Plans by Section", description: "Section activity plans & status", icon: FileText },
        { id: "plans-by-department", name: "Annual Plans by Department", description: "Department plans & planned value", icon: FileText },
      ]
    },
    {
      category: "Budget Reports",
      reports: [
        { id: "budget-vs-actual", name: "Budget vs Commitment vs Actual", description: "Comprehensive budget utilization analysis", icon: BarChart3 },
        { id: "quarterly-utilization", name: "Quarterly Utilization Report", description: "Budget spending by quarter", icon: TrendingUp },
        { id: "supplemental-impact", name: "Supplemental Budget Impact", description: "Analysis of budget revisions", icon: PieChart },
      ]
    },
    {
      category: "FF3 Reports",
      reports: [
        { id: "ff3-status", name: "FF3 Status Report", description: "All requisitions by status", icon: FileText },
        { id: "ff3-bulk-pdf", name: "Bulk FF3 PDF Export", description: "Export multiple FF3s as PDF", icon: Files },
        { id: "ff3-pending", name: "Pending Approvals Report", description: "Requisitions awaiting action", icon: FileText },
        { id: "ff3-turnaround", name: "Approval Turnaround Time", description: "Workflow efficiency metrics", icon: TrendingUp },
        { id: "quotation-analysis", name: "Supplier Quotation Analysis", description: "Comparison of supplier quotes", icon: PieChart },
      ]
    },
    {
      category: "FF4 Reports",
      reports: [
        { id: "ff4-status", name: "FF4 Status Report", description: "All expenses by payment status", icon: FileText },
        { id: "ff4-bulk-pdf", name: "Bulk FF4 PDF Export", description: "Export multiple FF4s as PDF", icon: Files },
        { id: "ff4-reconciliation", name: "Reconciliation Report", description: "Unreconciled payments", icon: FileText },
      ]
    },
    {
      category: "Expenditure Analysis",
      reports: [
        { id: "exp-section", name: "Expenditure by Section", description: "Spending breakdown by section", icon: PieChart },
        { id: "exp-project", name: "Expenditure by Project", description: "Project-wise expenditure", icon: PieChart },
        { id: "exp-province", name: "Expenditure by Province", description: "Provincial spending distribution", icon: PieChart },
        { id: "exp-account", name: "Expenditure by Ledger Account", description: "Account-wise spending", icon: BarChart3 },
      ]
    },
    {
      category: "Audit & Compliance",
      reports: [
        { id: "audit-trail", name: "Audit Trail Report", description: "Complete system activity log", icon: FileText },
        { id: "user-activity", name: "User Activity Report", description: "User actions and transactions", icon: FileText },
      ]
    }
  ]

  // Bulk export FF3 PDFs
  const exportBulkFF3 = async () => {
    setExporting(true)
    setExportError("")
    setExportSuccess("")

    try {
      // Fetch FF3 records
      let query = supabase
        .from('ff3_headers')
        .select(`
          id, ff3_number, financial_year, request_date, purpose, justification,
          required_by_date, urgency_level, procurement_method, status,
          total_estimated_amount, is_within_budget,
          department:departments(name),
          section:sections(name),
          province:provinces(name),
          funding_source:funding_sources(name)
        `)
        .eq('financial_year', 2025)
        .gte('request_date', dateRange.start)
        .lte('request_date', dateRange.end)
        .order('ff3_number')

      if (filters.status) {
        query = query.eq('status', filters.status)
      }

      const { data: ff3Records, error } = await query

      if (error) throw error
      if (!ff3Records || ff3Records.length === 0) {
        setExportError("No FF3 records found for the selected criteria")
        return
      }

      setExportProgress({ current: 0, total: ff3Records.length })

      // Create combined PDF
      const combinedPdf = new jsPDF()
      let isFirstPage = true

      for (let i = 0; i < ff3Records.length; i++) {
        const ff3 = ff3Records[i] as unknown as FF3Record
        setExportProgress({ current: i + 1, total: ff3Records.length })

        // Fetch items and quotations for this FF3
        const [itemsRes, quotsRes] = await Promise.all([
          supabase.from('ff3_items').select('*').eq('ff3_header_id', ff3.id).order('line_number'),
          supabase.from('ff3_quotations').select('*').eq('ff3_header_id', ff3.id)
        ])

        const pdfData: FF3PDFData = {
          ff3_number: ff3.ff3_number,
          financial_year: ff3.financial_year,
          request_date: ff3.request_date,
          status: ff3.status,
          department: ff3.department?.name,
          section: ff3.section?.name,
          province: ff3.province?.name,
          funding_source: ff3.funding_source?.name,
          purpose: ff3.purpose,
          justification: ff3.justification,
          required_by_date: ff3.required_by_date || undefined,
          urgency_level: ff3.urgency_level || undefined,
          procurement_method: ff3.procurement_method || undefined,
          total_estimated_amount: ff3.total_estimated_amount || 0,
          is_within_budget: ff3.is_within_budget || false,
          items: (itemsRes.data || []).map(item => ({
            line_number: item.line_number,
            item_description: item.item_description,
            quantity: item.quantity,
            unit_of_measure: item.unit_of_measure,
            estimated_unit_price: item.estimated_unit_price || 0,
          })),
          quotations: (quotsRes.data || []).map(q => ({
            supplier_name: q.supplier_name,
            quotation_number: q.quotation_number,
            quotation_date: q.quotation_date,
            quotation_amount: q.quotation_amount,
            is_selected: q.is_selected,
          })),
        }

        // Generate individual PDF
        const singlePdf = generateFF3PDF(pdfData)

        // Add to combined PDF
        if (!isFirstPage) {
          combinedPdf.addPage()
        }
        isFirstPage = false

        // Copy content from single PDF to combined
        const pageCount = singlePdf.internal.pages.length - 1
        for (let p = 1; p <= pageCount; p++) {
          if (p > 1) combinedPdf.addPage()
          const pageData = singlePdf.internal.pages[p]
          if (pageData) {
            // Simple text addition for demo - in production would use more sophisticated merging
            combinedPdf.setFontSize(10)
            combinedPdf.text(`${ff3.ff3_number} - Page ${p}`, 20, 20)
          }
        }
      }

      // Download combined PDF
      downloadPDF(combinedPdf, `FF3_Bulk_Export_${new Date().toISOString().split('T')[0]}.pdf`)
      setExportSuccess(`Successfully exported ${ff3Records.length} FF3 records`)

    } catch (err) {
      console.error('Bulk export error:', err)
      setExportError('Failed to export FF3 records')
    } finally {
      setExporting(false)
      setExportProgress({ current: 0, total: 0 })
    }
  }

  // Bulk export FF4 PDFs
  const exportBulkFF4 = async () => {
    setExporting(true)
    setExportError("")
    setExportSuccess("")

    try {
      // Fetch FF4 records
      let query = supabase
        .from('ff4_headers')
        .select(`
          id, ff4_number, financial_year, payment_request_date, status,
          payee_type, payee_name, supplier_code, invoice_number, invoice_date,
          payment_description, gross_amount, tax_amount, deductions, net_amount,
          payment_method, external_payment_reference, payment_date,
          ff3:ff3_headers(ff3_number, purpose),
          commitment:ff3_commitments(commitment_number)
        `)
        .eq('financial_year', 2025)
        .gte('payment_request_date', dateRange.start)
        .lte('payment_request_date', dateRange.end)
        .order('ff4_number')

      if (filters.status) {
        query = query.eq('status', filters.status)
      }

      const { data: ff4Records, error } = await query

      if (error) throw error
      if (!ff4Records || ff4Records.length === 0) {
        setExportError("No FF4 records found for the selected criteria")
        return
      }

      setExportProgress({ current: 0, total: ff4Records.length })

      // Export each FF4 individually (combined approach similar to FF3)
      for (let i = 0; i < ff4Records.length; i++) {
        const ff4 = ff4Records[i] as unknown as FF4Record
        setExportProgress({ current: i + 1, total: ff4Records.length })

        const pdfData: FF4PDFData = {
          ff4_number: ff4.ff4_number,
          financial_year: ff4.financial_year,
          payment_request_date: ff4.payment_request_date,
          status: ff4.status,
          ff3_number: ff4.ff3?.ff3_number,
          ff3_purpose: ff4.ff3?.purpose,
          commitment_number: ff4.commitment?.commitment_number,
          payee_type: ff4.payee_type || undefined,
          payee_name: ff4.payee_name,
          supplier_code: ff4.supplier_code || undefined,
          invoice_number: ff4.invoice_number || undefined,
          invoice_date: ff4.invoice_date || undefined,
          payment_description: ff4.payment_description || undefined,
          gross_amount: ff4.gross_amount,
          tax_amount: ff4.tax_amount,
          deductions: ff4.deductions,
          net_amount: ff4.net_amount,
          payment_method: ff4.payment_method || undefined,
          external_payment_reference: ff4.external_payment_reference || undefined,
          payment_date: ff4.payment_date || undefined,
        }

        const doc = generateFF4PDF(pdfData)
        downloadPDF(doc, `${ff4.ff4_number}.pdf`)

        // Small delay to prevent browser blocking multiple downloads
        await new Promise(resolve => setTimeout(resolve, 300))
      }

      setExportSuccess(`Successfully exported ${ff4Records.length} FF4 records`)

    } catch (err) {
      console.error('Bulk export error:', err)
      setExportError('Failed to export FF4 records')
    } finally {
      setExporting(false)
      setExportProgress({ current: 0, total: 0 })
    }
  }

  const PLANNING_IDS = ['consolidated-budget', 'budget-by-cost-centre', 'budget-by-code', 'available-balance', 'plans-by-section', 'plans-by-department']
  const datasetFor = (id: string): 'ff3' | 'ff4' | 'budget' | 'audit' | 'planning' => {
    if (PLANNING_IDS.includes(id)) return 'planning'
    if (id.startsWith('ff4') || id.startsWith('exp')) return 'ff4'
    if (id.startsWith('ff3') || id === 'quotation-analysis') return 'ff3'
    if (id.startsWith('audit') || id === 'user-activity') return 'audit'
    return 'budget'
  }

  const buildReport = async (id: string): Promise<{ title: string; records: ExportRow[] }> => {
    const ds = datasetFor(id)

    if (ds === 'ff3') {
      let q = supabase
        .from('ff3_headers')
        .select('ff3_number, request_date, status, urgency_level, total_estimated_amount, department:departments(name), section:sections(name)')
        .eq('financial_year', 2025)
        .gte('request_date', dateRange.start)
        .lte('request_date', dateRange.end)
        .order('ff3_number')
      if (id === 'ff3-pending') q = q.in('status', ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD'])
      else if (filters.status) q = q.eq('status', filters.status)
      const { data } = await q
      const rows = (data || []) as unknown as Array<{ ff3_number: string; request_date: string; status: string; urgency_level: string | null; total_estimated_amount: number | null; department: { name: string } | null; section: { name: string } | null }>
      return {
        title: 'FF3 Requisitions Report',
        records: rows.map((r) => ({
          'FF3 Number': r.ff3_number,
          Date: r.request_date,
          Department: r.department?.name || '-',
          Section: r.section?.name || '-',
          Urgency: r.urgency_level || '-',
          Status: r.status,
          'Amount (K)': r.total_estimated_amount || 0,
        })),
      }
    }

    if (ds === 'ff4') {
      let q = supabase
        .from('ff4_headers')
        .select('ff4_number, payment_request_date, payee_name, status, gross_amount, net_amount, payment_date, ff3:ff3_headers(ff3_number)')
        .eq('financial_year', 2025)
        .gte('payment_request_date', dateRange.start)
        .lte('payment_request_date', dateRange.end)
        .order('ff4_number')
      if (id === 'ff4-reconciliation') q = q.neq('status', 'RECONCILED')
      else if (filters.status) q = q.eq('status', filters.status)
      const { data } = await q
      const rows = (data || []) as unknown as Array<{ ff4_number: string; payment_request_date: string; payee_name: string; status: string; gross_amount: number; net_amount: number; payment_date: string | null; ff3: { ff3_number: string } | null }>
      return {
        title: 'FF4 Expenses Report',
        records: rows.map((r) => ({
          'FF4 Number': r.ff4_number,
          Date: r.payment_request_date,
          Payee: r.payee_name,
          'Linked FF3': r.ff3?.ff3_number || '-',
          Status: r.status,
          'Gross (K)': r.gross_amount || 0,
          'Net (K)': r.net_amount || 0,
          'Paid Date': r.payment_date || '-',
        })),
      }
    }

    if (ds === 'audit') {
      const { data } = await supabase
        .from('audit_logs')
        .select('created_at, user_name, action, entity_type, entity_reference, changes')
        .order('created_at', { ascending: false })
        .limit(500)
      const rows = (data || []) as unknown as Array<{ created_at: string; user_name: string | null; action: string; entity_type: string; entity_reference: string | null; changes: Record<string, unknown> | null }>
      return {
        title: 'Audit Trail Report',
        records: rows.map((r) => ({
          Timestamp: new Date(r.created_at).toLocaleString('en-GB'),
          User: r.user_name || 'System',
          Action: r.action,
          Entity: r.entity_type,
          Reference: r.entity_reference || '-',
          Change: r.changes && typeof r.changes === 'object' && 'old_status' in r.changes
            ? `${(r.changes as Record<string, unknown>).old_status} -> ${(r.changes as Record<string, unknown>).new_status}`
            : '',
        })),
      }
    }

    if (ds === 'planning') {
      const fy = new Date(dateRange.start).getFullYear() || 2025
      if (id === 'plans-by-section' || id === 'plans-by-department') {
        const { data } = await supabase
          .from('annual_plan_headers')
          .select('plan_number, plan_title, status, total_planned_budget, department:departments(name), section:sections(name)')
          .eq('financial_year', fy)
          .order('plan_number')
        const rows = (data || []) as unknown as Array<{ plan_number: string; plan_title: string | null; status: string; total_planned_budget: number | null; department: { name: string } | null; section: { name: string } | null }>
        if (id === 'plans-by-department') {
          const map = new Map<string, number>()
          rows.forEach((r) => { const k = r.department?.name || '-'; map.set(k, (map.get(k) || 0) + (r.total_planned_budget || 0)) })
          return { title: 'Annual Plans by Department', records: Array.from(map).map(([dept, total]) => ({ Department: dept, 'Planned (K)': total })) }
        }
        return {
          title: 'Annual Plans by Section',
          records: rows.map((r) => ({ Plan: r.plan_number, Title: r.plan_title || '-', Department: r.department?.name || '-', Section: r.section?.name || '-', Status: r.status, 'Planned (K)': r.total_planned_budget || 0 })),
        }
      }
      // budget views from v_budget_by_code
      const { data } = await supabase.from('v_budget_by_code').select('*').eq('financial_year', fy)
      const vrows = (data || []) as Array<{ department_name: string | null; section_name: string | null; cost_centre_code: string | null; cost_centre_name: string | null; full_expense_code: string | null; revised_budget: number; committed_amount: number; actual_expenditure: number }>
      if (id === 'consolidated-budget') {
        const map = new Map<string, { rev: number; com: number; act: number }>()
        vrows.forEach((r) => { const k = r.department_name || '-'; const e = map.get(k) || { rev: 0, com: 0, act: 0 }; e.rev += r.revised_budget || 0; e.com += r.committed_amount || 0; e.act += r.actual_expenditure || 0; map.set(k, e) })
        return { title: 'Consolidated Department Budget', records: Array.from(map).map(([dept, v]) => ({ Department: dept, 'Approved (K)': v.rev, 'Committed (K)': v.com, 'Actual (K)': v.act, 'Available (K)': v.rev - v.com - v.act })) }
      }
      if (id === 'budget-by-cost-centre') {
        const map = new Map<string, { rev: number; com: number; act: number }>()
        vrows.forEach((r) => { const k = r.cost_centre_code ? `${r.cost_centre_code} — ${r.cost_centre_name}` : (r.section_name || '-'); const e = map.get(k) || { rev: 0, com: 0, act: 0 }; e.rev += r.revised_budget || 0; e.com += r.committed_amount || 0; e.act += r.actual_expenditure || 0; map.set(k, e) })
        return { title: 'Budget by Cost Centre', records: Array.from(map).map(([cc, v]) => ({ 'Cost Centre': cc, 'Approved (K)': v.rev, 'Committed (K)': v.com, 'Actual (K)': v.act, 'Available (K)': v.rev - v.com - v.act })) }
      }
      return {
        title: id === 'available-balance' ? 'Available Balance Report' : 'Budget by Expense Code',
        records: vrows.map((r) => ({
          'Expense Code': r.full_expense_code || '-', Department: r.department_name || '-', 'Cost Centre': r.cost_centre_code || '-',
          'Approved (K)': r.revised_budget || 0, 'Committed (K)': r.committed_amount || 0, 'Actual (K)': r.actual_expenditure || 0,
          'Available (K)': (r.revised_budget || 0) - (r.committed_amount || 0) - (r.actual_expenditure || 0),
        })),
      }
    }

    // budget summary
    const [{ data: alloc }, { data: rel }, { data: com }] = await Promise.all([
      supabase.from('budget_allocations').select('original_budget, supplemental_budget').eq('financial_year', 2025).eq('is_active', true),
      supabase.from('quarterly_releases').select('released_amount').eq('financial_year', 2025),
      supabase.from('ff3_commitments').select('committed_amount, paid_amount, status').eq('financial_year', 2025),
    ])
    const allocRows = (alloc || []) as { original_budget: number; supplemental_budget: number | null }[]
    const released = ((rel || []) as { released_amount: number }[]).reduce((s, r) => s + (r.released_amount || 0), 0)
    const comRows = (com || []) as { committed_amount: number; paid_amount: number; status: string }[]
    const committed = comRows.reduce((s, c) => s + (c.status === 'CANCELLED' ? 0 : (c.committed_amount || 0) - (c.paid_amount || 0)), 0)
    const spent = comRows.reduce((s, c) => s + (c.paid_amount || 0), 0)
    const totalBudget = allocRows.reduce((s, a) => s + (a.original_budget || 0) + (a.supplemental_budget || 0), 0)
    return {
      title: 'Budget Utilisation Report',
      records: [
        { Metric: 'Total Budget', 'Amount (K)': totalBudget },
        { Metric: 'Quarterly Released', 'Amount (K)': released },
        { Metric: 'Active Commitments', 'Amount (K)': committed },
        { Metric: 'Actual Expenditure', 'Amount (K)': spent },
        { Metric: 'Available Balance', 'Amount (K)': released - committed - spent },
      ],
    }
  }

  const runExport = async (format: 'pdf' | 'csv') => {
    setExporting(true)
    setExportError('')
    setExportSuccess('')
    try {
      const { title, records } = await buildReport(selectedReport)
      if (records.length === 0) {
        setExportError('No data found for the selected report and filters.')
        return
      }
      const stamp = new Date().toISOString().split('T')[0]
      const file = `${selectedReport}_${stamp}`
      if (format === 'csv') {
        exportToCSV(file, records)
      } else {
        const { columns, rows } = rowsToPdfTable(records)
        exportToPDF({ title, subtitle: `FY2025 • ${dateRange.start} to ${dateRange.end}`, columns, rows, filename: file })
      }
      setExportSuccess(`Exported ${records.length} row(s) as ${format.toUpperCase()}.`)
    } catch (err) {
      console.error('Export error:', err)
      setExportError('Failed to generate the report.')
    } finally {
      setExporting(false)
    }
  }

  const handleExport = async (format: 'pdf' | 'excel' | 'csv') => {
    if (!selectedReport) return
    if (selectedReport === 'ff3-bulk-pdf') { await exportBulkFF3(); return }
    if (selectedReport === 'ff4-bulk-pdf') { await exportBulkFF4(); return }
    await runExport(format === 'pdf' ? 'pdf' : 'csv')
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
        <p className="text-slate-600 mt-1">Financial Year 2025 - Generate and Export Reports</p>
      </div>

      {/* Messages */}
      {exportError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
          <p className="text-red-700">{exportError}</p>
        </div>
      )}

      {exportSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
          <p className="text-green-700">{exportSuccess}</p>
        </div>
      )}

      {/* Export Progress */}
      {exporting && (
        <div className="bg-png-red/5 border border-png-gold/40 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className="h-5 w-5 text-png-red animate-spin" />
            <p className="text-png-red font-medium">Exporting documents...</p>
          </div>
          <div className="w-full bg-png-gold/30 rounded-full h-2">
            <div
              className="bg-png-red h-2 rounded-full transition-all"
              style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
            />
          </div>
          <p className="text-sm text-png-red mt-1">
            {exportProgress.current} of {exportProgress.total} documents
          </p>
        </div>
      )}

      {/* Report Generator */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Report Generator</h2>

        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Report Type</label>
            <select
              value={selectedReport}
              onChange={(e) => setSelectedReport(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
            >
              <option value="">Select a report...</option>
              {reportCategories.map((cat) => (
                <optgroup key={cat.category} label={cat.category}>
                  {cat.reports.map((report) => (
                    <option key={report.id} value={report.id}>{report.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
            >
              <option value="">All Status</option>
              <option value="DRAFT">Draft</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="PAID">Paid</option>
              <option value="RECONCILED">Reconciled</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Section</label>
            <select
              value={filters.section}
              onChange={(e) => setFilters({ ...filters, section: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-png-red"
            >
              <option value="">All Sections</option>
              <option value="accounts">Accounts Section</option>
              <option value="procurement">Procurement Section</option>
              <option value="payroll">Payroll Section</option>
            </select>
          </div>
        </div>

        {/* Export Buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handleExport('pdf')}
            disabled={!selectedReport || exporting}
            className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {exporting && selectedReport.includes('bulk') ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {selectedReport.includes('bulk') ? 'Export Bulk PDF' : 'Export PDF'}
          </button>
          <button
            onClick={() => handleExport('excel')}
            disabled={!selectedReport || exporting || selectedReport.includes('bulk')}
            className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Export Excel
          </button>
          <button
            onClick={() => handleExport('csv')}
            disabled={!selectedReport || exporting || selectedReport.includes('bulk')}
            className="px-4 py-2 bg-png-red text-white rounded-lg font-medium hover:bg-png-maroon disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Report Categories */}
      {reportCategories.map((category) => (
        <div key={category.category} className="bg-white rounded-lg border border-slate-200">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">{category.category}</h2>
          </div>
          <div className="p-6">
            <div className="grid md:grid-cols-2 gap-4">
              {category.reports.map((report) => {
                const Icon = report.icon
                const isBulk = report.id.includes('bulk')
                return (
                  <div
                    key={report.id}
                    onClick={() => setSelectedReport(report.id)}
                    className={`border rounded-lg p-4 cursor-pointer transition-all ${
                      selectedReport === report.id
                        ? 'border-png-gold bg-png-red/5'
                        : 'border-slate-200 hover:border-png-gold/50 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${
                        selectedReport === report.id
                          ? 'bg-png-red text-white'
                          : isBulk ? 'bg-png-gold/20 text-png-maroon' : 'bg-slate-100 text-slate-600'
                      }`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-medium text-slate-900">{report.name}</h3>
                        <p className="text-sm text-slate-600 mt-1">{report.description}</p>
                        {isBulk && (
                          <span className="inline-block mt-2 px-2 py-0.5 bg-png-gold/20 text-png-maroon text-xs rounded-full">
                            Bulk Export
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ))}

      {/* Recently Generated Reports */}
      <div className="bg-white rounded-lg border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Recently Generated</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {[
            { name: "Budget vs Actual - Q1 2025", date: "2025-04-05", format: "PDF", user: "John Doe" },
            { name: "FF3 Bulk Export - March", date: "2025-04-02", format: "PDF", user: "Admin" },
            { name: "FF3 Pending Approvals - March", date: "2025-04-01", format: "Excel", user: "Jane Smith" },
            { name: "Expenditure by Section - Q1", date: "2025-03-31", format: "PDF", user: "John Doe" },
          ].map((report, idx) => (
            <div key={idx} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-slate-100 rounded-lg">
                  <FileText className="h-5 w-5 text-slate-600" />
                </div>
                <div>
                  <h3 className="font-medium text-slate-900">{report.name}</h3>
                  <p className="text-sm text-slate-600">
                    Generated {new Date(report.date).toLocaleDateString('en-GB')} by {report.user}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-1 rounded font-medium ${
                  report.format === 'PDF' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                }`}>
                  {report.format}
                </span>
                <button className="p-2 hover:bg-slate-100 rounded">
                  <Download className="h-4 w-4 text-slate-600" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
