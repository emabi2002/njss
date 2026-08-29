# Task 15 — Functional UAT Technical Readiness Evidence

**Baseline dataset:** `NJSS-NATIONAL-UAT-2026-V1`  
**Baseline run:** `UAT-2026-V1-20260829`  
**Task 14 live status:** `COMPLETED`  
**Readiness mode:** non-destructive application/RBAC verification  
**Result:** `TECHNICAL READINESS PASSED`

## Scope

Task 15 validates that the completed Task 14 national UAT dataset is safe and technically ready to be exercised through the NJSS application by the retained functional roles. This phase does not create a second transaction dataset and does not represent final human UAT acceptance or business sign-off.

The readiness pass covered:

- fail-closed dashboard route authorization;
- database-backed RBAC readiness before route decisions;
- role/action permission wiring for FF3 and FF4;
- `SECTION_WIDE` record visibility for Requisition Officer and Line Supervisor;
- System Operations menu/route/API permission coherence;
- live role and data-scope configuration;
- live RLS policies for FF3, FF4, budget and funding records;
- preservation of the completed Task 14 dataset;
- full repository regression, lint, TypeScript and production-build validation.

## Defects reproduced and corrected

### 1. Direct dashboard URLs were not enforced at the segment boundary

Menus were permission-filtered, but an authenticated user could manually enter a dashboard URL without the dashboard layout applying `canAccessRoute()`.

Correction:

- added `app/dashboard/template.tsx` as a fail-closed route-authorization boundary;
- unauthorized direct dashboard routes redirect to `/dashboard/no-access` without rendering restricted page content;
- `/dashboard/no-access` is explicitly reachable by authenticated users to prevent a redirect loop.

### 2. RBAC route enforcement could race permission loading

The authenticated session could become available before the database-backed profile, permissions and scopes had finished resolving. Immediate route enforcement could therefore deny a legitimate user against a temporary empty permission set.

Correction:

- `AuthContext` now exposes `accessReady`;
- route authorization waits for the effective RBAC context to finish resolving;
- refresh/sign-in/sign-out transitions explicitly maintain the readiness state;
- a failed profile resolution remains fail-closed with an empty effective permission set.

### 3. `SECTION_WIDE` was omitted from one client record-scope evaluator

The live Requisition Officer and Line Supervisor roles are `SECTION_WIDE`, and the canonical database/server rule permits records whose `section_id` matches the user section. `canAccessRecord()` omitted that scope and fell through to `OWN_RECORDS`.

Correction:

- `canAccessRecord()` now handles `SECTION_WIDE` explicitly using `record.section_id === context.sectionId`;
- this now matches both `isRecordInScope()` and the live `fn_current_user_data_scope_allows()` database function.

### 4. System Operations menu, route and API authorization were inconsistent

Ordinary `dashboard.view` was accepted by the broad `/dashboard/admin/operations/...` route and operations APIs, even though most System Operations menus require operations/settings permissions. At the same time, the live Transaction Monitor menu intentionally permits `audit.view` users.

Correction:

- added an explicit `/dashboard/admin/operations/transactions` rule accepting `audit.view` plus operations/settings permissions;
- removed ordinary `dashboard.view` from the broad System Operations route;
- the nested System Operations layout now enforces the same distinction before rendering its children;
- the shared server API authorization strips `dashboard.view` from `/api/operations/...` permission checks;
- existing database backup controls remain independently restricted to `operations.manage`, `settings.manage` or `all`.

## Automated regression evidence

Three dedicated National UAT readiness tests now protect the application contracts:

- `scripts/national-uat/application-uat-readiness.test.mjs`
- `scripts/national-uat/application-data-scope.test.mjs`
- `scripts/national-uat/operations-route-coherence.test.mjs`

Each defect was first represented by a failing regression before the corresponding production change was made.

Key red/green evidence:

- direct-route authorization regression: RED in CI #322; corrected path subsequently green;
- `SECTION_WIDE` regression: RED in CI #328; green in CI #329;
- System Operations authorization regression: RED in CI #330;
- consolidated production state at commit `fb14162b23a649a46365e8deab453ffee0fd2285`: CI #336 **PASSED**.

CI #336 passed:

- RBAC regression checks;
- admin/runtime fallback checks;
- user CRUD routing checks;
- backup/master/budget regression suites;
- National UAT regression checks;
- National UAT orchestrator contract checks;
- ESLint;
- TypeScript validation;
- production Next.js build.

## Live role/readiness matrix

The retained active actors remain aligned to the intended UAT duties:

| Role | Data scope | Principal verified actions |
| --- | --- | --- |
| Requisition Officer | `SECTION_WIDE` | FF3 create/submit/view; budget/report visibility |
| Line Supervisor | `SECTION_WIDE` | FF3 endorse/reject/view; budget preparation/revision/report visibility |
| Registrar | `SYSTEM_WIDE` | FF3 approve/reject/view; budget/revision authorization; audit/report visibility |
| Payment/Reconciliation Officer | `SYSTEM_WIDE` | FF4 create/submit/verify/process/reconcile; FF3/budget/report visibility |
| System Administrator | `SYSTEM_WIDE` | `all`, including FF4 approval and system administration |

The live menu evaluation also confirms that operational roles receive only menus for permissions they hold. In particular, the Requisition Officer receives New FF3, the Payment/Reconciliation Officer receives New FF4, and System Administrator receives the full administrative/support menu set.

## Database/RLS verification

Live RLS policies remain active and consistent with the application model:

- `ff3_headers` SELECT requires an applicable FF3/report permission **and** `fn_current_user_data_scope_allows(...)`;
- `ff4_headers` SELECT requires an applicable FF4/report permission **and** `fn_current_user_data_scope_allows(...)`;
- direct FF4 INSERT/UPDATE/DELETE remains denied, preserving controlled workflow/RPC transitions;
- `budget_allocations` and `funding_allocations` SELECT policies also enforce data scope;
- `fn_current_user_data_scope_allows()` explicitly implements `SECTION_WIDE` by matching the record section to the retained user section;
- `SYSTEM_WIDE` roles remain unrestricted by organisational scope subject to their functional permissions.

## Task 14 baseline preservation

The final post-readiness live check confirmed that Task 15 did not alter the national UAT business dataset:

- Task 14 run status: `COMPLETED`
- 22 Provinces
- 28 Court Locations
- 204 Departments
- 456 Sections
- 437 active FY2026 operational budget allocations
- 32 UAT FF3 records
- 20 active commitments
- 16 UAT FF4 records
- 8 budget revisions
- 8 UAT payment transactions totalling **K56,460.00**
- 10 retained users / 7 active users / 8 user-role assignments

The FF3/FF4 scenario distributions remain unchanged from the completed Task 14 evidence.

## Readiness conclusion

The national UAT dataset and application authorization layer are technically ready for controlled user-facing UAT. The automated/read-only readiness gate is **PASSED**.

This evidence is not a substitute for human UAT acceptance. The next controlled activity is role-based user execution in the deployed NJSS application using the retained UAT actors, recording pass/fail evidence for navigation, FF3, budget/revision, FF4/payment/reconciliation and reporting journeys without rebuilding or reseeding the Task 14 baseline.