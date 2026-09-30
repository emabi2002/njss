# Division Budget Ledger and Registrar Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture each Head Office division's signed budget by explicit division-wide or section/unit ledger allocation, then require separate Registrar electronic approval.

**Architecture:** Extend the existing Supabase budget schema and authenticated RPCs rather than building a new budget module. Keep the division-specific private document register; use non-posting expense_ledger parents for headings and posting children for amounts. The current Next.js budget-template page becomes a preparation view plus a Registrar review view, with database-enforced transitions.

**Tech Stack:** Supabase PostgreSQL/RLS/Storage, Next.js/React/TypeScript, Node contract tests.

**Spec:** `docs/superpowers/specs/2026-09-30-division-budget-ledger-registrar-approval-design.md`

## Global Constraints

- Only Waigani Head Office divisions participate in the new annual budget cycle.
- Each division has its own signed or stamped official document; a spreadsheet is supporting material only.
- Every amount explicitly chooses Division-wide or a section/unit owned by that division; no implicit Enforcement default.
- Master ledger categories do not accept amounts. Existing original approved amounts remain immutable after electronic approval.
- The Registrar who approves electronically is distinct from the receiving officer; annual activation remains separate.
- Do not automatically import 2025 Sheriff figures into production.

## Review Focus

- Two divisions upload similarly named documents: submitting one budget cannot pass by using the other's document (Task 2 test).
- A multi-section division enters the same ledger under two sections: both lines and subtotals remain distinct and total once (Tasks 1 and 3 tests).
- An officer tries to choose another division's section or a non-posting category: server rejects it (Task 2 test).
- A Registrar opens a stale review while an officer resubmits: stale approval is rejected by version/fingerprint (Task 2 test).
- A previously LOCKED budget remains locked after migration and still contributes to readiness (Task 2 test).

---

### Task 1: Ledger hierarchy and explicit allocation catalogue

**Files:**
- Create: `supabase/migrations/<CLI-generated>_division_budget_ledger_hierarchy.sql`
- Create: `scripts/division-budget-ledger-hierarchy.test.mjs`
- Modify: `lib/head-office-budget.ts`

**Interfaces:**
- Produces `LedgerReference.parent_ledger_id: string | null`, `sort_order: number`, `is_posting: boolean`; category/child data for Task 3.
- Produces a designated division-wide section for each eligible division, identified by explicit code/type and owned by that division; ordinary sections/units remain division-owned sections.

- [ ] **Step 1: Write failing catalogue tests.** Assert each active posting child has one active non-posting parent, that a parent cannot itself post, that the sample's reviewed codes/categories have unique mappings, and that each eligible division has exactly one designated Division-wide section. Include same ledger under two different sections as valid.
- [ ] **Step 2: Run `node --test scripts/division-budget-ledger-hierarchy.test.mjs`.** Expect failure on missing hierarchy/Division-wide catalogue rules.
- [ ] **Step 3: Generate migration with `supabase migration new division_budget_ledger_hierarchy` and implement constraints/backfill.** Review current ledger and mapping rows before changing codes; record unresolved four-digit source codes as mapping exceptions instead of inventing posting destinations. Add type/ownership identification for Division-wide sections without changing the existing non-null section_id line contract.
- [ ] **Step 4: Add the ledger hierarchy fields to `LedgerReference` and read queries, and rerun the test and `npx tsc --noEmit`.** Expect both to pass.
- [ ] **Step 5: Commit catalogue and client contract.**

### Task 2: Submit, return, and electronic approval RPCs

**Files:**
- Create: `supabase/migrations/<CLI-generated>_division_budget_registrar_review.sql`
- Create: `scripts/division-budget-registrar-review.test.mjs`
- Modify: `lib/head-office-budget.ts`
- Modify: `scripts/simplified-budget-foundation.test.mjs`

**Interfaces:**
- Produces `submitDivisionBudget(budgetId: string): Promise<void>`, `returnDivisionBudget(budgetId: string, expectedVersion: number, reason: string): Promise<void>`, and `approveDivisionBudget(budgetId: string, expectedVersion: number): Promise<void>`.
- Extends `DivisionBudgetStatus` to include `PENDING_REGISTRAR_APPROVAL` and `RETURNED`; exposes submission, return, reviewer, approval, and version metadata to Task 3.

- [ ] **Step 1: Write failing RPC/database tests.** Assert document must belong to the exact budget/year and be OFFICIAL_APPROVED_BUDGET; all lines require active posting ledger and owned section; submit locks the version; budget.capture cannot approve; receiving officer cannot approve own submission; wrong-division document/section, stale version, and post-approval edits fail; returned work can be corrected and resubmitted; old LOCKED rows stay valid/readiness-safe.
- [ ] **Step 2: Run `node --test scripts/division-budget-registrar-review.test.mjs scripts/simplified-budget-foundation.test.mjs`.** Expect failure on missing states/RPCs.
- [ ] **Step 3: Generate migration with `supabase migration new division_budget_registrar_review` and implement transitions.** Add review/version/audit metadata and a Registrar-only permission. Remove budget.lock from the Budget Officer capture role; preserve legitimate Registrar grants through an explicit role mapping. Reject master-category posting in the save RPC, bind approval to document ID and line fingerprint/version, make transition functions authenticated and permission-checked, and keep activation based on electronically approved/LOCKED budgets.
- [ ] **Step 4: Add typed client methods and read fields, run the two tests and `npx tsc --noEmit`.** Expect pass. Verify against a disposable/local Supabase instance using the migration and SQL role matrix; never test mutations against live UAT budgets.
- [ ] **Step 5: Commit review workflow.**

### Task 3: Preparation and Registrar review screens

**Files:**
- Modify: `app/dashboard/budget-template/page.tsx`
- Create: `app/dashboard/budget-template/RegistrarReviewPanel.tsx`
- Create: `lib/division-budget-ledger-groups.ts`
- Modify: `scripts/simplified-budget-entry-ui.test.mjs`
- Create: `scripts/division-budget-ledger-groups.test.mjs`

**Interfaces:**
- Consumes Task 1 ledger parent/child and Division-wide selection; consumes Task 2 transition methods and version metadata.
- Produces group totals with `groupDivisionBudgetLines(ledgers, lines)` in `lib/division-budget-ledger-groups.ts`.

- [ ] **Step 1: Write failing UI/group tests.** Assert headings are non-editable, ordering follows master ledger sort order, section/unit picker is restricted to selected division, Division-wide requires explicit choice, same child under two sections sums once in category/division totals, signed document belongs to selected budget, Submit is separate from Approve/Return, and existing draft/print functions remain.
- [ ] **Step 2: Run `node --test scripts/simplified-budget-entry-ui.test.mjs scripts/division-budget-ledger-groups.test.mjs`.** Expect failures for flat grid and lock button.
- [ ] **Step 3: Implement grouping helper and update the preparation page.** Keep draft save and private document upload; show division-specific signed attachment and manual approval details; display categories, child amounts, explicit allocation, section and category totals, Submit state, and clear returned reason.
- [ ] **Step 4: Implement RegistrarReviewPanel with document viewer, version/totals, Return reason and Approve actions.** Use server RPCs and show errors for stale reviews. Remove the capture user's Lock action.
- [ ] **Step 5: Run the UI/group tests, `npx tsc --noEmit`, and `npm run build`.** Expect pass; inspect the browser at desktop and narrow widths for a division with multiple sections.
- [ ] **Step 6: Commit UI and grouping helper.**

### Task 4: End-to-end UAT and documentation

**Files:**
- Create: `docs/uat/division-budget-registrar-approval.md`
- Modify: `scripts/head-office-budget-client.test.mjs`
- Modify: `scripts/budget-entry-layout.test.mjs`

**Interfaces:**
- Consumes Tasks 1–3; produces a repeatable UAT checklist and known legacy-code mapping exceptions.

- [ ] **Step 1: Write failing integration assertions for division-specific attachment, multiple sections, return/resubmit, Registrar-only approval, and immutable approved lines.**
- [ ] **Step 2: Run `node --test scripts/head-office-budget-client.test.mjs scripts/budget-entry-layout.test.mjs`.** Expect failure before final wiring.
- [ ] **Step 3: Complete integration and document UAT inputs.** Include a multi-section division and the Sheriff historical example, with flagged Lae items and unmapped 7835/7847/7852 codes held until catalogue/scope review. State that 2025 figures are examples, not approved new-year amounts.
- [ ] **Step 4: Run relevant Node tests, `npx tsc --noEmit`, `npm run build`, migration verification in disposable/local Supabase, and security advisors.** Confirm category and division totals, role separation, document isolation, legacy LOCKED compatibility, and activation readiness.
- [ ] **Step 5: Commit UAT instructions and final integration. Open a draft PR for review; do not merge or deploy to production.**
