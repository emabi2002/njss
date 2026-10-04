import type { ReportCategory } from "./types"
import { ReportAgentError } from "./types"

export interface ReportDomainConfig {
  label: string
  permissions: string[]
  description: string
}

export const REPORT_DOMAINS: Record<ReportCategory, ReportDomainConfig> = {
  management: {
    label: "Management",
    permissions: ["budget.report.view", "reports.view", "all"],
    description: "Operational commitment and payment activity reporting. Approved budget and funding positions require the standard annual reports.",
  },
  budget: {
    label: "Budget",
    permissions: ["budget.report.view", "budget.revision.report", "all"],
    description: "Unavailable in AI reporting. Use the standard annual reports for approved annual budget positions.",
  },
  funding: {
    label: "Funding",
    permissions: ["funding.view", "all"],
    description: "Unavailable in AI reporting. Use the standard annual reports for funding positions.",
  },
  commitment: {
    label: "FF3 / Commitments",
    permissions: ["ff3.view", "commitment.view", "all"],
    description: "FF3 requisitions, quotations, approvals, commitments and commitment movements.",
  },
  expenditure: {
    label: "FF4 / Expenditure",
    permissions: ["ff4.view", "all"],
    description: "FF4 payment requests, approvals, payment transactions and expenditure reporting.",
  },
  supplier: {
    label: "Suppliers",
    permissions: ["supplier.view", "all"],
    description: "Supplier registration, categories, compliance documents, follow-ups and transaction usage.",
  },
  audit: {
    label: "Audit",
    permissions: ["audit.view", "all"],
    description: "Audit trail and workflow status reporting for authorized audit users.",
  },
}

const CATEGORY_PATTERNS: Array<[ReportCategory, RegExp]> = [
  ["audit", /\b(audit|audit log|activity log|who changed|who updated|access log|change history|system activity)\b/i],
  ["supplier", /\b(supplier|suppliers|vendor|vendors|ipa registration|gst registration|supplier compliance)\b/i],
  ["expenditure", /\b(ff\s*4|ff4|payment|payments|paid|expenditure|spend|spent|invoice|invoices|disbursement)\b/i],
  ["commitment", /\b(ff\s*3|ff3|commitment|commitments|requisition|purchase request|quotation|quotations|procurement)\b/i],
  ["funding", /\b(funding|funds|funded|warrant|warrants|funding authority|receipt|receipts|quarterly release|releases)\b/i],
  ["budget", /\b(budget|budgets|allocation|allocations|ceiling|ceilings|supplementary|revision|reforecast|variance|annual plan)\b/i],
]

export function detectReportCategory(question: string): ReportCategory {
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(question)) return category
  }
  return "management"
}

export const DOMAIN_GLOSSARY = `
NJSS reporting conventions:
- Currency is Papua New Guinea Kina (PGK). Monetary sums should be rounded to 2 decimal places.
- FF3 represents commitment / purchase requisition activity.
- FF4 represents payment / expenditure activity and normally follows an FF3 commitment.
- FF3 flow: ff3_headers/items/quotations/approvals -> ff3_commitments -> commitment_transactions.
- FF4 flow: ff4_headers/approvals -> payment_transactions.
- Organization hierarchy commonly uses departments -> sections -> cost_centres.
- Use the requested financial year when stated. Otherwise prefer the currently open financial_years record when the query needs a year.
- Operational FF3 and FF4 activity is not an approved budget or funding position. Never calculate available budget, approved budget, funding balances, or budget variance from these records.
- Never infer a column or relation that is not present in the supplied schema.
`.trim()


// Check the whole request before category detection: mixed FF3/budget requests must
// never route through an operational category and fabricate an approved position.
export function assertSupportedReportQuestion(question: string) {
  const positionRequest = /\b(budget|budgets|allocation|allocations|ceiling|ceilings|supplementary|revision|reforecast|variance|annual plan|funding|funds|funded|warrant|warrants|funding authority|receipt|receipts|quarterly|release|releases|balance|balances|remaining budget|financial position|budget position|funding position|appropriation)\b/i
  if (positionRequest.test(question)) {
    throw new ReportAgentError(
      "ANNUAL_REPORT_REQUIRED",
      "AI budget, funding and approved position reports are unavailable. Use the standard annual Head Office reports at /dashboard/reports. AI reporting supports FF3, FF4, supplier and audit activity.",
      410,
    )
  }
}
