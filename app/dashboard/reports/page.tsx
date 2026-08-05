"use client"

import { useState } from "react"
import { FileText, BarChart3, PieChart, TrendingUp, Loader2, CheckCircle2, AlertCircle, Files, Printer, FileSpreadsheet, FileDown } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { generateFF3PDF, generateFF4PDF, downloadPDF, type FF3PDFData, type FF4PDFData } from "@/lib/pdf"
import { exportToCSV, exportToExcel, exportToPDF, printRows, rowsToPdfTable, type ExportRow } from "@/lib/export"
import type jsPDF from "jspdf"

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

type ExportFormat = "pdf" | "excel" | "csv" | "print"

const round1 = (n: number) => Math.round(n * 10) / 10
const quarterOf = (d: string | null) => (d ? Math.floor(new Date(d).getMonth() / 3) + 1 : 1)
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "-")

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = useState("")
  const [dateRange, setDateRange] = useState({ start: "2025-01-01", end: "2025-12-31" })
  const [filters, setFilters] = useState({
    department: "",
    section: "",
    status: ""
  })
  const [exporting, setExporting] = useState(false)
  const [activeAction, setActiveAction] = useState<string>("")
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 })
  const [exportSuccess, setExportSuccess] = useState("")
  const [exportError, setExportError] = useState("")

  const fyOf = () => new Date(dateRange.start).getFullYear() || 2025
  // The financial_year column is the authoritative scope. The calendar range is
  // an optional refinement: when left at the full default year we don't apply a
  // date filter (so all rows for the FY are returned regardless of seed dates).
  const isFullYearRange = () => {
    const fy = fyOf()
    return dateRange.start === `${fy}-01-01` && dateRange.end === `${fy}-12-31`
  }

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
        { id: "ff3-bulk-pdf", name: "Bulk FF3 PDF Export", description: "Export multiple FF3s as one PDF", icon: Files },
        { id: "ff3-pending", name: "Pending Approvals Report", description: "Requisitions awaiting action", icon: FileText },
        { id: "ff3-turnaround", name: "Approval Turnaround Time", description: "Workflow efficiency metrics", icon: TrendingUp },
        { id: "quotation-analysis", name: "Supplier Quotation Analysis", description: "Comparison of supplier quotes", icon: PieChart },
      ]
    },
    {
      category: "FF4 Reports",
      reports: [
        { id: "ff4-status", name: "FF4 Status Report", description: "All expenses by payment status", icon: FileText },
        { id: "ff4-bulk-pdf", name: "Bulk FF4 PDF Export", description: "Export multiple FF4s as one PDF", icon: Files },
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

  // Bulk export FF3s into a single combined PDF
  const exportBulkFF3 = async () => {
    setExporting(true)
    setExportError("")
    setExportSuccess("")

    try {
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
        .eq('financial_year', fyOf())
        .order('ff3_number')

      if (!isFullYearRange()) query = query.gte('request_date', dateRange.start).lte('request_date', dateRange.end)
      if (filters.status) query = query.eq('status', filters.status)

      const { data: ff3Records, error } = await query
      if (error) throw error
      if (!ff3Records || ff3Records.length === 0) {
        setExportError("No FF3 records found for the selected criteria")
        return
      }

      setExportProgress({ current: 0, total: ff3Records.length })

      let combined: jsPDF | undefined
      for (let i = 0; i < ff3Records.length; i++) {
        const ff3 = ff3Records[i] as unknown as FF3Record
        setExportProgress({ current: i + 1, total: ff3Records.length })

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

        combined = generateFF3PDF(pdfData, combined)
      }

      if (combined) {
        downloadPDF(combined, `FF3_Bulk_Export_${new Date().toISOString().split('T')[0]}.pdf`)
        setExportSuccess(`Successfully exported ${ff3Records.length} FF3 record(s) into one PDF`)
      }
    } catch (err) {
      console.error('Bulk export error:', err)
      setExportError('Failed to export FF3 records')
    } finally {
      setExporting(false)
      setExportProgress({ current: 0, total: 0 })
    }
  }

  // Bulk export FF4s into a single combined PDF
  const exportBulkFF4 = async () => {
    setExporting(true)
    setExportError("")
    setExportSuccess("")

    try {
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
        .eq('financial_year', fyOf())
        .order('ff4_number')

      if (!isFullYearRange()) query = query.gte('payment_request_date', dateRange.start).lte('payment_request_date', dateRange.end)
      if (filters.status) query = query.eq('status', filters.status)

      const { data: ff4Records, error } = await query
      if (error) throw error
      if (!ff4Records || ff4Records.length === 0) {
        setExportError("No FF4 records found for the selected criteria")
        return
      }

      setExportProgress({ current: 0, total: ff4Records.length })

      let combined: jsPDF | undefined
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

        combined = generateFF4PDF(pdfData, combined)
      }

      if (combined) {
        downloadPDF(combined, `FF4_Bulk_Export_${new Date().toISOString().split('T')[0]}.pdf`)
        setExportSuccess(`Successfully exported ${ff4Records.length} FF4 record(s) into one PDF`)
      }
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
    if (id.startsWith('ff4')) return 'ff4'
    if (id.startsWith('ff3')) return 'ff3'
    if (id.startsWith('audit')) return 'audit'
    return 'budget'
  }

  // Build a titled, tabular dataset for any report id.
  const buildReport = async (id: string): Promise<{ title: string; records: ExportRow[] }> => {
    const fy = fyOf()

    // ---------- Budget analytics ----------
    if (id === 'budget-vs-actual') {
      const { data } = await supabase.from('v_budget_by_code').select('*').eq('financial_year', fy)
      const vrows = (data || []) as Array<{ department_name: string | null; revised_budget: number; committed_amount: number; actual_expenditure: number }>
      const map = new Map<string, { rev: number; com: number; act: number }>()
      vrows.forEach((r) => { const k = r.department_name || '-'; const e = map.get(k) || { rev: 0, com: 0, act: 0 }; e.rev += r.revised_budget || 0; e.com += r.committed_amount || 0; e.act += r.actual_expenditure || 0; map.set(k, e) })
      return {
        title: 'Budget vs Commitment vs Actual',
        records: Array.from(map).map(([dept, v]) => ({
          Department: dept, 'Approved (K)': v.rev, 'Committed (K)': v.com, 'Actual (K)': v.act,
          'Available (K)': v.rev - v.com - v.act, 'Utilisation %': v.rev ? round1(((v.com + v.act) / v.rev) * 100) : 0,
        })),
      }
    }

    if (id === 'quarterly-utilization') {
      const [{ data: qr }, { data: ff4q }, { data: comq }] = await Promise.all([
        supabase.from('quarterly_releases').select('quarter, released_amount').eq('financial_year', fy),
        supabase.from('ff4_headers').select('payment_request_date, net_amount').eq('financial_year', fy),
        supabase.from('ff3_commitments').select('commitment_date, committed_amount, status').eq('financial_year', fy),
      ])
      const q: Record<number, { rel: number; com: number; spent: number }> = { 1: { rel: 0, com: 0, spent: 0 }, 2: { rel: 0, com: 0, spent: 0 }, 3: { rel: 0, com: 0, spent: 0 }, 4: { rel: 0, com: 0, spent: 0 } }
      ;((qr || []) as Array<{ quarter: number; released_amount: number }>).forEach((r) => { if (q[r.quarter]) q[r.quarter].rel += r.released_amount || 0 })
      ;((ff4q || []) as Array<{ payment_request_date: string; net_amount: number }>).forEach((r) => { const n = quarterOf(r.payment_request_date); if (q[n]) q[n].spent += r.net_amount || 0 })
      ;((comq || []) as Array<{ commitment_date: string; committed_amount: number; status: string }>).forEach((r) => { if (r.status !== 'CANCELLED') { const n = quarterOf(r.commitment_date); if (q[n]) q[n].com += r.committed_amount || 0 } })
      return {
        title: 'Quarterly Utilization Report',
        records: [1, 2, 3, 4].map((n) => ({
          Quarter: `Q${n}`, 'Released (K)': q[n].rel, 'Committed (K)': q[n].com, 'Spent (K)': q[n].spent,
          'Utilisation %': q[n].rel ? round1((q[n].spent / q[n].rel) * 100) : 0,
        })),
      }
    }

    if (id === 'supplemental-impact') {
      const { data } = await supabase
        .from('budget_allocations')
        .select('original_budget, supplemental_budget, revised_budget, department:departments(name)')
        .eq('financial_year', fy).eq('is_active', true)
      const rows = (data || []) as unknown as Array<{ original_budget: number; supplemental_budget: number | null; revised_budget: number | null; department: { name: string } | null }>
      const map = new Map<string, { orig: number; supp: number; rev: number }>()
      rows.forEach((r) => {
        const k = r.department?.name || '-'
        const e = map.get(k) || { orig: 0, supp: 0, rev: 0 }
        e.orig += r.original_budget || 0; e.supp += r.supplemental_budget || 0
        e.rev += r.revised_budget || ((r.original_budget || 0) + (r.supplemental_budget || 0)); map.set(k, e)
      })
      return {
        title: 'Supplemental Budget Impact',
        records: Array.from(map).map(([dept, v]) => ({
          Department: dept, 'Original (K)': v.orig, 'Supplemental (K)': v.supp, 'Revised (K)': v.rev,
          'Impact %': v.orig ? round1((v.supp / v.orig) * 100) : 0,
        })),
      }
    }

    // ---------- FF3 analytics ----------
    if (id === 'ff3-turnaround') {
      let q = supabase
        .from('ff3_headers')
        .select('ff3_number, status, created_at, updated_at, request_date, total_estimated_amount')
        .eq('financial_year', fy).order('ff3_number')
      if (!isFullYearRange()) q = q.gte('request_date', dateRange.start).lte('request_date', dateRange.end)
      if (filters.status) q = q.eq('status', filters.status)
      const { data } = await q
      const rows = (data || []) as unknown as Array<{ ff3_number: string; status: string; created_at: string; updated_at: string; total_estimated_amount: number | null }>
      return {
        title: 'Approval Turnaround Time',
        records: rows.map((r) => ({
          'FF3 Number': r.ff3_number, Status: r.status, Created: fmtDate(r.created_at), 'Last Action': fmtDate(r.updated_at),
          'Turnaround (days)': round1(Math.max(0, (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()) / 86400000)),
          'Amount (K)': r.total_estimated_amount || 0,
        })),
      }
    }

    if (id === 'quotation-analysis') {
      const { data } = await supabase
        .from('ff3_quotations')
        .select('quotation_amount, is_selected, supplier_name, ff3:ff3_headers(ff3_number)')
      const rows = (data || []) as unknown as Array<{ quotation_amount: number; is_selected: boolean; supplier_name: string; ff3: { ff3_number: string } | null }>
      const map = new Map<string, { count: number; min: number; max: number; selected: number; supplier: string }>()
      rows.forEach((r) => {
        const k = r.ff3?.ff3_number || '-'
        const e = map.get(k) || { count: 0, min: Infinity, max: 0, selected: 0, supplier: '-' }
        e.count += 1; e.min = Math.min(e.min, r.quotation_amount); e.max = Math.max(e.max, r.quotation_amount)
        if (r.is_selected) { e.selected = r.quotation_amount; e.supplier = r.supplier_name }
        map.set(k, e)
      })
      return {
        title: 'Supplier Quotation Analysis',
        records: Array.from(map).map(([ff3, v]) => {
          const base = v.selected || (v.min === Infinity ? 0 : v.min)
          return {
            'FF3 Number': ff3, Quotes: v.count, 'Lowest (K)': v.min === Infinity ? 0 : v.min, 'Highest (K)': v.max,
            'Selected (K)': v.selected, 'Selected Supplier': v.supplier, 'Savings vs Highest (K)': Math.max(0, v.max - base),
          }
        }),
      }
    }

    // ---------- Expenditure analysis ----------
    if (id === 'exp-account') {
      const { data } = await supabase.from('v_budget_by_code').select('full_expense_code, department_name, committed_amount, actual_expenditure').eq('financial_year', fy)
      const rows = (data || []) as Array<{ full_expense_code: string | null; department_name: string | null; committed_amount: number; actual_expenditure: number }>
      return {
        title: 'Expenditure by Ledger Account',
        records: rows.map((r) => ({
          Account: r.full_expense_code || '-', Department: r.department_name || '-',
          'Committed (K)': r.committed_amount || 0, 'Actual (K)': r.actual_expenditure || 0,
        })),
      }
    }

    if (id === 'exp-section' || id === 'exp-project' || id === 'exp-province') {
      let q = supabase
        .from('ff4_headers')
        .select('net_amount, status, payment_request_date, ff3:ff3_headers(section:sections(name), province:provinces(name), project:projects(name))')
        .eq('financial_year', fy)
      if (!isFullYearRange()) q = q.gte('payment_request_date', dateRange.start).lte('payment_request_date', dateRange.end)
      const { data } = await q
      const rows = (data || []) as unknown as Array<{ net_amount: number; ff3: { section: { name: string } | null; province: { name: string } | null; project: { name: string } | null } | null }>
      const keyOf = (r: typeof rows[number]) => {
        if (id === 'exp-section') return r.ff3?.section?.name || 'Unspecified'
        if (id === 'exp-province') return r.ff3?.province?.name || 'Unspecified'
        return r.ff3?.project?.name || 'Unspecified'
      }
      const label = id === 'exp-section' ? 'Section' : id === 'exp-province' ? 'Province' : 'Project'
      const map = new Map<string, { amount: number; count: number }>()
      let total = 0
      rows.forEach((r) => { const k = keyOf(r); const e = map.get(k) || { amount: 0, count: 0 }; e.amount += r.net_amount || 0; e.count += 1; total += r.net_amount || 0; map.set(k, e) })
      return {
        title: `Expenditure by ${label}`,
        records: Array.from(map).map(([k, v]) => ({
          [label]: k, Payments: v.count, 'Expenditure (K)': v.amount, 'Share %': total ? round1((v.amount / total) * 100) : 0,
        })),
      }
    }

    // ---------- User activity ----------
    if (id === 'user-activity') {
      const { data } = await supabase.from('audit_logs').select('user_name, action, created_at').order('created_at', { ascending: false }).limit(1000)
      const rows = (data || []) as Array<{ user_name: string | null; action: string; created_at: string }>
      const map = new Map<string, { total: number; creates: number; updates: number; last: string }>()
      rows.forEach((r) => {
        const u = r.user_name || 'System'
        const e = map.get(u) || { total: 0, creates: 0, updates: 0, last: r.created_at }
        e.total += 1
        if (r.action === 'CREATE') e.creates += 1
        else e.updates += 1
        if (new Date(r.created_at) > new Date(e.last)) e.last = r.created_at
        map.set(u, e)
      })
      return {
        title: 'User Activity Report',
        records: Array.from(map).map(([user, v]) => ({
          User: user, 'Total Actions': v.total, Creates: v.creates, 'Other Actions': v.updates,
          'Last Activity': new Date(v.last).toLocaleString('en-GB'),
        })),
      }
    }

    const ds = datasetFor(id)

    if (ds === 'ff3') {
      let q = supabase
        .from('ff3_headers')
        .select('ff3_number, request_date, status, urgency_level, total_estimated_amount, department:departments(name), section:sections(name)')
        .eq('financial_year', fy)
        .order('ff3_number')
      if (!isFullYearRange()) q = q.gte('request_date', dateRange.start).lte('request_date', dateRange.end)
      if (id === 'ff3-pending') q = q.in('status', ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD'])
      else if (filters.status) q = q.eq('status', filters.status)
      const { data } = await q
      const rows = (data || []) as unknown as Array<{ ff3_number: string; request_date: string; status: string; urgency_level: string | null; total_estimated_amount: number | null; department: { name: string } | null; section: { name: string } | null }>
      return {
        title: id === 'ff3-pending' ? 'FF3 Pending Approvals' : 'FF3 Requisitions Report',
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
        .eq('financial_year', fy)
        .order('ff4_number')
      if (!isFullYearRange()) q = q.gte('payment_request_date', dateRange.start).lte('payment_request_date', dateRange.end)
      if (id === 'ff4-reconciliation') q = q.neq('status', 'RECONCILED')
      else if (filters.status) q = q.eq('status', filters.status)
      const { data } = await q
      const rows = (data || []) as unknown as Array<{ ff4_number: string; payment_request_date: string; payee_name: string; status: string; gross_amount: number; net_amount: number; payment_date: string | null; ff3: { ff3_number: string } | null }>
      return {
        title: id === 'ff4-reconciliation' ? 'FF4 Reconciliation Report' : 'FF4 Expenses Report',
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
      const isAvail = id === 'available-balance'
      const mapped = vrows.map((r) => ({
        'Expense Code': r.full_expense_code || '-', Department: r.department_name || '-', 'Cost Centre': r.cost_centre_code || '-',
        'Approved (K)': r.revised_budget || 0, 'Committed (K)': r.committed_amount || 0, 'Actual (K)': r.actual_expenditure || 0,
        'Available (K)': (r.revised_budget || 0) - (r.committed_amount || 0) - (r.actual_expenditure || 0),
      }))
      if (isAvail) mapped.sort((a, b) => (a['Available (K)'] as number) - (b['Available (K)'] as number))
      return { title: isAvail ? 'Available Balance Report' : 'Budget by Expense Code', records: mapped }
    }

    // ---------- Budget utilisation summary (fallback) ----------
    const [{ data: alloc }, { data: rel }, { data: com }] = await Promise.all([
      supabase.from('budget_allocations').select('original_budget, supplemental_budget').eq('financial_year', fy).eq('is_active', true),
      supabase.from('quarterly_releases').select('released_amount').eq('financial_year', fy),
      supabase.from('ff3_commitments').select('committed_amount, paid_amount, status').eq('financial_year', fy),
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

  // Single entry point: generate any report id in any format.
  const runReport = async (id: string, format: ExportFormat) => {
    if (!id || exporting) return

    // Bulk multi-document PDFs
    if (format === 'pdf' && id === 'ff3-bulk-pdf') { setActiveAction(`${id}:${format}`); await exportBulkFF3(); setActiveAction(""); return }
    if (format === 'pdf' && id === 'ff4-bulk-pdf') { setActiveAction(`${id}:${format}`); await exportBulkFF4(); setActiveAction(""); return }

    setExporting(true)
    setActiveAction(`${id}:${format}`)
    setExportError('')
    setExportSuccess('')
    try {
      const { title, records } = await buildReport(id)
      if (records.length === 0) {
        setExportError('No data found for the selected report and filters.')
        return
      }
      const stamp = new Date().toISOString().split('T')[0]
      const file = `${id}_${stamp}`
      const subtitle = `FY${fyOf()} • ${dateRange.start} to ${dateRange.end}`
      if (format === 'csv') {
        exportToCSV(file, records)
        setExportSuccess(`Exported ${records.length} row(s) as CSV.`)
      } else if (format === 'excel') {
        exportToExcel(file, records, { title, subtitle, sheetName: id })
        setExportSuccess(`Exported ${records.length} row(s) as Excel.`)
      } else if (format === 'print') {
        const { columns, rows } = rowsToPdfTable(records)
        printRows({ title, subtitle, columns, rows })
        setExportSuccess(`Print dialog opened for "${title}". If it doesn't appear, the in-app preview may block printing — open the app in a new browser tab, or use PDF.`)
      } else {
        const { columns, rows } = rowsToPdfTable(records)
        exportToPDF({ title, subtitle, columns, rows, filename: file })
        setExportSuccess(`Exported ${records.length} row(s) as PDF.`)
      }
    } catch (err) {
      console.error('Export error:', err)
      setExportError('Failed to generate the report.')
    } finally {
      setExporting(false)
      setActiveAction("")
    }
  }

  // Compact action buttons rendered on every report card and the top generator.
  // Plain render helper (not a component) so it can read closure state safely.
  const renderActions = (id: string, size: "sm" | "lg" = "sm") => {
    const isBulk = id.includes('bulk')
    const busy = (fmt: ExportFormat) => exporting && activeAction === `${id}:${fmt}`
    const base = size === "lg"
      ? "px-4 py-2 text-sm rounded-lg font-medium"
      : "px-2.5 py-1 text-xs rounded-md font-medium"
    const icon = size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"
    return (
      <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => runReport(id, 'pdf')}
          disabled={exporting}
          className={`${base} inline-flex items-center gap-1.5 border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
        >
          {busy('pdf') ? <Loader2 className={`${icon} animate-spin`} /> : <FileDown className={icon} />}
          {isBulk ? 'Bulk PDF' : 'PDF'}
        </button>
        <button
          onClick={() => runReport(id, 'excel')}
          disabled={exporting}
          className={`${base} inline-flex items-center gap-1.5 border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
        >
          {busy('excel') ? <Loader2 className={`${icon} animate-spin`} /> : <FileSpreadsheet className={icon} />}
          Excel
        </button>
        <button
          onClick={() => runReport(id, 'print')}
          disabled={exporting}
          className={`${base} inline-flex items-center gap-1.5 border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
        >
          {busy('print') ? <Loader2 className={`${icon} animate-spin`} /> : <Printer className={icon} />}
          Print
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
        <p className="text-slate-600 mt-1">Financial Year {fyOf()} - Generate and Export Reports</p>
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
      {exporting && exportProgress.total > 0 && (
        <div className="bg-png-red/5 border border-png-gold/40 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className="h-5 w-5 text-png-red animate-spin" />
            <p className="text-png-red font-medium">Generating documents...</p>
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
        {selectedReport ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-500">Export the selected report:</span>
            {renderActions(selectedReport, "lg")}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Select a report above, or use the quick action buttons on any report card below.</p>
        )}
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
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-slate-900">{report.name}</h3>
                        <p className="text-sm text-slate-600 mt-1">{report.description}</p>
                        {isBulk && (
                          <span className="inline-block mt-2 px-2 py-0.5 bg-png-gold/20 text-png-maroon text-xs rounded-full">
                            Bulk Export
                          </span>
                        )}
                        <div className="mt-3">
                          {renderActions(report.id)}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
