# Simplified Supplementary Budget and Reallocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Follow test-driven development: add each regression contract first, observe the expected failure in CI, then implement the minimum production change to make it pass.

**Goal:** Add the approved post-activation budget-adjustment layer for supplementary budgets and Registrar-controlled reallocations without changing original locked budget figures or breaking the existing FF3/FF4 backend.

**Architecture:** Extend the additive Head Office budget model introduced in Phase 1. Store supplementary adjustments as immutable posted events. Store reallocations as controlled REQUESTED -> AUTHORISED -> EXECUTED/REJECTED records, with the Registrar as the only authoriser and the Budget Officer as executor. Derive the approved ceiling from original + posted supplementary + executed transfers. Protect source balances using the existing commitment/payment control data resolved through canonical finance posting mappings. Do not repurpose the legacy `budget_revisions` workflow; preserve it for transition/history until later retirement decisions.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, TypeScript 5, Supabase/PostgreSQL 17, Supabase Storage, existing RBAC/RPC framework, Node `.mjs` contract/runtime tests, Bun/GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-17-simplified-head-office-budget-design.md`

## Global constraints

- Operate only against an `ACTIVE` annual Head Office budget cycle.
- Original `division_budget_lines.original_amount` remains immutable.
- Supplementary authority is mandatory before posting a supplementary adjustment.
- A Division Director may request a reallocation; the Registrar is the sole approving authority; the Budget Officer executes.
- Deputy Registrar, System Administrator and Budget Officer must not gain reallocation approval authority through role inheritance.
- Registrar correspondence/document evidence is mandatory before execution.
- Reallocation source and destination are one atomic transaction.
- `reallocation amount <= source available budget`; committed and spent amounts cannot be moved.
- Source and destination may cross Division, Section and ledger boundaries.
- Documents remain in private bucket `njss-budget-documents` and are append/version controlled.
- New business tables are RLS-protected; authenticated clients do not receive direct INSERT/UPDATE/DELETE privileges.
- Legacy FF3/FF4 and old budget revision tables are preserved during this phase.

---

## Task 1 — Add failing Phase 2 schema/security contracts

**Files:**
- Create: `scripts/simplified-budget-adjustments.test.mjs`
- Modify: `.github/workflows/ci.yml`

- [ ] Add source-contract assertions requiring:
  - `budget_supplementary_adjustments`
  - `budget_reallocations`
  - permissions `budget.supplementary.enter`, `budget.reallocation.request`, `budget.reallocation.approve`, `budget.reallocation.execute`
  - RPCs `post_budget_supplementary_adjustment`, `request_budget_reallocation`, `authorise_budget_reallocation`, `reject_budget_reallocation`, `execute_budget_reallocation`
  - authoritative approved-position view/function exposing original, supplementary, reallocation in/out and current approved budget
  - Registrar-only approval guard
  - Budget Officer execute permission
  - mandatory authority-document checks
  - source available-budget validation
  - RLS/direct-DML lockdown.
- [ ] Add the new test to CI.
- [ ] Push the test-only commit and confirm CI fails for the intended missing migration/API behavior (RED).

Expected RED: the contract fails because the Phase 2 migration and APIs do not yet exist.

---

## Task 2 — Implement the additive database model and secured RPC workflow

**Files:**
- Create: `supabase/migrations/20260917020000_simplified_budget_adjustments.sql`
- Modify as needed: `scripts/simplified-budget-adjustments.test.mjs`

### Supplementary table

Create `public.budget_supplementary_adjustments` with, at minimum:

```sql
id uuid primary key,
transaction_number text unique not null,
annual_budget_cycle_id uuid not null references annual_budget_cycles(id),
financial_year integer not null,
division_budget_id uuid not null references division_budgets(id),
section_id uuid not null references sections(id),
expense_ledger_id uuid not null references expense_ledger(id),
adjustment_amount numeric(18,2) not null check (adjustment_amount > 0),
authority_document_id uuid not null references budget_documents(id),
authority_reference text,
reason text not null,
posted_by uuid not null references users(id),
posted_at timestamptz not null default now()
```

Supplementary rows are append-only after posting. `post_budget_supplementary_adjustment(...)` must:

1. require `budget.supplementary.enter`;
2. require the cycle to be `ACTIVE`;
3. require the Division budget to be `LOCKED` and belong to that cycle/year;
4. validate Section belongs to Division and ledger is active/posting;
5. require `SUPPLEMENTARY_AUTHORITY` document linked to the transaction/cycle context and stored in the private bucket;
6. insert one immutable positive adjustment event.

### Reallocation table

Create `public.budget_reallocations` with:

```sql
id uuid primary key,
reallocation_number text unique not null,
annual_budget_cycle_id uuid not null references annual_budget_cycles(id),
financial_year integer not null,
status text not null check (status in ('REQUESTED','AUTHORISED','EXECUTED','REJECTED')),
requested_by uuid not null references users(id),
requested_at timestamptz not null,
requesting_division_id uuid references departments(id),
reason text not null,
source_division_budget_id uuid not null references division_budgets(id),
source_section_id uuid not null references sections(id),
source_expense_ledger_id uuid not null references expense_ledger(id),
destination_division_budget_id uuid not null references division_budgets(id),
destination_section_id uuid not null references sections(id),
destination_expense_ledger_id uuid not null references expense_ledger(id),
amount numeric(18,2) not null check (amount > 0),
authority_document_id uuid references budget_documents(id),
authority_reference text,
authorised_by uuid references users(id),
authorised_at timestamptz,
rejected_by uuid references users(id),
rejected_at timestamptz,
rejection_reason text,
executed_by uuid references users(id),
executed_at timestamptz
```

The request RPC requires `budget.reallocation.request` and validates both dimensions against the active cycle. `authorise_budget_reallocation(...)` must require both `budget.reallocation.approve` **and** `njss_current_user_has_role('Registrar')`; it must require a valid `REGISTRAR_REALLOCATION_AUTHORITY` document/reference. `reject_budget_reallocation(...)` has the same Registrar-only guard. `execute_budget_reallocation(...)` requires `budget.reallocation.execute`, requires status `AUTHORISED`, locks the reallocation/source budget records, recomputes source availability inside the same transaction and only then marks `EXECUTED`.

### Permissions and role grants

Create permissions idempotently:

- Budget Officer: `budget.supplementary.enter`, `budget.reallocation.execute` (and existing document/view permissions)
- Division Director: `budget.reallocation.request`
- Registrar: `budget.reallocation.approve`, `budget.reallocation.request`, view/report as appropriate

Do not assign `budget.reallocation.approve` to Deputy Registrar, Budget Officer or System Administrator.

### Current approved position

Create a security-invoker view (or secured function if repository conventions require it) keyed by:

`financial_year + division_id + section_id + expense_ledger_id`

and expose:

- `original_budget`
- `supplementary_adjustments`
- `reallocation_in`
- `reallocation_out`
- `current_approved_budget`.

The dimension set must include original lines plus dimensions introduced solely by supplementary/reallocation events so that a destination can receive funds even when no original zero-value line was stored.

### Protected obligations / source availability

Create one secured calculation used by reallocation execution that resolves the selected global ledger to the canonical posting mapping for the selected FY/Division/Section and sums the existing financial-control obligations:

- outstanding FF3 commitments (`ff3_commitments.outstanding_amount`), and
- actual expenditure/payments already posted through the linked allocation/commitment/payment controls.

Source availability is:

`current_approved_budget - outstanding_commitments - actual_expenditure`.

Do not count the same paid amount twice. Reuse the existing commitment/payment ledger semantics (`outstanding_amount` and paid/posted actuals) rather than inventing a second calculation.

- [ ] Run the new schema contract and the existing security/migration/runtime regression suite; all must pass.

---

## Task 3 — Extend the Head Office budget client API

**Files:**
- Modify: `lib/head-office-budget.ts`
- Create: `scripts/head-office-budget-adjustments-client.test.mjs`
- Modify: `.github/workflows/ci.yml`

Add types for `BudgetSupplementaryAdjustment`, `BudgetReallocation`, `BudgetApprovedPosition` and functions:

```ts
getBudgetApprovedPosition(financialYear: number)
getSupplementaryAdjustments(financialYear: number)
postSupplementaryAdjustment(input)
getBudgetReallocations(financialYear: number)
requestBudgetReallocation(input)
authoriseBudgetReallocation(input)
rejectBudgetReallocation(input)
executeBudgetReallocation(reallocationId: string)
```

All writes use secured RPCs; reads use the new secured position/read model. Extend document upload helpers by using existing `registerBudgetDocument` with `SUPPLEMENTARY`/`REALLOCATION` and the correct document types.

TDD sequence: client contract first (RED), then implementation (GREEN), then lint/typecheck.

---

## Task 4 — Replace the legacy revisions landing experience for new annual-budget adjustments

**Files:**
- Create: `app/dashboard/budget/adjustments/page.tsx`
- Create: `scripts/simplified-budget-adjustments-ui.test.mjs`
- Modify: navigation/menu configuration only where the existing budget menu supports it
- Do **not** delete `app/dashboard/budget/revisions/*` in this phase.

Build a role-aware Budget Adjustments workspace with two primary tabs:

1. **Supplementary Budget** — Budget Officer selects FY, Division, Section, global ledger, amount, reason, uploads/chooses official authority document, sees original/current approved amount, then posts.
2. **Reallocation** — displays request register and status. Division Director can create a request. Registrar alone receives Authorise/Reject controls. Budget Officer receives Execute only after Registrar authorisation and evidence are present.

Display source position prominently before execution:

```text
Current Approved Budget
Outstanding Commitments
Actual Expenditure
Available to Reallocate
Requested Transfer
Projected Source Balance
```

Destination preview displays current approved amount and projected approved amount after execution.

The UI must not provide any override of the source-availability rule.

Preserve the legacy `budget/revisions` route for historical/transition use, but label the new page as the operational **Budget Adjustments** workspace for the simplified annual-budget model.

TDD sequence: UI contract first (RED), implementation (GREEN), lint/typecheck/build.

---

## Task 5 — Runtime/concurrency tests and security review

**Files:**
- Create: `scripts/simplified-budget-adjustments-runtime.test.mjs`
- Modify: `.github/workflows/ci.yml`

Against CI PostgreSQL, verify at minimum:

1. original locked amount remains unchanged after supplementary posting;
2. supplementary increases current approved position;
3. request can be created by allowed request role/permission;
4. non-Registrar cannot authorise even if mistakenly given approval permission;
5. Registrar can authorise only with valid authority evidence;
6. Budget Officer cannot execute REQUESTED/unapproved transfer;
7. execution posts one atomic transfer and updates both source/destination positions;
8. transfer larger than source available is rejected;
9. two concurrent executions cannot overspend the same source balance;
10. executed records cannot be silently edited/deleted;
11. direct authenticated table mutation remains unavailable.

Run existing critical RPC, RLS, migration-governance and legacy-backend-preservation tests as regression gates.

---

## Task 6 — PR, review, deployment and production verification

- [ ] Run complete branch CI: regression suite, lint, typecheck, build.
- [ ] Review diff against approved spec and ensure Phase 1/legacy records are not destructively modified.
- [ ] Open PR to protected `main`.
- [ ] Request/review code; resolve findings.
- [ ] Merge only after required `Build and validate` is green.
- [ ] Capture production pre-deployment counts for legacy budget/FF3/FF4 tables and Phase 1 tables.
- [ ] Apply only the new additive migration to Supabase using migration tooling.
- [ ] Verify new tables/RPCs/permissions/RLS and source-availability calculation.
- [ ] Verify post-deployment legacy counts are unchanged.
- [ ] Run Supabase security/performance advisors and distinguish new findings from the pre-existing baseline.
- [ ] Record deployment evidence in `docs/governance/` through a protected PR.

## Explicitly deferred to the following phase

- changing FF3 submission behavior to `INSUFFICIENT_BUDGET_BLOCKED`;
- creating commitments against the new simplified active budget position;
- automatic unblock/re-evaluation of blocked FF3s after adjustments;
- FF4/reporting cut-over to the new single authoritative position;
- retirement of legacy budget-capture/revision tables and routes.
