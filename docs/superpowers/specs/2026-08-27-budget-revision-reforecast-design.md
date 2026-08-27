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

## 3. Design Decision

Use versioned budget revisions rather than direct unlock/edit.

An approved budget version is never edited in place.

Example:

- Version 1 — `APPROVED` — locked and immutable
- Version 2 — linked to a Budget Revision record — submission status `DRAFT`
- Version 2 — progresses through the existing submission workflow
- Version 1 — retained as historical baseline and marked superseded only after Version 2 approval

The UI may display labels such as **Revision Draft**, **Revision Submitted**, or **Revision Approved**, but `divisional_budget_submissions.status` continues to use the existing status values (`DRAFT`, `SUBMITTED`, `RETURNED`, `RESUBMITTED`, `REVIEWED`, `APPROVED`, `REJECTED`, `ARCHIVED`). This avoids creating two competing workflow state models.

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
- optional supporting reference/attachment.

## 5. Roles and Permissions

No new business role is introduced.

### 5.1 Line Supervisor

The Line Supervisor remains the budget originator for the assigned section/division.

Permissions:

- view approved budget and actual position;
- create a revision from the current approved version;
- edit revision draft;
- add/reduce/reallocate draft revision lines subject to controls;
- revise future monthly allocations/reforecast;
- provide reason/reference;
- submit revision;
- view revision history.

Default scope: Section-wide / assigned budget-division scope.

### 5.2 Registrar

The Registrar remains the organisation-wide budget approval authority.

Permissions:

- view original, current and proposed revised budget;
- view actual expenditure and outstanding commitments;
- review revision reason/reference;
- perform the existing technical `REVIEW` step where required;
- approve, reject, or return revision;
- view full revision history.

Default scope: System-wide.

The `REVIEWED` state does not create another officer role. Where the current workflow requires `REVIEW` before `APPROVE`, the Registrar performs that review step before final approval.

### 5.3 Requisition Officer

Read-only for budget revision.

Permissions:

- view the current approved/revised budget for the assigned section;
- view available balance relevant to requisition preparation;
- no ability to create, submit or approve revisions.

Default scope: Section-wide.

### 5.4 Payment/Reconciliation Officer

Read-only for budget revision, with organisation-wide financial visibility.

Permissions:

- view current approved/revised budget;
- view commitments, actuals, payments, outstanding balances and revision history;
- no authority to originate or approve a budget revision.

Default scope: System-wide.

### 5.5 System Administrator

Technical administration only. The Administrator may maintain permissions/configuration but is not the normal business approver for a revision.

## 6. Revision Workflow

Business labels and existing submission statuses work together as follows:

- Approved Version 1 (`APPROVED`, locked)
- `Create Budget Revision`
- Version 2 created as submission status `DRAFT`, linked to a `budget_revisions` record
- Line Supervisor edits and submits Version 2
- submission status becomes `SUBMITTED`
- Registrar reviews; if the existing workflow requires it, status becomes `REVIEWED`
- Registrar approves; status becomes `APPROVED`

Alternative paths:

- `SUBMITTED` → `RETURNED` → Line Supervisor edits → `RESUBMITTED`
- `SUBMITTED` / `REVIEWED` → `REJECTED`

On approval:

1. the new version becomes the current authoritative approved budget;
2. the previous approved submission remains locked;
3. the new revision links back through `parent_submission_id`;
4. the old approved version links forward through `superseded_by_id`;
5. authoritative `budget_allocations.revised_budget` and approved monthly cashflow are updated transactionally;
6. audit and workflow-history records are written;
7. existing commitments and payments remain linked to their existing budget allocations and are not recreated.

Only one active revision (`DRAFT`, `SUBMITTED`, `RETURNED`, `RESUBMITTED`, or `REVIEWED`) may exist for a given current approved version at a time.

## 7. Actuals and Commitment Position

NJSS derives the revision position from authoritative budget/commitment/payment data. Users do not type actual or commitment figures.

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

The result must not be negative.

## 8. Virement / Reallocation Rules

A virement transfers budget from one line to another. It does not modify actuals or commitments.

For a balanced virement within the same authority:

`Total Decreases = Total Increases`

Rules:

- donor/restricted funding may move only where funding restrictions permit;
- a source line cannot be reduced below its protected minimum;
- the target line must use a valid active posting code/funding combination;
- source and target adjustments share one revision reference;
- no commitment is moved automatically because a budget is reallocated.

Moving an existing commitment to another allocation, if ever required, remains a separate controlled commitment-adjustment function.

## 9. Supplementary Budget Rules

A supplementary revision may increase total budget only where a valid supplementary authority/funding reference exists.

Required information:

- supplementary authority/reference;
- funding source;
- amount;
- effective date;
- supporting reference/documentation.

On approval, the increase affects `supplemental_budget` and `revised_budget`; `original_budget` remains unchanged.

## 10. Reduction Rules

A reduction is allowed only when:

- the proposed amount remains at or above the protected minimum;
- no funding restriction prevents the reduction;
- reason and authority are recorded;
- the Registrar approves it.

`original_budget` remains unchanged. The reduction affects `revised_budget` only.

## 11. Reforecast Rules

Reforecasting changes the timing and/or remaining expected requirement.

Rules:

- actual expenditure periods are read-only;
- formally closed budget periods are read-only using the existing period-control data where available;
- future monthly allocations may be changed;
- the revised monthly total must equal the proposed revised annual budget;
- the screen shows actual-to-date and remaining forecast separately;
- a reforecast that changes authorised annual budget or formally controlled cashflow follows the same approval path.

## 12. Data Model Changes

Reuse the existing versioning and allocation structures where possible.

### 12.1 New table: `budget_revisions`

Recommended fields:

- `id uuid primary key`
- `revision_number varchar unique not null`
- `parent_submission_id uuid not null`
- `revision_submission_id uuid unique not null`
- `budget_year integer not null`
- `division_id uuid not null`
- `revision_type varchar not null`
- `reason text not null`
- `authority_reference varchar null`
- `effective_date date not null`
- `status varchar not null`
- `requested_by uuid null`
- `requested_by_email varchar null`
- `approved_by uuid null`
- `approved_at timestamptz null`
- `supporting_reference varchar null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

The revision record may use a business status such as `DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED` for reporting, but the authoritative workflow state remains the linked `divisional_budget_submissions.status`. The two values must be updated transactionally so they cannot drift.

### 12.2 New table: `budget_revision_lines`

Recommended fields:

- `id uuid primary key`
- `budget_revision_id uuid not null`
- `source_budget_allocation_id uuid null`
- `source_budget_line_id uuid null`
- `revision_budget_line_id uuid null`
- `original_budget numeric not null`
- `current_revised_budget numeric not null`
- `actual_expenditure_at_submission numeric null`
- `outstanding_commitment_at_submission numeric null`
- `protected_minimum_at_submission numeric null`
- `actual_expenditure_at_approval numeric null`
- `outstanding_commitment_at_approval numeric null`
- `protected_minimum_at_approval numeric null`
- `proposed_revised_budget numeric not null`
- `adjustment_amount numeric not null`
- `adjustment_reason text null`
- `created_at timestamptz not null`

Submission snapshots record the financial position when the Line Supervisor submits. Approval snapshots record the revalidated position used by the Registrar's approval. Live views continue to calculate the current position after approval.

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

## 13. Atomic Server-Side Operations

Revision creation, submission and approval must use controlled server-side API/RPC operations rather than direct client-side writes to authoritative financial fields.

### 13.1 Create revision

A create-revision operation should:

1. confirm caller has `budget.revision.create` and correct scope;
2. confirm source version is the current `APPROVED` version;
3. confirm no active revision already exists;
4. create the next submission version with `parent_submission_id`;
5. copy approved lines and monthly allocations;
6. create `budget_revisions` and line snapshot records;
7. write audit history.

### 13.2 Submit revision

Submission should:

1. validate mandatory fields and monthly totals;
2. read current actuals and outstanding commitments;
3. calculate and store submission snapshots;
4. enforce protected minimums and virement/supplementary rules;
5. transition the linked submission through the existing workflow;
6. write audit/history.

### 13.3 Approve revision

Approval must execute in one database transaction/RPC:

1. lock the revision and current authoritative budget rows;
2. re-read current actual expenditure and outstanding commitments;
3. calculate approval snapshots and protected minimums;
4. reject approval if any proposal has become invalid since submission;
5. update `budget_allocations.revised_budget` / `supplemental_budget` as appropriate;
6. update approved monthly cashflow from the revision version;
7. mark the new submission/revision approved and locked;
8. link previous and new versions through parent/superseded fields;
9. insert workflow-history and audit events;
10. commit all changes together or roll back all changes on error.

This approval-time revalidation prevents approval based on stale actual/commitment figures.

## 14. UI Changes

### 14.1 Approved Budget Entry Sheet

When the selected version is approved/locked:

- all existing budget cells remain read-only;
- authorised Line Supervisors see `Create Budget Revision`;
- version lineage is visible;
- the current authoritative version is clearly marked.

### 14.2 Revision Entry Sheet

Add financial-control columns:

- Original Approved
- Current Revised
- Actual Paid
- Outstanding Commitments
- Protected Minimum
- Proposed Revised
- Adjustment
- Available After Revision

The existing activity, finance code, description, monthly allocation, priority, funding and procurement fields remain available where revision rules permit.

### 14.3 Comparison panel

Show:

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

Show:

- version number;
- revision number/type;
- workflow status;
- submitted by/date;
- approved by/date;
- total budget;
- net adjustment;
- reason/reference.

Historical versions remain viewable and immutable.

## 15. Reporting Changes

Budget Control and management reports distinguish:

- Original Budget
- Supplementary Budget
- Current Revised Budget
- Actual Expenditure
- Outstanding Commitments
- Available Balance
- Pending Commitments, where applicable
- Forecast / Remaining Plan
- Variance to Revised Budget

At section, department and system level management can trace:

`Original -> Revisions -> Current Budget -> Commitments -> Actuals -> Available`

Reports expose revision number, type and effective date for audit traceability.

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

- Requisition Officer: `view`, Section-wide
- Line Supervisor: `view/create/edit/submit/report`, Section-wide
- Registrar: `view/review/approve/reject/return/report`, System-wide
- Payment/Reconciliation Officer: `view/report`, System-wide
- System Administrator: technical `all`, System-wide

All API/RPC operations enforce these permissions server-side. UI button visibility is not an authorization boundary.

## 17. Audit Requirements

Every revision records:

- creator;
- source approved version;
- revision type;
- line-level before/after amounts;
- actual/commitment/protected-minimum snapshots at submission and approval;
- reason/reference;
- workflow actions;
- approver;
- timestamps;
- parent/superseded version links.

Approved revisions and audit/history records are never physically deleted.

## 18. Error and Concurrency Handling

The system must handle:

- actual/commitment values changing after revision submission;
- two revision drafts being created for the same approved version;
- concurrent approvals;
- invalid virement imbalance;
- missing supplementary authority;
- restricted funding-source conflicts;
- attempts to edit historical approved versions.

A database constraint/transactional guard should prevent more than one active revision for the same current approved version.

## 19. UAT Acceptance Criteria

1. Approved Version 1 remains locked and unchanged.
2. Line Supervisor can create Version 2 revision from current approved Version 1.
3. Revision copies approved lines and monthly allocations.
4. Actual and outstanding commitment values are displayed automatically.
5. Reduction above protected minimum succeeds.
6. Reduction below protected minimum is blocked.
7. Multi-line balanced virement succeeds.
8. Unbalanced virement is blocked.
9. Supplementary revision requires authority/reference.
10. Reforecast can move future monthly allocations while preserving actual/closed periods.
11. Line Supervisor can submit only within assigned scope.
12. Registrar can see all sections, perform required review, and approve/reject/return.
13. Requisition Officer cannot edit or submit revisions.
14. Payment/Reconciliation Officer cannot edit or approve revisions.
15. Approval revalidates actuals/commitments using current data.
16. If obligations changed after submission and invalidate the proposal, approval is blocked and revision is returned for correction.
17. Approved Version 2 updates authoritative revised budget.
18. Version 1 remains accessible as historical baseline.
19. Existing FF3 commitments remain unchanged by budget revision.
20. Actual payments remain unchanged by budget revision.
21. Budget Control reports Original, Revised, Actual, Commitment and Available correctly.
22. Audit history records before/after values, snapshots, user, reason and approval.
23. Direct URL/API attempts without revision permission are denied.
24. Two active revisions cannot be created against the same current approved version.

## 20. Non-Goals

This design does not:

- unlock and edit an approved version in place;
- rewrite historical payments;
- automatically move an existing commitment to another budget allocation;
- allow a budget to be reduced below already spent/committed obligations;
- bypass Registrar approval for controlled budget revisions;
- create a new business workflow role;
- use System Administrator as the normal financial approver.

## 21. Implementation Boundaries

Expected implementation areas:

- Supabase migration for revision tables, constraints, RLS/RPCs and reporting views;
- server-side Budget workflow API operations;
- `lib/budget-module.ts` revision data/functions;
- Budget Preparation UI for revision creation/edit/comparison/history;
- Budget Control/reporting UI additions;
- RBAC seed/migration for revision permissions;
- audit and regression/UAT tests.

The implementation reuses existing submission versioning, allocation, commitment, payment, audit and reporting structures rather than building a parallel financial ledger.

## 22. Final Design Decision

NJSS will support post-approval budget adjustment through controlled versioned revisions. Approved historical budgets remain locked. Revisions use authoritative actual and commitment data, enforce a protected minimum, preserve full audit history, and become authoritative only after Registrar approval.
