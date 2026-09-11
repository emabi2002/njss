import { NextResponse, type NextRequest } from "next/server"
import {
  getServerAccessContext,
  hasAnyServerPermission,
  logServerAccessEvent,
} from "@/lib/rbac/server"
import { ReportAgentError, runReportAgent, type ReportAgentRequest } from "@/reporting-agent"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const context = await getServerAccessContext(request)
  if (!context) {
    return NextResponse.json({ error: "Authentication required", code: "UNAUTHENTICATED" }, { status: 401 })
  }

  if (!hasAnyServerPermission(context, ["reports.view"])) {
    await logServerAccessEvent(request, context, {
      action: "ACCESS_DENIED",
      entityType: "AI_REPORT",
      metadata: { required_permissions: ["reports.view"] },
    })
    return NextResponse.json({ error: "Access denied", code: "PERMISSION_DENIED" }, { status: 403 })
  }

  let payload: ReportAgentRequest
  try {
    payload = (await request.json()) as ReportAgentRequest
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body", code: "INVALID_REQUEST" }, { status: 400 })
  }

  const question = typeof payload?.question === "string" ? payload.question : ""
  const maxRows = typeof payload?.maxRows === "number" && Number.isFinite(payload.maxRows) ? payload.maxRows : 250

  try {
    const result = await runReportAgent({ request, question, maxRows })
    await logServerAccessEvent(request, context, {
      action: "AI_REPORT_GENERATED",
      entityType: "AI_REPORT",
      metadata: {
        category: result.category,
        tables: result.tables,
        row_count: result.rowCount,
        truncated: result.truncated,
        duration_ms: result.ms,
      },
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ReportAgentError) {
      await logServerAccessEvent(request, context, {
        action: "AI_REPORT_FAILED",
        entityType: "AI_REPORT",
        metadata: { code: error.code, status: error.status },
      })
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }

    console.error("AI reporting agent error", error)
    return NextResponse.json(
      { error: "The AI report could not be generated.", code: "REPORT_AGENT_ERROR" },
      { status: 500 },
    )
  }
}
