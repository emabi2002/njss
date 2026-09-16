# FF3 Budget-Control Blocking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ACTIVE simplified Head Office budget authoritative for FF3 while allowing insufficient-budget requisitions to continue through managerial review without creating a financial commitment.

**Architecture:** Add a separate FF3 budget-control state keyed by Financial Year + Division + Section + global Expense Ledger. When an ACTIVE simplified annual budget exists, FF3 uses `get_current_budget_position`; otherwise the current 2026 legacy allocation/release logic remains the compatibility fallback. Managerial transitions may proceed while `INSUFFICIENT_BUDGET_BLOCKED`, but final approval takes a transaction-level budget-key lock, rechecks available budget, and creates a commitment only when sufficient.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Supabase Postgres/RPC/RLS, Bun CI, Node contract tests.

**Spec:** `docs/superpowers/specs/2026-09-17-simplified-head-office-budget-design.md`

## Global Constraints

- The authoritative simplified budget key is `Financial Year + Division + Section + Ledger`.
- Only an `ACTIVE` simplified annual budget is authoritative.
- `INSUFFICIENT_BUDGET_BLOCKED` is separate from FF3 workflow status.
- Blocked FF3s may move through managerial endorsement but must not create commitments.
- Final commitment creation must atomically recheck budget and reject over-commitment.
- No user may override the budget ceiling.
- Existing 2026 legacy FF3/FF4 records and financial-control data must remain unchanged.
- If no ACTIVE simplified annual budget exists for a financial year, preserve the current legacy budget-allocation/release control path.
- Requesters select the centrally maintained global ledger in simplified mode; they cannot create finance codes from FF3.
- Changes are additive; do not drop legacy budget, FF3, FF4, commitment, or payment tables.

---

### Task 1: Database Budget-Control State and Preview/Refresh RPCs

**Files:**
- Create: `supabase/migrations/20260917030000_ff3_simplified_budget_control.sql`
- Create: `scripts/ff3-budget-control-blocking.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces columns on `ff3_headers`: `expense_ledger_id uuid`, `budget_control_status varchar`, `budget_control_source varchar`, `budget_available_at_check numeric`, `budget_shortfall_amount numeric`, `budget_checked_at timestamptz`.
- Produces columns on `ff3_commitments`: `expense_ledger_id uuid`.
- Produces columns on `commitment_transactions`: `expense_ledger_id uuid`; `budget_allocation_id` becomes nullable for simplified-budget commitments.
- Produces RPC `preview_ff3_budget_control(p_financial_year integer, p_department_id uuid, p_section_id uuid, p_expense_ledger_id uuid, p_expense_code_registry_id uuid, p_cost_centre_id uuid, p_funding_source_id uuid, p_project_id uuid, p_requested_amount numeric)` returning one row containing `control_source`, `budget_control_status`, `budget_allocation_id`, `expense_ledger_id`, `mapping_status`, `current_approved_budget`, `outstanding_commitments`, `actual_expenditure`, `available_budget`, `requested_amount`, `shortfall_amount`, `within_budget`, `has_allocation`.
- Produces RPC `refresh_ff3_budget_control(p_ff3_id uuid)` returning the same position as JSON and persisting the separate FF3 budget-control state.

- [ ] **Step 1: Write the failing migration contract**

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'

const path = 'supabase/migrations/20260917030000_ff3_simplified_budget_control.sql'
assert.ok(fs.existsSync(path), 'Phase 3 migration must exist')
const sql = fs.readFileSync(path, 'utf8')
for (const token of [
  'expense_ledger_id uuid',
  'budget_control_status',
  'INSUFFICIENT_BUDGET_BLOCKED',
  'preview_ff3_budget_control',
  'refresh_ff3_budget_control',
  'SIMPLIFIED_ACTIVE',
  'LEGACY_FALLBACK',
  'get_current_budget_position',
]) assert.ok(sql.includes(token), `migration must contain ${token}`)
for (const destructive of ['DROP TABLE public.ff3_headers','DROP TABLE public.ff3_commitments','TRUNCATE public.ff3_headers']) {
  assert.ok(!sql.includes(destructive), `migration must not contain ${destructive}`)
}
console.log('FF3 budget-control migration contract: ok')
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node scripts/ff3-budget-control-blocking.test.mjs`
Expected: FAIL because the migration does not yet exist.

- [ ] **Step 3: Implement the migration**

The preview RPC must first detect exactly one `annual_budget_cycles.status='ACTIVE'` row for the requested FY. In simplified mode it requires Division, Section and active posting Ledger and reads the exact row from `get_current_budget_position`. A missing current-position row is a valid zero-budget position, producing `INSUFFICIENT_BUDGET_BLOCKED` for positive requests. In legacy mode it reproduces the current exact `budget_allocations` matching rules and release-based available calculation. `refresh_ff3_budget_control` calls the preview RPC from the persisted FF3 dimensions and updates the header fields server-side.

- [ ] **Step 4: Run the migration contract and existing budget contracts**

Run: `node scripts/ff3-budget-control-blocking.test.mjs && node scripts/simplified-budget-adjustments.test.mjs && node scripts/simplified-budget-event-dimensions.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260917030000_ff3_simplified_budget_control.sql scripts/ff3-budget-control-blocking.test.mjs .github/workflows/ci.yml
git commit -m "feat: add FF3 simplified budget control state"
```

---

### Task 2: Make FF3 Workflow Permit Managerial Review but Block Commitment

**Files:**
- Modify: `supabase/migrations/20260917030000_ff3_simplified_budget_control.sql`
- Create: `scripts/ff3-budget-transition-blocking.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Replaces `njss_transition_ff3(uuid,text,text,text)` without changing its public signature.
- `SUBMIT`, `ENDORSE_SUPERVISOR`, and `ENDORSE_SECTION_HEAD` refresh budget state.
- In `SIMPLIFIED_ACTIVE`, insufficient budget does not prevent those managerial transitions.
- In `LEGACY_FALLBACK`, current insufficient-budget submit behavior remains unchanged.
- `APPROVE` uses `pg_advisory_xact_lock` on FY/Division/Section/Ledger, refreshes under the lock, and raises `INSUFFICIENT BUDGET - COMMITMENT BLOCKED` unless the state is `SUFFICIENT`.
- Successful simplified approval inserts `ff3_commitments.expense_ledger_id` and `commitment_transactions.expense_ledger_id`; it does not require a legacy `budget_allocation_id`.

- [ ] **Step 1: Write the failing workflow contract**

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql = fs.readFileSync('supabase/migrations/20260917030000_ff3_simplified_budget_control.sql','utf8')
for (const token of [
  "p_action IN ('SUBMIT','ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD')",
  'refresh_ff3_budget_control',
  'pg_advisory_xact_lock',
  'INSUFFICIENT BUDGET - COMMITMENT BLOCKED',
  "v_control_source = 'SIMPLIFIED_ACTIVE'",
  'expense_ledger_id',
]) assert.ok(sql.includes(token), `workflow migration must contain ${token}`)
assert.ok(sql.includes("v_control_source = 'LEGACY_FALLBACK'"), 'legacy fallback must remain explicit')
console.log('FF3 workflow blocking contract: ok')
```

- [ ] **Step 2: Run and confirm RED**

Run: `node scripts/ff3-budget-transition-blocking.test.mjs`
Expected: FAIL until the transition RPC is replaced.

- [ ] **Step 3: Implement the transition replacement**

Preserve all current status/permission/segregation-of-duties checks. Only budget handling changes. A blocked simplified FF3 can be `SUBMITTED`, `ENDORSED_SUPERVISOR`, and `ENDORSED_SECTION_HEAD`; `APPROVE` must leave the workflow unchanged and create no commitment when the final atomic recheck is insufficient.

- [ ] **Step 4: Run the workflow and legacy preservation contracts**

Run: `node scripts/ff3-budget-transition-blocking.test.mjs && node scripts/legacy-budget-backend-preservation.test.mjs && node scripts/critical-rpc-lockdown.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260917030000_ff3_simplified_budget_control.sql scripts/ff3-budget-transition-blocking.test.mjs .github/workflows/ci.yml
git commit -m "feat: block FF3 commitment without blocking management review"
```

---

### Task 3: Use the Authoritative Preview in the FF3 Client

**Files:**
- Modify: `lib/api.ts`
- Modify: `app/dashboard/ff3/new/page.tsx`
- Create: `scripts/ff3-budget-control-client.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- `checkBudgetAvailability(...)` returns `controlSource`, `budgetControlStatus`, `budgetAllocationId`, `expenseLedgerId`, `mappingStatus`, `currentApproved`, `committed`, `spent`, `available`, `requested`, `shortfall`, `withinBudget`, `hasAllocation` from `preview_ff3_budget_control`.
- New FF3 page detects whether the FY has an ACTIVE simplified annual budget.
- Simplified mode shows `Ledger` from active posting `expense_ledger`, stores `expense_ledger_id`, and disables creation of finance/expense codes.
- Legacy fallback preserves the current expense-code selector.
- On insufficient simplified budget, submission shows a warning but continues; it does not call the current client hard-stop return.

- [ ] **Step 1: Write the failing client/UI contract**

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
const api = fs.readFileSync('lib/api.ts','utf8')
const page = fs.readFileSync('app/dashboard/ff3/new/page.tsx','utf8')
assert.ok(api.includes("rpc('preview_ff3_budget_control'"))
assert.ok(page.includes('INSUFFICIENT BUDGET – COMMITMENT BLOCKED'))
assert.ok(page.includes('expense_ledger_id'))
assert.ok(page.includes('Current Approved Budget'))
assert.ok(page.includes('SHORTFALL'))
assert.ok(page.includes('SIMPLIFIED_ACTIVE'))
console.log('FF3 budget-control client/UI contract: ok')
```

- [ ] **Step 2: Run and confirm RED**

Run: `node scripts/ff3-budget-control-client.test.mjs`
Expected: FAIL before the client/UI changes.

- [ ] **Step 3: Implement the client and creation screen**

For simplified mode the budget panel displays Current Approved, Commitments, Actual Expenditure, Available, This FF3, Shortfall and a blocking badge. A blocked request may still call the normal FF3 `SUBMIT` workflow. Missing required organisational/ledger dimensions remains a validation error and is not treated as an overrideable budget shortfall.

- [ ] **Step 4: Run contract, lint and typecheck**

Run: `node scripts/ff3-budget-control-client.test.mjs && bun run lint && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api.ts app/dashboard/ff3/new/page.tsx scripts/ff3-budget-control-client.test.mjs .github/workflows/ci.yml
git commit -m "feat: show authoritative FF3 budget control"
```

---

### Task 4: Surface the Separate Budget State to Managers

**Files:**
- Modify: `app/dashboard/ff3/page.tsx`
- Modify: `app/dashboard/ff3/[ff3_number]/page.tsx`
- Create: `scripts/ff3-budget-control-manager-ui.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- FF3 list selects `budget_control_status`, `budget_shortfall_amount`, `budget_control_source` and renders an independent Budget Status column.
- FF3 detail reads the persisted budget-control fields and calls `checkBudgetAvailability` for a fresh position while pending.
- Endorsement buttons remain enabled for blocked FF3s.
- Final `APPROVE` is visibly budget-blocked while insufficient; server-side RPC remains authoritative even if the UI is stale.

- [ ] **Step 1: Write the failing manager-visibility contract**

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
const list = fs.readFileSync('app/dashboard/ff3/page.tsx','utf8')
const detail = fs.readFileSync('app/dashboard/ff3/[ff3_number]/page.tsx','utf8')
for (const token of ['budget_control_status','Budget Status','INSUFFICIENT_BUDGET_BLOCKED']) assert.ok(list.includes(token))
for (const token of ['budget_control_status','Commitment Created','INSUFFICIENT BUDGET','Shortfall']) assert.ok(detail.includes(token))
console.log('FF3 manager budget-state UI contract: ok')
```

- [ ] **Step 2: Run and confirm RED**

Run: `node scripts/ff3-budget-control-manager-ui.test.mjs`
Expected: FAIL before list/detail changes.

- [ ] **Step 3: Implement list/detail visibility**

Keep workflow status and budget status in separate badges. The detail budget panel must not imply a blocked FF3 is financially committed. For `ENDORSED_SECTION_HEAD + INSUFFICIENT_BUDGET_BLOCKED`, show that reallocation/supplementary funding is required before commitment.

- [ ] **Step 4: Run UI contract, lint and typecheck**

Run: `node scripts/ff3-budget-control-manager-ui.test.mjs && bun run lint && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/ff3/page.tsx app/dashboard/ff3/[ff3_number]/page.tsx scripts/ff3-budget-control-manager-ui.test.mjs .github/workflows/ci.yml
git commit -m "feat: expose FF3 budget block to managers"
```

---

### Task 5: Automatic Unblock, Full Verification, PR and Production Deployment

**Files:**
- Modify: `supabase/migrations/20260917030000_ff3_simplified_budget_control.sql`
- Create: `scripts/ff3-budget-auto-refresh.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Adds event triggers/functions that refresh matching non-terminal FF3 budget-control states after a supplementary adjustment is POSTED or a reallocation becomes EXECUTED.
- Budget changes may change `INSUFFICIENT_BUDGET_BLOCKED` to `SUFFICIENT`, but must never skip or alter the human workflow status.

- [ ] **Step 1: Write the failing automatic-refresh contract**

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql = fs.readFileSync('supabase/migrations/20260917030000_ff3_simplified_budget_control.sql','utf8')
assert.ok(sql.includes('refresh_pending_ff3_budget_control_for_key'))
assert.ok(sql.includes('budget_supplementary_adjustments'))
assert.ok(sql.includes('budget_reallocations'))
assert.ok(sql.includes("status IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD')"))
console.log('FF3 automatic budget refresh contract: ok')
```

- [ ] **Step 2: Run and confirm RED**

Run: `node scripts/ff3-budget-auto-refresh.test.mjs`
Expected: FAIL until automatic refresh is present.

- [ ] **Step 3: Implement automatic refresh without workflow mutation**

Refresh only the separate budget-control columns for matching pending FF3s. Do not change `ff3_headers.status`, approval records, or create commitments from a budget event.

- [ ] **Step 4: Run the full branch validation**

Run: all repository CI steps, including the five new Phase 3 contracts, `bun run lint`, `bun run typecheck`, and `bun run build`.
Expected: all green.

- [ ] **Step 5: Review and merge through protected main**

Open a PR from `feat/ff3-budget-control-blocking` to `main`, inspect all changed files, fix Critical/Important review findings, require the `Build and validate` check to succeed, then merge using the repository's protected workflow.

- [ ] **Step 6: Production migration and verification**

Apply `20260917030000_ff3_simplified_budget_control.sql` with Supabase `apply_migration`. Before and after deployment compare legacy row counts for `budget_allocations`, `ff3_headers`, `ff3_items`, `ff3_commitments`, `ff4_headers`, `budget_revisions`, and `budget_revision_lines`. Verify new columns/RPCs/triggers, RLS/privileges, and confirm no commitment was created by deployment itself. Run Supabase security/performance advisors and record new-versus-existing findings.

- [ ] **Step 7: Commit final evidence if repository conventions require it**

```bash
git add docs/superpowers/plans/2026-09-17-ff3-budget-control-blocking.md
git commit -m "docs: record FF3 budget-control implementation plan"
```
