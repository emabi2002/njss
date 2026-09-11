import { ALLOWED_REPORT_TABLES } from "./schema.generated"
import type { GuardedSql } from "./types"
import { ReportAgentError } from "./types"

const BANNED_KEYWORDS = /\b(insert|update|delete|drop|alter|create|truncate|merge|grant|revoke|copy|call|execute|refresh|vacuum|analyze|reindex|cluster)\b/i
const BANNED_CLAUSES = /\bselect\s+into\b|\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i
const BANNED_SCHEMAS = /\b(auth|storage|realtime|vault|information_schema|pg_catalog)\s*\./i
const DANGEROUS_FUNCTIONS = /\b(nextval|setval|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink|dblink_exec|set_config|current_setting)\s*\(/i
const COMMENT_TOKENS = /--|\/\*/
const SELECT_STAR = /\bselect\s+(?:all\s+|distinct\s+)?\*|\b[a-zA-Z_][a-zA-Z0-9_]*\.\*/i

function normalizeIdentifier(value: string) {
  return value.replace(/"/g, "").replace(/\s/g, "").split(".").pop()?.toLowerCase() || ""
}

function extractCteNames(sql: string) {
  const names = new Set<string>()
  const ctePattern = /(?:\bwith\b|,)\s*(?:recursive\s+)?("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+as\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = ctePattern.exec(sql))) names.add(normalizeIdentifier(match[1]))
  return names
}

export function extractReferencedTables(sql: string) {
  const ctes = extractCteNames(sql)
  const tables = new Set<string>()
  const referencePattern = /\b(?:from|join)\s+(?:only\s+)?((?:"?[a-zA-Z_][a-zA-Z0-9_]*"?)(?:\s*\.\s*"?[a-zA-Z_][a-zA-Z0-9_]*"?)?)/gi
  let match: RegExpExecArray | null

  while ((match = referencePattern.exec(sql))) {
    const relation = normalizeIdentifier(match[1])
    if (!relation || ctes.has(relation)) continue
    tables.add(relation)
  }

  return Array.from(tables)
}

export function guardReportSql(candidate: string, maxRows = 1000): GuardedSql {
  if (!candidate || !candidate.trim()) {
    throw new ReportAgentError("UNSAFE_SQL", "The reporting model returned an empty query.", 422)
  }

  let statement = candidate.trim()
  if (COMMENT_TOKENS.test(statement)) {
    throw new ReportAgentError("UNSAFE_SQL", "SQL comments are not allowed in generated reports.", 422)
  }

  // One optional trailing semicolon is tolerated, but multiple statements are rejected.
  statement = statement.replace(/;\s*$/, "").trim()
  if (statement.includes(";")) {
    throw new ReportAgentError("UNSAFE_SQL", "Multiple SQL statements are not allowed.", 422)
  }

  if (!/^(select|with)\b/i.test(statement)) {
    throw new ReportAgentError("UNSAFE_SQL", "Only a single read-only SELECT or WITH query is allowed.", 422)
  }
  if (BANNED_KEYWORDS.test(statement) || BANNED_CLAUSES.test(statement)) {
    throw new ReportAgentError("UNSAFE_SQL", "Generated SQL contains a write, DDL, locking, or execution operation.", 422)
  }
  if (BANNED_SCHEMAS.test(statement)) {
    throw new ReportAgentError("UNSAFE_SQL", "Generated SQL references a protected internal schema.", 422)
  }
  if (DANGEROUS_FUNCTIONS.test(statement)) {
    throw new ReportAgentError("UNSAFE_SQL", "Generated SQL references a function that is not permitted for reporting.", 422)
  }
  if (SELECT_STAR.test(statement)) {
    throw new ReportAgentError("UNSAFE_SQL", "Generated reports must select explicit columns rather than SELECT *.", 422)
  }

  const tables = extractReferencedTables(statement)
  const disallowed = tables.filter((table) => !ALLOWED_REPORT_TABLES.has(table))
  if (disallowed.length) {
    throw new ReportAgentError(
      "UNSAFE_SQL",
      `Generated SQL references relations outside the reporting allow-list: ${disallowed.join(", ")}.`,
      422,
    )
  }

  const rowLimit = Math.min(Math.max(Math.trunc(maxRows || 1000), 1), 1000)
  const sql = `SELECT * FROM (\n${statement}\n) AS ai_report_result\nLIMIT ${rowLimit}`
  return { sql, tables }
}
