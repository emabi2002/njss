# FF3 Authoritative Budget Blocking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate FF3 with the simplified active Head Office budget so insufficient requests may continue through managerial review while financial commitment remains blocked until sufficient authoritative budget exists.

**Architecture:** Introduce a database-owned FF3 budget-state evaluator. For a financial year with an ACTIVE simplified annual budget, budget sufficiency is calculated from `get_current_budget_position(FY, Division, Section, Ledger)`; otherwise the existing legacy allocation/release control remains unchanged. Workflow status and budget-control state remain separate. Final approval/commitment always rechecks availability inside the same serialized database transaction.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase/PostgreSQL 17, PostgreSQL SECURITY DEFINER RPCs, Node contract tests, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-09-17-simplified-head-office-budget-design.md`

## Global Constraints

- Only an ACTIVE simplified annual budget may supersede the legacy FF3 ceiling for that financial year.
- `Financial Year + Division + Section + Ledger` is the authoritative simplified budget key.
- Insufficient budget does not stop managerial review.
- No commitment is created while `budget_control_status = 'INSUFFICIENT_BUDGET_BLOCKED'`.
- Final commitment creation must recheck budget server-side under a lock.
- A Registrar-approved reallocation or posted supplementary adjustment must refresh affected pending FF3 budget states automatically.
- Existing `budget_allocations`, `ff3_commitments`, FF4 and payment structures remain intact; Phase 3 is additive/compatibility-first.
- Original and adjustment budget records remain immutable under the controls implemented in Phases 1–2.
- Do not create finance master data from the FF3 form.

---

### Task 1: FF3 Budget-State Schema and Database Evaluator

**Files:**
- Create: `supabase/migrations/20260917030000_ff3_authoritative_budget_state.sql`
- Create: `scripts/ff3-authoritative-budget-state.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `public.check_ff3_budget_availability(...) RETURNS jsonb`
- Produces: `public.njss_refresh_ff3_budget_state(uuid) RETURNS jsonb`
- Adds `ff3_headers.budget_control_status`, `budget_control_source`, `budget_available_snapshot`, `budget_current_approved_snapshot`, `budget_shortfall_amount`, `budget_checked_at`, `expense_ledger_id`.

- [ ] **Step 1: Write failing contract test**

Assert the migration adds the separate budget-state columns, supports both `SIMPLIFIED` and `LEGACY` sources, uses `get_current_budget_position` only when an ACTIVE annual cycle exists, calculates shortfall, and preserves the existing legacy path when no simplified budget is active.

- [ ] **Step 2: Run test and confirm failure**

Run: `node scripts/ff3-authoritative-budget-state.test.mjs`
Expected: FAIL because the migration does not yet exist.

- [ ] **Step 3: Implement migration**

Add the FF3 state columns with controlled values:

```sql
budget_control_status varchar(40) NOT NULL DEFAULT 'UNASSESSED'
  CHECK (budget_control_status IN ('UNASSESSED','SUFFICIENT','INSUFFICIENT_BUDGET_BLOCKED','MAPPING_REQUIRED')),
budget_control_source varchar(20) NULL
  CHECK (budget_control_source IN ('LEGACY','SIMPLIFIED')),
budget_available_snapshot numeric(18,2) NULL,
budget_current_approved_snapshot numeric(18,2) NULL,
budget_shortfall_amount numeric(18,2) NOT NULL DEFAULT 0,
budget_checked_at timestamptz NULL,
expense_ledger_id uuid NULL REFERENCES public.expense_ledger(id) ON DELETE RESTRICT
```

Create `check_ff3_budget_availability` with this behavior:

```text
1. Require authenticated user and FF3 view/create/submit-compatible permission.
2. Resolve the selected active posting ledger from expense_code_registry_id.
3. Detect whether an ACTIVE annual_budget_cycles row exists for the requested FY.
4. SIMPLIFIED path: read `get_current_budget_position` for exact FY/Division/Section/Ledger.
5. LEGACY path: preserve exact `v_authoritative_budget_position` filtering and released-available calculation.
6. Return source, mapping status, current approved, commitments, actuals, available, requested, shortfall, withinBudget and legacy budgetAllocationId where available.
```

Create `njss_refresh_ff3_budget_state(p_ff3_id uuid)` to evaluate one persisted FF3 and update only budget-control fields, never workflow status.

- [ ] **Step 4: Re-run contract test**

Run: `node scripts/ff3-authoritative-budget-state.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add authoritative FF3 budget state`

---

### Task 2: Managerial Review Without Commitment on Insufficient Budget

**Files:**
- Create: `supabase/migrations/20260917031000_ff3_blocked_managerial_workflow.sql`
- Create: `scripts/ff3-blocked-managerial-workflow.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Replaces: `public.njss_transition_ff3(uuid,text,text,text)` without changing its signature.
- Consumes: `njss_refresh_ff3_budget_state(uuid)` from Task 1.

- [ ] **Step 1: Write failing workflow contract**

Assert:
- SUBMIT no longer raises an insufficient-budget exception.
- SUBMIT stores `INSUFFICIENT_BUDGET_BLOCKED` when required and still changes workflow to `SUBMITTED`.
- `ENDORSE_SUPERVISOR` and `ENDORSE_SECTION_HEAD` do not override the budget block.
- APPROVE refreshes budget state under a lock and refuses commitment if still blocked.
- No `ff3_commitments` insert is reachable while blocked.
- If budget is sufficient, the existing commitment creation path and segregation-of-duties checks remain.

- [ ] **Step 2: Run and confirm failure**

Run: `node scripts/ff3-blocked-managerial-workflow.test.mjs`
Expected: FAIL against the existing hard-stop workflow.

- [ ] **Step 3: Implement workflow replacement**

On SUBMIT:

```text
refresh state -> resolve legacy routing if available -> set SUBMITTED regardless of SUFFICIENT/BLOCKED -> record approval/audit entry
```

On endorsements:

```text
preserve normal workflow transition -> refresh budget state -> do not create commitment
```

On APPROVE:

```text
lock FF3 row;
if simplified source, lock the matching division_budgets row to serialize competing approvals;
if legacy source, lock the resolved budget_allocations row as today;
refresh state;
if blocked, raise a clear budget-blocked error and leave workflow at ENDORSED_SECTION_HEAD;
if sufficient, require a unique legacy budget_allocation_id for commitment routing, recheck, then create exactly one commitment and transaction as today.
```

- [ ] **Step 4: Re-run workflow contract**

Run: `node scripts/ff3-blocked-managerial-workflow.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: allow budget-blocked FF3 managerial review`

---

### Task 3: Automatic Re-evaluation After Supplementary Budget or Reallocation

**Files:**
- Create: `supabase/migrations/20260917032000_ff3_budget_state_auto_refresh.sql`
- Create: `scripts/ff3-budget-auto-refresh.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces internal helper: `public.njss_refresh_pending_ff3_for_budget_key(integer,uuid,uuid,uuid) RETURNS integer`.
- Replaces existing Phase 2 post/execute RPC bodies while preserving signatures.

- [ ] **Step 1: Write failing contract**

Assert that posting a supplementary adjustment refreshes pending FF3s matching FY/Division/Section/Ledger, and executing a reallocation refreshes pending FF3s for both source and destination keys. Assert the helper updates budget state only and does not auto-endorse or auto-approve any FF3.

- [ ] **Step 2: Run and confirm failure**

Run: `node scripts/ff3-budget-auto-refresh.test.mjs`
Expected: FAIL because Phase 2 functions currently do not refresh FF3s.

- [ ] **Step 3: Implement helper and RPC integration**

Pending workflow statuses to refresh:

```sql
('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD')
```

Map each FF3 `expense_code_registry_id` to its active posting `expense_ledger` and call `njss_refresh_ff3_budget_state` for matching requisitions. Do not mutate terminal FF3s or commitments.

- [ ] **Step 4: Re-run contract**

Run: `node scripts/ff3-budget-auto-refresh.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: refresh blocked FF3 after budget changes`

---

### Task 4: FF3 Client Availability Contract and Creation Screen

**Files:**
- Modify: `lib/api.ts`
- Modify: `app/dashboard/ff3/new/page.tsx`
- Create: `scripts/ff3-authoritative-budget-client.test.mjs`
- Create: `scripts/ff3-insufficient-budget-ui.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- `checkBudgetAvailability(...)` calls `check_ff3_budget_availability` and returns `budgetControlSource`, `budgetControlStatus`, `currentApproved`, `available`, `shortfall`, `withinBudget`, `budgetAllocationId`, `mappingStatus`.

- [ ] **Step 1: Write failing client/UI contracts**

Assert the new screen no longer returns early merely because `withinBudget` is false when the authoritative result is valid. It must show the warning and still save/submit the FF3. The submitted header must persist the evaluator snapshots/state.

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node scripts/ff3-authoritative-budget-client.test.mjs
node scripts/ff3-insufficient-budget-ui.test.mjs
```

Expected: FAIL against the old hard-stop client behavior.

- [ ] **Step 3: Implement API adapter and UI**

Replace the current client-side query against `v_authoritative_budget_position` with the secured RPC. On insufficient budget show:

```text
Current Approved Budget
Less Commitments
Less Actual Expenditure
AVAILABLE
This FF3 Request
SHORTFALL
INSUFFICIENT BUDGET – COMMITMENT BLOCKED
```

Do not prevent SUBMIT solely because of insufficient budget. Preserve hard errors for invalid/missing mapping conditions that make the budget key unknowable.

- [ ] **Step 4: Re-run client/UI tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: submit FF3 with separate budget block state`

---

### Task 5: FF3 Detail Screen and Management Visibility

**Files:**
- Modify: `app/dashboard/ff3/[ff3_number]/page.tsx`
- Modify: `app/dashboard/ff3/page.tsx`
- Create: `scripts/ff3-budget-state-visibility.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes persisted `budget_control_status`, snapshots, shortfall and source.

- [ ] **Step 1: Write failing visibility contract**

Assert detail/list pages display the independent budget-control state and shortfall without replacing the ordinary FF3 workflow status.

- [ ] **Step 2: Run and confirm failure**

Run: `node scripts/ff3-budget-state-visibility.test.mjs`
Expected: FAIL because the UI does not yet expose the separate state.

- [ ] **Step 3: Implement visibility**

For blocked FF3s display a prominent warning to requester, Line Manager and Division Director/approvers. Keep endorsement actions available, but final approval remains protected by the database RPC.

- [ ] **Step 4: Re-run visibility contract**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: expose FF3 budget block to managers`

---

### Task 6: Full Regression, Production Preflight and Deployment

**Files:**
- Modify: `.github/workflows/ci.yml` only if a new test has not yet been registered.
- Record deployment evidence in PR description/comment.

**Interfaces:**
- No new business interfaces; validates Tasks 1–5.

- [ ] **Step 1: Run all Phase 3 contracts and repository CI**

Required checks include:

```text
ff3-authoritative-budget-state
ff3-blocked-managerial-workflow
ff3-budget-auto-refresh
ff3-authoritative-budget-client
ff3-insufficient-budget-ui
ff3-budget-state-visibility
existing budget/FF3/FF4 regressions
lint
typecheck
build
```

- [ ] **Step 2: Review migration against live production schema**

Verify all referenced tables/columns/functions and capture row-count baseline for `ff3_headers`, `ff3_commitments`, `ff4_headers`, `budget_allocations`, `annual_budget_cycles`, `division_budgets`, `budget_supplementary_adjustments`, `budget_reallocations`.

- [ ] **Step 3: Merge only after green CI**

Use protected PR flow; no direct `main` edits.

- [ ] **Step 4: Apply migrations through Supabase `apply_migration` in timestamp order**

Do not use raw SQL for DDL.

- [ ] **Step 5: Post-deployment verification**

Verify schema, RPC definitions, permissions, unchanged legacy row counts, no accidental commitment creation, and Supabase security advisors. Record any pre-existing advisor findings separately from Phase 3 regressions.
