# Management Reporting & Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver server-scoped management reporting with on-screen report preview and hierarchical drill-down from national financial position to department, section, cost centre, expense code, FF3, commitment, FF4 and payment records.

**Architecture:** Keep the existing report catalogue and export library, but move Management Monitoring data behind authenticated Next.js API routes using the request-scoped Supabase client and existing RBAC context. The server resolves the caller's effective data scope and applies it before aggregation; the client receives only authorised rows. A generic preview table carries drill-down metadata so users can navigate Department → Section → Cost Centre → Expense Code → transaction trace without exposing broader data.

**Tech Stack:** Next.js App Router, TypeScript, Supabase/Postgres RLS, existing RBAC helpers, React, existing CSV/Excel/PDF export helpers.

**Spec:** Approved conversation scope: Management Reports and Drill Down; existing dashboard scope and RBAC model.

## Global Constraints

- System Administrator retains universal access through `all`.
- Registrar and Payment/Reconciliation Officer have system-wide reporting scope when they hold `reports.view`.
- Line Supervisor and Requisition Officer are restricted to their assigned Section for report data.
- Server-side scope enforcement is authoritative; UI filters may narrow data but may never widen the caller's scope.
- Management reports must use authoritative financial views (`v_authoritative_budget_position` and derived security-invoker views).
- Transaction drill-down must expose direct links to existing FF3 and FF4 detail routes, never service-role credentials.
- Existing report exports remain available; Management Monitoring exports must use the same scoped result shown in preview.
- No report may download national rows and then rely on browser filtering for confidentiality.

---

### Task 1: Scoped Management Reporting Contract

**Files:**
- Create: `lib/rbac/management-reports.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: existing `getServerAccessContext()` and `createRequestSupabaseClient()`.
- Produces: regression contract requiring `/api/reports/management`, explicit report permission checks, section-scope filtering, management view usage, drill-down metadata, and client use of `authFetch`.

- [ ] **Step 1: Write the failing regression test**

The test must assert that:

```js
assert.equal(existsSync('app/api/reports/management/route.ts'), true)
assert.match(route, /reports\.view/)
assert.match(route, /section_id/)
assert.match(route, /v_authoritative_budget_position/)
assert.match(route, /v_ff3_ff4_transaction_trace/)
assert.match(page, /authFetch/)
assert.match(page, /Run Report/)
assert.match(page, /Drill Down/)
```

- [ ] **Step 2: Run test to verify RED**

Run: `node lib/rbac/management-reports.test.mjs`
Expected: FAIL because the scoped management reporting API and preview do not yet exist.

- [ ] **Step 3: Add CI step**

Add:

```yaml
- name: Management reporting and drill-down regression checks
  run: node lib/rbac/management-reports.test.mjs
```

immediately after the scoped dashboard regression.

- [ ] **Step 4: Commit RED state**

Commit message: `test(reports): require scoped management drill-down`

---

### Task 2: Server-Side Reporting Scope Resolver

**Files:**
- Create: `lib/reports/management-scope.ts`
- Test: `lib/rbac/management-reports.test.mjs`

**Interfaces:**
- Consumes: `UserAccessContext` and request-scoped Supabase client.
- Produces:

```ts
export type ManagementReportScope = {
  mode: 'SYSTEM' | 'SECTION'
  label: string
  departmentId: string | null
  sectionId: string | null
  province: { id: string; name: string } | null
  courtLocation: { id: string; name: string } | null
  department: { id: string; name: string } | null
  section: { id: string; name: string } | null
}

export async function resolveManagementReportScope(
  supabase: ReturnType<typeof createRequestSupabaseClient>,
  context: UserAccessContext,
): Promise<ManagementReportScope>
```

Rules:

```ts
if (context.permissions.includes('all')) return SYSTEM
if (context.scopes.some((s) => s.scope_type === 'SYSTEM_WIDE')) return SYSTEM
if (context.roleNames.includes('Registrar')) return SYSTEM
if (context.roleNames.includes('Payment/Reconciliation Officer')) return SYSTEM
if (context.sectionId) return SECTION
throw new Error('Reporting user has no enforceable organisational scope.')
```

- [ ] **Step 1: Extend the failing test for resolver rules**
- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Implement resolver and readable Province → Court Location → Department → Section label**
- [ ] **Step 4: Verify GREEN for resolver contract**
- [ ] **Step 5: Commit**

Commit message: `feat(reports): resolve server reporting scope`

---

### Task 3: Authenticated Management Report API

**Files:**
- Create: `app/api/reports/management/route.ts`
- Test: `lib/rbac/management-reports.test.mjs`

**Interfaces:**
- Consumes query parameters:

```ts
report: 'management-financial-summary' |
        'department-financial-position' |
        'section-financial-position' |
        'cost-centre-financial-position' |
        'expense-code-financial-position' |
        'funding-source-financial-position' |
        'ff3-ff4-transaction-trace'
financialYear: number
departmentId?: string
sectionId?: string
costCentreId?: string
expenseCodeRegistryId?: string
fundingSourceId?: string
status?: string
startDate?: YYYY-MM-DD
endDate?: YYYY-MM-DD
```

- Produces:

```ts
type ManagementReportResponse = {
  report: string
  title: string
  financialYear: number
  scope: ManagementReportScope
  appliedFilters: Record<string, string | null>
  columns: Array<{ key: string; label: string; kind?: 'text' | 'money' | 'number' | 'date' | 'status' | 'link' }>
  rows: Array<Record<string, unknown> & {
    drilldown?: { report: string; params: Record<string, string> }
    ff3Href?: string
    ff4Href?: string
  }>
  totals?: Record<string, number>
  lookups: {
    departments: Array<{ id: string; name: string }>
    sections: Array<{ id: string; department_id: string | null; name: string }>
  }
}
```

- [ ] **Step 1: Require authentication and `reports.view`/`budget.report.view`/`all`**
- [ ] **Step 2: Validate requested financial year and report ID**
- [ ] **Step 3: Resolve effective scope before building queries**
- [ ] **Step 4: For SECTION mode, force `section_id = context.sectionId` and reject attempts to request another section**
- [ ] **Step 5: For SYSTEM mode, allow optional Department/Section narrowing after validating the Section belongs to the requested Department**
- [ ] **Step 6: Build Management Financial Summary from `v_authoritative_budget_position` after applying scope, not from the national aggregate view**
- [ ] **Step 7: Build organisational position reports from the security-invoker views and apply scope before rows are returned**
- [ ] **Step 8: Build transaction trace from `v_ff3_ff4_transaction_trace`, including FF3/FF4 IDs/numbers, commitment, payee, payment reference, reconciliation and links**
- [ ] **Step 9: Add hierarchical drill-down metadata:**

```text
Department row → section-financial-position
Section row → cost-centre-financial-position
Cost-centre row → expense-code-financial-position
Expense-code row → ff3-ff4-transaction-trace
Funding-source row → ff3-ff4-transaction-trace
```

- [ ] **Step 10: Return lookup lists constrained to the effective scope**
- [ ] **Step 11: Run regression test and TypeScript check**
- [ ] **Step 12: Commit**

Commit message: `feat(reports): add scoped management reporting API`

---

### Task 4: On-Screen Report Preview and Drill-Down UI

**Files:**
- Modify: `app/dashboard/reports/page.tsx`
- Create: `components/reports/ManagementReportPreview.tsx`
- Test: `lib/rbac/management-reports.test.mjs`

**Interfaces:**
- Consumes `ManagementReportResponse` from `/api/reports/management` via `authFetch()`.
- Produces preview state and drill-down navigation.

- [ ] **Step 1: Add `Run Report` button for Management Monitoring reports**
- [ ] **Step 2: Call `/api/reports/management` with selected FY/date/status/org filters**
- [ ] **Step 3: Render scope banner above results**

Example:

```text
Report Scope: Milne Bay Province › Alotau National Court Registry › Alotau - Judicial Support › Circuit Support
```

- [ ] **Step 4: Render columns/rows in an on-screen table with money/date/status formatting**
- [ ] **Step 5: Render `Drill Down` action for rows containing drill-down metadata**
- [ ] **Step 6: Push current report/filter state onto a breadcrumb stack before drilling**
- [ ] **Step 7: Add Back control and breadcrumb labels**
- [ ] **Step 8: Render direct `Open FF3` and `Open FF4` links on transaction-trace rows**
- [ ] **Step 9: Disable Department/Section widening in SECTION mode; display the assigned values as locked scope**
- [ ] **Step 10: Keep existing report catalogue cards and bulk PDF exports unchanged**
- [ ] **Step 11: Verify regression and TypeScript**
- [ ] **Step 12: Commit**

Commit message: `feat(reports): add management preview and drill-down`

---

### Task 5: Scoped Export Parity

**Files:**
- Modify: `app/dashboard/reports/page.tsx`
- Modify/Create as needed: `components/reports/ManagementReportPreview.tsx`
- Test: `lib/rbac/management-reports.test.mjs`

**Interfaces:**
- Consumes the already-authorised preview rows.
- Produces CSV/Excel/PDF/Print using the same scoped dataset.

- [ ] **Step 1: For Management Monitoring reports, export `preview.rows` instead of rebuilding a direct browser Supabase query**
- [ ] **Step 2: Refuse export until the report has been run at least once for the current filters**
- [ ] **Step 3: Include report title, financial year and scope label in PDF/print metadata where supported**
- [ ] **Step 4: Re-run regression, lint, typecheck and build**
- [ ] **Step 5: Commit**

Commit message: `fix(reports): keep exports aligned with scoped preview`

---

### Task 6: Live Financial Reconciliation Verification

**Files:**
- No production source unless a discrepancy is discovered.

**Interfaces:**
- Consumes live authoritative views and configured users.
- Produces verification evidence for national and section-scoped report totals.

- [ ] **Step 1: Verify national FY2026 totals from `v_authoritative_budget_position`**
- [ ] **Step 2: Verify at least one SECTION_WIDE user receives no data outside their assigned section**
- [ ] **Step 3: Verify Department → Section → Cost Centre → Expense Code totals reconcile at each parent/child level**
- [ ] **Step 4: Verify transaction trace amounts reconcile to commitment paid/outstanding and payment transactions**
- [ ] **Step 5: Confirm no report endpoint can be widened by changing query parameters**
- [ ] **Step 6: Record any data-quality gaps separately instead of masking them in UI**

---

### Task 7: Final CI and Readiness Gate

**Files:**
- No additional source expected.

- [ ] **Step 1: Run/inspect complete GitHub CI for the final commit**
- [ ] **Step 2: Confirm management reporting regression passes**
- [ ] **Step 3: Confirm all existing RBAC, budget, backup and password regressions pass**
- [ ] **Step 4: Confirm lint passes**
- [ ] **Step 5: Confirm TypeScript passes**
- [ ] **Step 6: Confirm production build passes**
- [ ] **Step 7: Hand off for browser UAT with one System Administrator, Registrar, Line Supervisor, Requisition Officer and Payment/Reconciliation Officer account**
