import type { NextRequest } from "next/server"
import { detectReportCategory } from "./domain"
import { executeReportSql } from "./execute"
import { guardReportSql } from "./guard"
import { correctReportSql, generateReportSql } from "./model"
import { assertReportCategoryPermission } from "./permissions"
import { buildChartSpec, buildNarrative } from "./presentation"
import type { ReportAgentResult } from "./types"
import { ReportAgentError } from "./types"

function clampMaxRows(value: number) {
  return Math.min(Math.max(Math.trunc(value || 250), 1), 1000)
}

function isCorrectableQueryFailure(error: unknown): error is ReportAgentError {
  return error instanceof ReportAgentError && error.code === "QUERY_FAILED"
}

export async function runReportAgent(input: {
  request: NextRequest
  question: string
  maxRows?: number
}): Promise<ReportAgentResult> {
  const startedAt = Date.now()
  const question = input.question.trim()
  if (!question) {
    throw new ReportAgentError("INVALID_QUESTION", "Enter a reporting question before generating a report.", 400)
  }
  if (question.length > 2000) {
    throw new ReportAgentError("INVALID_QUESTION", "The reporting question is too long. Keep it under 2,000 characters.", 400)
  }

  const maxRows = clampMaxRows(input.maxRows || 250)
  const category = detectReportCategory(question)
  await assertReportCategoryPermission(input.request, category)

  let candidateSql = await generateReportSql(question, category, maxRows)
  let guarded = guardReportSql(candidateSql, maxRows)
  let execution

  try {
    execution = await executeReportSql(input.request, guarded.sql, maxRows)
  } catch (error) {
    if (!isCorrectableQueryFailure(error)) throw error

    candidateSql = await correctReportSql({
      question,
      category,
      maxRows,
      previousSql: candidateSql,
      databaseError: error.message,
    })
    guarded = guardReportSql(candidateSql, maxRows)
    execution = await executeReportSql(input.request, guarded.sql, maxRows)
  }

  return {
    sql: guarded.sql,
    category,
    tables: guarded.tables,
    narrative: buildNarrative({
      category,
      rows: execution.rows,
      rowCount: execution.rowCount,
      truncated: execution.truncated,
    }),
    chart: buildChartSpec(execution.rows, question),
    rows: execution.rows,
    rowCount: execution.rowCount,
    truncated: execution.truncated,
    ms: Date.now() - startedAt,
  }
}
