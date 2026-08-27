# NJSS Budget Revision, Reforecast and Post-Approval Adjustment Design

Date: 27 August 2026  
Status: Design for review — not yet implemented

## 1. Purpose

NJSS must allow an approved budget to be re-evaluated after operations have started, without unlocking and overwriting the approved baseline. The design introduces a controlled Budget Revision / Reforecast process that uses actual expenditure and outstanding commitments to determine what may safely be adjusted.

The approved budget remains immutable for audit purposes. A revision creates a new version, routes that version through approval, and only makes it authoritative after approval.

## 2. Current System Position

The current Budget Preparation module already supports:

- divisional budget submissions with `version`, `parent_submission_id`, `superseded_by_id`, `status`, and `is_locked`;
- line-level monthly allocations;
- submission workflow history;
- approved budget allocations linked back to source budget submissions and source budget lines;
- budget allocations with `original_budget`, `supplemental_budget`, and `revised_budget`;
- commitments linked to budget allocations;
- payment transactions linked to commitments and budget allocations;
- live financial-control views exposing original/revised budget, commitments, actual expenditure, and available balance.

The current Budget Entry Sheet intentionally treats `SUBMITTED`, `RESUBMITTED`, `REVIEWED`, `APPROVED`, and `ARCHIVED` submissions as locked. That control remains in place.

## 3. Recommended Approach

Use versioned budget revisions rather than direct unlock/edit.

### 3.1 Baseline rule

An approved budget version is never edited in place.

Example:

- Version 1 — APPROVED — locked and immutable
- Version 2 — REVISION_DRAFT — editable revision derived from Version 1
- Version 2 — submitted/reviewed/approved through the normal control chain
- Version 1 — retained as historical baseline and marked superseded only after Version 2 approval

### 3.2 Why this approach

This preserves:

- the original approved appropriation;
- the reason and authority for every adjustment;
- actual spending already incurred;
- outstanding contractual/FF3 commitments;
- the approval trail;
- the ability to compare Original vs Current Revised vs Actual.

Directly unlocking an approved record would destroy that distinction and is not permitted by this design.

## 4. Revision Types

Every revision must have one controlled type:

1. `VIREMENT` — transfer budget between approved lines/cost centres within authorised limits.
2. `SUPPLEMENTARY` — increase the budget from an approved supplementary funding source/authority.
3. `REDUCTION` — reduce an approved budget where funds are no longer required.
4. `RECLASSIFICATION` — move budget to the correct finance/expense coding without hiding the original coding decision.
5. `REFORECAST` — revise timing/monthly cashflow and/or expected year-end requirement based on actual performance.

Each revision requires:

- revision type;
- reason/justification;
- authority/reference number where applicable;
- effective date;
- requesting officer;
- approving authority;
- optional attachment/supporting reference.

## 5. Roles and Permissions

### 5.1 Line Supervisor

Primary budget revision originator for the assigned section/division.

Permissions:

- view approved budget and actual position;
- create revision from current approved version;
- edit revision draft;
- add/reduce/reallocate draft revision lines subject to controls;
- revise monthly allocations/reforecast;
- provide reason/reference;
- submit revision;
- view revision history.

Default scope: Section-wide or assigned budget-division scope.

### 5.2 Registrar

Organisation-wide revision approver.

Permissions:

- view original, current and proposed revised budget;
- view actual expenditure and outstanding commitments;
- review revision reason/reference;
- approve, reject, or return revision;
- approve supplementary/virement effects where authorised by business rules;
- view full revision history.

Default scope: System-wide.

### 5.3 Requisition Officer

Read-only for budget revision.

Permissions:

- view current approved/revised budget for the assigned section;
- view available balance relevant to requisition preparation;
- no ability to create or approve revisions.

Default scope: Section-wide.

### 5.4 Payment/Reconciliation Officer

Read-only for budget revision, full visibility of financial position.

Permissions:

- view current approved/revised budget;
- view commitments, actuals, payments, outstanding balances and revision history;
- no authority to originate or approve a budget revision.

Default scope: System-wide.

### 5.5 System Administrator

Technical administration only.

The Administrator may maintain permissions/configuration but should not be the normal business approver for a revision.

## 6. Revision Workflow

The proposed workflow is:

`APPROVED`  
→ `CREATE REVISION`  
→ `REVISION_DRAFT`  
→ `REVISION_SUBMITTED`  
→ `REVISION_REVIEWED`  
→ `REVISION_APPROVED`

Alternative paths:

- `REVISION_SUBMITTED` → `REVISION_RETURNED` → edit → resubmit
- `REVISION_SUBMITTED` / `REVISION_REVIEWED` → `REVISION_REJECTED`

On approval:

1. the new version becomes the current authoritative approved budget;
2. the previous approved submission remains locked and is linked through `superseded_by_id`;
3. the new revision links back through `parent_submission_id`;
4. authoritative `budget_allocations.revised_budget` and monthly cashflow are updated transactionally;
5. audit and workflow-history records are written;
6. existing commitments and payments remain linked to their budget allocations and are not recreated.

## 7. Actuals and Commitment Position

NJSS should derive each revision line's current financial position from authoritative budget/commitment/payment data rather than user entry.

For each budget allocation/line display:

- Original Approved Budget
- Current Revised Budget
- Actual Expenditure
- Outstanding Commitments
- Protected Minimum
- Available Balance Before Revision
- Proposed Revised Budget
- Adjustment Amount
- Available Balance After Revision

### 7.1 Protected minimum

`Protected Minimum = Actual Expenditure + Outstanding Commitments`

A proposed revised budget must satisfy:

`Proposed Revised Budget >= Protected Minimum`

Example:

- Original approved: K100,000
- Actual paid: K40,000
- Outstanding commitments: K30,000
- Protected minimum: K70,000

A proposal of K80,000 is valid. A proposal of K60,000 is blocked.

Error message:

> Revision not allowed. This budget line has K70,000 already spent or committed.

### 7.2 Available balance after revision

`Available After Revision = Proposed Revised Budget - Actual Expenditure - Outstanding Commitments`

This value must not be negative.

## 8. Virement / Reallocation Rules

A virement transfers budget from one line to another. It must not modify actuals or commitments.

For a balanced virement within the same authority:

`Total Decreases = Total Increases`

Rules:

- donor/restricted funding may only move where funding restrictions permit;
- a source line cannot be reduced below its protected minimum;
- the target line must use a valid active posting code/funding combination;
- the system records both source and target adjustments as one revision transaction/reference;
- no commitment is moved automatically merely because budget is reallocated.

If an existing commitment itself must move to another allocation, that is a separate controlled commitment-adjustment function and not an automatic side effect of budget revision.

## 9. Supplementary Budget Rules

A supplementary revision may increase total budget only where a valid supplementary authority/funding reference exists.

The revision must capture:

- supplementary authority/reference;
- funding source;
- amount;
- effective date;
- supporting documentation/reference.

On approval, the increase is reflected in `supplemental_budget` and `revised_budget`, while `original_budget` remains unchanged.

## 10. Reduction Rules

A reduction lowers the approved/revised budget.

It is allowed only when:

- the proposed amount remains at or above the protected minimum;
- no funding restriction prevents the reduction;
- the reason and authority are recorded;
- the Registrar approves the reduction.

`original_budget` remains unchanged. The reduction affects `revised_budget` only.

## 11. Reforecast Rules

Reforecasting is primarily about timing and expected year-end requirements.

The revision screen should allow monthly allocations to be rephased across future months while preserving actual periods.

Rules:

- closed/past periods containing actual expenditure should be treated as read-only for reforecast purposes;
- future monthly allocations may be changed;
- the revised monthly total must equal the proposed revised annual budget;
- the screen should show actual-to-date and remaining forecast separately;
- reforecast changes follow the same submission/approval path when they change the authorised budget or formally controlled cashflow.

## 12. Data Model Changes

Reuse the existing versioning and allocation structures where possible.

### 12.1 New table: `budget_revisions`

Recommended fields:

- `id uuid primary key`
- `revision_number varchar unique`
- `parent_submission_id uuid not null`
- `revision_submission_id uuid not null`
- `budget_year integer not null`
- `division_id uuid not null`
- `revision_type varchar not null`
- `reason text not null`
- `authority_reference varchar null`
- `effective_date date not null`
- `status varchar not null`
- `requested_by uuid/null`
- `requested_by_email varchar/null`
- `approved_by uuid/null`
- `approved_at timestamptz null`
- `supporting_reference varchar/null`
- `created_at timestamptz`
- `updated_at timestamptz`

### 12.2 New table: `budget_revision_lines`

Recommended fields:

- `id uuid primary key`
- `budget_revision_id uuid not null`
- `source_budget_allocation_id uuid null`
- `source_budget_line_id uuid null`
- `revision_budget_line_id uuid null`
- `original_budget numeric not null`
- `current_revised_budget numeric not null`
- `actual_expenditure_snapshot numeric not null`
- `outstanding_commitment_snapshot numeric not null`
- `protected_minimum numeric not null`
- `proposed_revised_budget numeric not null`
- `adjustment_amount numeric not null`
- `adjustment_reason text null`
- `created_at timestamptz`

The snapshots preserve the decision context at the time the revision was submitted/approved. Live views continue to calculate the current position.

### 12.3 Existing tables reused

- `divisional_budget_submissions` — version and workflow container;
- `divisional_budget_lines` — revised budget lines;
- `budget_monthly_allocations` — revised/reforecast monthly allocations;
- `budget_allocations` — authoritative original/supplemental/revised budget values;
- `budget_workflow_history` — workflow events;
- `audit_logs` — audit trail;
- `ff3_commitments`, `commitment_transactions` — outstanding commitment position;
- `payment_transactions` — actual expenditure;
- `v_budget_control`, `v_authoritative_budget_position` — live financial position.

## 13. Atomic Approval Operation

Revision approval must be executed server-side in one database transaction/RPC.

The approval operation should:

1. lock the revision record and current authoritative budget rows;
2. re-read actual expenditure and outstanding commitments at approval time;
3. recalculate protected minimums;
4. reject approval if any proposed revised value has become invalid since submission;
5. update `budget_allocations.revised_budget` / `supplemental_budget` as appropriate;
6. update approved monthly cashflow from the revision version;
7. mark the new submission/revision approved and locked;
8. link previous and new versions using parent/superseded fields;
9. insert workflow-history and audit events;
10. commit all changes together or roll back all changes on error.

This approval-time revalidation prevents a revision from being approved using stale actual/commitment figures.

## 14. UI Changes

### 14.1 Approved Budget Entry Sheet

When the selected version is approved/locked:

- keep all existing cells read-only;
- add button: `Create Budget Revision` for authorised Line Supervisors;
- show version lineage: `Version 1 Approved`, `Version 2 Revision Draft`, etc.;
- show current-authoritative badge.

### 14.2 Revision Entry Sheet

Add financial-control columns near each budget line:

- Original Approved
- Current Revised
- Actual Paid
- Outstanding Commitments
- Protected Minimum
- Proposed Revised
- Adjustment
- Available After Revision

The normal activity, finance code, description, monthly allocation, priority, funding and procurement fields remain available where revision rules permit.

### 14.3 Comparison panel

Provide a summary panel:

- Original Budget
- Current Revised Budget
- Proposed Revision
- Actual Expenditure
- Outstanding Commitments
- Available Balance
- Net Revision Increase/Decrease
- Revision Type
- Revision Reference

### 14.4 Version history

Provide a version/revision history list with:

- version number;
- revision number/type;
- status;
- submitted by/date;
- approved by/date;
- total budget;
- net adjustment;
- reason/reference.

Historical versions remain viewable but immutable.

## 15. Reporting Changes

Budget Control and management reports should distinguish:

- Original Budget
- Supplementary Budget
- Current Revised Budget
- Actual Expenditure
- Outstanding Commitments
- Available Balance
- Pending Commitments, where applicable
- Forecast / Remaining Plan
- Variance to Revised Budget

At section, department and system level, management should be able to compare:

`Original -> Revisions -> Current Budget -> Commitments -> Actuals -> Available`

Reports should expose revision number and effective date for audit traceability.

## 16. RBAC and Data Scope

Suggested permissions:

- `budget.revision.view`
- `budget.revision.create`
- `budget.revision.edit`
- `budget.revision.submit`
- `budget.revision.review`
- `budget.revision.approve`
- `budget.revision.reject`
- `budget.revision.return`
- `budget.revision.report`

Default role mapping:

- Requisition Officer: `view`, section-wide
- Line Supervisor: `view/create/edit/submit/report`, section-wide
- Registrar: `view/review/approve/reject/return/report`, system-wide
- Payment/Reconciliation Officer: `view/report`, system-wide
- System Administrator: technical `all`, system-wide

All API/RPC operations must enforce these permissions server-side; UI button hiding alone is insufficient.

## 17. Audit Requirements

Every revision must capture:

- who created it;
- source approved version;
- revision type;
- line-level before/after amounts;
- actual/commitment snapshot at submission and approval;
- reason/reference;
- workflow actions;
- approver;
- timestamps;
- parent/superseded version links.

Approved revisions and their audit/history rows must not be physically deleted.

## 18. Error and Concurrency Handling

The system must handle:

- actual/commitment values changing after revision submission;
- two revision drafts being created for the same current approved version;
- concurrent approvals;
- invalid virement imbalance;
- missing supplementary authority;
- restricted funding-source conflicts;
- attempts to edit historical approved versions.

Only one active revision draft/submission should be allowed for a given current approved version unless an earlier revision is rejected/cancelled.

## 19. UAT Acceptance Criteria

Minimum tests:

1. Approved Version 1 remains locked and unchanged.
2. Line Supervisor can create Version 2 revision from Version 1.
3. Revision copies approved lines/monthly allocations.
4. Actual and outstanding commitment values are displayed automatically.
5. Reduction above protected minimum succeeds.
6. Reduction below protected minimum is blocked.
7. Multi-line balanced virement succeeds.
8. Unbalanced virement is blocked.
9. Supplementary revision requires authority/reference.
10. Reforecast can move future monthly allocations while preserving protected/actual periods.
11. Revision submit follows Line Supervisor permissions and scope.
12. Registrar can view all sections and approve/reject/return.
13. Requisition Officer cannot edit revisions.
14. Payment/Reconciliation Officer cannot edit/approve revisions.
15. Approval revalidates actuals/commitments using current data.
16. Approved Version 2 updates authoritative revised budget.
17. Version 1 remains accessible as historical baseline.
18. Existing FF3 commitments remain unchanged by budget revision.
19. Actual payments remain unchanged by budget revision.
20. Budget Control reports Original, Revised, Actual, Commitment and Available correctly.
21. Audit history records before/after values, user, reason and approval.
22. Direct URL/API attempts without revision permission are denied.

## 20. Non-Goals

This design does not:

- unlock and edit an approved version in place;
- rewrite historical payments;
- automatically move an existing commitment to another budget allocation;
- allow a budget to be reduced below already spent/committed obligations;
- bypass Registrar approval for material budget revisions;
- use System Administrator as the normal financial approver.

## 21. Implementation Boundaries

Expected implementation areas:

- Supabase migration for revision tables, constraints, RPCs and reporting views;
- server-side Budget workflow API operations;
- `lib/budget-module.ts` revision data/functions;
- Budget Preparation UI for revision creation/edit/comparison/history;
- Budget Control/reporting UI additions;
- RBAC seed/migration for revision permissions;
- audit and regression/UAT tests.

The implementation should reuse existing submission versioning, allocation, commitment, payment, audit and reporting structures rather than building a parallel financial ledger.

## 22. Final Design Decision

NJSS will support post-approval budget adjustment through controlled versioned revisions. Approved historical budgets remain locked. Revisions use live actual and commitment data, enforce a protected minimum, preserve full audit history, and become authoritative only after Registrar approval.
