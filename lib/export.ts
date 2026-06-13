import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

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

// Download an array of objects as a CSV file (Excel-compatible).
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

  doc.setFontSize(16)
  doc.setTextColor(15, 23, 42)
  doc.text(opts.title, 14, 18)

  doc.setFontSize(10)
  doc.setTextColor(100, 116, 139)
  const sub = opts.subtitle ? `${opts.subtitle}   •   ` : ""
  doc.text(`${sub}Generated ${new Date().toLocaleString("en-GB")}`, 14, 25)

  autoTable(doc, {
    head: [opts.columns],
    body: opts.rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)))),
    startY: 30,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  })

  doc.save(opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`)
}

// Helper to turn an array of objects into PDF columns + rows.
export function rowsToPdfTable(rows: ExportRow[]): { columns: string[]; rows: ExportCell[][] } {
  if (rows.length === 0) return { columns: [], rows: [] }
  const columns = Object.keys(rows[0])
  return { columns, rows: rows.map((r) => columns.map((c) => r[c])) }
}
