# NJSS-HARD-10 Production and Merge Reconciliation — 6 September 2026 (PNG)

## Purpose

This record reconciles the source-control state of NJSS-HARD-10 with the production Supabase state after the explicitly approved HARD-10 RLS deployment. It supplements, and does not rewrite, the historical pre-deployment readiness evidence in `NJSS_HARD10_FINAL_READINESS_2026-09-05.md`.

Repository: `emabi2002/njss`
Supabase project: `qzsmmalfeinoagvronpb`
Authoritative pull request: **#32 — NJSS-HARD-10: RLS and legacy policy lockdown**
Pre-reconciliation verified PR head: `c21eb97e189719d4c57abe62669eacbf5f7d7246`

## Production applied-state reconciliation

The HARD-10 source migrations were applied through the managed Supabase migration interface. Repository timestamps are source-ordering identifiers; the live managed ledger versions are authoritative evidence of production application.

| Logical order | Repository source artifact | Live managed migration version | Live migration name |
| --- | --- | --- | --- |
| 1 | `supabase/migrations/20260904013000_rls_and_legacy_policy_lockdown.sql` | `20260905144321` | `rls_and_legacy_policy_lockdown` |
| 2 | `supabase/migrations/20260904013100_budget_legacy_policy_cleanup.sql` | `20260905144436` | `budget_legacy_policy_cleanup` |
| 3 | `supabase/migrations/20260905152000_hard10_monthly_budget_view_compatibility.sql` | `20260905144510` | `hard10_monthly_budget_view_compatibility` |
| 4 | `supabase/migrations/20260905152100_hard10_budget_view_history_compatibility.sql` | `20260905144535` | `hard10_budget_view_history_compatibility` |

The prerequisite HARD-10A reconciliation remains recorded live as `20260905082346 hard10a_uat_supervisor_delegation`.

Post-deployment verification established:

- all 37 primary and ancillary HARD-10 target tables have RLS enabled;
- zero target tables remain RLS-disabled;
- zero unsafe legacy/permissive policy paths remain from the reviewed HARD-10 set;
- workflow history has no direct authenticated mutation policy;
- anonymous SELECT/DML access on the hardened target set is absent;
- HARD-10 revision assignment mismatches remain zero;
- business row counts remained unchanged: 213 submissions, 467 lines, 5,604 monthly allocations and 612 workflow-history rows;
- submission state remained 204 APPROVED and 9 DRAFT; all 8 certified UAT revisions remain DRAFT.

Real authenticated actor probes after RLS activation confirmed the intended access model: Requisition Officer receives no raw budget detail; Payment/Reconciliation retains scoped read-only budget detail; Registrar retains workflow review/approval without direct edit; ordinary Line Supervisor does not receive cross-location data; the explicit HARD-10A UAT Line Supervisor delegation exposes the eight assigned revision scenarios; and System Administrator cannot directly mutate APPROVED submissions.

## Stacked-PR reconciliation

The HARD-10 hardening work was developed as a stack against unchanged `main` (`6781ddf43c958a2095f9a48e2bfec85b9296be7e`). Merge-readiness inspection established the following ancestry:

1. PR #25 HARD-02 head `9408b789817a110455eb95d5158876cb428b2a9c` is an ancestor of PR #32. PR #32 is 43 commits ahead and zero behind that head.
2. PR #29 HARD-03 head `45d5b877f4dd7d69ef70b829a5c1f70493060958` is an ancestor of PR #32. PR #32 is 37 commits ahead and zero behind that head.
3. PR #31 HARD-45 current head `c7e45b9dc0a2199870ecefba735d68b70a57a71e` diverged from PR #32 only because PR #32 branched from the earlier validated HARD-45 head `767c9dbffeb0ba39f398ac438078b254fcbdf07d` and the HARD-45 branch later received two additional commits.
4. Content reconciliation of those later HARD-45 commits confirms the authoritative HARD-45 migration, compatibility hotfix, static regression, PostgreSQL runtime regression and live scope probe are present with equivalent current content in PR #32. PR #32's CI workflow preserves every HARD-45 check and adds the HARD-10/client-privilege checks. Its migration ledger extends the HARD-45 ledger rather than deleting its reconciliation evidence.

Accordingly, **PR #32 is the canonical aggregate source-control candidate for HARD-02 + HARD-03 + HARD-45 + HARD-10**. Sequentially merging PRs #25, #29, #31 and #32 is unnecessary and would reintroduce duplicate-history/reconciliation work. Once PR #32 is merged successfully, predecessor PRs #25, #29 and #31 should be closed as superseded by the aggregate merge, with their discussions retained as audit evidence.

## Independent and superseded PRs

PR #26 (`NJSS-HARD-09/24: Assign FF4 approval to Registrar`) is independent. Its workflow/RBAC files are not part of PR #32 and it must remain a separate merge/deployment decision.

The following older parallel branches were explicitly marked superseded and closed during this reconciliation:

- PR #27 — earlier SECURITY DEFINER/RPC hardening, superseded by PR #31/#32;
- PR #28 — earlier public-table RLS draft, superseded by the authoritative HARD-10 policy set in PR #32;
- PR #30 — incomplete draft HARD-03 TDD-RED branch, superseded by completed PR #29/#32.

These PRs were closed without merge; their discussions remain historical evidence and their older migrations must not be applied.

## Repository protection blocker

Live GitHub inspection on 6 September 2026 found:

- `main` remains at `6781ddf43c958a2095f9a48e2bfec85b9296be7e`;
- `main` is not protected;
- required status-check enforcement is off;
- the repository has no rulesets.

This means HARD-02's external acceptance criteria are not yet satisfied. Before the aggregate PR #32 is merged, repository protection must require pull requests to `main`, require the `Build and validate` status check, block force pushes and deletion, and prevent routine bypass as far as the repository plan permits.

## Merge gate

This reconciliation does **not** authorize a merge. The safe merge sequence is:

1. configure and verify `main` protection/ruleset controls;
2. verify the final PR #32 head is still based on current `main` and mergeable;
3. require a fresh complete `Build and validate` success on that exact final head;
4. obtain explicit NJSS merge approval;
5. merge PR #32 only;
6. verify `main` contains the aggregate source and CI remains green;
7. close #25, #29 and #31 as superseded by the aggregate merge;
8. keep PR #26 on its independent FF4/RBAC track.

No production database migration is implied by the future source merge: HARD-10 production DDL has already been applied and verified under its separate explicit approval. Any later database change requires a new migration and a new production migration gate.
