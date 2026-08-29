# Task 13 — NJSS National UAT Cloud Dry-Run Evidence

**Date:** 2026-08-29  
**Dataset:** `NJSS-NATIONAL-UAT-2026-V1`  
**Run ID:** `UAT-2026-V1-20260829`  
**Supabase project:** `qzsmmalfeinoagvronpb` (`NJSS System`)  
**Execution mode:** Supabase cloud privileged migration, rollback-only rehearsal

## Recovery gate

The rehearsal used the verified completed Full ZIP Backup:

- Backup ID: `NJSS-FULL-20260829_065943Z-a39e1c44`
- Size: 636,440 bytes
- SHA-256: `e97044dcebc6d801e874f1c65797779e94899a3aee668d6df577054c98c79226`
- Table count at backup: 94
- Record count at backup: 6,483

Migration `066_national_uat_location_seed_registry.sql` was applied only after this backup gate passed.

## Dry-run execution

The final rehearsal was applied to Supabase as migration history entry:

- Version: `20260829074717`
- Name: `national_uat_cloud_dry_run_rehearsal`

The rehearsal performed the entire 73-table rebuild purge inside a PL/pgSQL exception subtransaction and intentionally rolled the subtransaction back before persisting the Task 13 evidence row.

The rehearsal discovered and resolved three live-schema constraints without weakening them:

1. **Scoped-role Section guard** — active Requisition Officers and Line Supervisors cannot be left without a Section. The scoped-user trigger is suspended only inside the reset transaction and must be restored before commit; a committed reset is now refused unless retained users are atomically remapped.
2. **Expense registry/ledger cycle** — only `expense_ledger.expense_code_registry_id` is detached. The reverse pointer is retained so the legacy expense-code generation trigger is not forced to recompute duplicate `NJSS-GEN-GEN-GEN` codes.
3. **Finance ledger hierarchy** — `expense_ledger` is purged leaf-first so parent Finance Codes are never deleted while child accounts remain. The existing parent/child delete guard remains enabled.

Approved-budget and budget-revision immutability controls were traversed using the database's existing transaction-local maintenance contexts, `njss.budget_workflow=on` and `njss.budget_revision_workflow=on`. Both contexts were verified to roll back and not leak outside the rehearsal transaction.

## Independent post-rehearsal verification

Read-only verification after the successful rehearsal established:

- 73 rebuildable tables compared against their pre-rehearsal counts
- 0 count mismatches
- 19 protected tables checked against the captured protected manifest
- 0 protected-manifest mismatches
- Users: 10 total / 7 active / 3 archived
- Roles: 28
- User-role assignments: 8
- Permissions: 107
- Role-permission assignments: 371
- `trg_users_keep_section_for_scoped_group`: enabled before and after (`O`)
- `uat_seed_entities`: 0
- `court_locations`: 0
- Task 13 evidence: `rollbackVerified=true`
- Task 13 evidence: `businessDataCommitted=false`
- All 73 rebuildable tables reached zero inside the rehearsal subtransaction before rollback

The live NJSS UAT business data therefore remained unchanged after the rehearsal.

## Safety conclusion

Task 13 is PASSED. The cloud-only rollback rehearsal demonstrated that the guarded purge can reach a clean reset state and fully restore the pre-rehearsal database through rollback while preserving protected identity, RBAC, configuration, reporting and security data.

No Task 14 destructive reset/reseed is authorised by this evidence. Task 14 requires a separate explicit approval and a fresh execution gate.
