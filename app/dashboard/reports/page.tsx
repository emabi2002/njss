"use client"

import { useEffect, useState } from "react"
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
type ReportCategoryConfig = { category: string; reports: { id: string; name: string; description: string; icon: typeof FileText }[] }

const round1 = (n: number) => Math.round(n * 10) / 10
const quarterOf = (d: string | null) => (d ? Math.floor(new Date(d).getMonth() / 3) + 1 : 1)
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "-")

export default function ReportsPage() {
  const currentYear = new Date().getFullYear()
  const [selectedReport, setSelectedReport] = useState("")
  const [dateRange, setDateRange] = useState({ start: `${currentYear}-01-01`, end: `${currentYear}-12-31` })
  const [filters, setFilters] = useState({
    department: "",
    section: "",
    status: ""
  })
  const [dbReportCategories, setDbReportCategories] = useState<ReportCategoryConfig[] | null>(null)
  const [exporting, setExporting] = useState(false)
  const [activeAction, setActiveAction] = useState<string>("")
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 })
  const [exportSuccess, setExportSuccess] = useState("")
  const [exportError, setExportError] = useState("")

  const fyOf = () => new Date(dateRange.start).getFullYear() || currentYear
  const isFullYearRange = () => {
    const fy = fyOf()
    return dateRange.start === `${fy}-01-01` && dateRange.end === `${fy}-12-31`
  }

  const reportCategories = [
    {
      category: "Management Monitoring",
      reports: [
        { id: "management-financial-summary", name: "Management Financial Summary", description: "Approved budget, funding, releases, commitments, actuals and available balance", icon: BarChart3 },
        { id: "department-financial-position", name: "Department Financial Position", description: "Authoritative financial position by department", icon: BarChart3 },
        { id: "section-financial-position", name: "Section Financial Position", description: "Authoritative financial position by section", icon: PieChart },
        { id: "cost-centre-financial-position", name: "Cost Centre Financial Position", description: "Authoritative financial position by cost centre", icon: PieChart },
        { id: "expense-code-financial-position", name: "Expense Code Financial Position", description: "Authoritative financial position by expense code", icon: FileText },
        { id: "funding-source-financial-position", name: "Funding Source Financial Position", description: "Authoritative financial position by funding source", icon: TrendingUp },
        { id: "ff3-ff4-transaction-trace", name: "FF3 to FF4 Transaction Trace", description: "Drill-down trace from FF3 to commitment, FF4, payment and supplier/payee", icon: FileText },
      ]
    },
    {
      category: "Planning & Budget Cycle",
      reports: [
        { id: "consolidated-budget", name: "Consolidated Department Budget", description: "Approved budget rolled up by department", icon: BarChart3 },
        { id: "budget-by-cost-centre", name: "Budget by Cost Centre", description: "Approved / committed / actual per cost centre", icon: PieChart },
        { id: "budget-by-section", name: "Budget by Section", description: "Approved budget rolled up by section", icon: BarChart3 },
        { id: "budget-by-code", name: "Budget by Expense Code", description: "Position for each full expense code", icon: BarChart3 },
        { id: "available-balance", name: "Available Balance Report", description: "Remaining balance per expense code", icon: TrendingUp },
        { id: "approved-budget-by-division", name: "Approved Budget by Division", description: "Approved Excel divisional budgets", icon: FileText },
        { id: "approved-budget-by-department", name: "Approved Budget by Department", description: "Approved budget rolled up by department", icon: BarChart3 },
        { id: "approved-budget-by-finance-code", name: "Approved Budget by Finance Code", description: "Approved budget by canonical finance code", icon: BarChart3 },
        { id: "monthly-cashflow", name: "Monthly Cash-Flow Plan", description: "January to December approved budget profile", icon: TrendingUp },
        { id: "quarterly-cashflow", name: "Quarterly Cash-Flow Requirement", description: "Q1 to Q4 planned requirements", icon: TrendingUp },
        { id: "budget-submission-status", name: "Budget Submission Status", description: "Draft, submitted, returned, reviewed and approved budgets", icon: FileText },
      ]
    },
    {
      category: "Budget Reports",
      reports: [
        { id: "budget-vs-actual", name: "Budget vs Commitment vs Actual", description: "Comprehensive budget utilization analysis", icon: BarChart3 },
        { id: "quarterly-utilization", name: "Quarterly Utilization Report", description: "Budget spending by quarter", icon: TrendingUp },
        { id: "supplemental-impact", name: "Supplemental Budget Impact", description: "Analysis of budget revisions", icon: PieChart },
        { id: "budget-position-report", name: "Budget Position", description: "Authoritative approved, funded, released and available position", icon: BarChart3 },
        { id: "monthly-expenditure", name: "Monthly Expenditure", description: "Actual expenditure by payment month", icon: TrendingUp },
        { id: "quarterly-expenditure", name: "Quarterly Expenditure", description: "Actual expenditure by payment quarter", icon: TrendingUp },
      ]
    },
    {
      category: "Funding Reports",
      reports: [
        { id: "funding-authority-register", name: "Funding Authority Register", description: "Authorities with approved receipts and remaining authority", icon: FileText },
        { id: "funding-receipt-register", name: "Funding Receipt Register", description: "Receipts with authority and unallocated balances", icon: FileText },
        { id: "funding-allocation-report", name: "Funding Allocation Report", description: "Funding allocated against operational budget lines", icon: BarChart3 },
        { id: "funding-source-report", name: "Funding Source Report", description: "Authority, receipt and allocation totals by funding source", icon: PieChart },
        { id: "funding-vs-approved-budget", name: "Funding vs Approved Budget", description: "Approved budget compared with funded amount", icon: BarChart3 },
        { id: "funding-vs-releases", name: "Funding vs Releases", description: "Funded amounts compared with actual releases", icon: TrendingUp },
        { id: "unfunded-budget-report", name: "Unfunded Budget Report", description: "Approved budget not yet funded", icon: FileText },
        { id: "unreleased-funding-report", name: "Unreleased Funding Report", description: "Funded amounts not yet released", icon: FileText },
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
        { id: "commitment-register", name: "Commitment Register", description: "Authoritative commitment ledger", icon: FileText },
        { id: "outstanding-commitments", name: "Outstanding Commitments", description: "Commitments with outstanding balances", icon: FileText },
        { id: "partially-paid-commitments", name: "Partially Paid Commitments", description: "Commitments with partial liquidations", icon: FileText },
        { id: "fully-paid-commitments", name: "Fully Paid Commitments", description: "Commitments fully paid", icon: FileText },
        { id: "ff3-workflow-history", name: "FF3 Workflow History", description: "FF3 approval and workflow trail", icon: FileText },
      ]
    },
    {
      category: "FF4 Reports",
      reports: [
        { id: "ff4-status", name: "FF4 Status Report", description: "All expenses by payment status", icon: FileText },
        { id: "ff4-bulk-pdf", name: "Bulk FF4 PDF Export", description: "Export multiple FF4s as one PDF", icon: Files },
        { id: "ff4-reconciliation", name: "Reconciliation Report", description: "Unreconciled payments", icon: FileText },
        { id: "ff4-register", name: "FF4 Register", description: "FF4 payment request register", icon: FileText },
        { id: "actual-expenditure", name: "Actual Expenditure", description: "Actual posted payment expenditure", icon: BarChart3 },
        { id: "monthly-expenditure-summary", name: "Monthly Expenditure Summary", description: "Actual expenditure by payment month", icon: TrendingUp },
        { id: "quarterly-expenditure-summary", name: "Quarterly Expenditure Summary", description: "Actual expenditure by payment quarter", icon: TrendingUp },
        { id: "payment-register", name: "Payment Register", description: "Posted payment transaction register", icon: FileText },
        { id: "unreconciled-payments", name: "Unreconciled Payments", description: "Paid transactions awaiting reconciliation", icon: AlertCircle },
        { id: "ff4-workflow-history", name: "FF4 Workflow History", description: "FF4 approval and workflow trail", icon: FileText },
      ]
    },
    {
      category: "Supplier Reports",
      reports: [
        { id: "supplier-spend-summary", name: "Supplier Spend Summary", description: "Simple supplier/payee spend totals", icon: PieChart },
        { id: "supplier-transaction-history", name: "Supplier Transaction History", description: "Supplier/payee FF4 and payment history", icon: FileText },
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
        { id: "transaction-audit-trail", name: "Transaction Audit Trail", description: "Financial transaction audit events", icon: FileText },
        { id: "user-activity", name: "User Activity Report", description: "User actions and transactions", icon: FileText },
      ]
    }
  ]

  useEffect(() => {
    async function loadReportLookups() {
      const { data } = await supabase.from('v_report_catalogue').select('*').order('category_sort_order').order('sort_order')
      const rows = (data || []) as Array<{ category_name: string; report_code: string; report_name: string; description: string }>
      if (rows.length > 0) {
        const map = new Map<string, ReportCategoryConfig['reports']>()
        rows.forEach((row) => {
          const list = map.get(row.category_name) || []
          list.push({ id: row.report_code, name: row.report_name, description: row.description, icon: FileText })
          map.set(row.category_name, list)
        })
        setDbReportCategories(Array.from(map.entries()).map(([category, reports]) => ({ category, reports })))
      }
    }
    loadReportLookups()
  }, [])

  const visibleReportCategories = dbReportCategories || reportCategories

  const MANAGEMENT_IDS = ['management-financial-summary', 'department-financial-position', 'section-financial-position', 'cost-centre-financial-position', 'expense-code-financial-position', 'funding-source-financial-position', 'ff3-ff4-transaction-trace']
  const COMMITMENT_IDS = ['commitment-register', 'outstanding-commitments', 'partially-paid-commitments', 'fully-paid-commitments']
  const SUPPLIER_IDS = ['supplier-spend-summary', 'supplier-transaction-history']

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

  const FUNDING_IDS = ['funding-authority-register', 'funding-receipt-register', 'funding-allocation-report', 'funding-source-report', 'funding-vs-approved-budget', 'funding-vs-releases', 'unfunded-budget-report', 'unreleased-funding-report', 'budget-position-report']

  const buildReport = async (id: string): Promise<{ title: string; records: ExportRow[] }> => {
    const fy = fyOf()

    if (MANAGEMENT_IDS.includes(id)) {
      if (id === 'management-financial-summary') {
        const { data } = await supabase.from('v_management_financial_summary').select('*').eq('financial_year', fy)
        const row = ((data || []) as Array<{ approved_budget: number; funded_amount: number; released_amount: number; pending_ff3: number; outstanding_commitments: number; actual_expenditure: number; available_balance: number; unfunded_budget: number; unreleased_funding: number; projected_available_after_pending: number; ff3_awaiting_action: number; ff4_awaiting_verification: number; ff4_awaiting_approval: number; ff4_processed_awaiting_payment: number; paid_awaiting_reconciliation: number }>)[0]
        return {
          title: 'Management Financial Summary',
          records: [
            { Metric: 'Approved Budget', 'Amount (K)': row?.approved_budget || 0 },
            { Metric: 'Funded Amount', 'Amount (K)': row?.funded_amount || 0 },
            { Metric: 'Released Amount', 'Amount (K)': row?.released_amount || 0 },
            { Metric: 'Pending FF3', 'Amount (K)': row?.pending_ff3 || 0 },
            { Metric: 'Outstanding Commitments', 'Amount (K)': row?.outstanding_commitments || 0 },
            { Metric: 'Actual Expenditure', 'Amount (K)': row?.actual_expenditure || 0 },
            { Metric: 'Available Balance', 'Amount (K)': row?.available_balance || 0 },
            { Metric: 'Unfunded Budget', 'Amount (K)': row?.unfunded_budget || 0 },
            { Metric: 'Unreleased Funding', 'Amount (K)': row?.unreleased_funding || 0 },
            { Metric: 'Projected Available After Pending FF3', 'Amount (K)': row?.projected_available_after_pending || 0 },
            { Metric: 'FF3 Awaiting Action', Count: row?.ff3_awaiting_action || 0 },
            { Metric: 'FF4 Awaiting Verification', Count: row?.ff4_awaiting_verification || 0 },
            { Metric: 'FF4 Awaiting Approval', Count: row?.ff4_awaiting_approval || 0 },
            { Metric: 'FF4 Processed Awaiting Payment', Count: row?.ff4_processed_awaiting_payment || 0 },
            { Metric: 'Paid Awaiting Reconciliation', Count: row?.paid_awaiting_reconciliation || 0 },
          ]
        }
      }

      if (id === 'ff3-ff4-transaction-trace') {
        const { data } = await supabase.from('v_ff3_ff4_transaction_trace').select('*').eq('financial_year', fy).order('ff3_number')
        const traceRows = (data || []) as Array<{ ff3_number: string | null; ff3_purpose: string | null; commitment_number: string | null; ff4_number: string | null; supplier_or_payee: string | null; ff4_status: string | null; payment_date: string | null; payment_amount: number | null; ff4_net_amount: number | null; payment_reference: string | null; reconciled: boolean | null }>
        return {
          title: 'FF3 to FF4 Transaction Trace',
          records: traceRows.map((r) => ({
            'FF3 Number': r.ff3_number || '-',
            Purpose: r.ff3_purpose || '-',
            Commitment: r.commitment_number || '-',
            'FF4 Number': r.ff4_number || '-',
            'Supplier/Payee': r.supplier_or_payee || '-',
            Status: r.ff4_status || '-',
            'Payment Date': fmtDate(r.payment_date),
            'Payment Reference': r.payment_reference || '-',
            Reconciled: r.reconciled ? 'Yes' : 'No',
            'Amount (K)': r.payment_amount || r.ff4_net_amount || 0,
          }))
        }
      }

      const config: Record<string, { view: string; title: string; label: string; order: string }> = {
        'department-financial-position': { view: 'v_department_financial_position', title: 'Department Financial Position', label: 'Department', order: 'department_name' },
        'section-financial-position': { view: 'v_section_financial_position', title: 'Section Financial Position', label: 'Section', order: 'section_name' },
        'cost-centre-financial-position': { view: 'v_cost_centre_financial_position', title: 'Cost Centre Financial Position', label: 'Cost Centre', order: 'cost_centre_code' },
        'expense-code-financial-position': { view: 'v_expense_code_financial_position', title: 'Expense Code Financial Position', label: 'Expense Code', order: 'full_expense_code' },
        'funding-source-financial-position': { view: 'v_funding_source_financial_position', title: 'Funding Source Financial Position', label: 'Funding Source', order: 'funding_source_name' },
      }
      const cfg = config[id]
      const { data } = await supabase.from(cfg.view).select('*').eq('financial_year', fy).order(cfg.order)
      const rows = (data || []) as Array<{ department_name?: string | null; section_name?: string | null; cost_centre_code?: string | null; cost_centre_name?: string | null; full_expense_code?: string | null; funding_source_name?: string | null; approved_budget: number; funded_amount: number; released_amount: number; pending_ff3: number; outstanding_commitments: number; actual_expenditure: number; available_balance: number; unfunded_budget: number; unreleased_funding: number; utilisation_pct: number }>
      const labelOf = (row: typeof rows[number]) => row.department_name || row.section_name || (row.cost_centre_code ? `${row.cost_centre_code} — ${row.cost_centre_name || ''}` : null) || row.full_expense_code || row.funding_source_name || '-'
      return { title: cfg.title, records: rows.map((row) => ({ [cfg.label]: labelOf(row), 'Approved (K)': row.approved_budget || 0, 'Funded (K)': row.funded_amount || 0, 'Released (K)': row.released_amount || 0, 'Pending FF3 (K)': row.pending_ff3 || 0, 'Outstanding Commitments (K)': row.outstanding_commitments || 0, 'Actual (K)': row.actual_expenditure || 0, 'Available (K)': row.available_balance || 0, 'Unfunded (K)': row.unfunded_budget || 0, 'Unreleased Funding (K)': row.unreleased_funding || 0, 'Utilisation %': row.utilisation_pct || 0 })) }
    }

    if (FUNDING_IDS.includes(id)) {
      if (id === 'funding-authority-register') {
        const { data } = await supabase.from('v_funding_authority_register').select('*').eq('financial_year', fy).order('authority_number')
        const rows = (data || []) as Array<{ authority_number: string | null; authority_type: string; funding_source_name: string | null; source_agency: string | null; status: string; approved_amount: number; approved_receipts: number; authority_remaining: number }>
        return { title: 'Funding Authority Register', records: rows.map((r) => ({ Authority: r.authority_number || '-', Type: r.authority_type, Source: r.funding_source_name || r.source_agency || '-', Status: r.status, 'Authority Amount (K)': r.approved_amount || 0, 'Approved Receipts (K)': r.approved_receipts || 0, 'Authority Remaining (K)': r.authority_remaining || 0 })) }
      }
      if (id === 'funding-receipt-register') {
        const { data } = await supabase.from('v_funding_receipt_register').select('*').eq('financial_year', fy).order('receipt_number')
        const rows = (data || []) as Array<{ receipt_number: string | null; authority_number: string | null; funding_source_name: string | null; receipt_date: string; status: string; amount_received: number; previous_approved_receipts: number; authority_balance_before_this_receipt: number; receipt_unallocated_balance: number }>
        return { title: 'Funding Receipt Register', records: rows.map((r) => ({ Receipt: r.receipt_number || '-', Authority: r.authority_number || '-', Source: r.funding_source_name || '-', Date: r.receipt_date, Status: r.status, 'Receipt Amount (K)': r.amount_received || 0, 'Previous Receipts (K)': r.previous_approved_receipts || 0, 'Authority Balance (K)': r.authority_balance_before_this_receipt || 0, 'Unallocated Receipt Balance (K)': r.receipt_unallocated_balance || 0 })) }
      }
      if (id === 'funding-allocation-report') {
        const { data } = await supabase.from('v_funding_allocation_register').select('*').eq('financial_year', fy).order('allocation_number')
        const rows = (data || []) as Array<{ allocation_number: string | null; receipt_number: string | null; authority_number: string | null; funding_source_name: string | null; department_name: string | null; cost_centre_code: string | null; full_expense_code: string | null; status: string; approved_budget: number; allocated_amount: number; released_from_allocation: number; allocation_unreleased_balance: number }>
        return { title: 'Funding Allocation Report', records: rows.map((r) => ({ Allocation: r.allocation_number || '-', Receipt: r.receipt_number || '-', Authority: r.authority_number || '-', Source: r.funding_source_name || '-', Department: r.department_name || '-', 'Cost Centre': r.cost_centre_code || '-', 'Finance Code': r.full_expense_code || '-', Status: r.status, 'Approved Budget (K)': r.approved_budget || 0, 'Allocated (K)': r.allocated_amount || 0, 'Released (K)': r.released_from_allocation || 0, 'Unreleased (K)': r.allocation_unreleased_balance || 0 })) }
      }
      if (id === 'funding-source-report') {
        const { data } = await supabase.from('v_funding_source_report').select('*').eq('financial_year', fy).order('funding_source_name')
        const rows = (data || []) as Array<{ funding_source_code: string | null; funding_source_name: string | null; authority_amount: number; received_amount: number; allocated_amount: number }>
        return { title: 'Funding Source Report', records: rows.map((r) => ({ Source: r.funding_source_code ? `${r.funding_source_code} — ${r.funding_source_name}` : r.funding_source_name || '-', 'Authority Amount (K)': r.authority_amount || 0, 'Received (K)': r.received_amount || 0, 'Allocated (K)': r.allocated_amount || 0, 'Unallocated Receipts (K)': (r.received_amount || 0) - (r.allocated_amount || 0) })) }
      }
      const { data } = await supabase.from('v_authoritative_budget_position').select('*').eq('financial_year', fy).order('department_name')
      let rows = (data || []) as Array<{ full_expense_code: string | null; department_name: string | null; section_name: string | null; cost_centre_code: string | null; funding_source_name: string | null; approved_budget: number; funded_amount: number; released_amount: number; pending_amount: number; outstanding_commitment: number; actual_expenditure: number; available_amount: number; unfunded_amount: number; unreleased_funding: number }>
      if (id === 'unfunded-budget-report') rows = rows.filter((r) => (r.unfunded_amount || 0) > 0)
      if (id === 'unreleased-funding-report') rows = rows.filter((r) => (r.unreleased_funding || 0) > 0)
      const title = id === 'funding-vs-approved-budget' ? 'Funding vs Approved Budget' : id === 'funding-vs-releases' ? 'Funding vs Releases' : id === 'unfunded-budget-report' ? 'Unfunded Budget Report' : id === 'unreleased-funding-report' ? 'Unreleased Funding Report' : 'Budget Position Report'
      return { title, records: rows.map((r) => ({ 'Finance Code': r.full_expense_code || '-', Department: r.department_name || '-', Section: r.section_name || '-', 'Cost Centre': r.cost_centre_code || '-', 'Funding Source': r.funding_source_name || '-', 'Approved (K)': r.approved_budget || 0, 'Funded (K)': r.funded_amount || 0, 'Released (K)': r.released_amount || 0, 'Pending (K)': r.pending_amount || 0, 'Committed (K)': r.outstanding_commitment || 0, 'Actual (K)': r.actual_expenditure || 0, 'Available (K)': r.available_amount || 0, 'Unfunded (K)': r.unfunded_amount || 0, 'Unreleased Funding (K)': r.unreleased_funding || 0 })) }
    }

    if (id === 'budget-vs-actual') {
      const { data } = await supabase.from('v_budget_by_code').select('*').eq('financial_year', fy)
      const vrows = (data || []) as Array<{ department_name: string | null; revised_budget: number; committed_amount: number; actual_expenditure: number }>
      const map = new Map<string, { rev: number; com: number; act: number }>()
      vrows.forEach((r) => { const k = r.department_name || '-'; const e = map.get(k) || { rev: 0, com: 0, act: 0 }; e.rev += r.revised_budget || 0; e.com += r.committed_amount || 0; e.act += r.actual_expenditure || 0; map.set(k, e) })
      return { title: 'Budget vs Commitment vs Actual', records: Array.from(map).map(([dept, v]) => ({ Department: dept, 'Approved (K)': v.rev, 'Committed (K)': v.com, 'Actual (K)': v.act, 'Available (K)': v.rev - v.com - v.act, 'Utilisation %': v.rev ? round1(((v.com + v.act) / v.rev) * 100) : 0 })) }
    }

    if (id === 'quarterly-utilization') {
      const [{ data: qr }, { data: qexp }, { data: comq }] = await Promise.all([
        supabase.from('quarterly_releases').select('quarter, released_amount').eq('financial_year', fy),
        supabase.from('v_quarterly_expenditure_summary').select('quarter, actual_expenditure').eq('financial_year', fy),
        supabase.from('ff3_commitments').select('commitment_date, committed_amount, status').eq('financial_year', fy),
      ])
      const q: Record<number, { rel: number; com: number; spent: number }> = { 1: { rel: 0, com: 0, spent: 0 }, 2: { rel: 0, com: 0, spent: 0 }, 3: { rel: 0, com: 0, spent: 0 }, 4: { rel: 0, com: 0, spent: 0 } }
      ;((qr || []) as Array<{ quarter: number; released_amount: number }>).forEach((r) => { if (q[r.quarter]) q[r.quarter].rel += r.released_amount || 0 })
      ;((qexp || []) as Array<{ quarter: number; actual_expenditure: number }>).forEach((r) => { if (q[r.quarter]) q[r.quarter].spent += r.actual_expenditure || 0 })
      ;((comq || []) as Array<{ commitment_date: string; committed_amount: number; status: string }>).forEach((r) => { if (r.status !== 'CANCELLED') { const n = quarterOf(r.commitment_date); if (q[n]) q[n].com += r.committed_amount || 0 } })
      return { title: 'Quarterly Utilization Report', records: [1, 2, 3, 4].map((n) => ({ Quarter: `Q${n}`, 'Released (K)': q[n].rel, 'Committed (K)': q[n].com, 'Spent (K)': q[n].spent, 'Utilisation %': q[n].rel ? round1((q[n].spent / q[n].rel) * 100) : 0 })) }
    }

    if (id === 'supplemental-impact') {
      const { data } = await supabase.from('budget_allocations').select('original_budget, supplemental_budget, revised_budget, department:departments(name)').eq('financial_year', fy).eq('is_active', true)
      const rows = (data || []) as unknown as Array<{ original_budget: number; supplemental_budget: number | null; revised_budget: number | null; department: { name: string } | null }>
      const map = new Map<string, { orig: number; supp: number; rev: number }>()
      rows.forEach((r) => {
        const k = r.department?.name || '-'
        const e = map.get(k) || { orig: 0, supp: 0, rev: 0 }
        e.orig += r.original_budget || 0; e.supp += r.supplemental_budget || 0
        e.rev += r.revised_budget || ((r.original_budget || 0) + (r.supplemental_budget || 0)); map.set(k, e)
      })
      return { title: 'Supplemental Budget Impact', records: Array.from(map).map(([dept, v]) => ({ Department: dept, 'Original (K)': v.orig, 'Supplemental (K)': v.supp, 'Revised (K)': v.rev, 'Impact %': v.orig ? round1((v.supp / v.orig) * 100) : 0 })) }
    }

    if (id === 'ff3-turnaround' || id === 'ff3-workflow-history') {
      let q = supabase.from('ff3_headers').select('ff3_number, status, created_at, updated_at, request_date, total_estimated_amount').eq('financial_year', fy).order('ff3_number')
      if (!isFullYearRange()) q = q.gte('request_date', dateRange.start).lte('request_date', dateRange.end)
      if (filters.status) q = q.eq('status', filters.status)
      const { data } = await q
      const rows = (data || []) as unknown as Array<{ ff3_number: string; status: string; created_at: string; updated_at: string; total_estimated_amount: number | null }>
      return { title: id === 'ff3-workflow-history' ? 'FF3 Workflow History' : 'Approval Turnaround Time', records: rows.map((r) => ({ 'FF3 Number': r.ff3_number, Status: r.status, Created: fmtDate(r.created_at), 'Last Action': fmtDate(r.updated_at), 'Turnaround (days)': round1(Math.max(0, (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()) / 86400000)), 'Amount (K)': r.total_estimated_amount || 0 })) }
    }

    if (id === 'quotation-analysis') {
      const { data } = await supabase.from('ff3_quotations').select('quotation_amount, is_selected, supplier_name, ff3:ff3_headers(ff3_number)')
      const rows = (data || []) as unknown as Array<{ quotation_amount: number; is_selected: boolean; supplier_name: string; ff3: { ff3_number: string } | null }>
      const map = new Map<string, { count: number; min: number; max: number; selected: number; supplier: string }>()
      rows.forEach((r) => {
        const k = r.ff3?.ff3_number || '-'
        const e = map.get(k) || { count: 0, min: Infinity, max: 0, selected: 0, supplier: '-' }
        e.count += 1; e.min = Math.min(e.min, r.quotation_amount); e.max = Math.max(e.max, r.quotation_amount)
        if (r.is_selected) { e.selected = r.quotation_amount; e.supplier = r.supplier_name }
        map.set(k, e)
      })
      return { title: 'Supplier Quotation Analysis', records: Array.from(map).map(([ff3, v]) => { const base = v.selected || (v.min === Infinity ? 0 : v.min); return { 'FF3 Number': ff3, Quotes: v.count, 'Lowest (K)': v.min === Infinity ? 0 : v.min, 'Highest (K)': v.max, 'Selected (K)': v.selected, 'Selected Supplier': v.supplier, 'Savings vs Highest (K)': Math.max(0, v.max - base) } }) }
    }

    if (COMMITMENT_IDS.includes(id)) {
      const { data } = await supabase.from('v_commitment_ledger').select('*').eq('financial_year', fy).order('commitment_number')
      const rows = (data || []) as Array<{ commitment_id: string; commitment_number: string | null; ff3_number: string | null; status: string | null; original_committed_amount: number | null; current_committed_amount: number | null; paid_amount: number | null; outstanding_amount: number | null; transaction_date: string | null; transaction_type: string | null; reference: string | null }>
      const map = new Map<string, typeof rows[number]>()
      rows.forEach((row) => {
        const existing = map.get(row.commitment_id)
        if (!existing || new Date(row.transaction_date || '1900-01-01') > new Date(existing.transaction_date || '1900-01-01')) map.set(row.commitment_id, row)
      })
      let commitments = Array.from(map.values())
      if (id === 'outstanding-commitments') commitments = commitments.filter((row) => (row.outstanding_amount || 0) > 0)
      if (id === 'partially-paid-commitments') commitments = commitments.filter((row) => row.status === 'PARTIALLY_PAID')
      if (id === 'fully-paid-commitments') commitments = commitments.filter((row) => row.status === 'FULLY_PAID')
      const title = id === 'outstanding-commitments' ? 'Outstanding Commitments' : id === 'partially-paid-commitments' ? 'Partially Paid Commitments' : id === 'fully-paid-commitments' ? 'Fully Paid Commitments' : 'Commitment Register'
      return { title, records: commitments.map((row) => ({ Commitment: row.commitment_number || '-', 'Linked FF3': row.ff3_number || '-', Status: row.status || '-', 'Original (K)': row.original_committed_amount || 0, 'Current (K)': row.current_committed_amount || 0, 'Paid (K)': row.paid_amount || 0, 'Outstanding (K)': row.outstanding_amount || 0, 'Last Transaction': row.transaction_type || '-', Reference: row.reference || '-' })) }
    }

    if (id === 'exp-account') {
      const { data } = await supabase.from('v_budget_by_code').select('full_expense_code, department_name, committed_amount, actual_expenditure').eq('financial_year', fy)
      const rows = (data || []) as Array<{ full_expense_code: string | null; department_name: string | null; committed_amount: number; actual_expenditure: number }>
      return { title: 'Expenditure by Ledger Account', records: rows.map((r) => ({ Account: r.full_expense_code || '-', Department: r.department_name || '-', 'Committed (K)': r.committed_amount || 0, 'Actual (K)': r.actual_expenditure || 0 })) }
    }

    if (id === 'exp-section' || id === 'exp-project' || id === 'exp-province') {
      let q = supabase.from('ff4_headers').select('net_amount, status, payment_request_date, ff3:ff3_headers(section:sections(name), province:provinces(name), project:projects(name))').eq('financial_year', fy)
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
      return { title: `Expenditure by ${label}`, records: Array.from(map).map(([k, v]) => ({ [label]: k, Payments: v.count, 'Expenditure (K)': v.amount, 'Share %': total ? round1((v.amount / total) * 100) : 0 })) }
    }

    if (id === 'user-activity' || id === 'audit-trail' || id === 'transaction-audit-trail') {
      const { data } = await supabase.from('audit_logs').select('created_at, user_name, action, entity_type, entity_reference, changes').order('created_at', { ascending: false }).limit(id === 'user-activity' ? 1000 : 500)
      const rows = (data || []) as Array<{ created_at: string; user_name: string | null; action: string; entity_type: string; entity_reference: string | null; changes: Record<string, unknown> | null }>
      if (id === 'user-activity') {
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
        return { title: 'User Activity Report', records: Array.from(map).map(([user, v]) => ({ User: user, 'Total Actions': v.total, Creates: v.creates, 'Other Actions': v.updates, 'Last Activity': new Date(v.last).toLocaleString('en-GB') })) }
      }
      return { title: id === 'transaction-audit-trail' ? 'Transaction Audit Trail' : 'Audit Trail Report', records: rows.map((r) => ({ Timestamp: new Date(r.created_at).toLocaleString('en-GB'), User: r.user_name || 'System', Action: r.action, Entity: r.entity_type, Reference: r.entity_reference || '-', Change: r.changes && typeof r.changes === 'object' && 'old_status' in r.changes ? `${(r.changes as Record<string, unknown>).old_status} -> ${(r.changes as Record<string, unknown>).new_status}` : '' })) }
    }

    if (id === 'ff3-workflow-history') {
      const { data } = await supabase.from('ff3_headers').select('ff3_number, status, created_at, updated_at, request_date, total_estimated_amount').eq('financial_year', fy)
      const rows = (data || []) as unknown as Array<{ ff3_number: string; status: string; created_at: string; updated_at: string; total_estimated_amount: number | null }>
      return { title: 'FF3 Workflow History', records: rows.map((r) => ({ 'FF3 Number': r.ff3_number, Status: r.status, Created: fmtDate(r.created_at), Updated: fmtDate(r.updated_at), 'Amount (K)': r.total_estimated_amount || 0 })) }
    }

    if (id === 'ff4-workflow-history') {
      const { data } = await supabase.from('ff4_headers').select('ff4_number, status, created_at, updated_at, payment_request_date, net_amount').eq('financial_year', fy)
      const rows = (data || []) as unknown as Array<{ ff4_number: string; status: string; created_at: string; updated_at: string; net_amount: number }>
      return { title: 'FF4 Workflow History', records: rows.map((r) => ({ 'FF4 Number': r.ff4_number, Status: r.status, Created: fmtDate(r.created_at), Updated: fmtDate(r.updated_at), 'Amount (K)': r.net_amount || 0 })) }
    }

    if (SUPPLIER_IDS.includes(id)) {
      if (id === 'supplier-spend-summary') {
        const { data } = await supabase.from('v_supplier_spend_summary').select('*').eq('financial_year', fy).order('supplier_or_payee')
        const rows = (data || []) as Array<{ supplier_code: string | null; supplier_or_payee: string | null; payee_type: string | null; ff4_count: number; payment_count: number; total_spend: number; reconciled_spend: number; unreconciled_spend: number; last_payment_date: string | null }>
        return { title: 'Supplier Spend Summary', records: rows.map((row) => ({ Supplier: row.supplier_or_payee || '-', 'Supplier Code': row.supplier_code || '-', 'Payee Type': row.payee_type || '-', 'FF4 Count': row.ff4_count || 0, Payments: row.payment_count || 0, 'Total Spend (K)': row.total_spend || 0, 'Reconciled Spend (K)': row.reconciled_spend || 0, 'Unreconciled Spend (K)': row.unreconciled_spend || 0, 'Last Payment': fmtDate(row.last_payment_date) })) }
      }

      if (id === 'supplier-transaction-history') {
        const { data } = await supabase.from('v_ff3_ff4_transaction_trace').select('*').eq('financial_year', fy).order('supplier_or_payee')
        const rows = (data || []) as Array<{ supplier_or_payee: string | null; ff3_number: string | null; commitment_number: string | null; ff4_number: string | null; invoice_number: string | null; ff4_status: string | null; payment_date: string | null; payment_amount: number | null; payment_reference: string | null }>
        return { title: 'Supplier Transaction History', records: rows.map((row) => ({ 'Supplier/Payee': row.supplier_or_payee || '-', 'FF3 Number': row.ff3_number || '-', Commitment: row.commitment_number || '-', 'FF4 Number': row.ff4_number || '-', Invoice: row.invoice_number || '-', Status: row.ff4_status || '-', 'Payment Date': fmtDate(row.payment_date), 'Payment Reference': row.payment_reference || '-', 'Amount (K)': row.payment_amount || 0 })) }
      }
    }

    if (id === 'ff3-status') {
      let q = supabase.from('ff3_headers').select('ff3_number, request_date, status, urgency_level, total_estimated_amount, department:departments(name), section:sections(name)').eq('financial_year', fy).order('ff3_number')
      if (!isFullYearRange()) q = q.gte('request_date', dateRange.start).lte('request_date', dateRange.end)
      if (filters.status) q = q.eq('status', filters.status)
      const { data } = await q
      const rows = (data || []) as unknown as Array<{ ff3_number: string; request_date: string; status: string; urgency_level: string | null; total_estimated_amount: number | null; department: { name: string } | null; section: { name: string } | null }>
      return { title: 'FF3 Requisitions Report', records: rows.map((r) => ({ 'FF3 Number': r.ff3_number, Date: r.request_date, Department: r.department?.name || '-', Section: r.section?.name || '-', Urgency: r.urgency_level || '-', Status: r.status, 'Amount (K)': r.total_estimated_amount || 0 })) }
    }

    if (id === 'ff3-pending') {
      const { data } = await supabase.from('ff3_headers').select('ff3_number, request_date, status, urgency_level, total_estimated_amount, department:departments(name), section:sections(name)').eq('financial_year', fy).in('status', ['SUBMITTED', 'ENDORSED_SUPERVISOR', 'ENDORSED_SECTION_HEAD']).order('ff3_number')
      const rows = (data || []) as unknown as Array<{ ff3_number: string; request_date: string; status: string; urgency_level: string | null; total_estimated_amount: number | null; department: { name: string } | null; section: { name: string } | null }>
      return { title: 'FF3 Pending Approvals', records: rows.map((r) => ({ 'FF3 Number': r.ff3_number, Date: r.request_date, Department: r.department?.name || '-', Section: r.section?.name || '-', Urgency: r.urgency_level || '-', Status: r.status, 'Amount (K)': r.total_estimated_amount || 0 })) }
    }

    if (id === 'monthly-expenditure' || id === 'monthly-expenditure-summary') {
      const { data } = await supabase.from('v_monthly_expenditure_summary').select('*').eq('financial_year', fy).order('month_number')
      const rows = (data || []) as Array<{ month_number: number; month_name: string | null; department_name: string | null; cost_centre_code: string | null; full_expense_code: string | null; payment_count: number; actual_expenditure: number }>
      return { title: id === 'monthly-expenditure' ? 'Monthly Expenditure' : 'Monthly Expenditure Summary', records: rows.map((row) => ({ Month: `${row.month_number}. ${row.month_name || ''}`.trim(), Department: row.department_name || '-', 'Cost Centre': row.cost_centre_code || '-', 'Expense Code': row.full_expense_code || '-', Payments: row.payment_count || 0, 'Actual Expenditure (K)': row.actual_expenditure || 0 })) }
    }

    if (id === 'quarterly-expenditure' || id === 'quarterly-expenditure-summary') {
      const { data } = await supabase.from('v_quarterly_expenditure_summary').select('*').eq('financial_year', fy).order('quarter')
      const rows = (data || []) as Array<{ quarter_label: string | null; department_name: string | null; cost_centre_code: string | null; full_expense_code: string | null; payment_count: number; actual_expenditure: number }>
      return { title: id === 'quarterly-expenditure' ? 'Quarterly Expenditure' : 'Quarterly Expenditure Summary', records: rows.map((row) => ({ Quarter: row.quarter_label || '-', Department: row.department_name || '-', 'Cost Centre': row.cost_centre_code || '-', 'Expense Code': row.full_expense_code || '-', Payments: row.payment_count || 0, 'Actual Expenditure (K)': row.actual_expenditure || 0 })) }
    }

    if (id === 'actual-expenditure') {
      const { data } = await supabase.from('v_monthly_expenditure_summary').select('*').eq('financial_year', fy).order('department_name')
      const rows = (data || []) as Array<{ department_name: string | null; actual_expenditure: number; payment_count: number }>
      const map = new Map<string, { amount: number; count: number }>()
      rows.forEach((row) => { const key = row.department_name || '-'; const e = map.get(key) || { amount: 0, count: 0 }; e.amount += row.actual_expenditure || 0; e.count += row.payment_count || 0; map.set(key, e) })
      return { title: 'Actual Expenditure', records: Array.from(map.entries()).map(([department, value]) => ({ Department: department, Payments: value.count, 'Actual Expenditure (K)': value.amount })) }
    }

    if (id === 'payment-register' || id === 'unreconciled-payments' || id === 'ff4-reconciliation') {
      let q = supabase.from('v_ff4_reconciliation_summary').select('*').eq('financial_year', fy).order('payment_date', { ascending: false })
      if (!isFullYearRange()) q = q.gte('payment_date', dateRange.start).lte('payment_date', dateRange.end)
      if (id === 'unreconciled-payments' || id === 'ff4-reconciliation') q = q.eq('reconciliation_status', 'UNRECONCILED')
      const { data } = await q
      const rows = (data || []) as Array<{ payment_date: string | null; payment_reference: string | null; ff4_number: string | null; commitment_number: string | null; supplier_or_payee: string | null; reconciliation_status: string | null; amount: number }>
      const title = id === 'payment-register' ? 'Payment Register' : id === 'unreconciled-payments' ? 'Unreconciled Payments' : 'FF4 Reconciliation Report'
      return { title, records: rows.map((row) => ({ 'Payment Date': fmtDate(row.payment_date), 'Payment Reference': row.payment_reference || '-', FF4: row.ff4_number || '-', Commitment: row.commitment_number || '-', 'Supplier/Payee': row.supplier_or_payee || '-', Status: row.reconciliation_status || '-', 'Amount (K)': row.amount || 0 })) }
    }

    if (id === 'budget-submission-status') {
      const { data } = await supabase.from('divisional_budget_submissions').select('submission_number, submission_reference, budget_year, status, total_proposed_budget, total_monthly_allocation, unallocated_variance, division:budget_divisions(name, code)').eq('budget_year', fy).order('created_at', { ascending: false })
      const rows = (data || []) as unknown as Array<{ submission_number: string | null; submission_reference: string | null; status: string; total_proposed_budget: number | null; total_monthly_allocation: number | null; unallocated_variance: number | null; division: { name: string; code: string } | null }>
      return { title: 'Budget Submission Status', records: rows.map((row) => ({ Submission: row.submission_number || row.submission_reference || '-', Division: row.division ? `${row.division.code} — ${row.division.name}` : '-', Status: row.status, 'Annual Estimate (K)': row.total_proposed_budget || 0, 'Monthly Allocation (K)': row.total_monthly_allocation || 0, 'Variance (K)': row.unallocated_variance || 0 })) }
    }

    if (id === 'approved-budget-by-division' || id === 'approved-budget-by-department' || id === 'approved-budget-by-finance-code' || id === 'monthly-cashflow' || id === 'quarterly-cashflow' || id === 'consolidated-budget' || id === 'budget-by-cost-centre' || id === 'budget-by-section' || id === 'budget-by-code' || id === 'available-balance') {
      const { data } = await supabase.from('v_budget_by_code').select('*').eq('financial_year', fy)
      const vrows = (data || []) as Array<{ department_name: string | null; section_name: string | null; cost_centre_code: string | null; cost_centre_name: string | null; full_expense_code: string | null; revised_budget: number; committed_amount: number; actual_expenditure: number }>

      if (id === 'approved-budget-by-division' || id === 'approved-budget-by-department' || id === 'approved-budget-by-finance-code') {
        const { data: d2 } = await supabase.from('v_department_consolidated_budget').select('*').eq('budget_year', fy)
        const rows = (d2 || []) as Array<{ department_name: string | null; division_name: string | null; finance_code: string | null; standard_description: string | null; proposed_budget: number }>
        const label = id === 'approved-budget-by-division' ? 'Division' : id === 'approved-budget-by-department' ? 'Department' : 'Finance Code'
        const map = new Map<string, number>()
        rows.forEach((row) => {
          const key = id === 'approved-budget-by-division'
            ? row.division_name || '-'
            : id === 'approved-budget-by-department'
              ? row.department_name || '-'
              : `${row.finance_code || '-'} — ${row.standard_description || ''}`
          map.set(key, (map.get(key) || 0) + (row.proposed_budget || 0))
        })
        return { title: id === 'approved-budget-by-division' ? 'Approved Budget by Division' : id === 'approved-budget-by-department' ? 'Approved Budget by Department' : 'Approved Budget by Finance Code', records: Array.from(map).map(([key, total]) => ({ [label]: key, 'Approved Budget (K)': total })) }
      }

      if (id === 'monthly-cashflow' || id === 'quarterly-cashflow') {
        const { data: monthly } = await supabase.from('v_department_consolidated_budget_monthly').select('*').eq('budget_year', fy)
        const rows = (monthly || []) as Array<{ department_name: string | null; division_name: string | null; finance_code: string | null; month_number: number; month_name: string; monthly_amount: number }>
        if (id === 'monthly-cashflow') {
          return { title: 'Monthly Cash-Flow Plan', records: rows.map((row) => ({ Department: row.department_name || '-', Division: row.division_name || '-', 'Finance Code': row.finance_code || '-', Month: row.month_name, 'Amount (K)': row.monthly_amount || 0 })) }
        }
        const quarterMap = new Map<string, number>()
        rows.forEach((row) => {
          const quarter = `Q${Math.floor((row.month_number - 1) / 3) + 1}`
          const key = `${row.department_name || '-'}|${row.division_name || '-'}|${row.finance_code || '-'}|${quarter}`
          quarterMap.set(key, (quarterMap.get(key) || 0) + (row.monthly_amount || 0))
        })
        return { title: 'Quarterly Cash-Flow Requirement', records: Array.from(quarterMap).map(([key, amount]) => { const [department, division, financeCode, quarter] = key.split('|'); return { Department: department, Division: division, 'Finance Code': financeCode, Quarter: quarter, 'Planned Requirement (K)': amount } }) }
      }

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

      if (id === 'budget-by-section') {
        const map = new Map<string, { rev: number; com: number; act: number }>()
        vrows.forEach((r) => { const k = r.section_name || '-'; const e = map.get(k) || { rev: 0, com: 0, act: 0 }; e.rev += r.revised_budget || 0; e.com += r.committed_amount || 0; e.act += r.actual_expenditure || 0; map.set(k, e) })
        return { title: 'Budget by Section', records: Array.from(map).map(([section, v]) => ({ Section: section, 'Approved (K)': v.rev, 'Committed (K)': v.com, 'Actual (K)': v.act, 'Available (K)': v.rev - v.com - v.act })) }
      }

      const isAvail = id === 'available-balance'
      const mapped = vrows.map((r) => ({ 'Expense Code': r.full_expense_code || '-', Department: r.department_name || '-', 'Cost Centre': r.cost_centre_code || '-', 'Approved (K)': r.revised_budget || 0, 'Committed (K)': r.committed_amount || 0, 'Actual (K)': r.actual_expenditure || 0, 'Available (K)': (r.revised_budget || 0) - (r.committed_amount || 0) - (r.actual_expenditure || 0) }))
      if (isAvail) mapped.sort((a, b) => (a['Available (K)'] as number) - (b['Available (K)'] as number))
      return { title: isAvail ? 'Available Balance Report' : 'Budget by Expense Code', records: mapped }
    }

    if (id === 'budget-position-report') {
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
        title: 'Budget Position',
        records: [
          { Metric: 'Total Budget', 'Amount (K)': totalBudget },
          { Metric: 'Quarterly Released', 'Amount (K)': released },
          { Metric: 'Active Commitments', 'Amount (K)': committed },
          { Metric: 'Actual Expenditure', 'Amount (K)': spent },
          { Metric: 'Available Balance', 'Amount (K)': released - committed - spent },
        ],
      }
    }

    return { title: 'Report', records: [] }
  }

  const runReport = async (id: string, format: ExportFormat) => {
    if (!id || exporting) return

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
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
        <p className="text-slate-600 mt-1">Financial Year {fyOf()} - Generate and Export Reports</p>
      </div>

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
              {visibleReportCategories.map((cat) => (
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

        {selectedReport ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-500">Export the selected report:</span>
            {renderActions(selectedReport, "lg")}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Select a report above, or use the quick action buttons on any report card below.</p>
        )}
      </div>

      {visibleReportCategories.map((category) => (
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
