# NJSS Migration Ledger and Drift Control

## Purpose

This is the authoritative migration-governance record for NJSS. It reconciles repository migration history with the live Supabase migration ledger without renaming, rewriting or reordering historical SQL files that may already have been applied.

## Live environment baseline

- Supabase project: **NJSS System**
- Project reference: `qzsmmalfeinoagvronpb`
- Region: `ap-northeast-1`
- Database engine observed during HARD-03: PostgreSQL 17
- Latest live migration observed during the HARD-03 read-only inspection: `20260830060930 workflow_task_inbox`

The live ledger is authoritative evidence of what Supabase recorded as applied. Repository filenames are source-control artifacts and must not be assumed to have identical timestamps to the live migration versions.

## Historical repository migration model

The repository contains an older short-number migration series (`000` through `065`, plus `0625`) and later timestamp-based migrations. The short-number series is frozen historical material. It must not be renamed merely to normalize numbering because a migration may already have been applied, transformed or recorded under a Supabase timestamp version.

### Approved historical prefix collisions

Exactly three duplicate short prefixes are known and accepted as historical debt:

| Prefix | Historical files | Governance treatment |
| --- | --- | --- |
| `003` | `003_notifications_and_audit.sql`; `003_notifications_only.sql` | Freeze both files; do not rename; determine actual schema state from live database and migration ledger. |
| `052` | `052_budget_revision_workflow.sql`; `052_dashboard_scope_access.sql` | Freeze both files; do not rename; live `dashboard_scope_access` is recorded separately as `20260830030139`. |
| `064` | `064_budget_activation_finance_mapping_worklist.sql`; `064_budget_activation_mapping_worklist.sql` | Freeze both files; do not rename; use live schema/migration evidence to determine applied state. |

Any new duplicate legacy prefix is a CI failure.

## Repository-to-live drift evidence

The following examples prove that filename chronology and Supabase's applied version chronology are not one-to-one:

- Repository contains `20260830054500_workflow_task_inbox.sql`, while live Supabase records `20260830060930 workflow_task_inbox`.
- Repository contains `20260830141000_management_reporting_drilldown_menu.sql`, while live Supabase records `20260830035043 add_management_reporting_drilldown_menu`.
- Historical `052_dashboard_scope_access.sql` exists in the short-number series, while live Supabase records `20260830030139 dashboard_scope_access`.

Therefore replay, recovery and deployment decisions must use **both** source-control evidence and the target environment's applied migration ledger. A filename alone is not proof that an environment has applied a migration.

## Live applied migration checkpoint

The HARD-03 read-only Supabase inspection recorded the following applied migration sequence from the current managed ledger. This is an environment checkpoint, not a replacement for future live queries:

```text
20260826072440 four_group_preflight_permission_helper
20260826072516 four_group_operational_rbac
20260826072601 four_group_report_scope_security
20260826072622 four_group_membership_guards
20260826072849 four_group_unambiguous_section_backfill
20260826072912 four_group_quarantine_unscoped_assignments
20260826120644 full_differential_backup_framework
20260826222632 master_data_cleanup
20260827094716 budget_revision_reforecast_schema
20260827094954 budget_revision_reforecast_workflow
20260827095046 budget_revision_reporting
20260827095214 budget_revision_hardening
20260827124739 budget_revision_workspace_notifications
20260828164958 task9_predeploy_full_snapshot_20260829
20260828165256 task9_base_activation_schema_rbac
20260828165337 task9_approval_separation_and_draft_backfill
20260828165513 task9_canonical_finance_posting_mapping
20260828165630 task9_activation_fingerprint_snapshot_schema
20260828165719 task9_final_activation_prepare_rpc
20260828165741 task9_final_activation_submit_rpc
20260828165823 task9_final_registrar_activation_rpc
20260828170001 task9_budget_workflow_actor_type_hardening
20260828170136 task9_fk_only_transaction_guards_and_queue
20260828170149 task9_completion_marker
20260828170242 task9_create_exact_approved_division_cost_centres
20260828170333 task9_reconcile_legacy_sheriff_division_department
20260828171240 task9_finance_mapping_worklist
20260829003617 budget_activation_finance_mapping_worklist
20260829004153 budget_activation_performance_indexes
20260829070135 national_uat_location_seed_registry
20260829074717 national_uat_cloud_dry_run_rehearsal
20260829075923 supplier_workflow_status_alignment
20260829080340 national_uat_task14_guarded_reset
20260829080436 national_uat_task14_geography
20260829080459 national_uat_task14_waigani_structure
20260829080533 national_uat_task14_regional_structure
20260829080824 national_uat_task14_finance_masters
20260829081044 finance_posting_context_uniqueness_alignment
20260829081151 national_uat_task14_finance_posting_contexts_v4
20260829115256 national_uat_task14_uuid_helper
20260829115323 national_uat_task14_budget_drafts_core
20260829115516 national_uat_task14_budget_monthly_profiles
20260829115613 national_uat_task14_budget_submit
20260829115627 national_uat_task14_budget_review
20260829115715 national_uat_task14_budget_approve_v2
20260829115730 national_uat_task14_activation_prepare
20260829115740 national_uat_task14_activation_submit
20260829115759 national_uat_task14_activation_registrar
20260829115858 national_uat_task14_transaction_masters
20260829120030 national_uat_task14_transaction_plan
20260829120224 fix_budget_release_uuid_aggregate
20260829120243 national_uat_task14_funding_runtime_v4
20260829121205 national_uat_task14_ff3_headers
20260829121219 national_uat_task14_ff3_items_quotations
20260829121234 national_uat_task14_ff3_submit
20260829121305 national_uat_task14_ff3_return_cases
20260829121331 national_uat_task14_ff3_case_012
20260829121343 national_uat_task14_ff3_case_020
20260829121355 national_uat_task14_ff3_case_028
20260829121407 national_uat_task14_ff3_case_032
20260829121423 national_uat_task14_ff3_001_endorse
20260829121439 national_uat_task14_ff3_remaining_endorsements
20260829121454 national_uat_task14_ff3_001_approve
20260829121516 national_uat_task14_ff3_approve_group_a
20260829121536 national_uat_task14_ff3_approve_group_b
20260829121546 national_uat_task14_ff3_approve_group_c
20260829121601 national_uat_task14_ff3_approve_group_d
20260829121740 national_uat_task14_ff4_headers
20260829121844 national_uat_task14_ff4_001_submit_uat_only
20260829121906 national_uat_task14_ff4_submit_002_004_uat_only
20260829121919 national_uat_task14_ff4_submit_005_008_uat_only
20260829121935 national_uat_task14_ff4_submit_009_012_uat_only
20260829121949 national_uat_task14_ff4_submit_013_016_uat_only
20260829122008 national_uat_task14_ff4_verify_005_008_uat_only
20260829122037 national_uat_task14_ff4_verify_009_010_uat_only
20260829122055 national_uat_task14_ff4_verify_011_012_uat_only
20260829122109 national_uat_task14_ff4_verify_013_016_uat_only
20260829122337 fix_budget_revision_monthly_clone_trigger_alignment
20260829122354 national_uat_task14_revision_wgn_uat_only_v2
20260829122408 national_uat_task14_revision_lae_uat_only
20260829122427 national_uat_task14_revision_mhg_uat_only
20260829122444 national_uat_task14_revision_wew_uat_only
20260829122459 national_uat_task14_revision_kok_uat_only
20260829122518 national_uat_task14_revision_alo_uat_only
20260829122532 national_uat_task14_revision_tar_uat_only
20260829122603 national_uat_task14_revision_buk_retry
20260829123002 national_uat_task14_transaction_provenance_completion
20260829130042 task14_uat_runtime_hardening
20260829131507 national_uat_task14_ff4_complete
20260829131756 national_uat_task14_negative_validation
20260829132037 national_uat_task14_protected_validation
20260829132135 national_uat_task14_positive_validation
20260829132441 national_uat_task14_finalize_cleanup
20260830030139 dashboard_scope_access
20260830035043 add_management_reporting_drilldown_menu
20260830060930 workflow_task_inbox
```

## Schema-drift decision rules

Before any UAT or production migration:

1. Query the target project's live migration ledger.
2. Compare the expected schema objects, grants, RLS policies, functions and views against the target database.
3. Never infer applied state solely from a repository filename.
4. Never rename or rewrite a historical migration already capable of having been applied.
5. Correct drift with a new additive timestamp migration.
6. Record the migration filename, source commit SHA, target project, preflight evidence, backup reference where required and post-apply validation.
7. If the target state is ambiguous, stop deployment and resolve the ledger/schema discrepancy first.

## Checksum policy

Git history is the immutable source for historical migration contents. Release evidence must record the exact source commit SHA containing the migration set. Before production application, the migration file contents must match that approved commit; any post-approval edit invalidates the approval and requires fresh CI/review. Future automation may additionally publish SHA-256 file manifests, but this does not justify rewriting historical migrations.

## Future migration naming rule

All **new** NJSS migration files must use the deterministic format:

`YYYYMMDDHHMMSS_snake_case_description.sql`

Example:

`20260904010000_harden_public_master_data_rls.sql`

New three-digit/four-digit migration prefixes are prohibited. The historical series remains frozen exactly as source evidence.

## Production gate

This ledger is governance evidence only. It does not authorize any database mutation. Production DDL requires the separate explicit **NJSS production migration approval** and must be followed by live migration-ledger, schema, RLS and security-advisor verification.

## Applied-state reconciliation — 4 September 2026 (PNG)

EM explicitly granted blanket approval to review the NJSS repository and NJSS Supabase and make necessary changes. The following narrowly scoped RPC corrections were applied to `qzsmmalfeinoagvronpb`; this is an execution record, not a claim that the complete hardening programme is finished.

| Required order | Live migration version | Source artifact | Evidence |
| --- | --- | --- | --- |
| 1 | `20260903204303` | `supabase/migrations/20260904010000_security_definer_rpc_lockdown.sql` at `30b3d6ac68a072e723d4ecf4de651d96a7c9271d` | CI #433 passed; all referenced live signatures resolved; anonymous/direct internal grants revoked. |
| 2 | `20260903204909` | `supabase/hotfixes/20260903204909_budget_transition_legacy_owner_compatibility.sql` | Live cross-section non-owner submission denial passed after legacy varchar ownership compatibility correction. |
| 3 | `20260903211826` | `supabase/hotfixes/20260903211826_client_table_privileges_lockdown.sql` | CI #436 on `8577bb02359022f9a3b4d2dac62bb911819aa7ef` passed before application; live read-only privilege assertion passed after application. |

The live `divisional_budget_submissions.prepared_by` column is `varchar`, while repository migration 012 declares UUID. A source-only test did not detect that drift. The first live scope probe failed with UUID input error before mutation. The additive compatibility patch accepts only canonical UUID-valued owners; display names resolve to NULL and are not treated as identity. Department, section and submitted-by inputs remain database-derived. An intermediate malformed patch was rejected by PostgreSQL and did not create a migration entry.

The CLI installer was unavailable after its network approval was cancelled. The existing authenticated migration interface generated the live version above. Its exact SQL is retained under `supabase/hotfixes` because the server-generated September 3 timestamp sorts before the previously authored September 4 base migration. Do not move this patch earlier in replay order, rewrite the historical base, or replay the base on an already-hardened database. Reconciled replay must apply the compatibility patch immediately after the base RPC migration. This ordering remains a HARD-03 release prerequisite.

Verification includes anonymous role-helper and budget-transition denials, authenticated direct-helper denial, rejection without an authenticated actor, and denial for an actual section supervisor against a cross-section submission they neither own nor submitted. Probes use rollback and commit no business changes. The new `scripts/critical-rpc-runtime.test.mjs` runs the production wrapper against isolated PostgreSQL fixtures for both varchar and UUID ownership fields. Live post-correction advisors report zero anonymously executable SECURITY DEFINER functions; broader RLS, view, storage, workflow and release findings remain open.

### Client table privilege correction

The live read-only regression initially failed on 91 table/role pairs. `authenticated` had TRUNCATE on 90 public tables and TRIGGER, REFERENCES and MAINTAIN on 91 each. Broad legacy `GRANT ALL` statements and postgres public default grants explain these non-row privileges. RLS does not cover TRUNCATE or REFERENCES; this finding concerns underlying database privileges, not proof of a direct REST truncate endpoint or exploitation.

Migration `20260903211826` revokes those four privileges from PUBLIC, anon and authenticated on existing postgres-owned public ordinary/partitioned tables and from postgres public table defaults. It does not change DML grants, policies, business rows, existing triggers or other schemas. Atomic before/after invariants preserve each client's SELECT/INSERT/UPDATE/DELETE privileges and all service-role table privileges; an unexpected owner, global default grant, residual inherited privilege or column-level REFERENCES grant causes rollback.

Post-application checks: 99 public tables; all four authenticated non-row privilege counts zero; the read-only regression passes for both client roles and postgres defaults. The RLS-disabled table count remains 30. No production TRUNCATE or test fixture was executed. Runtime tests use only the explicitly named localhost CI database and cover actual denied TRUNCATE, normal CRUD, existing trigger execution, preserved read-only restrictions, idempotence, future-table defaults, service-role grants and an untouched non-public schema. CI #436 passed all 28 scripted checks, lint, typecheck and build; lint retains the pre-existing unused-disable warning in `app/dashboard/budget/activation/page.tsx`.

The applied SQL was first committed under the unversioned hotfix name at `8577bb02359022f9a3b4d2dac62bb911819aa7ef`, then renamed to the server-generated live version with one metadata comment; executable SQL is unchanged. The CLI installation remains unavailable following the earlier cancelled network approval. This hotfix is independent of the pending business RLS migrations and can replay after the two RPC entries above. HARD-03 still must reconcile the historical source/live migration ordering before native migration deployment.

Managed-role limitation: `supabase_admin` also owns a public default-privilege entry. The configured `postgres` session is not a member of that managed role, so its defaults were not modified or bypassed. Tables later created by that managed role need an owner-authorized default correction or explicit least-privilege grants in their creation workflow. All currently existing public tables are owned by postgres and passed verification.

Broader HARD-10 remains unapplied. Its proposed `FOR ALL` budget policies conflate create/edit/submit/review/approve rights and do not independently constrain locked or approved records. Live workflow logic permits editing/return paths involving RETURNED as well as DRAFT; a draft-only patch would break resubmission. Live `njss_budget_submission_before`, line and monthly-allocation triggers already enforce locked-record/workflow checks, so policy text alone is not proof of an exploitable mutation. Complete actor, state, ownership-field, trigger and child-row tests before applying or claiming end-to-end workflow protection.

Post-change read smoke checks exercised nine core tables for one existing actor in each of the four business groups and System Administrator: 45 checks, no SQL errors, all returned at least one visible row. This verifies query continuity, NOT authorization correctness: the known broad legacy budget read policies remain. The reproducible read-only diagnostic is `supabase/diagnostics/actor_read_smoke.sql`. An earlier full table/view sweep reached its 30-second statement safety limit while evaluating `v_funding_source_financial_position`, through `fn_current_user_has_permission`/data-scope evaluation. This is an investigation lead, not a measured 30-second execution time for that individual view. No timeout was raised, production fixture created, or business write attempted.

## HARD-10A UAT supervisor reconciliation — 5 September 2026 (PNG)

Live preflight found eight DRAFT budget revisions from certified run `UAT-2026-V1-20260829` whose assigned Line Supervisor no longer matched the budget division. The applied national-UAT seed migrations had temporarily moved the single UAT actor, Alex Supervisor, into each target section while creating the revision request and then restored his permanent Waigani HR assignment. That made the seeded assignment valid only at creation time and invalid immediately after seed completion.

HARD-10A corrects the fixture design without weakening the four-group role model. The Line Supervisor role remains `SECTION_WIDE`; Alex remains in department `NCD-WGN-HR`, section `NCD-WGN-HR-HRA`; no user home assignment is rewritten. The canonical `njss_budget_revision_supervisor_matches(uuid,uuid)` function now also recognizes an explicit, current **user-level** `DEPARTMENT_WIDE` delegation. A single UAT-provenance `user_data_scopes` row delegates exactly the eight departments represented by the certified revision scenarios. Role-wide data scope does not satisfy this delegated matcher arm, and no `SYSTEM_WIDE` delegation is created.

| Live migration version | Source artifact / tested source | Evidence |
| --- | --- | --- |
| `20260905082346` | `supabase/hotfixes/20260905082346_hard10a_uat_supervisor_delegation.sql`; exact executable SQL tested/applied from commit `bbb4960b6cd28351400c0e669bb62ff22db1c083` before live-version filename reconciliation | TDD RED CI #442; exact-source CI #444 passed; exact-source rollback-only live probe resolved all eight assignments inside the transaction and persisted zero changes after rollback; post-apply assignment mismatch count is 0. |

Post-apply validation records one active `DEPARTMENT_WIDE` delegation with exactly eight department IDs and one matching `uat_seed_entities` provenance row. All eight `NJSS-NATIONAL-UAT-2026-V1` revision scenarios remain present and match Alex under the canonical helper. The certified UAT run remains `COMPLETED` with 15/15 positive and 27/27 negative validations. The complete `supabase/tests/hard10_policy_trigger_preflight.sql` executes without exception after HARD-10A.

This migration is **not** the broader HARD-10 RLS deployment. A fresh catalog check after HARD-10A still reports all 30 HARD-10 target tables with RLS disabled. The pending HARD-10 RLS migrations remain behind their separate production application gate.
