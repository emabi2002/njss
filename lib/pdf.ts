import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { getOrg, orgAddressLine, orgContactLine, getLogoForPdf } from './org'

// Extend jsPDF type for autoTable
declare module 'jspdf' {
  interface jsPDF {
    lastAutoTable: {
      finalY: number
    }
  }
}

// Common PDF styling
const COLORS = {
  primary: [139, 0, 0] as [number, number, number], // Dark red for NJSS
  secondary: [51, 51, 51] as [number, number, number],
  light: [245, 245, 245] as [number, number, number],
  border: [200, 200, 200] as [number, number, number],
}

const FONTS = {
  title: 16,
  subtitle: 12,
  heading: 11,
  body: 10,
  small: 9,
}

// Format currency
function formatCurrency(amount: number): string {
  return `K ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Format date
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

// Add header to PDF — branded with the configured organization profile.
function addHeader(doc: jsPDF, title: string, subtitle: string) {
  const org = getOrg()
  const pageWidth = doc.internal.pageSize.getWidth()
  const addr = orgAddressLine(org)
  const contact = orgContactLine(org)

  // Adaptive band: organization name (+ optional address / contact) then form title.
  let bandH = 23
  if (addr) bandH += 5
  if (contact) bandH += 5

  doc.setFillColor(...COLORS.primary)
  doc.rect(0, 0, pageWidth, bandH, 'F')

  // Organization logo (left side of the band), if one is configured & loaded.
  const logo = getLogoForPdf()
  if (logo && logo.h > 0 && logo.dataUrl) {
    const drawH = Math.min(bandH - 6, 15)
    const drawW = drawH * (logo.w / logo.h)
    try {
      doc.addImage(logo.dataUrl, 'PNG', 10, (bandH - drawH) / 2, drawW, drawH)
    } catch {
      /* logo not embeddable (e.g. cross-origin image without CORS) */
    }
  }

  doc.setTextColor(255, 255, 255)
  let yy = 9
  doc.setFontSize(FONTS.title)
  doc.setFont('helvetica', 'bold')
  doc.text(org.name.toUpperCase(), pageWidth / 2, yy, { align: 'center' })
  yy += 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(FONTS.small - 1.5)
  if (addr) { doc.text(addr, pageWidth / 2, yy, { align: 'center' }); yy += 4.5 }
  if (contact) { doc.text(contact, pageWidth / 2, yy, { align: 'center' }); yy += 4.5 }

  doc.setFontSize(FONTS.heading)
  doc.setFont('helvetica', 'bold')
  doc.text(title, pageWidth / 2, yy + 1, { align: 'center' })
  yy += 6

  doc.setFontSize(FONTS.small)
  doc.setFont('helvetica', 'normal')
  doc.text(subtitle, pageWidth / 2, yy, { align: 'center' })

  doc.setTextColor(0, 0, 0)
  return bandH + 10 // Y position after header
}

// Add footer to PDF
function addFooter(doc: jsPDF, pageNumber: number) {
  const org = getOrg()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  doc.setFontSize(FONTS.small)
  doc.setTextColor(128, 128, 128)

  // Footer line
  doc.setDrawColor(...COLORS.border)
  doc.line(20, pageHeight - 20, pageWidth - 20, pageHeight - 20)

  // Footer text
  doc.text(`Generated on ${new Date().toLocaleString('en-GB')}`, 20, pageHeight - 12)
  doc.text(`Page ${pageNumber}`, pageWidth - 20, pageHeight - 12, { align: 'right' })
  doc.text(org.name, pageWidth / 2, pageHeight - 12, { align: 'center' })

  doc.setTextColor(0, 0, 0)
}

// Add section title
function addSectionTitle(doc: jsPDF, y: number, title: string): number {
  doc.setFillColor(...COLORS.light)
  doc.rect(20, y, doc.internal.pageSize.getWidth() - 40, 8, 'F')

  doc.setFontSize(FONTS.heading)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...COLORS.primary)
  doc.text(title, 25, y + 6)
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')

  return y + 12
}

// Add key-value pair
function addKeyValue(doc: jsPDF, y: number, key: string, value: string, x: number = 25): number {
  doc.setFontSize(FONTS.body)
  doc.setFont('helvetica', 'bold')
  doc.text(`${key}:`, x, y)
  doc.setFont('helvetica', 'normal')
  doc.text(value, x + 45, y)
  return y + 6
}

// Generate FF3 PDF
export type FF3PDFData = {
  ff3_number: string
  financial_year: number
  request_date: string
  status: string
  department?: string
  section?: string
  province?: string
  funding_source?: string
  purpose: string
  justification?: string
  required_by_date?: string
  urgency_level?: string
  procurement_method?: string
  total_estimated_amount: number
  is_within_budget?: boolean
  items: Array<{
    line_number: number
    item_description: string
    quantity: number
    unit_of_measure?: string
    estimated_unit_price: number
  }>
  quotations: Array<{
    supplier_name: string
    quotation_number?: string
    quotation_date?: string
    quotation_amount: number
    is_selected: boolean
  }>
  approvals?: Array<{
    approval_level: string
    action_taken: string
    action_date: string
    comments?: string
  }>
}

export function generateFF3PDF(data: FF3PDFData, existingDoc?: jsPDF): jsPDF {
  // When an existing document is passed (bulk export), append a new page and
  // render this FF3 onto it; otherwise create a fresh single-form document.
  const doc = existingDoc ?? new jsPDF()
  if (existingDoc) doc.addPage()
  const pageWidth = doc.internal.pageSize.getWidth()

  // Header
  let y = addHeader(doc, 'FINANCE FORM 3 (FF3)', 'Requisition and Commitment Request')

  // Document info box
  doc.setDrawColor(...COLORS.border)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(20, y, pageWidth - 40, 25, 3, 3, 'FD')

  doc.setFontSize(FONTS.title)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...COLORS.primary)
  doc.text(data.ff3_number, 30, y + 10)

  doc.setFontSize(FONTS.body)
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.text(`Status: ${data.status}`, 30, y + 18)
  doc.text(`FY ${data.financial_year}`, pageWidth - 30, y + 10, { align: 'right' })
  doc.text(`Date: ${formatDate(data.request_date)}`, pageWidth - 30, y + 18, { align: 'right' })

  y += 35

  // Section A: Requisition Details
  y = addSectionTitle(doc, y, 'A. REQUISITION DETAILS')

  const col1X = 25
  const col2X = pageWidth / 2 + 5

  y = addKeyValue(doc, y, 'Department', data.department || '-', col1X)
  doc.setFont('helvetica', 'bold')
  doc.text('Section:', col2X, y - 6)
  doc.setFont('helvetica', 'normal')
  doc.text(data.section || '-', col2X + 45, y - 6)

  y = addKeyValue(doc, y, 'Province', data.province || '-', col1X)
  doc.setFont('helvetica', 'bold')
  doc.text('Funding Source:', col2X, y - 6)
  doc.setFont('helvetica', 'normal')
  doc.text(data.funding_source || '-', col2X + 45, y - 6)

  y = addKeyValue(doc, y, 'Required By', formatDate(data.required_by_date || null), col1X)
  doc.setFont('helvetica', 'bold')
  doc.text('Urgency:', col2X, y - 6)
  doc.setFont('helvetica', 'normal')
  doc.text(data.urgency_level || 'MEDIUM', col2X + 45, y - 6)

  y = addKeyValue(doc, y, 'Procurement', data.procurement_method || '-', col1X)

  y += 4

  // Section B: Purpose & Justification
  y = addSectionTitle(doc, y, 'B. PURPOSE & JUSTIFICATION')

  doc.setFontSize(FONTS.body)
  doc.setFont('helvetica', 'bold')
  doc.text('Purpose:', 25, y)
  doc.setFont('helvetica', 'normal')

  const purposeLines = doc.splitTextToSize(data.purpose, pageWidth - 55)
  doc.text(purposeLines, 25, y + 6)
  y += 6 + (purposeLines.length * 5)

  if (data.justification) {
    y += 4
    doc.setFont('helvetica', 'bold')
    doc.text('Justification:', 25, y)
    doc.setFont('helvetica', 'normal')

    const justLines = doc.splitTextToSize(data.justification, pageWidth - 55)
    doc.text(justLines, 25, y + 6)
    y += 6 + (justLines.length * 5)
  }

  y += 8

  // Section C: Items
  y = addSectionTitle(doc, y, 'C. REQUISITION ITEMS')

  autoTable(doc, {
    startY: y,
    head: [['#', 'Description', 'Qty', 'Unit', 'Unit Price', 'Total']],
    body: data.items.map(item => [
      item.line_number.toString(),
      item.item_description,
      item.quantity.toString(),
      item.unit_of_measure || '-',
      formatCurrency(item.estimated_unit_price || 0),
      formatCurrency(item.quantity * (item.estimated_unit_price || 0))
    ]),
    foot: [['', '', '', '', 'TOTAL:', formatCurrency(data.total_estimated_amount)]],
    theme: 'striped',
    headStyles: { fillColor: COLORS.primary, fontSize: FONTS.small },
    footStyles: { fillColor: COLORS.light, textColor: COLORS.primary, fontStyle: 'bold', fontSize: FONTS.body },
    styles: { fontSize: FONTS.small },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 15, halign: 'right' },
      3: { cellWidth: 20 },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 30, halign: 'right' },
    },
    margin: { left: 20, right: 20 },
  })

  y = doc.lastAutoTable.finalY + 10

  // Check if we need a new page
  if (y > doc.internal.pageSize.getHeight() - 80) {
    doc.addPage()
    y = 20
  }

  // Section D: Quotations
  y = addSectionTitle(doc, y, 'D. QUOTATIONS')

  autoTable(doc, {
    startY: y,
    head: [['Supplier', 'Quote #', 'Date', 'Amount', 'Selected']],
    body: data.quotations.map(q => [
      q.supplier_name,
      q.quotation_number || '-',
      formatDate(q.quotation_date || null),
      formatCurrency(q.quotation_amount),
      q.is_selected ? 'YES' : ''
    ]),
    theme: 'striped',
    headStyles: { fillColor: COLORS.primary, fontSize: FONTS.small },
    styles: { fontSize: FONTS.small },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 30 },
      2: { cellWidth: 30 },
      3: { cellWidth: 35, halign: 'right' },
      4: { cellWidth: 20, halign: 'center' },
    },
    margin: { left: 20, right: 20 },
  })

  y = doc.lastAutoTable.finalY + 10

  // Budget Status
  if (data.is_within_budget) {
    doc.setFillColor(200, 250, 200)
  } else {
    doc.setFillColor(250, 200, 200)
  }
  doc.roundedRect(20, y, pageWidth - 40, 12, 2, 2, 'F')
  doc.setFontSize(FONTS.body)
  doc.setFont('helvetica', 'bold')
  doc.text(
    data.is_within_budget ? 'WITHIN BUDGET - Sufficient funds available' : 'EXCEEDS BUDGET - Insufficient funds',
    pageWidth / 2, y + 8,
    { align: 'center' }
  )

  y += 20

  // Approval History if available
  if (data.approvals && data.approvals.length > 0) {
    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage()
      y = 20
    }

    y = addSectionTitle(doc, y, 'E. APPROVAL HISTORY')

    autoTable(doc, {
      startY: y,
      head: [['Level', 'Action', 'Date', 'Comments']],
      body: data.approvals.map(a => [
        a.approval_level.replace(/_/g, ' '),
        a.action_taken,
        formatDate(a.action_date),
        a.comments || '-'
      ]),
      theme: 'striped',
      headStyles: { fillColor: COLORS.primary, fontSize: FONTS.small },
      styles: { fontSize: FONTS.small },
      margin: { left: 20, right: 20 },
    })
  }

  // Add footer
  addFooter(doc, 1)

  return doc
}

// Generate FF4 PDF
export type FF4PDFData = {
  ff4_number: string
  financial_year: number
  payment_request_date: string
  status: string
  ff3_number?: string
  ff3_purpose?: string
  commitment_number?: string
  payee_type?: string
  payee_name: string
  supplier_code?: string
  invoice_number?: string
  invoice_date?: string
  payment_description?: string
  gross_amount: number
  tax_amount: number
  deductions: number
  net_amount: number
  payment_method?: string
  external_payment_reference?: string
  payment_date?: string
}

export function generateFF4PDF(data: FF4PDFData, existingDoc?: jsPDF): jsPDF {
  // When an existing document is passed (bulk export), append a new page and
  // render this FF4 onto it; otherwise create a fresh single-form document.
  const doc = existingDoc ?? new jsPDF()
  if (existingDoc) doc.addPage()
  const pageWidth = doc.internal.pageSize.getWidth()

  // Header
  let y = addHeader(doc, 'FINANCE FORM 4 (FF4)', 'Expense and Payment Request')

  // Document info box
  doc.setDrawColor(...COLORS.border)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(20, y, pageWidth - 40, 25, 3, 3, 'FD')

  doc.setFontSize(FONTS.title)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 128, 0)
  doc.text(data.ff4_number, 30, y + 10)

  doc.setFontSize(FONTS.body)
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.text(`Status: ${data.status}`, 30, y + 18)
  doc.text(`FY ${data.financial_year}`, pageWidth - 30, y + 10, { align: 'right' })
  doc.text(`Date: ${formatDate(data.payment_request_date)}`, pageWidth - 30, y + 18, { align: 'right' })

  y += 35

  // Section A: Linked Requisition
  if (data.ff3_number) {
    y = addSectionTitle(doc, y, 'A. LINKED REQUISITION')

    y = addKeyValue(doc, y, 'FF3 Number', data.ff3_number)
    if (data.ff3_purpose) {
      y = addKeyValue(doc, y, 'Purpose', data.ff3_purpose)
    }
    if (data.commitment_number) {
      y = addKeyValue(doc, y, 'Commitment', data.commitment_number)
    }

    y += 8
  }

  // Section B: Payee Information
  y = addSectionTitle(doc, y, 'B. PAYEE INFORMATION')

  const col1X = 25
  const col2X = pageWidth / 2 + 5

  y = addKeyValue(doc, y, 'Payee Type', data.payee_type || '-', col1X)
  doc.setFont('helvetica', 'bold')
  doc.text('Supplier Code:', col2X, y - 6)
  doc.setFont('helvetica', 'normal')
  doc.text(data.supplier_code || '-', col2X + 45, y - 6)

  y = addKeyValue(doc, y, 'Payee Name', data.payee_name, col1X)

  y += 8

  // Section C: Invoice Details
  y = addSectionTitle(doc, y, 'C. INVOICE DETAILS')

  y = addKeyValue(doc, y, 'Invoice No', data.invoice_number || '-', col1X)
  doc.setFont('helvetica', 'bold')
  doc.text('Invoice Date:', col2X, y - 6)
  doc.setFont('helvetica', 'normal')
  doc.text(formatDate(data.invoice_date || null), col2X + 45, y - 6)

  if (data.payment_description) {
    y += 4
    doc.setFont('helvetica', 'bold')
    doc.text('Description:', 25, y)
    doc.setFont('helvetica', 'normal')

    const descLines = doc.splitTextToSize(data.payment_description, pageWidth - 55)
    doc.text(descLines, 25, y + 6)
    y += 6 + (descLines.length * 5)
  }

  y += 8

  // Section D: Payment Amount
  y = addSectionTitle(doc, y, 'D. PAYMENT AMOUNT')

  autoTable(doc, {
    startY: y,
    body: [
      ['Gross Amount', formatCurrency(data.gross_amount)],
      ['Less: Tax', `- ${formatCurrency(data.tax_amount)}`],
      ['Less: Deductions', `- ${formatCurrency(data.deductions)}`],
    ],
    foot: [['NET AMOUNT PAYABLE', formatCurrency(data.net_amount)]],
    theme: 'plain',
    footStyles: {
      fillColor: [200, 250, 200],
      textColor: [0, 100, 0],
      fontStyle: 'bold',
      fontSize: FONTS.subtitle
    },
    styles: { fontSize: FONTS.body },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 60, halign: 'right' },
    },
    margin: { left: 40, right: 40 },
  })

  y = doc.lastAutoTable.finalY + 15

  // Section E: Payment Details
  y = addSectionTitle(doc, y, 'E. PAYMENT DETAILS')

  y = addKeyValue(doc, y, 'Method', data.payment_method || '-', col1X)
  y = addKeyValue(doc, y, 'Reference', data.external_payment_reference || 'Pending', col1X)
  y = addKeyValue(doc, y, 'Payment Date', formatDate(data.payment_date || null), col1X)

  // Status box at bottom
  y += 15
  const statusColor = data.status === 'PAID' || data.status === 'RECONCILED'
    ? [200, 250, 200] as [number, number, number]
    : data.status === 'CANCELLED'
      ? [250, 200, 200] as [number, number, number]
      : [255, 250, 200] as [number, number, number]

  doc.setFillColor(...statusColor)
  doc.roundedRect(40, y, pageWidth - 80, 20, 3, 3, 'F')
  doc.setFontSize(FONTS.subtitle)
  doc.setFont('helvetica', 'bold')
  doc.text(`Payment Status: ${data.status}`, pageWidth / 2, y + 12, { align: 'center' })

  // Add footer
  addFooter(doc, 1)

  return doc
}

// Download PDF helper
export function downloadPDF(doc: jsPDF, filename: string) {
  doc.save(filename)
}
