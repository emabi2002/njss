# Task 9 — Operational Budget Activation & Finance Master-Data Hardening

**Date:** 28 August 2026  
**Branch:** `feature/operational-budget-activation`  
**Base:** production `main` after Task 8 / PR #12

## 1. Decision and Objective

The approved governance model is **dual control**:

- **System Administrator** prepares and validates the technical financial mappings required to operationalise an approved budget.
- **Registrar** remains the business authority and performs the final activation.

Budget approval and operational activation are separate events.

Task 9 must therefore replace the current behaviour where Registrar approval immediately creates `budget_allocations`. An approved budget must remain approved and locked, but it must not become available to FF3/FF4 until its finance-code, posting-code, Chart-of-Accounts and cost-centre mappings have passed a technical preflight and the Registrar has explicitly authorised activation.

The target lifecycle is:

`LINE SUPERVISOR PREPARES → REGISTRAR APPROVES → ADMINISTRATOR MAPS/PREFLIGHTS → READY FOR ACTIVATION → REGISTRAR ACTIVATES → FF3/FF4 OPERATIONAL`

The design must preserve the immutable approved baseline and the Task 8 supplementary/revision workflow.

## 2. Confirmed Defects in the Current Implementation

### 2.1 Approval is incorrectly coupled to activation

Migration 019 currently calls `create_operational_allocations_from_divisional_budget(...)` as part of the `APPROVE` transition. This means the business approval and technical posting step happen in the same workflow transaction.

Task 9 must remove that coupling. `APPROVE` shall end with the submission in `APPROVED` status and locked, with no new operational allocation created by the approval action.

### 2.2 Chart of Accounts uses an unsafe fallback

The current allocation function selects the first active `chart_of_accounts` row and uses it as `budget_allocations.account_id` for every approved budget line.

This fallback is prohibited by Task 9.

There must be no default account, first-row account, name-based account guess, or silent substitution. Every activated source line must resolve to one explicit active Chart-of-Accounts record.

### 2.3 Posting-code builder is not bound to the approved Finance Code

The Master Data `Expense / Posting Codes` builder currently constructs:

`Department → Cost Centre → Category → Item`

and inserts an `expense_code_registry` record with `full_expense_code = 'PENDING'` for trigger-based code generation. It does not explicitly bind the resulting posting code to the `expense_ledger` Finance Code used on an approved budget line.

Task 9 must introduce an explicit authoritative bridge. Activation must never infer a Finance Code relationship from display text or a generated posting-code string.

### 2.4 Cost-centre resolution is also too permissive

The current allocation function resolves cost centre using a join equivalent to matching `budget_divisions.cost_centre_code` **or** `budget_divisions.cost_centre_name`.

Task 9 must replace this with an explicit foreign-key relationship. Name matching is not acceptable for financial posting.

## 3. Core Financial Model

The authoritative operational chain shall be:

`Approved Budget Line`

→ `expense_ledger` (**Finance Code**)

→ explicit `finance_posting_mappings` row

→ `expense_code_registry` (**Posting Code**)

→ `chart_of_accounts` (**Account**)

→ `cost_centres` (**Cost Centre**)

→ `budget_allocations` (**Operational Allocation**)

The system shall require **exactly one eligible active mapping** for every approved source line before activation.

A missing mapping blocks activation. Multiple eligible mappings also block activation because ambiguity is as unsafe as no mapping.

## 4. Canonical Finance-to-Posting Mapping

Create a new mapping table, recommended name:

`finance_posting_mappings`

Minimum fields:

- `id UUID PRIMARY KEY`
- `financial_year INTEGER NULL` — null means reusable across years where permitted
- `expense_ledger_id UUID NOT NULL REFERENCES expense_ledger(id)`
- `expense_code_registry_id UUID NOT NULL REFERENCES expense_code_registry(id)`
- `chart_of_account_id UUID NOT NULL REFERENCES chart_of_accounts(id)`
- `cost_centre_id UUID NOT NULL REFERENCES cost_centres(id)`
- `department_id UUID REFERENCES departments(id)`
- `section_id UUID REFERENCES sections(id)`
- `is_active BOOLEAN NOT NULL DEFAULT true`
- `mapping_notes TEXT`
- `created_by UUID REFERENCES users(id)`
- `created_at TIMESTAMPTZ`
- `updated_by UUID REFERENCES users(id)`
- `updated_at TIMESTAMPTZ`

The mapping table is the canonical bridge for activation. Existing `expense_ledger.expense_code_registry_id` and `expense_code_registry.expense_ledger_id` columns may remain for backward compatibility, but Task 9 activation must not rely on a potentially drifting bidirectional one-to-one pointer.

Candidate historical mappings may be backfilled only where the relationship is unambiguous. Ambiguous or incomplete candidates must remain unresolved for System Administrator correction.

The database must enforce uniqueness strongly enough that the activation resolver can detect one valid mapping for the combination required by the source line and its approved budget division/cost centre. Where the business rules permit more than one historical mapping, active/effective rows must still resolve to exactly one eligible row for the activation context.

## 5. Explicit Budget Division → Cost Centre Link

Add:

- `budget_divisions.cost_centre_id UUID REFERENCES cost_centres(id)`

Backfill only exact, deterministic matches. Existing `cost_centre_code` and `cost_centre_name` can remain for display/history, but operational activation shall use `cost_centre_id`.

A division is activation-ready only if:

- `cost_centre_id` is present;
- the cost centre is active;
- department/section ownership is consistent with the budget division;
- the mapping row references the same required cost centre.

No `OR name = ...` lookup is permitted in the activation path.

## 6. Activation Batch Model

Create `budget_activation_batches` as the maker-checker workflow record.

Minimum fields:

- `id UUID PRIMARY KEY`
- `submission_id UUID NOT NULL UNIQUE REFERENCES divisional_budget_submissions(id)`
- `financial_year INTEGER NOT NULL`
- `department_id UUID REFERENCES departments(id)`
- `budget_division_id UUID REFERENCES budget_divisions(id)`
- `status VARCHAR(40) NOT NULL`
- `approved_line_count INTEGER NOT NULL DEFAULT 0`
- `approved_total DECIMAL(15,2) NOT NULL DEFAULT 0`
- `mapped_line_count INTEGER NOT NULL DEFAULT 0`
- `mapped_total DECIMAL(15,2) NOT NULL DEFAULT 0`
- `validation_error_count INTEGER NOT NULL DEFAULT 0`
- `validation_summary JSONB NOT NULL DEFAULT '{}'::jsonb`
- `validation_fingerprint TEXT`
- `prepared_against_submission_updated_at TIMESTAMPTZ`
- `prepared_by UUID REFERENCES users(id)`
- `prepared_at TIMESTAMPTZ`
- `submitted_for_activation_by UUID REFERENCES users(id)`
- `submitted_for_activation_at TIMESTAMPTZ`
- `activated_by UUID REFERENCES users(id)`
- `activated_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Supported statuses:

- `DRAFT_MAPPING`
- `VALIDATION_FAILED`
- `READY_FOR_ACTIVATION`
- `ACTIVATED`

`ACTIVATED` is terminal for the initial baseline activation. Later supplementary/revision changes remain under the Task 8 revision workflow and do not create a second initial activation batch.

## 7. Immutable Activation Line Snapshot

Create an immutable line-level audit table, recommended name:

`budget_activation_line_snapshots`

Each activated budget line records the exact mapping used at the point of activation:

- `activation_batch_id`
- `source_budget_submission_id`
- `source_budget_line_id`
- `budget_allocation_id`
- `expense_ledger_id`
- Finance Code snapshot
- Finance description snapshot
- `expense_code_registry_id`
- Posting Code snapshot
- `chart_of_account_id`
- Chart-of-Accounts code/name snapshot
- `cost_centre_id`
- Cost-centre code/name snapshot
- approved annual amount
- monthly cash-flow snapshot
- created timestamp

These rows are append-only/immutable after successful activation. They preserve the audit evidence even if Finance master data is amended later.

## 8. Preflight Validation

Create a guarded server-side preflight function and a security-invoker view/service for the line-level results. Suggested names:

- `njss_prepare_budget_activation(p_submission_id UUID)`
- `v_budget_activation_preflight_lines`

The System Administrator action **Prepare for Activation** refreshes the batch and validates every approved line.

Each line must return a clear status and reason. Required validation classes include:

- `OK`
- `MISSING_FINANCE_CODE`
- `INACTIVE_FINANCE_CODE`
- `NO_POSTING_MAPPING`
- `MULTIPLE_POSTING_MAPPINGS`
- `INACTIVE_POSTING_CODE`
- `NO_CHART_ACCOUNT`
- `INACTIVE_CHART_ACCOUNT`
- `MISSING_COST_CENTRE`
- `INACTIVE_COST_CENTRE`
- `COST_CENTRE_SCOPE_MISMATCH`
- `MONTHLY_TOTAL_MISMATCH`
- `APPROVED_TOTAL_MISMATCH`
- `DUPLICATE_OPERATIONAL_ALLOCATION`

Preflight is successful only when:

- submission status is `APPROVED`;
- submission remains locked;
- every approved line has one active posting mapping;
- every mapping resolves to one active Chart-of-Accounts record;
- every division resolves to one explicit active cost centre;
- every line's monthly total equals its approved annual amount within the existing currency tolerance;
- line count equals approved line count;
- mapped total equals approved total;
- no active operational allocation already exists for any source budget line;
- no mapping ambiguity exists.

For the current 68-line budget, the workspace must visibly report, for example:

- Approved lines: 68
- Mapping ready: X
- Mapping issues: Y
- Approved total: K...
- Mapped total: K...
- Variance: K0.00 required

Activation remains blocked until all required errors are zero.

## 9. Validation Fingerprint and Stale-Mapping Protection

When the System Administrator submits a valid batch for Registrar action, the server shall calculate a deterministic fingerprint over the activation-critical state, including at minimum:

- submission id/version/update timestamp;
- source line ids and approved amounts;
- monthly allocations;
- Finance Code ids;
- mapping ids;
- Posting Code ids;
- Chart-of-Accounts ids;
- cost-centre ids.

Store the fingerprint in `budget_activation_batches.validation_fingerprint`.

The final Registrar activation RPC must recompute it. If any approved source value or technical mapping changed after preparation, activation is rejected and the batch returns to technical validation rather than posting stale mappings.

## 10. System Administrator Workflow

The System Administrator is the **technical maker**, not the business approver.

Activation workspace actions:

1. Open an approved, unactivated budget.
2. Review the preflight matrix.
3. Correct missing/ambiguous master-data mappings in the hardened Master Data interface.
4. Click **Prepare for Activation** / **Refresh Validation**.
5. When every line is valid and totals reconcile, click **Submit for Activation**.
6. Batch becomes `READY_FOR_ACTIVATION` and becomes read-only to the Registrar except for final authorisation.

The Administrator cannot:

- change approved budget quantities, rates, monthly amounts or annual totals;
- approve the budget;
- activate the budget;
- bypass a validation error;
- select a fallback account.

Master-data changes are separately audited.

## 11. Registrar Workflow

The Registrar is the **activation authoriser**.

Registrar view is a read-only reconciliation of the prepared batch showing:

- submission number and financial year;
- department/division/section;
- original approver and approval timestamp;
- System Administrator preparer and preparation timestamp;
- approved line count vs mapped line count;
- approved total vs mapped total;
- variance;
- Finance Code mapping count;
- posting-code mapping count;
- Chart-of-Accounts mapping count;
- cost-centre validation count;
- validation errors;
- activation fingerprint state.

The Registrar action is:

**Activate Approved Budget**

The Registrar cannot edit technical mappings from the activation authorisation screen.

The same Registrar may have performed the original budget approval and the final activation. The required segregation for Task 9 is between the **System Administrator technical preparer** and the **Registrar business authoriser**. A System Administrator may never authorise activation, even though the Administrator possesses the global `all` permission.

## 12. Final Activation RPC

Create one hardened SECURITY DEFINER RPC, recommended name:

`njss_activate_approved_budget(p_activation_batch_id UUID, p_comments TEXT DEFAULT NULL)`

The RPC must identify the authenticated actor server-side. Client-supplied role names, user ids, email addresses, validation counts or totals are not authoritative.

Immediately before posting, the RPC must revalidate:

1. batch exists and is `READY_FOR_ACTIVATION`;
2. source submission is still `APPROVED` and locked;
3. current actor is an active `Registrar`;
4. preparer is an active `System Administrator`;
5. current actor is not the technical preparer;
6. the stored validation fingerprint still matches current source and mapping state;
7. every source line still resolves to one valid active mapping;
8. all Chart-of-Accounts and cost-centre references remain active and scope-correct;
9. approved line count equals activation line count;
10. approved total equals activation total;
11. variance is K0.00 within the existing rounding tolerance;
12. no source line already has an active operational allocation.

The posting transaction shall then:

- insert all `budget_allocations` using the exact validated mapping;
- insert one immutable activation snapshot per line;
- mark the batch `ACTIVATED`;
- record `activated_by` and `activated_at`;
- write the activation audit event;
- create workflow notification(s).

The allocation insert must be atomic. If one of 68 lines cannot post, **none of the 68 lines may post**.

The initial activation path must use INSERT semantics and reject duplicate source-line allocations. It must not use the current `ON CONFLICT ... DO UPDATE` behaviour to silently rewrite an existing operational allocation.

## 13. Retire Unsafe Legacy Activation Paths

Task 9 must harden the migration-019 functions:

### `transition_divisional_budget_submission(...)`

`APPROVE` must only:

- validate the budget submission;
- set status to `APPROVED`;
- lock the approved baseline;
- set approval metadata;
- write workflow/audit history.

It must no longer create operational allocations.

### `create_operational_allocations_from_divisional_budget(...)`

The existing direct authenticated execution path must be revoked.

Either:

- retire the function entirely after references are migrated; or
- redefine it as an internal helper that requires exact mappings and is callable only from the hardened final activation RPC.

Under no circumstance may it select the first active Chart-of-Accounts row.

Direct `anon`/`authenticated` execute grants on unsafe allocation-creation functions must be removed.

## 14. RBAC and Segregation of Duties

Add explicit permissions for navigation/reporting clarity:

- `budget.activation.view`
- `budget.activation.prepare`
- `budget.activation.submit`
- `budget.activation.authorize`
- `budget.activation.report`

Role intent:

- **System Administrator:** view, prepare, submit, report through the protected `all` capability, but server-side RPC role checks explicitly prohibit activation authorisation.
- **Registrar:** view, authorize, report.
- **Line Supervisor:** no activation permission.
- **Requisition Officer:** no activation permission.
- **Payment/Reconciliation Officer:** view operational budget through existing budget/report permissions, but no activation permission.

This workflow cannot depend solely on generic `all` permission resolution. Mutation RPCs must enforce the exact maker/authoriser role boundary.

## 15. Master Data UX Hardening

The Master Data area shall expose a dedicated financial mapping view rather than hiding the relationship inside the hierarchical Posting Code builder.

Required columns:

- Finance Code
- Finance Description
- Department
- Section
- Cost Centre
- Category
- Expense Item
- Posting Code
- Chart of Accounts
- Financial Year / applicability
- Mapping Status
- Last Updated By
- Last Updated At

Required status examples:

- Ready
- Finance Code Missing
- Posting Code Missing
- Chart Account Missing
- Cost Centre Missing
- Ambiguous Mapping
- Inactive Reference

The Posting Code builder must be amended so creation/editing can establish the explicit Finance Code and Chart-of-Accounts relationship. A newly generated hierarchical code is not activation-ready merely because its formatted code string exists.

System Administrator must be able to correct a mapping without changing the approved budget line itself.

## 16. Activation Workspace UX and Navigation

Add a dedicated Budget Management workspace:

- **Label:** `Budget Activation`
- **Code:** `budget.activation`
- **Route:** `/dashboard/budget/activation`

Visibility: System Administrator and Registrar through the activation permissions above.

### Summary cards

- Approved Awaiting Mapping
- Validation Failed
- Ready for Activation
- Activated

### System Administrator tabs

- Awaiting Preparation
- Mapping Issues
- Ready for Registrar
- Activated History

### Registrar tabs

- Ready for My Action
- Activated History

Opening a record shows the same authoritative preflight/reconciliation data, but actions are role-specific.

## 17. Notifications

Use the existing hardened notification framework from Task 8.

Required events:

- `BUDGET_ACTIVATION_READY` → Registrar when System Administrator submits a valid batch
- `BUDGET_ACTIVATED` → System Administrator after Registrar activates

Optional informational notification may also go to the responsible Line Supervisor after activation if management wants visibility, but it must not create an approval responsibility.

Notifications link to:

`/dashboard/budget/activation?batch=<activation_batch_id>`

## 18. Interaction with FF3, FF4 and Budget Control

FF3/FF4 and operational budget reporting continue to consume `budget_allocations`.

The difference is that those records now exist only after explicit activation.

Therefore:

- an `APPROVED` but unactivated budget is visible as approved governance history but is **not spendable**;
- an `ACTIVATED` budget has operational allocation rows and can be used by FF3 commitment checks;
- FF4/payment controls continue to derive from the resulting FF3 commitments and operational budget lineage.

No FF3 or FF4 transaction should ever post against an approved submission that has not been operationally activated.

## 19. Interaction with Task 8 Revisions / Supplementary Budgets

Task 9 controls **initial operational activation of the approved baseline**.

Task 8 remains the authoritative post-activation change process:

`ACTIVATED BASELINE → Registrar requests change → Line Supervisor prepares revision → Registrar approves revision → existing allocation lineage is adjusted under revision controls`

Task 9 must not create a second initial activation batch for every supplementary/revised version.

Task 8 prerequisites remain intact: a revision workspace applies only where an operational allocation already exists and the prior authoritative baseline can be protected against actual expenditure and outstanding commitments.

## 20. Existing Production Data and Migration Safety

Recommended migration: `056_operational_budget_activation_finance_mapping.sql`.

The migration must be additive and conservative.

Rules:

- Do not delete approved submissions.
- Do not delete existing FF3/FF4/payment records.
- Do not automatically rewrite existing operational allocations that already have downstream commitments/payments.
- Do not automatically activate approved-but-unactivated budgets during migration.
- Backfill mapping candidates only when deterministic.
- Flag ambiguous/unresolved mappings for System Administrator action.
- Preserve legacy source lineage columns on `budget_allocations`.

For approved submissions with no active source-line allocations, create or expose activation batches in `DRAFT_MAPPING`/derived-awaiting-preparation state.

For submissions that already have complete operational allocations from the legacy approval-coupled process, preserve those allocations. Any historical activation reconciliation or backfilled audit record must be done conservatively and must never invent or reassign a financial account after the fact.

Before any production migration, explicitly inspect the current 68-line approved budget and classify whether it has zero, partial or complete operational allocations. A partial legacy allocation is an exception requiring reconciliation; it must not be silently completed.

## 21. API / Service Integration

The existing budget workflow API/service layer should expose explicit Task 9 actions rather than reusing `APPROVE`:

- `prepare_activation`
- `submit_activation`
- `activate_budget`
- read preflight/batch status

The server/database remains authoritative for actor identity, role, source totals and mapping validity.

Client code must never send an account id as a trusted override to force activation.

## 22. Audit Requirements

At minimum retain:

- budget preparer / submitter;
- Registrar budget approver;
- budget approval timestamp;
- System Administrator activation preparer;
- preparation/validation timestamp;
- validation result/fingerprint;
- Registrar activation authoriser;
- activation timestamp;
- approved line count;
- activated line count;
- approved total;
- activated total;
- variance;
- immutable line mapping snapshots;
- resulting `budget_allocation_id` per source line.

Suggested audit actions:

- `BUDGET_ACTIVATION_PREPARED`
- `BUDGET_ACTIVATION_VALIDATION_FAILED`
- `BUDGET_ACTIVATION_READY`
- `BUDGET_ACTIVATED`
- `FINANCE_POSTING_MAPPING_CREATED`
- `FINANCE_POSTING_MAPPING_UPDATED`
- `FINANCE_POSTING_MAPPING_DEACTIVATED`

## 23. Error Handling

Errors must be explicit and operationally useful. Do not surface generic “activation failed” where a deterministic business reason exists.

Examples:

- Approved budget not found.
- Budget is not in APPROVED status.
- Budget has already been activated.
- Budget contains an existing partial legacy allocation and requires reconciliation.
- Finance Code is inactive.
- No posting mapping exists for Finance Code X / Cost Centre Y.
- More than one active posting mapping exists.
- Posting Code is inactive.
- Chart-of-Accounts mapping is missing/inactive.
- Cost-centre mapping is missing/inactive/outside the approved section.
- Monthly allocation differs from approved annual amount.
- Approved and mapped totals do not reconcile.
- Technical mapping changed after Administrator validation; re-prepare activation.
- Only the System Administrator can prepare activation.
- Only the Registrar can authorise activation.

## 24. Testing Strategy

Use TDD for implementation.

### Database tests

Verify:

- `APPROVE` no longer creates `budget_allocations`;
- approved submission remains locked;
- no fallback Chart-of-Accounts lookup exists;
- no cost-centre name fallback exists;
- missing mapping blocks preparation;
- multiple mappings block preparation;
- inactive Finance Code/Posting Code/CoA/cost centre blocks preparation;
- valid 68-line-equivalent fixture reaches `READY_FOR_ACTIVATION` only when all 68 lines validate;
- Administrator cannot call final activation;
- Registrar cannot prepare technical mappings through activation RPC;
- fingerprint mismatch blocks activation;
- duplicate source allocation blocks activation;
- final activation inserts all lines atomically;
- deliberate failure on one line leaves zero newly activated lines;
- snapshot rows match created allocations and approved source values;
- direct authenticated execution of unsafe legacy allocation helper is revoked.

### Application tests

Verify:

- Budget Activation menu visibility is correct;
- System Administrator sees preparation actions but not activation authorisation;
- Registrar sees final authorisation but not mapping edit actions;
- preflight totals/counts display correctly;
- line-level mapping reasons are readable;
- ready notification routes Registrar to the exact batch;
- activated notification routes Administrator to history;
- FF3 cannot consume an approved-but-unactivated budget;
- FF3 can consume the successfully activated allocation;
- Task 8 revision workspace still recognises activated allocations and preserves existing allocation IDs.

### Regression gates

- full CI green;
- lint green;
- typecheck green;
- production build green;
- database migration review green;
- Netlify deploy preview green;
- existing budget workflow tests green;
- existing FF3/FF4 commitment/payment tests green;
- Task 8 revision/reforecast tests green.

## 25. UAT Scenario

Use a controlled approved budget equivalent to the production pattern.

1. Line Supervisor prepares and submits budget.
2. Registrar reviews and approves.
3. Verify no operational allocations were created by approval.
4. System Administrator opens Budget Activation.
5. Preflight intentionally shows at least one missing Finance/Posting/CoA mapping.
6. Verify **Submit for Activation** is blocked.
7. Administrator corrects the master mapping.
8. Refresh validation.
9. Verify approved lines = mapped lines and variance = K0.00.
10. Administrator submits for activation.
11. Registrar opens the ready batch.
12. Registrar reviews read-only reconciliation and activates.
13. Verify all source lines create operational allocations atomically.
14. Verify activation snapshots and audit history.
15. Create a valid FF3 requisition against an activated line and verify budget control.
16. Confirm an approved-but-unactivated fixture remains unavailable to FF3.
17. Confirm Task 8 supplementary/revision workflow can operate only after baseline activation.

No invented financial transaction should be posted to production merely to prove the workflow; use controlled UAT/test data until the live 68-line budget has passed reconciliation.

## 26. Out of Scope

- Changing the approved budget preparation ownership from Line Supervisor.
- Adding a second Registrar or executive approval level.
- Allowing System Administrator to approve or activate a budget.
- Automatic creation of missing Finance Codes, posting codes or Chart-of-Accounts records during activation.
- Silent auto-repair of ambiguous mappings.
- Replacing the Task 8 revision/supplementary budget process.
- Re-keying or deleting existing FF3/FF4/payment history.

## 27. Acceptance Criteria

Task 9 is accepted only when all of the following are true:

1. Registrar budget approval does not create operational allocations.
2. System Administrator can see every technical mapping defect before activation.
3. No approved line can activate using a fallback or inferred Chart-of-Accounts record.
4. No approved line can activate through cost-centre name matching.
5. Every activated line has an explicit Finance Code → Posting Code → Chart-of-Accounts → Cost Centre path.
6. System Administrator prepares; Registrar authorises.
7. Role segregation is enforced server-side even against the Administrator's `all` permission.
8. The final activation is atomic and idempotent against duplicate source lines.
9. Approved and activated totals reconcile to K0.00 variance.
10. Immutable line snapshots preserve exactly which master-data mapping was used.
11. FF3/FF4 only consume operational allocations created by a valid activation or preserved legacy lineage.
12. Task 8 revisions remain compatible and continue to preserve original approved history and operational allocation lineage.

---

### Approved Architecture Summary

**APPROVED BUDGET → SYSTEM ADMINISTRATOR MAPPING/PREFLIGHT → READY FOR ACTIVATION → REGISTRAR AUTHORISATION → ATOMIC OPERATIONAL ALLOCATION → FF3/FF4 + TASK 8 REVISION CONTROL**
