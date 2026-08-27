# Task 8 — Budget Revision & Supplementary Budget Workspace Design

**Date:** 27 August 2026  
**Branch:** `feature/budget-revision-workspace`  
**Base:** production `main` after PR #11

## 1. Objective

Provide a visible operational front door for the post-approval budget-change process already implemented in Tasks 1–7. The new workspace must let the Registrar initiate a controlled change against a specific approved section budget, assign it to the responsible Line Supervisor, notify that supervisor, let the supervisor review/adjust and submit, and return the item to the Registrar for final approve/return/reject action.

The approved baseline remains locked. Task 8 does not replace the revision engine; it exposes it as an operational work queue with assignment and notifications.

## 2. Approved Business Workflow

1. **Registrar — Initiate Request**
   - Select financial year.
   - Select department and section/division.
   - Select the current approved, unsuperseded budget submission.
   - Select change type: Virement, Supplementary Budget, Reduction, Reclassification, or Reforecast.
   - Enter reason, effective date, authority/reference where applicable, supporting reference, indicative change amount, and instruction to the Line Supervisor.
   - Select the responsible Line Supervisor from eligible active Line Supervisors for that section.
   - Submit the request.

2. **Line Supervisor — Prepare Revision**
   - Receive a real-time notification and work-queue item.
   - Open the assigned revision.
   - Review original/current budget, actual expenditure, outstanding commitments, protected minimum and available balances.
   - Adjust only permitted lines/months under the existing revision controls.
   - Save draft and Submit/Resubmit.

3. **Registrar — Final Decision**
   - Receive notification when the Line Supervisor submits/resubmits.
   - Open the revision in the Registrar queue.
   - Approve, Return for Amendment, or Reject.
   - Approval makes the revision submission the current authoritative version and preserves the previous approved version as history.

There is no separate user-facing `REVIEW` step.

## 3. Navigation and Route

Add a dedicated Budget Management menu item:

- **Label:** `Budget Revision & Supplementary Budget`
- **Code:** `budget.revisions`
- **Module:** `budget`
- **Route:** `/dashboard/budget/revisions`
- **Sort order:** 23, between Budget Control (20) and Funding Management (25)
- **Visibility permissions:** any of `budget.revision.view`, `budget.revision.create`, `budget.revision.edit`, `budget.revision.submit`, `budget.revision.approve`, `budget.revision.return`, `budget.revision.reject`, `budget.revision.report`

Update the static RBAC fallback configuration with the same menu/route so navigation remains correct even when runtime menu loading falls back to code configuration.

The existing `Request Budget Change` shortcut in Budget Preparation remains, but it must route to the new workspace with the selected approved submission preloaded rather than opening a separate initiation flow.

## 4. Workspace UX

### Registrar view

Header action: **Initiate Budget Change**.

Summary cards:
- Awaiting Registrar Action
- Requested / In Preparation
- Returned
- Approved
- Rejected

Primary tabs:
- Awaiting My Action
- Open Requests
- Completed
- All Revision History

The initiation form shows:
- Budget Year
- Department
- Section / Division
- Current Approved Budget
- Change Type
- Indicative Change Amount (optional except where management wants to communicate expected supplementary/reduction value)
- Reason / Justification
- Authority Reference
- Effective Date
- Supporting Reference
- Instruction to Line Supervisor
- Responsible Line Supervisor

The selected approved budget summary must show Original Budget, Current Revised Budget, Actuals, Outstanding Commitments, Budget Available and Released Available before the Registrar sends the request.

### Line Supervisor view

Summary cards:
- New Requests
- Draft / Returned
- Submitted
- Approved / Rejected

Primary tabs:
- My Revision Requests
- Submitted
- Completed

Opening a DRAFT/RETURNED item takes the supervisor directly to the existing controlled revision grid for that revision submission. The supervisor cannot initiate or approve revisions.

### Shared behavior

A query parameter such as `?revision=<revision_id>` opens a specific queue item directly from a notification. `?parent=<approved_submission_id>&action=request` preloads the Registrar initiation form from Budget Preparation.

## 5. Assignment Model

Add to `budget_revisions`:
- `assigned_line_supervisor_id UUID REFERENCES users(id)`
- `request_instruction TEXT`
- `requested_change_amount NUMERIC(15,2)`
- `assigned_at TIMESTAMPTZ`

A revision request is not operationally valid without an assigned active Line Supervisor.

Eligible supervisors are active users with the `Line Supervisor` role and an exact section match to the selected `budget_divisions.section_id`. The Registrar cannot assign a supervisor from another section.

UX behavior:
- exactly one eligible supervisor: preselect automatically;
- more than one: Registrar must choose one;
- none: block initiation and display a clear configuration error telling administration to assign a Line Supervisor to that section.

This keeps accountability explicit and prevents a general broadcast from being mistaken for assignment.

## 6. Database/API Changes

Create migration `055_budget_revision_workspace_notifications.sql`.

### Request creation RPC

Add a dedicated public RPC, e.g. `njss_create_budget_revision_request(...)`, accepting the existing revision request inputs plus:
- `p_assigned_line_supervisor_id`
- `p_request_instruction`
- `p_requested_change_amount`

The RPC must:
- require authenticated Registrar;
- require `budget.revision.create`;
- verify the parent is current approved/locked/unsuperseded;
- verify the assigned user is active, is a Line Supervisor, and belongs to the exact section;
- invoke the existing hardened revision-creation engine;
- persist assignment/request metadata atomically;
- create the initial Line Supervisor notification;
- return revision id, revision submission id and revision number.

Authenticated clients should use this request RPC. Direct authenticated execution of the older unassigned creation wrapper should be revoked after the workspace is deployed, while internal/base functions remain available only to trusted wrappers.

### Work queue view/service

Create a security-invoker view such as `v_budget_revision_work_queue` containing:
- revision/request metadata;
- department/division/section names;
- parent/revision submission numbers and versions;
- requested-by Registrar;
- assigned Line Supervisor;
- original/current/proposed totals;
- actuals, commitments, protected minimum;
- latest status and timestamps;
- a derived queue state suitable for Registrar and Line Supervisor tabs.

RLS/data scope remains authoritative. The client must not infer cross-section access.

### Supervisor lookup

Expose eligible Line Supervisors through a guarded RPC/view that returns only active exact-section candidates for the Registrar's selected division.

## 7. Notifications

Use `reference_type = 'BUDGET_REVISION'` and `reference_id = revision_id`.

Required events:
- `BUDGET_REVISION_REQUESTED` → assigned Line Supervisor
- `BUDGET_REVISION_SUBMITTED` → requesting Registrar
- `BUDGET_REVISION_RESUBMITTED` → requesting Registrar
- `BUDGET_REVISION_RETURNED` → assigned Line Supervisor
- `BUDGET_REVISION_APPROVED` → assigned Line Supervisor
- `BUDGET_REVISION_REJECTED` → assigned Line Supervisor

Each notification links directly to `/dashboard/budget/revisions?revision=<id>`.

Database-side notification creation is preferred so UI/API bypasses cannot suppress workflow alerts. Notification creation must be idempotent per revision/status transition to avoid duplicate alerts on retries.

Update both the header notification dropdown and full Notifications page so BUDGET_REVISION events have a budget icon/label and route correctly.

## 8. Notification Security Correction

The live `notifications.user_id` foreign key points to `users.id`, while authentication identity is stored in `users.auth_user_id`. The current live table has RLS disabled. Task 8 must correct this before relying on notifications for budget workflow.

Migration 055 must:
- enable RLS on `notifications`;
- allow authenticated users to SELECT notifications where `user_id` maps to their `users.auth_user_id = auth.uid()`, plus intentional global notifications where `user_id IS NULL`;
- allow users to UPDATE only their own notifications for read/read_at state;
- revoke direct authenticated INSERT/DELETE;
- create budget workflow notifications through SECURITY DEFINER helper(s) with tightly controlled execute privileges;
- preserve existing FF3/FF4 notification display behavior.

Client notification hooks must use the NJSS profile id (`users.id`) rather than the Supabase auth UUID when applying an optional client-side recipient filter.

## 9. Existing Revision Controls Preserved

Task 8 must not weaken any Tasks 1–7 safeguards:
- Registrar-only initiation;
- Line-Supervisor-only preparation/submission within section scope;
- Registrar-only approve/return/reject;
- approved baseline remains locked;
- no revision below actuals + outstanding commitments;
- funded-floor protection;
- closed/actual periods remain immutable;
- virement/reclassification balancing;
- supplementary authority validation;
- exact financial master-data mappings;
- existing budget allocation IDs remain stable for FF3/FF4/payment lineage.

## 10. Error Handling

User-facing errors must be specific:
- no approved current budget found;
- another active revision already exists;
- no eligible Line Supervisor configured;
- selected supervisor belongs to another section;
- missing supplementary authority;
- invalid effective date;
- protected-minimum/funded-floor violation;
- stale financial position;
- permission/scope denial.

No partial request should remain if assignment or notification creation fails.

## 11. Testing and Delivery Gates

Use TDD.

Regression coverage must verify:
- menu/route is registered;
- Registrar can initiate and Line Supervisor cannot;
- exact-section supervisor assignment;
- missing supervisor blocks request;
- work queue returns role-appropriate records;
- requested/submitted/resubmitted/returned/approved/rejected notifications target the correct user;
- notification direct link resolves to the revision workspace;
- notification RLS maps `users.id` to `auth.uid()` through `users.auth_user_id`;
- old unassigned public creation path is not available to authenticated clients after migration;
- existing revision hardening regressions remain green.

Final gates before production migration/merge:
- full GitHub CI green;
- lint, typecheck, production build green;
- correct `njsscrem` Netlify deploy preview green;
- migration 055 dry review against live schema;
- apply migration only after code/preview gates pass;
- post-migration verification of assignment columns, RLS, RPC grants, queue view and notification behavior;
- controlled UAT of Registrar → Line Supervisor → Registrar flow without inventing financial transactions.

## 12. Out of Scope

- Email/SMS delivery outside the existing in-app/browser notification framework.
- New financial approval levels beyond Registrar and Line Supervisor.
- Automatic creation of Finance master data.
- Bulk multi-section revision requests in one workflow record. Each section remains a separate controlled revision request.
