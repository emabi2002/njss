# Budget Supplementary and Reallocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add controlled supplementary-budget adjustments, Registrar-only reallocations, and a single authoritative Head Office budget-position source on top of the deployed simplified annual-budget foundation.

**Architecture:** Keep original locked Division budget lines immutable. Store later financial changes as append-only/posted events, derive the current approved position from original + posted supplementary + executed reallocation events, and combine that position with existing FF3 outstanding commitments and posted/reconciled payment transactions through the existing expense-code-to-ledger mapping. All writes use permission-checked SECURITY DEFINER RPCs; direct authenticated table mutation remains denied.

**Tech Stack:** PostgreSQL 17 / Supabase, Row Level Security, SECURITY DEFINER RPCs, Next.js/React/TypeScript, Supabase Storage, Node contract tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-17-simplified-head-office-budget-design.md`

## Global Constraints

- Budget scope is NJSS Head Office only.
- The original locked annual budget is immutable.
- Supplementary adjustments never overwrite original amounts.
- Registrar is the sole reallocation approval authority.
- Budget Officer executes approved reallocations and posts supplementary adjustments.
- A reallocation must be atomic and may not exceed source available budget.
- Registrar correspondence/reference is mandatory authority for reallocation; attachment is supported where available.
- Only ACTIVE annual budget cycles are authoritative for adjustments and operational control.
- Existing FF3/FF4, commitment, payment, revision and reporting records must not be deleted or rewritten by this slice.

---

### Task 1: Add failing adjustment schema/workflow contract

**Files:**
- Create: `scripts/simplified-budget-adjustments.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: source SQL migrations and `lib/head-office-budget.ts`.
- Produces: regression assertions that fail until supplementary/reallocation tables, permissions, RPCs and authoritative position are implemented.

- [ ] **Step 1: Write the failing test**

The test must assert that the new migration contains tables `budget_supplementary_adjustments` and `budget_reallocations`; permissions `budget.supplementary.enter`, `budget.reallocation.request`, `budget.reallocation.approve`, `budget.reallocation.execute`; RPCs `create_supplementary_adjustment_draft`, `post_supplementary_adjustment`, `request_budget_reallocation`, `approve_budget_reallocation`, `reject_budget_reallocation`, `execute_budget_reallocation`; and authoritative view `v_current_budget_position`. It must also assert that `approve_budget_reallocation` verifies the current user is in the `Registrar` role and that execution validates source available budget.

- [ ] **Step 2: Run test to verify it fails**

Run through GitHub Actions on the draft PR. Expected: `Simplified budget supplementary/reallocation regression` fails because the migration and client contracts do not yet exist.

- [ ] **Step 3: Keep the failing test committed before implementation**

Commit message: `test: define supplementary and reallocation controls`.

---

### Task 2: Add supplementary/reallocation data model and RBAC

**Files:**
- Create: `supabase/migrations/20260917020000_budget_supplementary_reallocation.sql`

**Interfaces:**
- Consumes: `annual_budget_cycles`, `division_budgets`, `division_budget_lines`, `budget_documents`, `roles`, `permissions`, `role_permissions`, `users`, `expense_ledger`, `expense_code_registry`.
- Produces:
  - `budget_supplementary_adjustments`
  - `budget_reallocations`
  - permissions `budget.supplementary.enter`, `budget.reallocation.request`, `budget.reallocation.approve`, `budget.reallocation.execute`

- [ ] **Step 1: Define supplementary table**

Create an append-only event table with `DRAFT` and `POSTED` states, signed `adjustment_amount <> 0`, authority reference/document, reason, created/posted actor and timestamps. Enforce that its Division/Section/Ledger target is tied to the same active annual cycle at posting time.

- [ ] **Step 2: Define reallocation table**

Create one header row containing source and destination Division budget, Section and Ledger IDs, positive transfer amount, reason, optional requesting Division/user, mandatory Registrar authority reference before approval, optional authority document, Registrar approval actor/time, Budget Officer execution actor/time, and status `REQUESTED | REGISTRAR_APPROVED | EXECUTED | REJECTED | CANCELLED`.

- [ ] **Step 3: Add RBAC permissions**

Assign supplementary entry and reallocation execution to `Budget Officer`; assign reallocation approval only to `Registrar`; create the request permission without auto-assigning it to an existing non-director role. This avoids incorrectly treating `Line Supervisor` as a Division Director. The permission can be assigned to the actual Director user/role through Access Control.

- [ ] **Step 4: Add RLS and table privileges**

Enable RLS. Allow authorised SELECT only. Revoke authenticated INSERT/UPDATE/DELETE so all mutations use RPCs.

- [ ] **Step 5: Protect posted/executed rows**

Add trigger protection so posted supplementary transactions and executed/rejected reallocations cannot be silently edited or deleted. Corrections require a new controlled transaction rather than mutation of financial history.

---

### Task 3: Add authoritative budget-position source

**Files:**
- Modify: `supabase/migrations/20260917020000_budget_supplementary_reallocation.sql`

**Interfaces:**
- Produces: `public.v_current_budget_position` keyed by `(financial_year, division_id, section_id, expense_ledger_id)`.

- [ ] **Step 1: Aggregate original locked budget**

Base the view on `division_budget_lines` joined to `division_budgets` and `annual_budget_cycles`. Expose cycle status and original amount.

- [ ] **Step 2: Aggregate posted supplementary events**

Only `POSTED` supplementary rows affect `supplementary_adjustments`.

- [ ] **Step 3: Aggregate executed reallocations**

Only `EXECUTED` rows affect `reallocations_in` and `reallocations_out`.

- [ ] **Step 4: Aggregate outstanding commitments**

Join `ff3_commitments -> ff3_headers -> expense_code_registry.expense_ledger_id`; use non-cancelled commitments and `coalesce(outstanding_amount, remaining_balance, current_committed_amount, committed_amount, 0)`.

- [ ] **Step 5: Aggregate actual expenditure**

Join posted/reconciled `payment_transactions -> ff4_headers -> expense_code_registry.expense_ledger_id`; treat `PAYMENT` as positive actual and `REVERSAL` as negative if reversal rows exist later.

- [ ] **Step 6: Calculate canonical fields**

`current_approved_budget = original_budget + supplementary_adjustments + reallocations_in - reallocations_out`.

`available_budget = current_approved_budget - outstanding_commitments - actual_expenditure`.

Expose `is_authoritative = annual_cycle_status = 'ACTIVE'`.

---

### Task 4: Add secured supplementary RPCs

**Files:**
- Modify: `supabase/migrations/20260917020000_budget_supplementary_reallocation.sql`

**Interfaces:**
- Produces:
  - `create_supplementary_adjustment_draft(p_financial_year integer, p_division_budget_id uuid, p_section_id uuid, p_expense_ledger_id uuid, p_adjustment_amount numeric, p_reason text, p_authority_reference text) returns uuid`
  - `post_supplementary_adjustment(p_adjustment_id uuid, p_authority_document_id uuid) returns void`

- [ ] **Step 1: Draft creation validation**

Require authentication and `budget.supplementary.enter`; ACTIVE cycle; locked target Division budget; Section belongs to Division; active posting ledger; non-zero amount.

- [ ] **Step 2: Posting validation**

Require a `SUPPLEMENTARY_AUTHORITY` document registered to the exact supplementary transaction. For negative adjustments, lock the target position and reject if the reduction exceeds currently available budget.

- [ ] **Step 3: Post immutably**

Set `status='POSTED'`, authority document, actor and timestamp in one transaction.

---

### Task 5: Add secured reallocation workflow RPCs

**Files:**
- Modify: `supabase/migrations/20260917020000_budget_supplementary_reallocation.sql`

**Interfaces:**
- Produces:
  - `request_budget_reallocation(...) returns uuid`
  - `approve_budget_reallocation(p_reallocation_id uuid, p_authority_reference text, p_authority_document_id uuid default null) returns void`
  - `reject_budget_reallocation(p_reallocation_id uuid, p_reason text) returns void`
  - `execute_budget_reallocation(p_reallocation_id uuid) returns void`

- [ ] **Step 1: Request**

Require `budget.reallocation.request`; ACTIVE cycle; valid locked source/destination; Section ownership; active posting ledgers; different source and destination keys; amount > 0. Capture request but do not change balances.

- [ ] **Step 2: Registrar approval**

Require `budget.reallocation.approve` AND `public.njss_current_user_has_role('Registrar')`. Require non-empty Registrar authority reference. If a document is supplied, validate `REGISTRAR_REALLOCATION_AUTHORITY`, related entity type `REALLOCATION`, and exact reallocation ID.

- [ ] **Step 3: Registrar rejection**

Use the same hard Registrar-role check. Rejection is terminal and records reason/actor/time.

- [ ] **Step 4: Budget Officer execution**

Require `budget.reallocation.execute`; status `REGISTRAR_APPROVED`; lock the source position; recompute source available balance at execution time from the canonical position; reject when amount exceeds available. Set `EXECUTED`, actor and timestamp atomically. The view then applies both source and destination effects together.

---

### Task 6: Add client API and types

**Files:**
- Modify: `lib/head-office-budget.ts`

**Interfaces:**
- Produces types `BudgetPosition`, `SupplementaryAdjustment`, `BudgetReallocation` and client functions for listing position/events and calling all new RPCs.

- [ ] **Step 1: Add types matching SQL columns**
- [ ] **Step 2: Add `getCurrentBudgetPosition(financialYear)`**
- [ ] **Step 3: Add supplementary draft/post client calls**
- [ ] **Step 4: Add reallocation request/approve/reject/execute client calls**
- [ ] **Step 5: Add document queries for supplementary/reallocation evidence**

---

### Task 7: Add Budget Adjustments workspace

**Files:**
- Create: `app/dashboard/budget-template/BudgetAdjustmentsPanel.tsx`
- Modify: `app/dashboard/budget-template/page.tsx`

**Interfaces:**
- Consumes `getCurrentBudgetPosition` and adjustment/reallocation client functions.
- Produces a role-aware adjustments workspace inside the simplified Annual Budget page.

- [ ] **Step 1: Position table**

Show Division, Section, Ledger, Original, Supplementary, Reallocation In, Reallocation Out, Current Approved, Commitments, Actual, Available.

- [ ] **Step 2: Supplementary workflow**

Budget Officer selects a target line, amount and reason; creates draft; uploads/registers `SUPPLEMENTARY_AUTHORITY`; posts only after authority document exists.

- [ ] **Step 3: Reallocation workflow**

Authorised requester selects source/destination and amount/reason. Registrar-only controls approve/reject, with mandatory authority reference and optional authority document. Budget Officer-only control executes approved rows.

- [ ] **Step 4: Refresh canonical position after posting/execution**

Do not update displayed balances optimistically; reload the canonical source after every successful financial event.

---

### Task 8: Verify, review, merge and deploy

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create deployment evidence document after production verification.

**Interfaces:**
- Produces a green protected-main merge and controlled additive Supabase migration.

- [ ] **Step 1: Run PR CI and fix all failures**
- [ ] **Step 2: Review diff against approved spec**
- [ ] **Step 3: Capture production pre-migration counts for legacy financial tables**
- [ ] **Step 4: Merge only after `Build and validate` is green**
- [ ] **Step 5: Apply the additive migration with Supabase migration tooling**
- [ ] **Step 6: Verify new tables, RLS, permissions, RPCs, view and zero fabricated business transactions**
- [ ] **Step 7: Re-run legacy row counts and confirm no protected records changed**
- [ ] **Step 8: Run Supabase security/performance advisors and record any new findings**
- [ ] **Step 9: Commit deployment evidence through a protected PR**

## Self-Review

- Spec coverage: Sections 7-9, 12-15 and the related document/RBAC requirements are covered. FF3 workflow-state changes are intentionally excluded from this slice and will follow as the next plan after this canonical budget-position layer is green.
- Placeholder scan: no TBD/TODO or unspecified implementation step remains.
- Type consistency: financial key is consistently `(financial_year, division_id, section_id, expense_ledger_id)`; reallocation source/destination use the same key; document entity types match the existing `budget_documents` constraint.
