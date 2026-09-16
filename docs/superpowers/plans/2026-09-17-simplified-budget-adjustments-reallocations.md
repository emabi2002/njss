# Simplified Budget Adjustments and Reallocations Implementation Plan

> **Required skill:** Use `superpowers:test-driven-development` for every implementation task and `superpowers:verification-before-completion` before integration/deployment claims.

**Goal:** Extend the deployed simplified Head Office annual-budget foundation with controlled supplementary adjustments, Registrar-only reallocations, and one authoritative current-budget-position service, without changing existing FF3/FF4 behavior yet.

**Architecture:** Keep the Phase 1 annual budget baseline immutable. Add append-only financial-event tables and permission-checked RPCs. Supplementary adjustments affect the position only after posting with supporting authority. Reallocations use one atomic source/destination transaction: Division Director/request permission initiates, Registrar alone approves, Budget Officer executes after Registrar documentary authority exists. A secured budget-position function/view derives Original + Supplementary + Reallocation In - Reallocation Out, then reconciles outstanding commitments and actual payments through the existing finance-posting mappings. No legacy budget, FF3, FF4, commitment, payment, revision, or reporting rows are rewritten.

**Tech stack:** Next.js/TypeScript, Supabase/PostgreSQL, Supabase Storage, existing NJSS RBAC, Bun/Node regression scripts, GitHub Actions.

## Global constraints

- Protected `main`; all changes through PR and required `Build and validate` check.
- Additive migrations only. Never edit already-deployed migration files.
- Preserve all Phase 1 and legacy financial data.
- Registrar is the sole reallocation approver. `system.full_access` must not substitute for Registrar approval authority.
- Budget Officer may post supplementary adjustments and execute only already-approved reallocations.
- Supplementary/reallocation events may affect only an `ACTIVE` annual budget cycle.
- Posted supplementary events and executed reallocations are immutable; corrections require subsequent controlled events, not silent edits/deletes.
- A reallocation cannot exceed the source line's authoritative available balance.
- Reallocation source and destination must be in the same financial year and must be different budget keys.
- Authority documents must be real objects in the private `njss-budget-documents` bucket and registered to the correct related entity.
- This phase does **not** modify FF3 workflow behavior. It creates the authoritative position that the next phase will consume.

---

### Task 1: Add failing schema and business-rule regression contracts

**Files:**
- Create: `scripts/simplified-budget-adjustments.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Test first:** Assert the next migration source contains:
- `budget_supplementary_adjustments`
- `budget_reallocations`
- permissions `budget.supplementary.enter`, `budget.reallocation.request`, `budget.reallocation.approve`, `budget.reallocation.execute`
- secured RPCs for create/update/post supplementary, request/approve/execute reallocation
- hard Registrar-role enforcement in the approval RPC
- active-cycle checks
- authority-document checks
- source-availability guard and atomic execution
- immutable posted/executed guards
- authoritative budget-position function/view
- no destructive DDL against legacy budget/FF3/FF4 tables.

Run the new script before migration creation and confirm RED.

---

### Task 2: Add the additive database migration

**Files:**
- Create: `supabase/migrations/20260917020000_simplified_budget_adjustments_reallocations.sql`

**Schema:**

`budget_supplementary_adjustments`
- id UUID PK
- transaction_number unique
- annual_budget_cycle_id FK
- financial_year
- division_budget_id FK
- section_id FK
- expense_ledger_id FK
- adjustment_amount NUMERIC, non-zero
- reason/description
- status `DRAFT | POSTED`
- authority_document_id FK nullable until post
- entered_by/entered_at
- posted_by/posted_at
- timestamps

`budget_reallocations`
- id UUID PK
- reallocation_number unique
- annual_budget_cycle_id FK
- financial_year
- status `REQUESTED | REGISTRAR_APPROVED | REJECTED | EXECUTED`
- requesting_division_id nullable
- source division_budget_id/section_id/expense_ledger_id
- destination division_budget_id/section_id/expense_ledger_id
- transfer_amount > 0
- reason
- requested_by/requested_at
- registrar_approved_by/registrar_approved_at
- registrar_authority_document_id nullable until execution
- rejected_by/rejected_at/rejection_reason
- executed_by/executed_at
- timestamps

**Database controls:**
- Validate section belongs to selected Division and both budget headers belong to the same active cycle/year.
- Supplementary target must be a locked Division in an active annual cycle.
- Negative supplementary adjustments, if entered, must not push the target below protected commitments/actuals; positive adjustments are unrestricted by balance.
- Posted supplementary and executed reallocation rows become immutable through triggers.
- Authenticated clients receive SELECT only on new tables; no direct INSERT/UPDATE/DELETE.
- RLS enabled with authorised read policies.

**Permissions/RBAC:**
- Add four permissions.
- Grant `budget.supplementary.enter` and `budget.reallocation.execute` to Budget Officer.
- Grant `budget.reallocation.approve` to Registrar only.
- Do not auto-grant request permission to a nonexistent role. RPC request is permission-based so it can be assigned later to the configured Director business role without weakening approval authority.
- Approval RPC must additionally require actual active `Registrar` role membership, not merely permission or full-access bypass.

**RPCs:**
- `create_budget_supplementary_draft(...)`
- `update_budget_supplementary_draft(...)`
- `post_budget_supplementary_adjustment(p_adjustment_id, p_authority_document_id)`
- `request_budget_reallocation(...)`
- `approve_budget_reallocation(p_reallocation_id)`
- `reject_budget_reallocation(p_reallocation_id, p_reason)`
- `execute_budget_reallocation(p_reallocation_id, p_authority_document_id)`

All SECURITY DEFINER RPCs: authenticated check, fixed `search_path = public, auth`, explicit permission/role checks, anon execute revoked, only intended authenticated execution granted.

---

### Task 3: Build one authoritative budget-position service

**Files:**
- In migration: `supabase/migrations/20260917020000_simplified_budget_adjustments_reallocations.sql`
- Create: `scripts/simplified-budget-position.test.mjs`

**Logical output key:** `financial_year + division_id + section_id + expense_ledger_id`.

**Position fields:**
- original_budget
- supplementary_adjustments (POSTED only)
- reallocations_in (EXECUTED only)
- reallocations_out (EXECUTED only)
- current_approved_budget
- outstanding_commitments
- actual_expenditure
- available_budget
- cycle/status context.

**Legacy reconciliation:**
- Link simplified budget line to existing `finance_posting_mappings` by financial_year, expense_ledger_id, department_id, section_id, active mapping.
- From mapped `expense_code_registry_id`/`budget_allocation_id`, aggregate `ff3_commitments.outstanding_amount` for live commitments.
- Aggregate signed posted/reconciled `payment_transactions` amounts for actual expenditure, respecting reversal semantics when present.
- Use a secured SQL function `get_current_budget_position(...)` as the write-control source so reallocation execution can lock/recheck the source line in the same transaction. Expose a read projection/view only if it does not weaken RLS.

**Concurrency:**
- `execute_budget_reallocation` obtains row locks on the source and destination original budget lines before recalculating availability and posting the transfer.
- Supplementary negative-posting obtains the target line lock before its final availability validation.

Write tests first, verify RED, then GREEN.

---

### Task 4: Extend the TypeScript budget client

**Files:**
- Modify: `lib/head-office-budget.ts`
- Create: `scripts/head-office-budget-adjustments-client.test.mjs`

Add types for supplementary adjustments, reallocations, and budget position rows.

Add client functions:
- `getCurrentBudgetPositions(financialYear, filters?)`
- `createSupplementaryDraft(...)`
- `updateSupplementaryDraft(...)`
- `postSupplementaryAdjustment(...)`
- `getSupplementaryAdjustments(financialYear)`
- `requestBudgetReallocation(...)`
- `approveBudgetReallocation(...)`
- `rejectBudgetReallocation(...)`
- `executeBudgetReallocation(...)`
- `getBudgetReallocations(financialYear)`

Reuse existing `registerBudgetDocument()` and private bucket mechanics for authority evidence.

Write contract test first, confirm RED, then implement and confirm GREEN.

---

### Task 5: Add the Budget Adjustments workspace

**Files:**
- Create: `app/dashboard/budget/adjustments/page.tsx`
- Modify navigation only if the existing menu framework requires an explicit route/menu record in the migration.
- Create: `scripts/simplified-budget-adjustments-ui.test.mjs`

UI requirements:
- Financial Year selector.
- Current-position table showing Original, Supplementary, Reallocation In, Reallocation Out, Current Approved, Commitments, Actual, Available.
- `Supplementary Budget` workflow for Budget Officer: choose Division/Section/Ledger, amount, reason, save draft, upload/register `SUPPLEMENTARY_AUTHORITY`, post.
- `Reallocation` workflow: source and destination keys, transfer amount, reason, request; status history; Registrar approve/reject controls only for authorised Registrar; Budget Officer execution control only after approval and registered `REGISTRAR_REALLOCATION_AUTHORITY`.
- Display source available amount and reject/disable obvious over-transfer client-side while retaining database enforcement.
- Cross-Division source/destination selection supported.
- Read-only audit list with transaction numbers, statuses, authorities and timestamps.

Test key controls and copy first, confirm RED, implement, confirm GREEN.

---

### Task 6: Integrate CI and perform code review

**Files:**
- Modify: `.github/workflows/ci.yml`

Add explicit steps for:
- simplified budget adjustments schema/business rules
- authoritative budget-position contract
- adjustments TypeScript client contract
- adjustments UI contract.

Run/request full GitHub CI on the feature branch PR.

Review specifically for:
- Registrar sole authority cannot be bypassed by system administrator/full access
- supplementary authority required before posting
- Registrar authority required before reallocation execution
- source availability rechecked inside execution transaction
- immutable posted/executed events
- no legacy row mutation/destructive migration
- anon cannot execute new RPCs
- authenticated direct table writes denied
- fixed function search paths
- document lineage matches related entity.

Address all material findings before merge.

---

### Task 7: Production deployment with preservation checks

**Pre-deployment:**
- Capture current row counts for legacy budget, FF3, commitment, payment, and FF4 tables.
- Capture counts for Phase 1 simplified budget tables.
- Confirm no active new-cycle business data is unexpectedly present before applying migration.
- Record current `main` merge SHA and successful CI run.

**Deployment:**
- Apply only the new additive migration through Supabase `apply_migration`.
- Never use raw `execute_sql` for DDL.

**Post-deployment verification:**
- New tables/RPCs/permissions exist.
- RLS and table privileges match design.
- Registrar role alone holds `budget.reallocation.approve` among normal business-role grants.
- Budget Officer holds supplementary/execute permissions.
- No adjustment/reallocation business rows fabricated by migration.
- Legacy and Phase 1 business row counts unchanged.
- Security advisor introduces no new mutable-search-path or RLS-without-policy issue for these objects.

Record evidence in `docs/governance/NJSS_SIMPLIFIED_BUDGET_ADJUSTMENTS_DEPLOYMENT_2026-09-17.md` through a protected PR.

---

## Completion boundary

This plan is complete when supplementary and reallocation functionality is merged, deployed and verified, and the authoritative current-budget-position service exists for the next phase. It does **not** claim FF3 workflow integration; that is the next separate implementation plan after this phase is verified.