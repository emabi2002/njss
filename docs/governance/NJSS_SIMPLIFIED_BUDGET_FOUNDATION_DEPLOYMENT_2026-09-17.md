# NJSS Simplified Head Office Budget Foundation — Production Deployment Evidence

**Deployment date:** 17 September 2026 (PNG local date)  
**Repository:** `emabi2002/njss`  
**Production Supabase project:** `qzsmmalfeinoagvronpb`  
**Merged implementation PR:** #37 — Simplified Head Office annual budget foundation  
**Production merge SHA:** `149b28759916d5cdf2185ecd37a176c04c1c3f34`

## 1. Scope deployed

This deployment introduces the approved Phase 1 simplified Head Office annual-budget foundation while preserving the existing NJSS FF3, FF4, commitment, payment, revision, reporting and legacy budget-control backend.

The deployed model is:

`Financial Year -> Division -> Section -> Standard Ledger -> Approved Amount`

The controlled lifecycle is:

`PREPARATION -> READY_FOR_ACTIVATION -> ACTIVE -> CLOSED`

Division budgets use `DRAFT -> LOCKED`, and locked original amounts are immutable.

## 2. Source migrations and live migration ledger

Repository source migrations:

1. `supabase/migrations/20260917010000_simplified_head_office_budget_foundation.sql`
2. `supabase/migrations/20260917011000_budget_document_evidence_hardening.sql`

Production Supabase recorded these as:

1. `20260916204944 simplified_head_office_budget_foundation`
2. `20260916204958 budget_document_evidence_hardening`

The difference between repository and live dates is the timestamp timezone boundary: source filenames use the PNG local date while the Supabase migration ledger recorded UTC.

## 3. Repository and CI evidence

PR #37 was merged through protected `main`; branch governance was not bypassed.

Merged `main` SHA: `149b28759916d5cdf2185ecd37a176c04c1c3f34`.

GitHub Actions CI run #527 completed successfully on that exact merge SHA. The successful gate covered:

- RBAC and access-control regression checks
- backup and master-data regression checks
- simplified budget schema contract
- simplified budget client contract
- private budget document storage contract
- simplified annual-budget capture UI contract
- Division lock and official-document controls
- simplified annual-budget activation contract
- preservation of the legacy financial-control backend
- repository and migration governance checks
- critical SECURITY DEFINER RPC lockdown checks
- RLS/legacy-policy lockdown checks
- PostgreSQL runtime checks
- client table privilege checks
- lint
- TypeScript typecheck
- production build

## 4. Pre-deployment production baseline

Immediately before migration, the legacy production counts were captured as follows:

| Table | Rows before deployment |
| --- | ---: |
| `budget_allocations` | 437 |
| `budget_revision_lines` | 30 |
| `budget_revisions` | 8 |
| `divisional_budget_lines` | 467 |
| `divisional_budget_submissions` | 213 |
| `ff3_commitments` | 20 |
| `ff3_headers` | 32 |
| `ff3_items` | 32 |
| `ff4_headers` | 16 |

Preflight also verified 15 active Head Office Divisions associated with active `HEADQUARTERS` court-location configuration.

No annual budget cycle or business budget record was created as part of the schema deployment.

## 5. Post-deployment structural verification

Production verification confirmed that all four new public tables exist:

- `annual_budget_cycles`
- `division_budgets`
- `division_budget_lines`
- `budget_documents`

At deployment completion each contained zero business rows. This is intentional: migrations establish the controlled framework but do not fabricate an annual budget cycle or populate business amounts.

The private Storage bucket `njss-budget-documents` exists and is confirmed non-public.

## 6. Post-deployment legacy-data preservation

Immediately after both migrations, the same legacy row-count check returned:

| Table | Rows after deployment |
| --- | ---: |
| `budget_allocations` | 437 |
| `budget_revision_lines` | 30 |
| `budget_revisions` | 8 |
| `divisional_budget_lines` | 467 |
| `divisional_budget_submissions` | 213 |
| `ff3_commitments` | 20 |
| `ff3_headers` | 32 |
| `ff3_items` | 32 |
| `ff4_headers` | 16 |

All protected legacy counts are unchanged from the pre-deployment baseline. No legacy financial transaction rows were deleted or rewritten by this deployment.

## 7. Security and privilege verification

The four new public tables have RLS enabled. Production privilege checks confirmed that `authenticated` users have SELECT only at the table level and do not have direct INSERT, UPDATE or DELETE privileges on these tables.

Authenticated writes therefore pass through the intended secured RPC layer rather than direct table mutation.

The new application RPCs are SECURITY DEFINER by design, require an authenticated user, call NJSS permission checks, pin `search_path = public, auth`, deny anonymous execution, and intentionally allow authenticated execution only as controlled API entry points:

- `create_or_get_head_office_budget_cycle`
- `create_or_get_division_budget`
- `update_division_budget_draft_header`
- `upsert_division_budget_line`
- `register_budget_document`
- `lock_division_budget`
- `activate_annual_budget`

The final hardening deployment additionally verified the live `register_budget_document` definition contains all of the following controls:

- verifies that the binary object exists in `storage.objects`
- requires bucket `njss-budget-documents`
- verifies the exact supplied storage path
- validates superseded-document lineage
- requires matching document type and related-entity type for version lineage

This prevents metadata-only records from satisfying controlled documentary-evidence requirements.

## 8. Storage policy verification

The budget-document bucket has only the intended authenticated policies for this feature:

- authenticated SELECT where the NJSS budget permission check allows it
- authenticated INSERT where `budget.documents.manage` (or full access) allows it

No authenticated UPDATE or DELETE policy was introduced for this controlled bucket. Corrections are stored as additional controlled document versions.

## 9. Budget Officer role

Production verification confirmed `Budget Officer` is active and marked as a business role. The deployment added/enabled the new simplified-budget permissions:

- `budget.capture`
- `budget.lock`
- `budget.activate`
- `budget.documents.manage`

The role also retains other permissions already present in the production NJSS environment; this deployment did not strip unrelated existing role permissions.

## 10. Supabase security-advisor status

The post-deployment security advisor found no new RLS-without-policy finding for the four new tables and did not flag the new budget RPCs for mutable search paths.

The advisor does list the seven new SECURITY DEFINER RPCs under the generic `authenticated_security_definer_function_executable` warning. This exposure is intentional for these seven application entry points and is paired with authentication, permission gates, fixed search paths and anonymous EXECUTE revocation as described above.

Pre-existing security-advisor findings remain outside this Phase 1 budget deployment, including:

- 10 legacy `security_definer_view` ERROR findings
- 47 legacy mutable-function-search-path WARN findings
- 4 existing RLS-enabled/no-policy INFO findings on backup/UAT support tables
- leaked-password protection disabled in Supabase Auth

Those items require separate security closure work and are not represented here as resolved.

## 11. Deployment boundary and deferred work

This deployment completes the approved **Phase 1 simplified annual-budget foundation, capture, document-control, Division-lock and annual-activation scope**.

It does not claim completion of later redesign phases. Deferred work includes, among other items:

- supplementary budget processing against the new active annual position
- Registrar-controlled reallocations against the new active annual position
- migration/adaptation of FF3 budget-availability checks to the new simplified active-budget position
- any later reconciliation/retirement of legacy budget-capture paths after controlled UAT and migration decisions

The existing legacy backend remains available to avoid breaking current FF3/FF4, commitment, payment, revision and reporting workflows during transition.

## 12. Recovery position

The deployed schema change is additive and no legacy business rows were changed by the deployment. The legacy pre/post counts above form the immediate preservation baseline.

If rollback is ever required, do not drop the new schema objects casually. First take and verify a production backup and determine whether any real annual-budget rows or documents have since been created in the new tables or bucket. Any rollback after business use must preserve those records and documentary evidence.

## 13. Deployment result

Phase 1 production deployment status: **SUCCESSFULLY APPLIED AND VERIFIED**.

Evidence includes protected-main merge, green main CI, successful Supabase migration ledger entries, private-storage verification, RLS/table-privilege checks, secured RPC checks, live hardening-function inspection, zero fabricated new business rows, and exact preservation of the sampled legacy production row counts.
