# Task 9 — Production Deployment Runbook (No Paid Supabase Branch)

**Repository:** `emabi2002/njss`  
**Feature branch:** `feature/operational-budget-activation`  
**Scope:** Operational Budget Activation & Finance Master-Data Hardening  
**Environment strategy:** No paid Supabase development branch. Production remains unchanged until an explicit deployment authorisation.

## 1. Verified production baseline — 28 August 2026

Read-only production reconciliation established:

- 11 `APPROVED` and locked budget submissions.
- 68 approved budget lines in total.
- Approved total: **K5,630,150.00**.
- 68/68 lines reconcile monthly cash flow to annual estimate.
- All 11 approved submissions have **ZERO** active operational `EXCEL_BUDGET` allocations.
- No `PARTIAL` legacy allocation case exists.
- 47 distinct active posting Finance Codes are used by the 68 lines.
- No duplicate reciprocal active Finance/Posting pointer exists.
- 68 distinct Division × Finance Code combinations require contextual canonical mappings.
- 112 Posting Codes exist; 0 are active.
- 7 Cost Centres exist; 0 are active.
- 17 Chart of Accounts records exist; all 17 are active.
- None of the 11 approved Division Cost Centre codes exists as an exact Cost Centre record, active or inactive.
- The 11 approved Divisions currently have no Section ownership; Cost Centres may therefore be Department-scoped unless governance deliberately changes this before activation.
- Production contains Task 8/RBAC migrations but does not yet contain Task 9 activation tables or `expense_code_registry.chart_of_account_id`.
- Production `users` schema uses `full_name`; it does not contain `first_name` or `last_name`. Task 9 migrations 061–063 have been corrected and regression-protected to use `full_name`.

## 2. Non-negotiable control principles

1. **Approval is not activation.** An approved budget is a governance baseline only.
2. **No migration may create spendable allocations.** Existing approved submissions may receive `DRAFT_MAPPING` activation headers only.
3. **System Administrator is technical maker.** The Administrator creates/maintains master-data mappings, prepares validation and submits a clean batch.
4. **Registrar is activation authoriser.** The Registrar cannot edit mappings from the activation screen.
5. **No fallback mapping.** No first-active CoA fallback, Cost Centre name match, submission free text or fuzzy matching may be used for live posting.
6. **Atomic activation.** All source lines must post together with immutable activation snapshots, or none post.
7. **K0.00 variance required.** Approved line count, mapped line count and totals must reconcile exactly within the defined 0.009 database tolerance.
8. **Task 8 remains post-activation authority.** Revisions/supplementary budgets operate on the existing activated allocation lineage; they do not create a new initial activation batch.

## 3. Deployment gates

### Gate A — code verification

Required before database deployment:

- Task 8 regression suite: PASS.
- Task 9 activation control regression: PASS.
- Approved Task 9 conformance regression: PASS.
- Lint: PASS.
- TypeScript: PASS.
- Next.js production build: PASS.
- Corrected migration head must be the exact reviewed commit or a later green commit.

### Gate B — production preflight

Run:

`script/task9-production-preflight.sql` equivalent path: `scripts/task9-production-preflight.sql`

Stop deployment if any of these are true:

- Any approved submission is `PARTIAL` or unexpected `COMPLETE` operational allocation state.
- Any approved monthly cash flow does not reconcile.
- Duplicate active reciprocal Finance/Posting links exist.
- System Administrator or Registrar active-user count is zero.
- Production schema assumptions differ from the preflight contract.
- Task 9 objects are already partially deployed in an unexplained state.

### Gate C — backup / recovery readiness

Because no paid staging branch is being used, production deployment requires a recovery point before DDL is applied.

At the authorised deployment window:

1. Confirm the current Supabase backup/PITR capability for the NJSS project.
2. Capture the current Supabase migration history and `latest_database_migration` value if present.
3. Export/read-only capture the 11 approved submission IDs, 68 line IDs, totals and current zero-allocation state.
4. Do not begin if the backup/recovery path is unavailable or uncertain.

No backup mutation or production DDL is authorised merely by this runbook.

## 4. Database migration order

Apply in this exact sequence with no Task 9 user activity between migrations:

1. `056_operational_budget_activation_finance_master_data.sql`
2. `057_finance_mapping_admin.sql`
3. `058_budget_activation_organizational_guard.sql`
4. `059_finance_posting_one_to_one_integrity.sql`
5. `060_operational_allocation_organizational_guard.sql`
6. `061_explicit_finance_posting_mapping_and_cost_centre_fk.sql`
7. `062_budget_activation_fingerprint_and_immutable_snapshot.sql`
8. `0625_budget_activation_queue_view_reset.sql`
9. `063_budget_activation_fk_only_guards.sql`

### Why the sequence must be uninterrupted

Migrations 058 and 060 are legacy Task 9 organisational guards that still understand historical code/name-based ownership. Migration 063 replaces them with the approved FK-only transaction boundary. Therefore, do not expose or use Budget Activation between 058 and 063. Treat 056→063 as one controlled database deployment unit.

### Migration 056 expected data effect

For existing approved budgets, migration 056 creates one `DRAFT_MAPPING` activation header per approved submission. It does **not** create `budget_allocations`.

Expected after 056 for the current baseline:

- approximately 11 draft activation batch headers;
- 68 approved source lines still remain only source budget lines;
- active `EXCEL_BUDGET` operational allocations remain 0;
- no Registrar activation occurs.

### Migration 061 expected backfill effect

061 only backfills canonical mappings when the legacy relationship is already deterministic and all referenced records are active and scope-consistent.

Under the verified current production data, no approved-line canonical mapping should be invented automatically because required Cost Centres and Posting Codes are inactive/missing. Unresolved records must remain unresolved for Administrator remediation.

## 5. Immediate post-deployment verification

Run:

`scripts/task9-production-postdeploy-checks.sql`

Stop and investigate if:

- final migration marker is not `063_budget_activation_fk_only_guards`;
- activation tables/views/functions are missing;
- an active `EXCEL_BUDGET` allocation appeared before Registrar activation;
- immutable activation snapshots exist unexpectedly;
- approved batch source counts/totals differ from the source submissions;
- legacy direct allocator remains executable by `authenticated`;
- required RBAC grants are missing.

## 6. Master-data remediation order

Schema deployment does not make the approved budgets activation-ready. The System Administrator must perform the following in order.

### 6.1 Create 11 exact Cost Centres

Create active Cost Centres with the approved Division codes/names and the correct Department ownership:

| Division | Required Cost Centre | Name |
|---|---|---|
| EXEC | 10101 | Executive Management |
| REG | 10201 | Court Registry Services |
| SHER | 10301 | Sheriff Operations |
| FIN | 10401 | Finance and Accounts |
| HR | 10501 | Human Resources |
| ICT | 10601 | ICT Services |
| INFRA | 10701 | Infrastructure and Assets |
| PROC | 10801 | Procurement and Supply |
| AUDIT | 10901 | Internal Audit |
| LEGAL | 11001 | Legal Services |
| SHERIFF | SHERIFF | Sheriff Division Cost Centre |

Do not substitute a Cost Centre with a similar name or different code.

After creation, update/confirm each `budget_divisions.cost_centre_id` against the exact Cost Centre ID.

### 6.2 Build contextual Posting Codes

The 68 approved lines represent 68 distinct Division × Finance Code contexts. A single generic Posting Code must not be reused across incompatible Cost Centres.

For each required context:

1. Finance Code must be active and `is_posting=true`.
2. Posting Code must be active.
3. Posting Code Department must equal the approved Department.
4. Posting Code Cost Centre must equal the approved Division Cost Centre.
5. Section must be null or exactly compatible with approved ownership.
6. Chart of Accounts must be explicitly selected from an active CoA record.
7. Financial Year should be set to 2026 for the current baseline unless a deliberately generic mapping is approved.
8. Save through the canonical `finance_posting_mappings` RPC/UI.

Do not repair this by directly manipulating reciprocal legacy pointers.

### 6.3 Canonical readiness target

Before activation preparation, the target is:

- 68 required source-line contexts;
- exactly one active applicable canonical mapping per context;
- zero ambiguous mappings;
- zero inactive references;
- zero scope mismatches.

## 7. Administrator activation preparation

For each of the 11 approved submissions:

1. Open Budget Activation.
2. Run Prepare/Refresh Validation.
3. Resolve every invalid line in Master Data.
4. Re-run validation.
5. Confirm:
   - approved line count = mapped line count;
   - unmapped count = 0;
   - validation error count = 0;
   - approved total = activation total;
   - variance = **K0.00**;
   - no existing active allocation exists for a source line.
6. Submit for activation.
7. Confirm status becomes `READY_FOR_ACTIVATION` and validation fingerprint is non-null.

The Administrator must not activate the budget.

## 8. Registrar authorisation

For each `READY_FOR_ACTIVATION` batch, Registrar reviews read-only evidence:

- approved submission and approval timestamp;
- technical preparer and preparation timestamp;
- line counts and totals;
- K0.00 variance;
- mapping status;
- fingerprint state;
- no duplicate active allocation;
- no stale validation.

Only then use **Activate Approved Budget**.

Expected transactional result:

- one operational `budget_allocations` row per approved source line;
- one immutable activation snapshot per created allocation;
- batch becomes `ACTIVATED`;
- activated total equals approved total;
- variance remains K0.00;
- FF3 can see the active operational budget position.

If any source line fails, the entire activation transaction must roll back.

## 9. Post-activation checks

For each activated batch verify:

1. allocation count = approved source-line count;
2. snapshot count = allocation count;
3. source IDs match exactly;
4. aggregate `original_budget` = approved total;
5. no duplicate active `EXCEL_BUDGET` allocation by source line;
6. Finance/Posting/CoA/Cost Centre IDs match immutable snapshots;
7. FF3 budget availability resolves through active `budget_allocations`;
8. Task 8 revision workspace sees the activated baseline and preserves allocation IDs.

## 10. Failure / rollback policy

### Before any migration commits

Do not proceed without the recovery point in Gate C.

### If one migration fails

Each migration is transaction-scoped. Stop immediately. Do not skip the failed migration and do not continue to a later number.

### If an early migration committed but a later migration fails

Prefer a reviewed **forward fix** over destructive manual rollback because 056 changes secured workflow functions as well as adding tables/permissions. Keep Budget Activation unavailable to users until the sequence is completed.

If a critical production regression cannot be forward-fixed safely, restore through the confirmed Supabase backup/PITR procedure rather than deleting Task 9 tables or manually reconstructing old functions from memory.

### If activation fails

Do not manually insert or patch allocations. The activation RPC is atomic; correct the validation/master-data defect, re-prepare, re-submit and retry through Registrar authority.

## 11. Merge policy

PR #20 remains draft until:

- corrected head is CI green;
- database preflight remains clean;
- production schema deployment is explicitly authorised and completed;
- immediate post-deployment checks pass;
- controlled UAT confirms dual control and no premature spendability.

Do not merge merely because GitHub reports the PR as mergeable.
