"use client"

import { useMemo, useState } from "react"
import {
  AlertTriangle,
  BarChart3 as BarChartIcon,
  Bot,
  ChevronDown,
  Download,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
  Table2,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { authFetch } from "@/lib/auth-fetch"
import type { ReportAgentResult, ReportRow } from "@/reporting-agent/types"

const EXAMPLES = [
  "Show FF4 payments by department this financial year",
  "Compare funding received against approved funding by authority",
  "Show outstanding FF3 commitments by department",
  "Summarize revised budget by division for the current financial year",
]

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function displayValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") {
    const isMoney = /(amount|budget|allocation|ceiling|commitment|payment|paid|spend|expenditure|expense|balance|variance|cost|received|released)/i.test(key)
    return new Intl.NumberFormat("en-PG", {
      minimumFractionDigits: isMoney ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(value)
  }
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function downloadCsv(rows: ReportRow[]) {
  if (!rows.length) return
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const csv = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n")

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `njss-ai-report-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function ResultChart({ result }: { result: ReportAgentResult }) {
  if (!result.chart || !result.rows.length) return null
  const chartRows = result.rows.slice(0, 30).map((row) => {
    const next: Record<string, unknown> = { ...row }
    for (const key of result.chart?.yKeys || []) {
      const value = row[key]
      if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) next[key] = Number(value)
    }
    return next
  })

  const common = {
    data: chartRows,
    margin: { top: 8, right: 18, left: 8, bottom: 8 },
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <BarChartIcon className="h-4 w-4 text-[#132A44]" />
            Visual analysis
          </div>
          <p className="mt-1 text-xs text-slate-500">Charting up to the first 30 returned rows.</p>
        </div>
      </div>
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {result.chart.type === "line" ? (
            <LineChart {...common}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={result.chart.xKey} minTickGap={24} />
              <YAxis />
              <Tooltip />
              <Legend />
              {result.chart.yKeys.map((key) => (
                <Line key={key} type="monotone" dataKey={key} stroke="#132A44" strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          ) : (
            <BarChart {...common}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={result.chart.xKey} minTickGap={24} />
              <YAxis />
              <Tooltip />
              <Legend />
              {result.chart.yKeys.map((key) => (
                <Bar key={key} dataKey={key} fill="#132A44" />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  )
}

export function AiReportPanel() {
  const [question, setQuestion] = useState("")
  const [maxRows, setMaxRows] = useState(250)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)
  const [result, setResult] = useState<ReportAgentResult | null>(null)

  const columns = useMemo(() => {
    if (!result?.rows.length) return []
    return Array.from(new Set(result.rows.flatMap((row) => Object.keys(row))))
  }, [result])

  async function generateReport() {
    const trimmed = question.trim()
    if (!trimmed || loading) return

    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const response = await authFetch("/api/reports/agent", {
        method: "POST",
        body: JSON.stringify({ question: trimmed, maxRows }),
      })
      const payload = (await response.json()) as ReportAgentResult | { error?: string; code?: string }
      if (!response.ok) {
        const failure = payload as { error?: string; code?: string }
        throw Object.assign(new Error(failure.error || "The AI report could not be generated."), { code: failure.code })
      }
      setResult(payload as ReportAgentResult)
    } catch (caught) {
      const err = caught as Error & { code?: string }
      setError({ message: err.message || "The AI report could not be generated.", code: err.code })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-gradient-to-r from-[#132A44] to-[#21496f] px-6 py-5 text-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/80">
                <Sparkles className="h-4 w-4" />
                Natural-language reporting
              </div>
              <h2 className="text-xl font-bold sm:text-2xl">Ask NJSS about its financial and operational data</h2>
              <p className="mt-2 text-sm leading-6 text-white/80">
                Describe the report you need in ordinary English. The assistant generates one read-only query and returns only information allowed by your signed-in NJSS permissions and data scope.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white/90">
              <ShieldCheck className="h-4 w-4" />
              Read-only · RLS enforced
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <label htmlFor="ai-report-question" className="text-sm font-semibold text-slate-800">
            What report would you like to generate?
          </label>
          <textarea
            id="ai-report-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void generateReport()
            }}
            maxLength={2000}
            rows={5}
            placeholder="Example: Show FF4 payments by department this financial year and total the net amount."
            className="mt-2 w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#315b82] focus:ring-4 focus:ring-[#315b82]/10"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setQuestion(example)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
              >
                {example}
              </button>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-slate-100 pt-5">
            <div>
              <label htmlFor="ai-report-max-rows" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Maximum rows
              </label>
              <div className="relative mt-1">
                <select
                  id="ai-report-max-rows"
                  value={maxRows}
                  onChange={(event) => setMaxRows(Number(event.target.value))}
                  className="appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-9 text-sm font-medium text-slate-700 outline-none focus:border-[#315b82]"
                >
                  <option value={100}>100 rows</option>
                  <option value={250}>250 rows</option>
                  <option value={500}>500 rows</option>
                  <option value={1000}>1,000 rows</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-slate-400" />
              </div>
            </div>

            <button
              type="button"
              onClick={() => void generateReport()}
              disabled={!question.trim() || loading}
              className="inline-flex min-w-[180px] items-center justify-center gap-2 rounded-xl bg-[#132A44] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d3d60] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {loading ? "Generating…" : "Generate report"}
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h3 className="font-semibold">Report could not be generated</h3>
              <p className="mt-1 text-sm leading-6">{error.message}</p>
              {error.code ? <p className="mt-2 font-mono text-xs text-amber-800">{error.code}</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      {result ? (
        <>
          <section className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Bot className="h-4 w-4 text-[#132A44]" />
                Report summary
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-700">{result.narrative}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium">Category: {humanize(result.category)}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium">{result.rowCount.toLocaleString()} rows</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium">{result.ms.toLocaleString()} ms</span>
                {result.truncated ? <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800">Row limit reached</span> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => downloadCsv(result.rows)}
              disabled={!result.rows.length}
              className="inline-flex h-fit items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </section>

          <ResultChart result={result} />

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Table2 className="h-4 w-4 text-[#132A44]" />
                  Report data
                </div>
                <p className="mt-1 text-xs text-slate-500">Results are filtered by your authenticated NJSS access scope.</p>
              </div>
              <span className="text-xs font-medium text-slate-500">{result.rowCount.toLocaleString()} returned</span>
            </div>

            {result.rows.length ? (
              <div className="max-h-[620px] overflow-auto">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr>
                      {columns.map((column) => (
                        <th key={column} className="whitespace-nowrap border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {humanize(column)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="hover:bg-slate-50/70">
                        {columns.map((column) => (
                          <td key={column} className="max-w-[360px] whitespace-nowrap px-4 py-3 text-slate-700">
                            {displayValue(column, row[column])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-5 py-12 text-center text-sm text-slate-500">No matching rows were returned.</div>
            )}
          </section>

          <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-slate-800">
              <span>Generated SQL</span>
              <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-slate-200 p-5">
              <p className="mb-3 text-xs leading-5 text-slate-500">
                This is the exact bounded read-only query submitted to the NJSS reporting RPC. It is shown for transparency and audit review.
              </p>
              <pre className="max-h-[360px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                <code>{result.sql}</code>
              </pre>
              {result.tables.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.tables.map((table) => (
                    <span key={table} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600">{table}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </details>
        </>
      ) : (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
          <Table2 className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-600">Your generated report will appear here.</p>
          <p className="mt-1 text-xs text-slate-400">No data is queried until you submit a reporting question.</p>
        </section>
      )}
    </div>
  )
}
