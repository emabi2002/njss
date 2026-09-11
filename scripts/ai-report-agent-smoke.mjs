const baseUrl = process.env.NJSS_BASE_URL?.trim()
const accessToken = process.env.NJSS_ACCESS_TOKEN?.trim()
const question = process.env.NJSS_REPORT_QUESTION?.trim() || "Show FF4 payments by department this financial year"
const requestedRows = Number(process.env.NJSS_REPORT_MAX_ROWS || 25)
const maxRows = Number.isFinite(requestedRows) ? Math.min(Math.max(Math.trunc(requestedRows), 1), 100) : 25
const timeoutMs = Math.min(Math.max(Number(process.env.NJSS_REPORT_SMOKE_TIMEOUT_MS || 60000), 5000), 120000)

if (!baseUrl) {
  console.error("NJSS_BASE_URL is required, for example https://deploy-preview-33--njsscrem.netlify.app")
  process.exit(2)
}

if (!accessToken) {
  console.error("NJSS_ACCESS_TOKEN is required. Use a short-lived UAT user access token with reports.view and the domain permission needed by the test question.")
  process.exit(2)
}

const endpoint = new URL("/api/reports/agent", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)

let response
try {
  response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, maxRows }),
    signal: AbortSignal.timeout(timeoutMs),
  })
} catch (error) {
  console.error("AI reporting smoke test could not reach the deployed endpoint:", error instanceof Error ? error.message : String(error))
  process.exit(1)
}

let payload
try {
  payload = await response.json()
} catch {
  console.error(`AI reporting smoke test received HTTP ${response.status} with a non-JSON body.`)
  process.exit(1)
}

if (!response.ok) {
  console.error(`AI reporting smoke test failed with HTTP ${response.status}.`)
  console.error(`Code: ${typeof payload?.code === "string" ? payload.code : "UNKNOWN"}`)
  console.error(`Error: ${typeof payload?.error === "string" ? payload.error : "No API error message returned."}`)
  process.exit(1)
}

const requiredChecks = {
  sql: typeof payload?.sql === "string" && payload.sql.trim().length > 0,
  category: typeof payload?.category === "string" && payload.category.trim().length > 0,
  tables: Array.isArray(payload?.tables),
  narrative: typeof payload?.narrative === "string",
  rows: Array.isArray(payload?.rows),
  rowCount: typeof payload?.rowCount === "number" && Number.isFinite(payload.rowCount),
  truncated: typeof payload?.truncated === "boolean",
  ms: typeof payload?.ms === "number" && Number.isFinite(payload.ms),
}

const missing = Object.entries(requiredChecks)
  .filter(([, valid]) => !valid)
  .map(([field]) => field)

if (missing.length) {
  console.error(`AI reporting smoke test returned an invalid response contract. Invalid fields: ${missing.join(", ")}`)
  process.exit(1)
}

if (!/^(select|with)\b/i.test(payload.sql.trim())) {
  console.error("AI reporting smoke test returned SQL that does not begin with SELECT or WITH.")
  process.exit(1)
}

if (/\b(insert|update|delete|drop|alter|create|truncate|merge|grant|revoke)\b/i.test(payload.sql)) {
  console.error("AI reporting smoke test returned SQL containing a prohibited mutation/DDL keyword.")
  process.exit(1)
}

console.log("AI reporting live smoke test passed.")
console.log(`Endpoint: ${endpoint.origin}${endpoint.pathname}`)
console.log(`Category: ${payload.category}`)
console.log(`Tables: ${payload.tables.join(", ") || "none"}`)
console.log(`Rows: ${payload.rowCount}${payload.truncated ? " (truncated)" : ""}`)
console.log(`Elapsed: ${payload.ms} ms`)
