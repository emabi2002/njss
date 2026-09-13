import type { ReportCategory } from "./types"

export interface ReportDomainConfig {
  label: string
  permissions: string[]
  description: string
}

export const REPORT_DOMAINS: Record<ReportCategory, ReportDomainConfig> = {
  management: {
    label: "Management",
    permissions: ["budget.report.view", "reports.view", "all"],
    description: "Cross-domain management reporting across budget, funding, commitments and expenditure.",
  },
  budget: {
    label: "Budget",
    permissions: ["budget.report.view", "budget.revision.report", "all"],
    description: "Budget preparation, ceilings, allocations, monthly phasing, revisions and supplementary budget reporting.",
  },
  funding: {
    label: "Funding",
    permissions: ["funding.view", "all"],
    description: "Funding authorities, receipts, allocations and quarterly releases.",
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
- Budget flow: budget_cycles -> divisional_budget_submissions -> divisional_budget_lines -> budget_allocations.
- Funding flow: funding_authorities -> funding_receipts -> funding_allocations -> quarterly_releases.
- FF3 flow: ff3_headers/items/quotations/approvals -> ff3_commitments -> commitment_transactions.
- FF4 flow: ff4_headers/approvals -> payment_transactions.
- Organization hierarchy commonly uses departments -> sections -> cost_centres, with budget_divisions used for budget preparation.
- Use the requested financial year when stated. Otherwise prefer the currently open financial_years record when the query needs a year.
- Never infer a column or relation that is not present in the supplied schema.
`.trim()
