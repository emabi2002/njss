import type { NextRequest } from "next/server"
import { createRequestSupabaseClient } from "@/lib/rbac/server"
import type { ReportExecutionResult, ReportRow } from "./types"
import { ReportAgentError } from "./types"

interface RpcPayload {
  rows?: unknown
  row_count?: unknown
  truncated?: unknown
}

export async function executeReportSql(request: NextRequest, sql: string, maxRows: number): Promise<ReportExecutionResult> {
  // The request-scoped client carries the signed-in user's JWT. This is deliberately
  // not an admin/service-role client so Postgres RLS remains authoritative.
  const supabase = createRequestSupabaseClient(request)
  const { data, error } = await supabase.rpc("exec_report_sql", {
    query: sql,
    max_rows: Math.min(Math.max(Math.trunc(maxRows || 1000), 1), 1000),
  })

  if (error) {
    throw new ReportAgentError("QUERY_FAILED", error.message || "The generated report query failed.", 400)
  }

  const payload = (data || {}) as RpcPayload
  const rows = Array.isArray(payload.rows) ? (payload.rows as ReportRow[]) : []
  const rowCount = typeof payload.row_count === "number" ? payload.row_count : rows.length

  return {
    rows,
    rowCount,
    truncated: payload.truncated === true,
  }
}
