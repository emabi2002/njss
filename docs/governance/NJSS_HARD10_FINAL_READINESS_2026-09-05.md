# NJSS-HARD-10 Final RLS Migration Readiness — 5 September 2026 (PNG)

## Scope

This checkpoint records the final pre-deployment review of NJSS-HARD-10 after HARD-10A UAT supervisor reconciliation. It is readiness evidence only. It does **not** authorize or apply the broader production RLS migration set.

Target Supabase project: `qzsmmalfeinoagvronpb`.

## Live prerequisite state

The live migration ledger contains the following applied security prerequisites:

1. `20260903204303 security_definer_rpc_lockdown`
2. `20260903204909 budget_transition_legacy_owner_compatibility`
3. `20260903211826 client_table_privileges_lockdown`
4. `20260905082346 hard10a_uat_supervisor_delegation`

No broader HARD-10 RLS migration is recorded as applied.

Fresh final-readiness checks show:

- HARD-10 revision assignment mismatches: **0**
- active HARD-10A delegated-scope rows: **1**
- delegated UAT departments: **8**
- HARD-10A provenance rows: **1**
- primary HARD-10 target tables still RLS-disabled: **30 / 30**

## Final HARD-10 migration chain

After the live prerequisite state above is verified again at deployment time, the pending HARD-10 source artifacts must be applied in this exact logical order:

1. `supabase/migrations/20260904013000_rls_and_legacy_policy_lockdown.sql`
2. `supabase/migrations/20260904013100_budget_legacy_policy_cleanup.sql`
3. `supabase/migrations/20260905152000_hard10_monthly_budget_view_compatibility.sql`
4. `supabase/migrations/20260905152100_hard10_budget_view_history_compatibility.sql`

The two compatibility migrations are intentionally guarded against standalone application. Their repository timestamps are source ordering metadata; the live managed migration ledger remains authoritative for applied versions.

## Residual permissive-policy finding and correction

The final live policy inventory discovered that the original ancillary cleanup was incomplete under PostgreSQL permissive-policy OR semantics.

Confirmed residual paths included:

- `budget_monthly_allocations_select_phase6`, which admitted report-only actors without organisational scope;
- `expense_ledger_select_phase6`;
- legacy `njss_is_budget_admin()` INSERT/UPDATE/DELETE policies on budget division ceilings, budget reference values and expense ledger;
- an overly broad `hard10_expense_ledger_read` that originally admitted any authenticated actor.

Live `njss_is_budget_admin()` includes Registrar by role name, while the intended HARD-10 mutation predicates do not give Registrar generic budget/master-data administration. Therefore leaving those policies in place would have preserved Registrar mutation access through OR semantics.

TDD evidence:

- RED commit `7fc491a189217a1413c491244a0fe38636c72b87`; CI #449 failed exactly at the HARD-10 regression after all predecessor checks passed.
- GREEN fix commit `5a335ad0d1575263638e2cb6a42a01a4e0f8068b`; CI #450 passed the complete pipeline at that exact HARD-10 fix point.

The ancillary migration now explicitly retires the residual Phase-6 and legacy budget-admin policies and requires an explicit budget/report permission for expense-ledger reads.

## Budget-detail compatibility findings

### Monthly allocations

The application reads monthly allocations as nested child detail of budget lines. The parent submission and line read policies recognise the canonical `budget.view` permission, while the first HARD-10 monthly policy did not. This caused Payment/Reconciliation Officer to have valid budget access but zero monthly child-detail visibility.

The corrected HARD-10B policy adds **only** `budget.view` to the scoped monthly-allocation SELECT policy. It deliberately does not add `budget.report.view` or `reports.view`, which would recreate the retired Phase-6 report-only raw-data path.

Isolated RED/GREEN verification against the exact policy block confirmed the missing permission before the fix and the intended predicate after it.

### Workflow history

The read-only budget detail path also loads `budget_workflow_history`. The first HARD-10 history policy recognised template/review/approve/audit permissions but not `budget.view`, creating the same child-detail mismatch.

HARD-10C replaces only the SELECT policy, adds `budget.view`, preserves organisational scope, excludes report-only permissions, and asserts that no direct workflow-history mutation policy exists.

Isolated RED/GREEN verification confirmed the missing permission before the fix and the intended read-only predicate after it.

## Actor regression matrix

The proposed policy predicates were evaluated against real active NJSS actor identities and the live organisational-scope engine without applying RLS or mutating business values.

| Actor group | Proposed result |
| --- | --- |
| Requisition Officer | 0 raw budget submissions; 0 monthly allocations; 0 workflow-history rows. Reporting permissions alone do not grant raw budget detail. |
| Ordinary Line Supervisor | Section-scoped only. The tested Alotau supervisor has 0 visibility into the seeded revision locations. |
| HARD-10A delegated UAT Line Supervisor | 17 readable submissions; 8 directly editable DRAFT submissions; 744 scoped monthly rows through home plus explicit UAT delegation. |
| Registrar | 213 readable submissions; 0 direct submission edits. Review/approve authority remains controlled-RPC authority and does not imply row mutation. |
| Payment/Reconciliation Officer | 213 submissions; 467 budget lines; 5,604 monthly allocations; 612 workflow-history rows through `budget.view`; no direct edit/admin-write authority. |
| System Administrator | 213 readable submissions; 9 directly editable DRAFT submissions; 5,604 monthly rows; administrative mutation authority through `all`. |

The old `budget_monthly_allocations_select_phase6` predicate was separately demonstrated to admit the Requisition Officer because that actor has reporting permissions. Its removal is therefore required, not cosmetic.

The old `njss_is_budget_admin()` helper was separately demonstrated to return true for Registrar while the corrected HARD-10 ancillary admin predicate returns false for Registrar. The old mutation policies must therefore remain explicitly retired.

## Workflow and trigger compatibility

Live function inspection confirms:

- the public budget transition wrapper is `SECURITY DEFINER`, requires an authenticated NJSS user, enforces action-specific permissions, derives actor identity from the authenticated profile and checks organisational scope;
- the internal budget transition routine sets transaction-local `njss.budget_workflow=on` before controlled status/actor changes;
- DRAFT submission, RETURNED resubmission, review and approval states are enforced by the workflow state machine;
- budget-revision submissions are intentionally blocked from the generic budget transition RPC by `njss_guard_budget_revision_submission_write()` and must use the dedicated revision workflow;
- dedicated revision SUBMIT/RESUBMIT requires the assigned Line Supervisor and organisational match; approve/return/reject requires Registrar.

A rollback attempt against a certified UAT revision correctly reached the dedicated financial validation layer and rejected submission because the seeded supplementary revision had not yet been edited to produce a positive net increase. All eight certified revision requests are still DRAFT and currently equal their parent totals. No financial values were fabricated merely to force a workflow test.

An attempt to replay an already-approved financial budget inside a rollback transaction was blocked by the execution safety layer. That protection was not bypassed. Final readiness therefore relies on read-only actor/predicate evidence, live function/trigger definitions, existing rollback workflow evidence and CI rather than mutating approved financial records.

## Full live policy inventory

A final inventory of all non-SELECT policies across the 30 primary and seven ancillary HARD-10 targets found no additional unaccounted mutation path after applying the planned DROP set:

- legacy budget-contributor writes are covered by the primary/ancillary cleanup;
- old budget-admin writes on cycles/divisions are covered by the primary migration;
- old budget-admin writes on ceilings/reference/ledger are covered by the corrected ancillary migration.

A sensitive-table SELECT audit found only the legacy `budget_workflow_history_read USING (true)` policy, which the primary HARD-10 migration explicitly removes before creating the scoped read-only replacement.

## CI status and deployment gate

HARD-10-specific full-pipeline evidence exists at CI #450 on commit `5a335ad0d1575263638e2cb6a42a01a4e0f8068b` for the residual-policy correction. The subsequent monthly/history compatibility assertions have isolated RED/GREEN evidence, but the monolithic branch CI currently stops earlier at a separate **Budget revision hardening regression** introduced by an independent revision-lineage workstream. Because that earlier step prevents the HARD-10 check from executing on the newest head, the overall PR is **not yet a green production-deployment candidate**.

### Gate status

- HARD-10 policy design: **READY**
- HARD-10 actor/scope regression: **READY**
- HARD-10A prerequisite integrity: **READY**
- Pending RLS migration set applied live: **NO**
- 30 primary target tables still RLS-disabled: **YES**
- Branch-wide CI on latest stacked head: **BLOCKED BY SEPARATE REVISION-HARDENING FAILURE**
- Production RLS deployment authorization: **NOT GRANTED / NOT EXECUTED**

Do not apply the four pending HARD-10 migrations until the branch-wide CI blocker is resolved and the final current head completes the entire validation pipeline. After that, production application remains behind the explicit NJSS production migration gate.
