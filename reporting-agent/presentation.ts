import { REPORT_DOMAINS } from "./domain"
import type { ReportCategory, ReportChartSpec, ReportRow } from "./types"

const MEASURE_KEY = /(amount|budget|allocation|ceiling|commitment|payment|paid|spend|expenditure|expense|balance|variance|cost|total|count|number|received|released)/i
const MONEY_KEY = /(amount|budget|allocation|ceiling|commitment|payment|paid|spend|expenditure|expense|balance|variance|cost|received|released)/i
const IDENTIFIER_KEY = /(^id$|_id$|uuid|reference|number$|code$)/i

function numericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function formatMeasure(key: string, value: number) {
  if (MONEY_KEY.test(key)) {
    return new Intl.NumberFormat("en-PG", {
      style: "currency",
      currency: "PGK",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  }
  return new Intl.NumberFormat("en-PG", { maximumFractionDigits: 2 }).format(value)
}

export function buildNarrative(input: {
  category: ReportCategory
  rows: ReportRow[]
  rowCount: number
  truncated: boolean
}) {
  const label = REPORT_DOMAINS[input.category].label
  if (!input.rows.length) {
    return `No matching ${label.toLowerCase()} records were returned within your authorized NJSS data scope.`
  }

  const keys = Object.keys(input.rows[0] || {})
  const measureKeys = keys.filter((key) => {
    if (!MEASURE_KEY.test(key) || IDENTIFIER_KEY.test(key)) return false
    return input.rows.some((row) => numericValue(row[key]) !== null)
  })

  const measures = measureKeys.slice(0, 3).map((key) => {
    const values = input.rows.map((row) => numericValue(row[key])).filter((value): value is number => value !== null)
    const value = input.rows.length === 1 ? values[0] || 0 : values.reduce((sum, item) => sum + item, 0)
    return `${key.replace(/_/g, " ")}: ${formatMeasure(key, value)}`
  })

  const countText = `${input.rowCount} ${input.rowCount === 1 ? "row" : "rows"}`
  const truncation = input.truncated ? " The result reached the configured row limit, so additional matching records may exist." : ""
  const measureText = measures.length ? ` Key values across the returned data: ${measures.join("; ")}.` : ""
  return `The ${label} report returned ${countText} within your authorized NJSS data scope.${measureText}${truncation}`
}

export function buildChartSpec(rows: ReportRow[], question: string): ReportChartSpec {
  if (rows.length < 2) return null

  const keys = Object.keys(rows[0] || {})
  const xKey = keys.find((key) => {
    if (IDENTIFIER_KEY.test(key)) return false
    const values = rows.slice(0, 12).map((row) => row[key]).filter((value) => value !== null && value !== undefined)
    return values.length > 1 && values.every((value) => typeof value === "string" || value instanceof Date)
  })
  if (!xKey) return null

  const yKeys = keys
    .filter((key) => MEASURE_KEY.test(key) && !IDENTIFIER_KEY.test(key))
    .filter((key) => rows.some((row) => numericValue(row[key]) !== null))
    .slice(0, 3)
  if (!yKeys.length) return null

  const timeSeries = /(date|month|quarter|period)/i.test(xKey)
  return {
    type: timeSeries ? "line" : "bar",
    title: question.length > 90 ? `${question.slice(0, 87)}...` : question,
    xKey,
    yKeys,
  }
}
