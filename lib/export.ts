import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { getOrg, orgAddressLine, orgContactLine, getLogoForPdf } from "./org"

export type ExportCell = string | number | null | undefined
export type ExportRow = Record<string, ExportCell>

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Pretty-print a numeric value for human-facing outputs (PDF / Print).
// Integers stay whole; decimals get 2 places. Always thousands-separated.
function formatCell(value: ExportCell): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? value.toLocaleString("en-US")
      : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return String(value)
}

// Download an array of objects as a CSV file (Excel-compatible, keeps raw numbers).
export function exportToCSV(filename: string, rows: ExportRow[]): void {
  if (typeof window === "undefined" || rows.length === 0) return
  const headers = Object.keys(rows[0])
  const escape = (v: ExportCell) => {
    const s = v === null || v === undefined ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n")
  // BOM so Excel reads UTF-8 correctly
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" })
  triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`)
}

// Download a true Excel workbook (.xls). Uses the Office HTML/XML format which
// Excel, LibreOffice and Google Sheets open natively, with styled headers and
// numbers kept as real numbers so spreadsheet formulas work.
export function exportToExcel(
  filename: string,
  rows: ExportRow[],
  opts?: { title?: string; subtitle?: string; sheetName?: string }
): void {
  if (typeof window === "undefined" || rows.length === 0) return
  const headers = Object.keys(rows[0])
  const sheetName = (opts?.sheetName || "Report").replace(/[\\/?*[\]:]/g, "").slice(0, 31)

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

  const cellHtml = (v: ExportCell) => {
    if (v === null || v === undefined) return `<td></td>`
    if (typeof v === "number" && Number.isFinite(v)) {
      return `<td style="mso-number-format:'#,##0.00';" align="right">${v}</td>`
    }
    return `<td>${esc(String(v))}</td>`
  }

  const org = getOrg()
  const addr = orgAddressLine(org)
  const contact = orgContactLine(org)
  const orgNameRow = `<tr><th colspan="${headers.length}" style="font-size:15px;text-align:left;background:#8a1420;color:#fff;padding:6px;">${esc(org.name)}</th></tr>`
  const orgAddrRow = addr
    ? `<tr><td colspan="${headers.length}" style="font-size:11px;color:#334155;padding:3px 6px;">${esc(addr)}</td></tr>`
    : ""
  const orgContactRow = contact
    ? `<tr><td colspan="${headers.length}" style="font-size:11px;color:#334155;padding:3px 6px;">${esc(contact)}</td></tr>`
    : ""
  const titleRow = opts?.title
    ? `<tr><td colspan="${headers.length}" style="font-size:13px;font-weight:bold;color:#0f172a;padding:6px;">${esc(opts.title)}</td></tr>`
    : ""
  const subtitleRow = opts?.subtitle
    ? `<tr><td colspan="${headers.length}" style="font-size:11px;color:#475569;padding:4px 6px;">${esc(opts.subtitle)}</td></tr>`
    : ""

  const headRow = `<tr>${headers
    .map(
      (h) =>
        `<th style="background:#8a1420;color:#ffffff;border:1px solid #b91c1c;padding:6px;text-align:left;">${esc(h)}</th>`
    )
    .join("")}</tr>`

  const bodyRows = rows
    .map(
      (r, i) =>
        `<tr style="background:${i % 2 ? "#f8fafc" : "#ffffff"};">${headers
          .map((h) => cellHtml(r[h]))
          .join("")}</tr>`
    )
    .join("")

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/>
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>${esc(sheetName)}</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>td,th{border:1px solid #cbd5e1;font-family:Calibri,Arial,sans-serif;}</style>
</head>
<body><table>${orgNameRow}${orgAddrRow}${orgContactRow}${titleRow}${subtitleRow}${headRow}${bodyRows}</table></body></html>`

  const blob = new Blob(["\ufeff" + html], { type: "application/vnd.ms-excel;charset=utf-8;" })
  triggerDownload(blob, filename.endsWith(".xls") ? filename : `${filename}.xls`)
}

// Render a titled table to PDF and save it.
export function exportToPDF(opts: {
  title: string
  subtitle?: string
  columns: string[]
  rows: ExportCell[][]
  filename: string
}): void {
  if (typeof window === "undefined") return
  const doc = new jsPDF({ orientation: opts.columns.length > 6 ? "landscape" : "portrait" })
  const org = getOrg()
  const pageWidth = doc.internal.pageSize.getWidth()
  const addr = orgAddressLine(org)
  const contact = orgContactLine(org)

  // Branded organization header band
  let bandH = 16
  if (addr) bandH += 5
  if (contact) bandH += 5
  doc.setFillColor(138, 20, 32) // PNG red
  doc.rect(0, 0, pageWidth, bandH, "F")

  // Organization logo (left), text shifts right when a logo is present.
  let textX = 14
  const logo = getLogoForPdf()
  if (logo && logo.h > 0 && logo.dataUrl) {
    const drawH = Math.min(bandH - 6, 14)
    const drawW = drawH * (logo.w / logo.h)
    try {
      doc.addImage(logo.dataUrl, "PNG", 10, (bandH - drawH) / 2, drawW, drawH)
      textX = 10 + drawW + 4
    } catch {
      /* logo not embeddable */
    }
  }

  doc.setTextColor(255, 255, 255)
  let hy = 8
  doc.setFontSize(13)
  doc.setFont("helvetica", "bold")
  doc.text(org.name.toUpperCase(), textX, hy)
  hy += 5
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7.5)
  if (addr) { doc.text(addr, textX, hy); hy += 4.5 }
  if (contact) { doc.text(contact, textX, hy); hy += 4.5 }

  // Report title + meta
  const y = bandH + 9
  doc.setTextColor(76, 15, 22) // PNG maroon
  doc.setFontSize(14)
  doc.setFont("helvetica", "bold")
  doc.text(opts.title, 14, y)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  const sub = opts.subtitle ? `${opts.subtitle}   •   ` : ""
  doc.text(`${sub}Generated ${new Date().toLocaleString("en-GB")}`, 14, y + 6)

  autoTable(doc, {
    head: [opts.columns],
    body: opts.rows.map((r) => r.map((c) => formatCell(c))),
    startY: y + 11,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [138, 20, 32], textColor: 255 }, // PNG red
    alternateRowStyles: { fillColor: [248, 250, 252] },
  })

  doc.save(opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`)
}

// Print styles are injected once into the host document. We render the report
// into a dedicated #njss-print-root and hide everything else during printing.
// This main-document approach works inside sandboxed preview iframes and on the
// deployed site (unlike nested-iframe / window.open printing).
const PRINT_STYLE_ID = "njss-print-style"
const PRINT_ROOT_ID = "njss-print-root"

function ensurePrintStyle() {
  if (document.getElementById(PRINT_STYLE_ID)) return
  const style = document.createElement("style")
  style.id = PRINT_STYLE_ID
  style.textContent = `
    #${PRINT_ROOT_ID}{display:none;}
    @media print{
      html,body{background:#fff !important;height:auto !important;}
      body > *:not(#${PRINT_ROOT_ID}){display:none !important;}
      #${PRINT_ROOT_ID}{display:block !important;position:static !important;margin:0;padding:0;color:#0f172a;font-family:'Segoe UI',Arial,sans-serif;}
      #${PRINT_ROOT_ID} .njss-print-brand{border-bottom:3px solid #8a1420;padding-bottom:10px;margin-bottom:6px;}
      #${PRINT_ROOT_ID} .njss-print-brand h1{margin:0;font-size:18px;color:#8a1420;letter-spacing:.04em;}
      #${PRINT_ROOT_ID} .njss-print-brand .njss-print-logo{max-height:60px;max-width:240px;margin-bottom:8px;object-fit:contain;}
      #${PRINT_ROOT_ID} .njss-print-brand .njss-print-org{margin:2px 0 0;font-size:10px;color:#475569;}
      #${PRINT_ROOT_ID} .njss-print-brand p{margin:6px 0 0;font-size:13px;font-weight:600;color:#1e293b;}
      #${PRINT_ROOT_ID} .njss-print-meta{font-size:11px;color:#64748b;margin-bottom:16px;}
      #${PRINT_ROOT_ID} table{width:100%;border-collapse:collapse;font-size:11px;}
      #${PRINT_ROOT_ID} thead{display:table-header-group;}
      #${PRINT_ROOT_ID} th{background:#8a1420 !important;color:#fff !important;text-align:left;padding:7px 8px;border:1px solid #6b0f18;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      #${PRINT_ROOT_ID} td{padding:6px 8px;border:1px solid #e2e8f0;}
      #${PRINT_ROOT_ID} td.num{text-align:right;}
      #${PRINT_ROOT_ID} tbody tr:nth-child(even){background:#f8fafc !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      #${PRINT_ROOT_ID} tr{break-inside:avoid;}
      #${PRINT_ROOT_ID} .njss-print-foot{margin-top:18px;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:8px;}
      @page{margin:12mm;}
    }
  `
  document.head.appendChild(style)
}

// Render a branded, print-ready table into the page and open the print dialog.
export function printRows(opts: {
  title: string
  subtitle?: string
  columns: string[]
  rows: ExportCell[][]
}): void {
  if (typeof window === "undefined") return
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

  const isNumericCol = opts.columns.map((_, ci) =>
    opts.rows.some((r) => typeof r[ci] === "number")
  )

  const thead = `<tr>${opts.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`
  const tbody = opts.rows
    .map(
      (r) =>
        `<tr>${r
          .map((c, ci) => `<td class="${isNumericCol[ci] ? "num" : ""}">${esc(formatCell(c))}</td>`)
          .join("")}</tr>`
    )
    .join("")

  const org = getOrg()
  const addr = orgAddressLine(org)
  const contact = orgContactLine(org)
  const inner = `
    <div class="njss-print-brand">
      ${org.logo_url ? `<img class="njss-print-logo" src="${esc(org.logo_url)}" alt="" />` : ""}
      <h1>${esc(org.name)}</h1>
      ${addr ? `<div class="njss-print-org">${esc(addr)}</div>` : ""}
      ${contact ? `<div class="njss-print-org">${esc(contact)}</div>` : ""}
      <p>${esc(opts.title)}</p>
    </div>
    <div class="njss-print-meta">${
      opts.subtitle ? esc(opts.subtitle) + " &nbsp;•&nbsp; " : ""
    }Generated ${esc(new Date().toLocaleString("en-GB"))}</div>
    <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
    <div class="njss-print-foot">${esc(org.name)}${org.subtitle ? " — " + esc(org.subtitle) : ""}</div>`

  ensurePrintStyle()

  let root = document.getElementById(PRINT_ROOT_ID)
  if (!root) {
    root = document.createElement("div")
    root.id = PRINT_ROOT_ID
    document.body.appendChild(root)
  }
  root.innerHTML = inner

  const cleanup = () => {
    window.removeEventListener("afterprint", cleanup)
    if (root) root.innerHTML = ""
  }
  window.addEventListener("afterprint", cleanup)

  // Let the browser paint the print root before invoking the dialog.
  setTimeout(() => {
    try {
      window.focus()
      window.print()
    } catch {
      cleanup()
    }
    // Safety net if afterprint never fires (some browsers).
    setTimeout(cleanup, 60000)
  }, 120)
}

// Helper to turn an array of objects into PDF columns + rows.
export function rowsToPdfTable(rows: ExportRow[]): { columns: string[]; rows: ExportCell[][] } {
  if (rows.length === 0) return { columns: [], rows: [] }
  const columns = Object.keys(rows[0])
  return { columns, rows: rows.map((r) => columns.map((c) => r[c])) }
}
