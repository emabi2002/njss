# FF3 Simplified Head Office Budget Integration Implementation Plan

> **Required skills:** Use `superpowers:test-driven-development` for every implementation task, `superpowers:systematic-debugging` for failures, `superpowers:requesting-code-review` before merge, and `superpowers:verification-before-completion` before deployment/completion claims.

**Goal:** Integrate FF3 with the activated simplified Head Office budget using the authoritative key `Financial Year + Division + Section + Expense Ledger`, while allowing managerial review of insufficient-budget requests and preventing any financial commitment until the server confirms sufficient available budget.

**Architecture:** The simplified annual-budget/event layer remains the budget source of truth. FF3 gains a direct `expense_ledger_id` and a separate budget-control state independent of workflow status. Submission and managerial endorsement do not reserve or commit budget. Final FF3 approval records the human approval even when budget is blocked; if budget is sufficient and a valid finance-posting mapping exists, the current approval path may create the commitment immediately. If approval is blocked, the FF3 remains `APPROVED` with no commitment. A later `COMMIT` action rechecks the authoritative budget atomically and creates the commitment only when the block has cleared. Supplementary/reallocation events refresh affected open FF3 budget states but never create a commitment by themselves.

**Compatibility strategy:** Existing FF3/FF4 rows and legacy allocation controls remain valid. New FF3s use the global expense ledger as the budget key. When a simplified-budget FF3 is ready to commit, a finance-posting mapping must resolve the ledger to the required legacy accounting dimensions. The commitment reuses an existing exact active `budget_allocation` where appropriate; otherwise it creates a narrowly scoped compatibility allocation for the mapped accounting code so existing commitment/FF4 foreign-key paths continue to work. Legacy rows are not rewritten. The authoritative simplified-budget position, not the compatibility allocation amount, determines whether the new FF3 may commit.

**Tech stack:** Next.js/TypeScript, Supabase/PostgreSQL, existing NJSS RBAC/workflow RPCs, existing FF3/FF4 commitment/payment schema, Bun/Node regression scripts, GitHub Actions.

## Global constraints

- Protected `main`; all code through a feature PR and required CI.
- Additive migrations only. Never edit an already-deployed migration.
- Preserve all existing FF3, FF4, commitment, payment, allocation and revision rows.
- New FF3 budget authority comes from `get_current_budget_position()` and the active simplified annual-budget cycle.
- Budget key is FY + Division/Department + Section + global Expense Ledger. Cost centre, project and funding source must not change the approved budget ceiling.
- Managerial workflow and budget-control state are separate.
- An insufficient-budget FF3 may be submitted, endorsed and finally approved, but it creates **no financial commitment** while blocked.
- No managerial role or system administrator may override the budget ceiling.
- Every commitment attempt performs a server-side authoritative recheck under transaction locks.
- Open managerial FF3s do not reserve budget. Only a created commitment consumes available budget.
- Supplementary/reallocation execution may refresh a blocked FF3 to sufficient but must not silently create a commitment.
- Existing legacy FF3 rows without `expense_ledger_id` retain the current legacy workflow path.
- Existing FF4 behavior must continue to work for commitments created by both paths.

---

### Task 1: Add RED contracts for the FF3 budget-state model

**Files:**
- Create `scripts/ff3-simplified-budget-schema.test.mjs`
- Create `scripts/ff3-simplified-budget-transition.test.mjs`
- Modify `.github/workflows/ci.yml`

Tests must require a new additive migration containing:

- `ff3_headers.expense_ledger_id`
- separate FF3 budget-control state and snapshots: status, current approved, available, shortfall, checked-at
- allowed states including `NOT_CHECKED`, `SUFFICIENT`, `INSUFFICIENT_BUDGET_BLOCKED`, `NO_ACTIVE_BUDGET`, `POSTING_MAPPING_REQUIRED`
- an authoritative FF3 budget-evaluation RPC/helper based on `get_current_budget_position`
- `SUBMIT` allowed despite insufficient budget
- managerial endorsement allowed despite budget block
- final `APPROVE` records approval but does not create a commitment when blocked
- `COMMIT` action available only from an approved FF3 and protected by `ff3.approve`
- atomic authoritative recheck before commitment creation
- duplicate commitment protection
- no administrator/full-access override of the budget ceiling
- no destructive DDL or legacy-data rewrite.

Run both new tests before implementation and confirm RED.

---

### Task 2: Add the additive FF3 budget-integration migration

**File:**
- Create `supabase/migrations/20260917030000_ff3_simplified_budget_integration.sql`

**Header fields:**

- `expense_ledger_id uuid NULL REFERENCES expense_ledger(id)`
- `budget_control_status varchar(40) NOT NULL DEFAULT 'NOT_CHECKED'`
- `budget_current_approved_snapshot numeric(18,2) NULL`
- `budget_available_snapshot numeric(18,2) NULL`
- `budget_shortfall numeric(18,2) NULL`
- `budget_checked_at timestamptz NULL`

Keep legacy `expense_code_registry_id`, `budget_allocation_id`, `budget_mapping_status` and `is_within_budget` for backward compatibility.

**Budget evaluator:**

Create a secured helper/RPC that:

1. validates the FF3 Division/Section/Ledger relationship;
2. finds the active simplified budget position for the exact key;
3. calculates requested amount, Current Approved, Commitments, Actuals, Available and Shortfall;
4. independently checks whether exactly one usable finance-posting mapping exists for the same FY/Division/Section/Ledger (optionally respecting a selected cost centre when present);
5. returns:
   - `NO_ACTIVE_BUDGET` when no active authoritative position exists;
   - `INSUFFICIENT_BUDGET_BLOCKED` when requested > available;
   - `POSTING_MAPPING_REQUIRED` when budget is sufficient but the accounting mapping cannot resolve uniquely;
   - `SUFFICIENT` only when both budget and required posting mapping are valid.

This evaluator updates snapshot fields whenever workflow actions recheck budget.

**Compatibility allocation resolver:**

Create an internal helper used only during commitment creation:

- resolve the active `finance_posting_mappings` row for the exact simplified key;
- prefer an existing active allocation matching its FY/Department/Section/Expense Code/Account/Cost Centre;
- if no exact allocation exists, create a compatibility allocation with `source_module='HEAD_OFFICE_SIMPLIFIED'` using the posting mapping's accounting dimensions;
- never mutate an unrelated legacy allocation merely to mirror the simplified budget;
- never use compatibility-allocation availability as the commitment ceiling.

---

### Task 3: Separate FF3 managerial approval from financial commitment

**File:**
- In `20260917030000_ff3_simplified_budget_integration.sql`, replace `njss_transition_ff3` additively.

**Legacy branch:**
- Existing FF3s with `expense_ledger_id IS NULL` continue through the current allocation/release-based behavior.

**Simplified-budget branch:**

`SUBMIT`
- DRAFT only.
- Recheck and persist budget-control state.
- Do **not** reject submission because budget is insufficient/no active budget/posting mapping missing.
- Set workflow status `SUBMITTED`.
- Create no commitment.

`ENDORSE_SUPERVISOR` and `ENDORSE_SECTION_HEAD`
- Preserve existing sequence/segregation rules.
- Refresh budget-control state.
- Do not create commitment and do not override a block.

`APPROVE`
- Preserve existing final-approver and segregation-of-duties checks.
- Record final managerial approval and status `APPROVED` first.
- Recheck the authoritative simplified position under locks.
- If status is `SUFFICIENT`, resolve/create the compatibility allocation, create one original commitment and transition to `COMMITTED` in the same transaction.
- If blocked, leave status `APPROVED`, retain the budget-control reason/snapshots and return successfully with no commitment.

`COMMIT`
- New action, valid only from `APPROVED` and requiring `ff3.approve`.
- Recheck authoritative budget and posting mapping under transaction locks.
- If still blocked, update the budget-control state and return with no commitment.
- If sufficient, create exactly one commitment and transition to `COMMITTED`.

`REJECT`, `RETURN`, `CANCEL`
- Preserve existing workflow rules and audit behavior.

**Concurrency:**
- Lock the FF3 row.
- Lock the affected Division budget header (or another deterministic simplified-budget control row) before the final available-balance recheck.
- Duplicate-commitment check immediately before insert.
- Concurrent commitments against the same Division/Section/Ledger must serialize sufficiently that the second request cannot overcommit the authoritative available balance.

---

### Task 4: Refresh blocked FF3s after authorised budget events

**File:**
- In the Phase 3 migration, add `njss_refresh_ff3_budget_states(...)` and replace the existing supplementary/reallocation posting RPCs only as needed to invoke it after successful financial events.

Behavior:

- After a supplementary posting, refresh non-committed FF3s on the affected key.
- After a reallocation execution, refresh non-committed FF3s for both source and destination keys.
- Recalculate only status/snapshots; never create a commitment automatically.
- A previously blocked approved FF3 can become `SUFFICIENT`, making `COMMIT` available.
- If another commitment consumes budget first, the later `COMMIT` action must recheck and may return the FF3 to `INSUFFICIENT_BUDGET_BLOCKED`.

---

### Task 5: Update the FF3 client and creation screen

**Files:**
- Modify `lib/api.ts`
- Modify `app/dashboard/ff3/new/page.tsx`
- Create `scripts/ff3-simplified-budget-client.test.mjs`
- Create `scripts/ff3-simplified-budget-ui.test.mjs`

**Client:**
- Add a simplified-budget evaluation function/RPC wrapper.
- Update `approveFF3` action typing to include `COMMIT`.
- Retain legacy `checkBudgetAvailability()` for existing/legacy screens but stop using it as the authoritative check for new ledger-based FF3s.

**New FF3 screen:**
- Select Division -> Section -> **Ledger** from centrally maintained `expense_ledger`.
- Do not require the requester to create/select a finance code to establish budget authority.
- Display:
  - Current Approved Budget
  - Outstanding Commitments
  - Actual Expenditure
  - Available Budget
  - This FF3 Request
  - Shortfall
  - budget-control badge.
- Permit Submit when budget status is insufficient/no-active-budget/mapping-required, provided normal FF3 fields are valid.
- Explain clearly: `INSUFFICIENT BUDGET – COMMITMENT BLOCKED` when applicable.
- Continue storing other procurement/accounting context fields that remain operationally useful, but they do not change the budget ceiling.

Write client/UI contracts first and confirm RED before implementation.

---

### Task 6: Surface budget state through review and approval

**Files:**
- Modify the relevant FF3 list/detail/review page(s) after locating their active routes.
- Add a regression test for review visibility.

Requirements:

- Reviewers see workflow status and budget-control status separately.
- Show Current Approved, Available, Request and Shortfall to Line Supervisor/final approver.
- Return/reject actions remain available under existing permissions.
- Final approver cannot override a blocked financial commitment.
- For `APPROVED + SUFFICIENT + no commitment`, show the controlled `Create Commitment`/`COMMIT` action to the authorised final approver.
- For `APPROVED + blocked`, show the reason and direct users toward budget reallocation/supplementary action rather than an override.

**Warning visibility:**
- Persist budget status on the FF3 so every workflow handler sees the same warning.
- Add targeted budget-block notifications to the requester and organisationally scoped FF3 endorsers/approvers using existing `BUDGET_EXCEEDED`/FF3 reference semantics. Do not send unrestricted global notifications.

---

### Task 7: Preserve FF4 and reporting compatibility

**Files:**
- Migration + targeted regressions only where required.

Verify that commitments created by the simplified path:

- retain a usable `budget_allocation_id` through the compatibility resolver;
- can be selected by existing FF4 creation;
- can proceed through existing FF4 payment controls;
- are counted by `get_current_budget_position()` through the finance-posting mapping;
- reduce the simplified available budget immediately on commitment;
- reduce/convert commitment to actual expenditure correctly after FF4 payment without double counting.

Do not redesign FF4 UI in this phase unless a compatibility failure requires a minimal correction.

---

### Task 8: Full CI, review and protected integration

Run full CI on the feature PR and review specifically for:

- insufficient FF3 submission no longer hard-stops managerial workflow;
- blocked FF3 creates no commitment;
- no pending managerial FF3 reserves budget;
- final commitment has an authoritative atomic recheck;
- two concurrent commitments cannot exceed available budget;
- supplementary/reallocation refreshes budget state but does not auto-commit;
- original budget/supplementary/reallocation immutability remains intact;
- Registrar-only reallocation authority remains intact;
- legacy FF3/FF4 behavior remains compatible;
- no existing financial rows are mutated by migration;
- anon execute remains denied and new SECURITY DEFINER functions have fixed search paths.

Address all material review findings before merge. Merge only after required `Build and validate` is green.

---

### Task 9: Production deployment and evidence

Pre-deployment:
- capture legacy/Phase1/Phase2 row counts and existing FF3 status distribution;
- capture production definitions of `njss_transition_ff3` and affected FF4 helpers;
- confirm no active simplified budget cycle exists unexpectedly;
- record merge SHA and successful main CI.

Deployment:
- apply only the new Phase 3 additive migration(s) through Supabase `apply_migration`.

Post-deployment:
- verify new columns, checks, RPCs, grants and function search paths;
- verify legacy row counts unchanged;
- verify existing 32 FF3 headers and 20 commitments were not altered by migration;
- verify existing FF4 rows unchanged;
- rerun Supabase security advisor and classify any findings;
- record evidence in `docs/governance/NJSS_FF3_SIMPLIFIED_BUDGET_INTEGRATION_DEPLOYMENT_2026-09-17.md` through protected PR flow.

## Completion boundary

Phase 3 is complete when new ledger-based FF3s can enter managerial workflow regardless of current budget sufficiency, every reviewer sees the same authoritative budget block, final financial commitment is impossible without sufficient authoritative budget and valid posting mapping, authorised budget events can clear the block without bypassing human approval, and existing FF4/payment behavior remains operational through the compatibility bridge.
