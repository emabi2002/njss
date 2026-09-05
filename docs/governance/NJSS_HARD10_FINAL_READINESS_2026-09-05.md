# NJSS-HARD-10 Final RLS Migration Readiness — 5 September 2026 (PNG)

## Scope

This checkpoint records the final pre-deployment review of NJSS-HARD-10 after HARD-10A UAT supervisor reconciliation. It is readiness evidence only. It does **not** authorize or apply the broader production RLS migration set.

Target Supabase project: `qzsmmalfeinoagvronpb`.

## Live prerequisite state

The live migration ledger contains these applied security prerequisites:

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

The compatibility migrations are intentionally guarded against standalone application. Repository timestamps are source ordering metadata; the live managed migration ledger remains authoritative for applied versions.

## Residual permissive-policy findings and corrections

Final live policy inventory found that the original ancillary cleanup was incomplete under PostgreSQL permissive-policy OR semantics. Confirmed residual paths included:

- `budget_monthly_allocations_select_phase6`, which admitted report-only actors without organisational scope;
- `expense_ledger_select_phase6`;
- legacy `njss_is_budget_admin()` INSERT/UPDATE/DELETE policies on budget division ceilings, budget reference values and expense ledger;
- an overly broad `hard10_expense_ledger_read` that originally admitted any authenticated actor.

Live `njss_is_budget_admin()` includes Registrar by role name, while the intended HARD-10 mutation predicates do not give Registrar generic budget/master-data administration. Leaving those policies in place would therefore have preserved Registrar mutation access through OR semantics.

TDD evidence:

- RED commit `7fc491a189217a1413c491244a0fe38636c72b87`; CI #449 failed exactly at the HARD-10 regression after predecessor checks passed.
- GREEN fix commit `5a335ad0d1575263638e2cb6a42a01a4e0f8068b`; CI #450 passed the complete pipeline at that exact HARD-10 fix point.

The ancillary migration now explicitly retires the residual Phase-6 and legacy budget-admin policies and requires an explicit budget/report permission for expense-ledger reads.

## Budget-detail compatibility

### Monthly allocations

The application loads `budget_monthly_allocations` as child detail of budget lines. Parent submission and line reads recognise `budget.view`, while the first HARD-10 monthly policy did not. This would have allowed Payment/Reconciliation Officer to read the budget but not its monthly child detail.

HARD-10B adds **only** `budget.view` to the scoped monthly-allocation SELECT policy. It deliberately excludes `budget.report.view` and `reports.view`, preventing recreation of the retired Phase-6 report-only raw-data path.

### Workflow history

The read-only budget detail path also loads `budget_workflow_history`. The first HARD-10 history policy recognised template/review/approve/audit permissions but not `budget.view`.

HARD-10C adds `budget.view` to the scoped SELECT policy, excludes report-only permissions, and asserts that no direct workflow-history mutation policy exists.

Both compatibility changes have isolated RED/GREEN evidence and are included in the final branch-wide CI below.

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

The old `budget_monthly_allocations_select_phase6` predicate was demonstrated to admit Requisition Officer through reporting permissions. Its removal is therefore required, not cosmetic.

The old `njss_is_budget_admin()` helper was demonstrated to return true for Registrar while the corrected HARD-10 ancillary admin predicate returns false for Registrar. The old mutation policies must remain explicitly retired.

## Workflow and trigger compatibility

Live function inspection confirms:

- the public budget transition wrapper is `SECURITY DEFINER`, requires an authenticated NJSS user, enforces action-specific permissions, derives actor identity from the authenticated profile and checks organisational scope;
- the internal budget transition routine sets transaction-local `njss.budget_workflow=on` before controlled status/actor changes;
- DRAFT submission, RETURNED resubmission, review and approval states are enforced by the workflow state machine;
- budget-revision submissions are intentionally blocked from the generic budget transition RPC and must use the dedicated revision workflow;
- dedicated revision SUBMIT/RESUBMIT requires the assigned Line Supervisor and organisational match; approve/return/reject requires Registrar.

A rollback attempt against a certified UAT revision reached the dedicated financial validation layer and correctly rejected submission because the seeded supplementary revision had not yet been edited to produce a positive net increase. All eight certified revision requests are still DRAFT and equal their parent totals. No financial values were fabricated merely to force a workflow test.

An attempt to replay an already-approved financial budget inside a rollback transaction was blocked by the execution safety layer. That protection was not bypassed. Readiness therefore relies on read-only actor/predicate evidence, live function/trigger definitions, existing rollback evidence and CI rather than mutating approved financial records.

## Revision-lineage CI blocker resolution

A later stacked revision-lineage test initially failed with:

`hotfix must document/guard the activated EXCEL_BUDGET baseline transition`

Root-cause inspection showed that the production hotfix already verifies the live operational-allocation guard for both `OLD.source_module='EXCEL_BUDGET'` and `NEW.source_module IS DISTINCT FROM 'EXCEL_BUDGET'`, and then repoints approved revised allocations to `source_module='BUDGET_REVISION'`. The test failed only because SQL string-literal escaping doubles quote characters in the hotfix source.

Commit `6cca0a1047191b57bd7e8f5b69732005dbe9f53e` corrected the regression to recognise the actual escaped preflight representation; production lineage SQL was not weakened or rewritten.

## Full live policy inventory

A final inventory of all non-SELECT policies across the 30 primary and seven ancillary HARD-10 targets found no additional unaccounted mutation path after the planned DROP set:

- legacy budget-contributor writes are covered by the primary/ancillary cleanup;
- old budget-admin writes on cycles/divisions are covered by the primary migration;
- old budget-admin writes on ceilings/reference/ledger are covered by the corrected ancillary migration.

A sensitive-table SELECT audit found only the legacy `budget_workflow_history_read USING (true)` policy, which the primary HARD-10 migration explicitly removes before creating the scoped read-only replacement.

## Final CI and deployment gate

CI **#459** completed successfully on exact head `6cca0a1047191b57bd7e8f5b69732005dbe9f53e`.

The run passed:

- four-group RBAC and Access Control regressions;
- server access-context and privileged Edge routing checks;
- dashboard/reporting/workflow/backup/master-data regressions;
- all budget preparation, revision, activation and Task 9 regressions;
- repository and migration governance checks;
- critical SECURITY DEFINER RPC lockdown checks;
- expanded HARD-10 RLS and legacy policy lockdown checks;
- Budget RPC PostgreSQL runtime checks;
- client table privilege PostgreSQL runtime checks;
- lint;
- TypeScript typecheck;
- production build.

### Gate status

- HARD-10 policy design: **READY**
- HARD-10 actor/scope regression: **READY**
- HARD-10A prerequisite integrity: **READY**
- Branch-wide CI on final tested head: **GREEN — CI #459**
- Pending RLS migration set applied live: **NO**
- 30 primary target tables still RLS-disabled: **YES**
- Production RLS deployment authorization: **NOT GRANTED / NOT EXECUTED**

NJSS-HARD-10 is now technically ready for the explicit production migration gate. Before applying, re-check the live migration ledger and prerequisite invariants, then apply the four pending HARD-10 artifacts in the documented order and perform post-apply RLS, policy, actor, security-advisor and application smoke verification.
