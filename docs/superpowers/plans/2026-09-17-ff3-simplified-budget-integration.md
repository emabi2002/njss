# FF3 Simplified Head Office Budget Integration Implementation Plan

> **Required skills:** Use `superpowers:test-driven-development` for every implementation task, `superpowers:systematic-debugging` for failures, `superpowers:requesting-code-review` before merge, and `superpowers:verification-before-completion` before deployment/completion claims.

**Goal:** Integrate FF3 with the activated simplified Head Office budget using the authoritative key `Financial Year + Division + Section + Expense Ledger`, while allowing managerial review of insufficient-budget requests and preventing any financial commitment until the server confirms sufficient available budget.

**Architecture:** The simplified annual-budget/event layer remains the budget source of truth. FF3 gains a direct `expense_ledger_id` and a separate budget-control state independent of workflow status. Submission and managerial endorsement do not reserve or commit budget. The existing final `APPROVE` action remains the single financial commitment gate: it acquires a deterministic budget lock, rechecks the authoritative position, and creates the commitment atomically only when the exact budget key is sufficient and one valid finance-posting mapping exists. If blocked, final approval does not complete and no commitment is created. Supplementary/reallocation events refresh affected open FF3 budget states but never create a commitment by themselves.

**Compatibility strategy:** Existing FF3/FF4 rows and legacy allocation controls remain valid. New FF3s use the global expense ledger as the budget key. When a simplified-budget FF3 reaches final approval, a finance-posting mapping resolves the ledger to the legacy accounting dimensions required by commitment/FF4 foreign keys. Only an allocation explicitly created with `source_module='HEAD_OFFICE_SIMPLIFIED'` may be reused or updated as that compatibility bridge; unrelated legacy allocations are never repurposed. The authoritative simplified-budget position, not the compatibility allocation amount, determines whether the FF3 may commit.

**Tech stack:** Next.js/TypeScript, Supabase/PostgreSQL, existing NJSS RBAC/workflow RPCs, existing FF3/FF4 commitment/payment schema, Bun/Node regression scripts, GitHub Actions.

## Global constraints

- Protected `main`; all code through a feature PR and required CI.
- Additive migrations only. Never edit an already-deployed migration.
- Preserve all existing FF3, FF4, commitment, payment, allocation and revision rows.
- New FF3 budget authority comes from the active simplified annual-budget cycle and its original/supplementary/reallocation events.
- Budget key is FY + Division/Department + Section + global Expense Ledger. Cost centre, project and funding source must not change the approved budget ceiling.
- Managerial workflow and budget-control state are separate.
- An insufficient-budget FF3 may be submitted and endorsed, but it creates **no financial commitment** while blocked.
- Final `APPROVE` cannot succeed financially while the budget is blocked; there is no separate override or second `COMMIT` action.
- No managerial role or system administrator may override the budget ceiling.
- Every final approval performs a server-side authoritative recheck under transaction locks.
- Open managerial FF3s do not reserve budget. Only a created commitment consumes available budget.
- Supplementary/reallocation execution may refresh a blocked FF3 to sufficient but must not silently create a commitment.
- Existing legacy FF3 rows without `expense_ledger_id` retain the current legacy workflow path.
- Existing FF4 behavior must continue to work for commitments created by both paths.

---

### Task 1: Define FF3 budget-state contracts

**Files:**
- `scripts/ff3-simplified-budget-schema.test.mjs`
- `scripts/ff3-simplified-budget-transition.test.mjs`
- `.github/workflows/ci.yml`

Contracts require:

- `ff3_headers.expense_ledger_id`
- separate budget-control state and snapshots: status, current approved, available, shortfall, checked-at
- states `NOT_CHECKED`, `SUFFICIENT`, `INSUFFICIENT_BUDGET_BLOCKED`, `NO_ACTIVE_BUDGET`, `POSTING_MAPPING_REQUIRED`
- authoritative exact-key budget evaluator
- `SUBMIT` and managerial endorsements allowed despite insufficient budget
- final `APPROVE` as the atomic financial commitment gate
- duplicate commitment protection
- no administrator/full-access override of the budget ceiling
- no destructive DDL or legacy-data rewrite.

---

### Task 2: Add additive FF3 budget-integration migrations

**Files:**
- `supabase/migrations/20260917210000_ff3_simplified_budget_integration.sql`
- `supabase/migrations/20260917211000_ff3_approval_commitment_gate.sql`

**Header fields:**

- `expense_ledger_id uuid NULL REFERENCES expense_ledger(id)`
- `budget_control_status varchar(40) NOT NULL DEFAULT 'NOT_CHECKED'`
- `budget_current_approved_snapshot numeric(18,2) NULL`
- `budget_available_snapshot numeric(18,2) NULL`
- `budget_shortfall numeric(18,2) NULL`
- `budget_checked_at timestamptz NULL`

Keep legacy `expense_code_registry_id`, `budget_allocation_id`, `budget_mapping_status` and `is_within_budget` for backward compatibility.

**Budget evaluator:**

1. validate the FF3 Division/Section/Ledger relationship;
2. find the active simplified budget position for the exact key;
3. calculate Original + Supplementary + Reallocations In - Reallocations Out = Current Approved;
4. subtract outstanding commitments and actual expenditure;
5. independently check whether exactly one usable finance-posting mapping exists;
6. return `NO_ACTIVE_BUDGET`, `INSUFFICIENT_BUDGET_BLOCKED`, `POSTING_MAPPING_REQUIRED`, or `SUFFICIENT`.

The evaluator persists snapshot fields whenever workflow actions recheck budget.

**Compatibility allocation resolver:**

- resolve the finance-posting mapping for the exact simplified key;
- reuse only an active allocation explicitly owned by the simplified bridge (`source_module='HEAD_OFFICE_SIMPLIFIED'`);
- otherwise create a narrowly scoped compatibility allocation;
- never mutate an unrelated legacy allocation;
- never use compatibility-allocation availability as the budget ceiling.

---

### Task 3: Preserve managerial review and make final approval the commitment gate

**Legacy branch:**
- Existing FF3s with `expense_ledger_id IS NULL` continue through the current allocation/release-based workflow unchanged.

**Simplified-budget branch:**

`SUBMIT`
- DRAFT only.
- Recheck and persist budget-control state.
- Do not reject merely because budget is insufficient/no active budget/posting mapping is missing.
- Set workflow status `SUBMITTED`.
- Create no commitment.

`ENDORSE_SUPERVISOR` and `ENDORSE_SECTION_HEAD`
- Preserve existing sequence and permissions.
- Refresh budget-control state.
- Do not create commitment and do not override a block.

`APPROVE`
- Preserve final-approver and segregation-of-duties controls.
- Lock the FF3 and the active Division budget control row.
- Recheck the authoritative exact-key budget while the lock is held.
- If insufficient, no active budget, or posting mapping is unresolved, reject the final financial approval and create no commitment.
- If `SUFFICIENT`, resolve/create the isolated compatibility allocation, create exactly one original commitment and transition the FF3 to `COMMITTED` in the same transaction.
- If any step fails, the transaction rolls back; the FF3 remains in its prior managerial state.

`REJECT`, `RETURN`, `CANCEL`
- Preserve existing workflow and audit behavior.

**Concurrency:**
- Lock the FF3 row.
- Lock the affected Division budget header before final available-balance recheck.
- Check for duplicate commitment immediately before insert.
- Concurrent final approvals against the same Division budget serialize, ensuring the later request sees the earlier commitment before it can commit.

---

### Task 4: Refresh blocked FF3s after authorised budget events

- After supplementary posting, refresh non-committed FF3s on the affected key.
- After reallocation execution, refresh non-committed FF3s for both source and destination keys.
- Recalculate only budget state/snapshots; never auto-commit.
- A previously blocked FF3 can become `SUFFICIENT`, after which the authorised approver may perform final `APPROVE` normally.
- If another commitment consumes budget first, the final approval recheck may block again.

---

### Task 5: Use the global ledger directly in the FF3 creation workspace

**Files:**
- `lib/ff3-simplified-budget.ts`
- `app/dashboard/ff3/new/page.tsx`
- `app/dashboard/ff3/new/SimplifiedHeadOfficeFF3.tsx`
- `scripts/ff3-simplified-budget-client.test.mjs`
- `scripts/ff3-simplified-budget-ui.test.mjs`

Requirements:

- Division -> Section -> **Expense Ledger** from centrally maintained `expense_ledger`.
- Requester does not need a finance code to establish budget authority.
- Show Current Approved Budget, Outstanding Commitments, Actual Expenditure, Available Budget, This FF3 Request and Shortfall.
- Permit submission despite insufficient/no-active-budget/mapping-required if ordinary requisition data is valid.
- Explain `INSUFFICIENT BUDGET – COMMITMENT BLOCKED` clearly.
- Preserve operational procurement context without allowing those extra dimensions to alter the approved budget ceiling.

---

### Task 6: Surface budget state throughout review

**Files:**
- `app/dashboard/ff3/[ff3_number]/layout.tsx`
- `scripts/ff3-budget-review-visibility.test.mjs`

Requirements:

- Reviewers see workflow status and budget-control status separately.
- Show Current Approved, Available, Request and Shortfall.
- Return/reject remain available under existing permissions.
- Final approver has no budget override.
- For blocked FF3s, point users toward supplementary budget or Registrar-approved reallocation.
- Persist warning state so requester, Line Manager and Division Director can see the same condition.

---

### Task 7: Preserve FF4 and reporting compatibility

Verify commitments created by the simplified path:

- retain a usable `budget_allocation_id` through the isolated compatibility resolver;
- can be consumed by existing FF4 creation/payment controls;
- are counted by the simplified budget calculator through the finance-posting mapping;
- reduce available budget immediately on commitment;
- convert to actual expenditure correctly after payment without double counting.

Do not redesign FF4 UI in this phase unless a compatibility defect requires a minimal correction.

---

### Task 8: Full CI, review and protected integration

Review specifically for:

- insufficient FF3 submission no longer hard-stops managerial workflow;
- blocked FF3 creates no commitment;
- no pending managerial FF3 reserves budget;
- final approval has an authoritative atomic recheck;
- concurrent commitments cannot exceed available budget;
- supplementary/reallocation refreshes state but does not auto-commit;
- Registrar-only reallocation authority remains intact;
- legacy FF3/FF4 behavior remains compatible;
- no existing financial rows are mutated by migration;
- anonymous execution remains denied and SECURITY DEFINER functions have fixed search paths.

Merge only after required `Build and validate` is green.

---

### Task 9: Production deployment and evidence

Pre-deployment:
- capture FF3, commitment, FF4, payment and allocation row counts and FF3 status distribution;
- capture current transition function and relevant schema state;
- confirm existing simplified budget-cycle state;
- record merge SHA and successful main CI.

Deployment:
- apply only the Phase 3 additive migrations through Supabase `apply_migration`.

Post-deployment:
- verify new columns, constraints, RPCs, grants, triggers and function search paths;
- verify all pre-existing FF3/commitment/FF4/payment/allocation rows are unchanged;
- verify historical FF3s remain on the legacy branch because `expense_ledger_id` remains null;
- rerun Supabase security advisor and classify findings;
- record evidence in `docs/governance/NJSS_FF3_SIMPLIFIED_BUDGET_INTEGRATION_DEPLOYMENT_2026-09-17.md` through protected PR flow.

## Completion boundary

Phase 3 is complete when new ledger-based FF3s can enter managerial workflow regardless of current budget sufficiency, every reviewer sees the same authoritative budget state, final `APPROVE` is impossible without sufficient authoritative budget and a valid posting mapping, the successful approval creates exactly one commitment atomically, authorised budget events can clear a block without bypassing human approval, and existing FF4/payment behavior remains operational through the compatibility bridge.
