# Task 9 — Operational Budget Activation & Finance Master-Data Hardening

Date: 2026-08-28
Status: Approved architecture, implementation pending review

## 1. Purpose

Task 9 separates business approval of a divisional budget from technical activation of that approved budget into operational allocations used by FF3, FF4, funding, commitments, revisions, reporting, and expenditure control.

The change removes unsafe fallback accounting behaviour and introduces explicit dual control:

- System Administrator prepares and validates financial mappings.
- Registrar authorises the final activation.

Approved budget figures remain business-authoritative and immutable. Operational activation creates the system representation of those approved figures only after all Finance master-data controls pass.

## 2. Current-State Problem

The existing budget approval workflow calls `create_operational_allocations_from_divisional_budget()` as part of the APPROVE transition. The function currently selects the first active Chart of Accounts record as a fallback account. This creates a material risk that approved budget lines can become operational using an unrelated account when an exact Finance Code to Chart of Accounts mapping is absent.

The current Posting Code builder also composes Department → Cost Centre → Category → Item records without requiring an explicit source `expense_ledger` Finance Code relationship at creation time.

Task 9 must not activate approved budget lines through this existing fallback path.

## 3. Governing Business Rule

The approved control model is dual control:

1. Line Supervisor prepares and submits the budget.
2. Registrar reviews and approves the budget.
3. Approval does not create operational allocations.
4. System Administrator prepares and validates Finance master-data mappings.
5. When all approved lines reconcile, the activation batch becomes READY_FOR_ACTIVATION.
6. Registrar performs the final Activate Approved Budget action.
7. Activation creates all operational allocations atomically.
8. The System Administrator cannot activate the budget.
9. The Registrar cannot alter technical mappings from the activation-authorisation screen.

System Administrator remains a protected technical role and must not be treated as a business workflow approver.

## 4. Accounting Mapping Authority

Every approved budget line must resolve through an explicit mapping chain:

`divisional_budget_line`
→ `expense_ledger`
→ authoritative Finance Code
→ `expense_code_registry`
→ `chart_of_accounts`
→ Department / Cost Centre / Section context
→ `budget_allocations`

No fallback accounting code is permitted.

No inferred Finance Code, first-active-account substitution, silent remapping, or partial posting is permitted.

If one approved line cannot resolve to valid active master data, the activation batch cannot be authorised.

## 5. Data Model

### 5.1 `budget_activation_batches`

Create a controlled activation header table containing at minimum:

- `id`
- `submission_id` — unique reference to approved divisional budget submission
- `financial_year`
- `department_id`
- `budget_division_id`
- `approved_line_count`
- `approved_total`
- `mapped_line_count`
- `unmapped_line_count`
- `activation_total`
- `variance`
- `status`
- `prepared_by`
- `prepared_by_email`
- `prepared_at`
- `validated_at`
- `submitted_for_activation_at`
- `authorised_by`
- `authorised_by_email`
- `authorised_at`
- `activated_at`
- `cancelled_at`
- `cancellation_reason`
- `validation_snapshot`
- `created_at`
- `updated_at`

Allowed status values:

- `DRAFT_MAPPING`
- `VALIDATION_FAILED`
- `READY_FOR_ACTIVATION`
- `ACTIVATED`
- `CANCELLED`

`ACTIVATED` is terminal and immutable except for non-financial system metadata if explicitly required.

### 5.2 `budget_activation_lines`

Create a line-level validation and traceability table containing at minimum:

- `id`
- `activation_batch_id`
- `submission_id`
- `budget_line_id`
- `expense_ledger_id`
- `finance_code`
- `expense_code_registry_id`
- `chart_of_account_id`
- `department_id`
- `section_id`
- `cost_centre_id`
- `approved_amount`
- `mapped_amount`
- `mapping_status`
- `validation_errors`
- `validation_snapshot`
- `created_at`
- `updated_at`

One active activation line must exist per source approved budget line within the batch.

The activation line is a validation snapshot and must never become an alternate source of approved budget figures.

## 6. Finance Master-Data Hardening

### 6.1 `expense_ledger`

The existing `expense_ledger.expense_code_registry_id` relationship remains the canonical Finance Code → Posting Code bridge.

Strengthen validation so an active posting `expense_ledger` record used by an approved budget line must have exactly one valid active `expense_code_registry` mapping.

### 6.2 `expense_code_registry`

Add an explicit Chart of Accounts reference if the current schema does not already contain an authoritative one:

- `chart_of_account_id UUID REFERENCES chart_of_accounts(id)`

An operational Posting Code that can receive budget must resolve to one active Chart of Accounts record.

The builder UI must expose the Finance Code association and Chart of Accounts mapping rather than creating hierarchy-only codes with no authoritative Finance linkage.

### 6.3 Master Data UI

Enhance the Expense / Posting Codes workspace to display and maintain:

- Finance Code
- Finance Description
- Department
- Section
- Cost Centre
- Expense Category
- Expense Item
- Posting Code
- Chart of Accounts
- Active status
- Mapping readiness

The System Administrator may correct master-data relationships but cannot change approved budget quantities, unit costs, monthly cash flow, annual estimates, or approved line Finance Codes through this workspace.

## 7. Workflow Changes

### 7.1 Budget Approval

Modify `transition_divisional_budget_submission` so `APPROVE`:

- validates the budget submission;
- records Registrar approval;
- changes the business budget status to APPROVED;
- creates or refreshes a DRAFT_MAPPING activation batch;
- does **not** create `budget_allocations`.

### 7.2 Prepare Activation

Provide a System Administrator-only action:

`Prepare Activation`

It must:

1. confirm the source submission is APPROVED;
2. load every approved line;
3. resolve exact `expense_ledger` Finance Code mapping;
4. resolve exact active `expense_code_registry` mapping;
5. resolve exact active Chart of Accounts mapping;
6. resolve Department, Section and Cost Centre context;
7. verify source amounts and monthly allocations;
8. compare line and batch totals to the approved submission;
9. write a validation snapshot to activation lines;
10. set the batch to VALIDATION_FAILED or DRAFT_MAPPING according to results.

The process must be idempotent and safe to re-run while the batch is not ACTIVATED.

### 7.3 Submit for Activation

System Administrator may select `Submit for Activation` only when:

- all source lines are mapped;
- no validation error remains;
- activation line count equals approved line count;
- activation total equals approved total;
- variance is zero within the established monetary tolerance;
- source submission remains APPROVED.

The batch then becomes `READY_FOR_ACTIVATION`.

### 7.4 Registrar Activation

Registrar receives a read-only reconciliation showing:

- approved line count;
- mapped line count;
- approved total;
- activation total;
- variance;
- Finance mapping status;
- preparer identity and validation timestamp.

The Registrar may then select `Activate Approved Budget`.

The Registrar must not be able to edit mappings in this screen.

## 8. Atomic Activation RPC

Create a secured RPC such as:

`njss_activate_approved_budget(p_activation_batch_id UUID, p_user_email TEXT)`

The RPC must independently revalidate all critical data immediately before posting. It must not trust a stale browser validation result.

Required checks:

1. activation batch exists;
2. status is READY_FOR_ACTIVATION;
3. source submission remains APPROVED;
4. current user has Registrar authority;
5. preparer is a System Administrator;
6. every source line still exists and matches the approved snapshot;
7. every Finance Code maps to one active Posting Code;
8. every Posting Code maps to one active Chart of Accounts record;
9. Department / Section / Cost Centre relationships remain valid;
10. approved line count equals activation line count;
11. approved total equals activation total;
12. variance equals zero within tolerance;
13. no active operational allocation already exists for any source budget line;
14. monthly and quarterly totals reconcile to each approved line amount.

If any check fails, the entire transaction must roll back.

If all checks pass, insert all `budget_allocations` in one transaction using exact mapped `account_id`, `expense_code_registry_id`, organisation dimensions, funding source, monthly cash flow and source traceability.

Then:

- mark the activation batch ACTIVATED;
- record Registrar authorisation and activation timestamps;
- write audit events;
- send relevant notifications;
- make allocations visible to FF3/FF4, funding, commitments, budget revisions and reports.

No partial activation is permitted.

## 9. Existing Allocation Function

Retire direct operational use of the unsafe fallback path.

`create_operational_allocations_from_divisional_budget()` must either:

- be replaced by the new secured activation RPC; or
- be retained only as an internal helper that accepts already-validated exact mappings and contains no fallback account selection.

Direct execute grants that allow ordinary authenticated users to call the old allocation function must be removed.

## 10. RBAC

Introduce or refine permissions so responsibility is explicit.

Suggested permissions:

- `budget.activation.view`
- `budget.activation.prepare`
- `budget.activation.validate`
- `budget.activation.submit`
- `budget.activation.authorize`

Assignment:

- System Administrator: prepare, validate, submit, view; **not authorize**.
- Registrar: view, authorize; **not prepare or edit master mappings from the authorisation workflow**.
- Line Supervisor: view activation status for own authorised budget context where useful; no activation mutation.
- Requisition Officer and Payment/Reconciliation Officer: no activation mutation.

Existing `all` administrator semantics must not accidentally bypass the business-authority prohibition. The activation RPC must enforce the role separation explicitly even if the technical account possesses broad application permissions.

## 11. Audit and Notifications

Audit events should include at minimum:

- `BUDGET_ACTIVATION_CREATED`
- `BUDGET_ACTIVATION_VALIDATED`
- `BUDGET_ACTIVATION_VALIDATION_FAILED`
- `BUDGET_ACTIVATION_SUBMITTED`
- `BUDGET_ACTIVATED`
- `BUDGET_ACTIVATION_CANCELLED`

Audit metadata must include:

- source submission;
- activation batch;
- financial year;
- department/division;
- line count;
- approved total;
- activation total;
- variance;
- preparer;
- Registrar authoriser;
- validation result summary.

Notifications:

- Registrar notified when a batch becomes READY_FOR_ACTIVATION.
- System Administrator notified if Registrar activation fails because a mapping changed after preparation.
- Relevant budget owner / Line Supervisor may be notified after successful activation.

## 12. Revision Integration

Task 8 budget revision eligibility depends on the existence of valid operational allocations.

After Task 9 activation succeeds:

- the approved submission becomes revision-ready;
- the existing revision workspace may use the operational allocation baseline;
- supplemental/reforecast changes must modify the operational position only through the approved revision workflow;
- the original approved budget remains preserved as immutable historical authority.

## 13. UI Structure

Add a Budget Activation workspace under Budget / Budget Control, with two role-sensitive views.

### System Administrator view

Display:

- Approved budgets awaiting activation
- line counts and totals
- mapped / unmapped counts
- detailed line validation table
- master-data problem links
- `Prepare Activation`
- `Revalidate`
- `Submit for Activation`

### Registrar view

Display:

- READY_FOR_ACTIVATION queue
- approved versus activation reconciliation
- line count
- approved total
- activation total
- variance
- preparer
- validation timestamp
- read-only mapping summary
- `Activate Approved Budget`

## 14. Error Handling

All validation failures must return specific, human-readable reasons such as:

- Finance Code is not mapped to an active Posting Code.
- Posting Code has no active Chart of Accounts mapping.
- Cost Centre relationship is missing or inactive.
- Approved budget changed after activation preparation.
- Activation total does not reconcile to approved total.
- Operational allocation already exists for source budget line.
- Only a Registrar may authorise activation.
- System Administrator cannot authorise operational budget activation.

No error path may leave partially inserted `budget_allocations`.

## 15. Testing

Task 9 requires regression tests covering at minimum:

1. APPROVE no longer creates operational allocations.
2. approved budget creates an activation batch.
3. fallback Chart of Accounts selection is removed.
4. missing Finance Code mapping blocks readiness.
5. missing Posting Code mapping blocks readiness.
6. missing Chart of Accounts mapping blocks readiness.
7. inactive master data blocks readiness.
8. amount variance blocks readiness.
9. System Administrator can prepare and submit.
10. System Administrator cannot activate.
11. Registrar cannot prepare technical mappings through the activation workflow.
12. Registrar can activate a fully valid READY batch.
13. duplicate activation is rejected.
14. one invalid line rolls back the entire activation.
15. successful activation creates one operational allocation per approved source line.
16. allocation account IDs match the explicit Finance mapping, never a fallback.
17. Task 8 revision eligibility becomes true after activation.
18. audit records identify both preparer and Registrar authoriser.
19. notification is generated for READY_FOR_ACTIVATION.
20. existing FF3/FF4 financial-control tests continue to pass.

## 16. Deployment and Production Safety

Implementation must be additive where possible and preserve existing historical data.

Before production migration:

- verify current production migration level;
- run database backup / validation procedure;
- run Task 9 migration on a controlled environment or transaction-safe preflight where available;
- run unit/regression tests and build;
- inspect Supabase security and performance advisors after DDL/RLS changes;
- deploy application only after database compatibility is confirmed;
- verify deployed commit SHA and system information;
- perform an activation dry-run against an approved budget without authorising it;
- activate only through the Registrar-controlled production action.

The migration must not automatically activate existing approved submissions. Existing approved submissions should enter DRAFT_MAPPING and require the dual-control workflow.

## 17. Acceptance Criteria

Task 9 is accepted when:

- no approved budget can create operational allocations using a fallback Chart of Accounts record;
- approval and activation are separate controlled states;
- every activated line has explicit Finance Code, Posting Code and Chart of Accounts traceability;
- System Administrator prepares but cannot authorise;
- Registrar authorises but does not perform technical mapping;
- activation is atomic and idempotent;
- approved amounts reconcile exactly to activated amounts;
- operational allocations become the valid baseline for Task 8 revisions;
- FF3/FF4 financial controls continue to operate against the activated allocations;
- audit evidence records both sides of the dual-control process.
