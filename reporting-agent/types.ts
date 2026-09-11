import type { NextRequest } from "next/server"

export type ReportCategory =
  | "management"
  | "budget"
  | "funding"
  | "commitment"
  | "expenditure"
  | "supplier"
  | "audit"

export type ReportRow = Record<string, unknown>

export type ReportChartSpec =
  | {
      type: "bar" | "line"
      title: string
      xKey: string
      yKeys: string[]
    }
  | null

export interface ReportAgentRequest {
  question: string
  maxRows?: number
}

export interface ReportAgentResult {
  sql: string
  category: ReportCategory
  tables: string[]
  narrative: string
  chart: ReportChartSpec
  rows: ReportRow[]
  rowCount: number
  truncated: boolean
  ms: number
}

export interface GuardedSql {
  sql: string
  tables: string[]
}

export interface ReportExecutionResult {
  rows: ReportRow[]
  rowCount: number
  truncated: boolean
}

export interface RunAgentInput {
  request: NextRequest
  question: string
  maxRows: number
}

export class ReportAgentError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = "ReportAgentError"
    this.code = code
    this.status = status
  }
}
