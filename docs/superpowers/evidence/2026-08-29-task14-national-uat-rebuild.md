# Task 14 — National UAT Rebuild Evidence

**Dataset:** `NJSS-NATIONAL-UAT-2026-V1`  
**Run:** `UAT-2026-V1-20260829`  
**Live run status:** `COMPLETED`  
**Completed:** 2026-08-29 13:24:41 UTC  
**Recovery backup:** `NJSS-FULL-20260829_065943Z-a39e1c44`

## Completion result

Task 14 completed the guarded National UAT rebuild in the live Supabase project after the verified Task 13 rehearsal. The final run passed all post-load validation, preserved the protected security/configuration manifest, completed the representative FF3/FF4/revision workflows, exported cloud evidence, and removed temporary Task 14 staging/helper objects.

## Authoritative national dataset

- 22 Provinces
- 28 Court Locations
- 204 Departments
- 456 Sections
- 204 Cost Centres
- 204 Budget Divisions
- 42 synthetic posting Finance Codes
- 437 canonical FY2026 finance/posting contexts
- 204 original FY2026 budget submissions
- 437 original budget lines
- 5,244 original monthly allocations
- 204 activated budget batches
- 437 active operational `EXCEL_BUDGET` allocations
- Annual/monthly/submission/activated total: **K30,469,400.00**

Revision workflows increase the raw live totals to 212 budget submissions, 467 budget lines and 5,604 monthly allocation rows. The original-budget controls remain 204 / 437 / 5,244 and reconcile exactly.

## Transaction coverage

- 5 UAT funding sources
- 18 fictitious UAT suppliers
- 5 approved funding authorities
- 5 approved funding receipts
- 32 approved funding allocations
- 32 quarterly releases totalling **K1,606,200.00**
- 32 FF3 scenarios: 20 COMMITTED / 4 SUBMITTED / 4 RETURNED / 4 REJECTED
- 20 live commitments
- 16 FF4 scenarios: 4 SUBMITTED / 4 APPROVED / 4 PAID / 4 RECONCILED
- 8 posted payment transactions totalling **K56,460.00**
- 8 post-activation budget revisions: 4 SUPPLEMENTARY / 4 REFORECAST

## Validation result

- Positive controls: **15 / 15 passed**
- Negative controls: **27 / 27 passed**
- Protected manifest: **MATCH**
- Finance-context duplicates: 0
- Organisation orphan/cross-context errors: 0
- Monthly/annual variance: 0
- Submission/line variance: 0
- Activation variance: 0
- Funding-limit errors: 0
- Negative spending positions: 0
- Transaction-reference errors: 0
- Active `EXCEL_BUDGET` lineage orphans: 0
- Retained active-user remaps: 7 / 7 correct

Protected-table rules remained intact: immutable user/RBAC/menu/report/settings data matched the pre-reset digest, append-only audit history did not shrink, and backup registry/change-log tables were allowed to grow.

## Backup evidence

- Type: FULL
- Status: COMPLETED
- File: `NJSS_FULL_20260829_065943Z.zip`
- Size: 636,440 bytes
- Tables: 94
- Records: 6,483
- SHA-256: `e97044dcebc6d801e874f1c65797779e94899a3aee668d6df577054c98c79226`

## Source/runtime defects corrected during Task 14

The branch was hardened from failures reproduced during the live rebuild:

1. committed reset now runs the retained-user/national-organisation callback atomically before COMMIT;
2. budget monthly seeding updates the 12 trigger-created rows instead of inserting duplicates;
3. UAT funding source types are translated to valid funding-authority types;
4. FF3 seeding no longer writes generated `total_amount` and quotation selection occurs only after the quotation row exists;
5. runtime workflow hardening makes funding release UUID selection PostgreSQL-safe, clones revision months into trigger-created rows, and establishes budget-workflow maintenance context before approval validation;
6. FF4 seeding no longer writes generated `net_amount`.

The final production-fix commit before this evidence note was `76cf90e79b093dca0620763ab7738f8fb2c1dcd3`, verified by CI run #320 with regression checks, orchestrator contract, lint, TypeScript and production build all passing.

## Final cleanup

The following one-off Task 14 objects were removed after all validation and export assertions passed:

- `public.uat_task14_txn_plan_staging`
- `public.uat_task14_funding_runtime_staging`
- `public.njss_uat_deterministic_uuid(text)`

The persistent UAT run/provenance/audit evidence remains available for traceability.

## Classification note

`OFFICIAL` provenance denotes source-supported public catalogue facts. `DERIVED` and `UAT` records are controlled test structures. Synthetic financial codes, suppliers, transaction values and UAT budgets are test data and are **not** official IFMS codes or Judiciary appropriations.
