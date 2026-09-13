import type { NextRequest } from "next/server"
import { createRequestSupabaseClient } from "@/lib/rbac/server"
import { REPORT_DOMAINS } from "./domain"
import type { ReportCategory } from "./types"
import { ReportAgentError } from "./types"

export async function assertReportCategoryPermission(request: NextRequest, category: ReportCategory) {
  const supabase = createRequestSupabaseClient(request)
  const permissions = REPORT_DOMAINS[category].permissions
  const { data, error } = await supabase.rpc("report_agent_can", { perm_codes: permissions })

  if (error) {
    throw new ReportAgentError("PERMISSION_CHECK_FAILED", "Unable to verify reporting permissions.", 500)
  }
  if (data !== true) {
    throw new ReportAgentError(
      "PERMISSION_DENIED",
      `You do not have permission to run ${REPORT_DOMAINS[category].label.toLowerCase()} AI reports.`,
      403,
    )
  }
}
