# NJSS National UAT Data Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild NJSS into a deterministic, nationally representative UAT dataset covering 22 jurisdictions and 28 Court Locations while preserving all retained user identities, authentication links, RBAC/security configuration and rollback capability.

**Architecture:** Add a normalized `court_locations` master beneath `provinces`, plus a small UAT seed-run registry that tracks provenance without adding seed metadata columns to every business table. Implement deterministic catalogue generators and guarded database scripts that preflight, back up, purge rebuildable data in foreign-key order, reload organisational and financial masters, remap retained users, create budgets and representative transactions through existing workflow controls wherever practical, then run positive/negative reconciliation checks before producing the final Word report.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, TypeScript 5, Bun, Supabase/PostgreSQL 17, `pg` 8.20.0, existing NJSS workflow/RBAC/backup functions, Node built-in `crypto`/`assert`.

**Spec:** `docs/superpowers/specs/2026-08-29-njss-national-uat-data-rebuild-design.md`

## Global Constraints

- Target database is exactly Supabase project `qzsmmalfeinoagvronpb` (`NJSS System`).
- Do not create a paid Supabase branch.
- Preserve all 10 `users`; preserve 7 active/3 archived states, authentication links and role assignments.
- Preserve `roles`, `user_roles`, `permissions`, `role_permissions`, RBAC scope definitions, menus/modules, workflow definitions, report definitions and system settings.
- Dataset identifier is `NJSS-NATIONAL-UAT-2026-V1`; run identifier is date-stamped `UAT-2026-V1-YYYYMMDD` at execution.
- Use 22 jurisdictions and 28 Court Locations from the approved catalogue.
- Business hierarchy is `Province -> Court Location -> Department/Division -> Section -> Cost Centre`.
- Human-readable business code convention is `[Province]-[Location]-[Function]-[Section]`; Cost Centre convention is `CC-[Province]-[Location]-[Function]-[Section]`.
- Parent economic classes are PNG-government-aligned only where source-supported; all NJSS subcodes and monetary values are explicitly UAT/synthetic.
- Never fabricate official IFMS codes or describe synthetic values as actual Judiciary appropriations.
- Never use a fallback Chart of Accounts mapping; every activated line must resolve through one explicit active `finance_posting_mappings` context.
- Approval is not activation. System Administrator prepares activation; Registrar authorises final activation; actors must differ.
- Do not globally disable foreign keys, RLS or audit controls to make seeding easier.
- Do not blanket-truncate `audit_logs`; preserve historic security/system evidence. Old business-test audit rows may only be removed when they are safely attributable to the rebuildable dataset. Otherwise create a documented reset-boundary event and retain the history.
- No destructive reset until fresh backup, protected-record manifest, dry-run purge and replacement-seed validation all pass.
- Application-code work must comply with `AGENTS.md`; before changing Next.js application files, read the relevant installed Next.js 16 guide under `node_modules/next/dist/docs/`.

---

## File Structure

New focused files:

- `supabase/migrations/066_national_uat_location_seed_registry.sql` — `court_locations`, UAT seed registry/membership tables, location FK on departments, RLS, validation constraints and indexes.
- `scripts/national-uat/constants.ts` — dataset version, expected project ref and run-time constants.
- `scripts/national-uat/deterministic-id.ts` — deterministic UUID generator.
- `scripts/national-uat/catalog/organisation.ts` — 22 jurisdictions, 28 locations, Waigani and provincial function/section templates.
- `scripts/national-uat/catalog/finance.ts` — source-labelled parent economic classes, UAT finance codes and applicability rules.
- `scripts/national-uat/catalog/scenarios.ts` — budget tiers, funding, suppliers and representative workflow scenarios.
- `scripts/national-uat/db.ts` — guarded pooler connection helper and actor-context utility.
- `scripts/national-uat/preflight.ts` — target guard, protected manifests, dependency/count checks and dry-run readiness.
- `scripts/national-uat/reset.ts` — backup gate, transaction-scoped purge and old organisation detachment.
- `scripts/national-uat/seed-master.ts` — provinces, locations, departments, sections, cost centres, budget divisions and user remap.
- `scripts/national-uat/seed-finance.ts` — reference masters, CoA, ledger, posting codes and canonical mappings.
- `scripts/national-uat/seed-budgets.ts` — FY2026 budget generation, monthly profiles, workflow submission/approval and activation.
- `scripts/national-uat/seed-transactions.ts` — suppliers, funding, FF3/commitment/FF4/revision scenarios.
- `scripts/national-uat/validate.ts` — positive reconciliation and rollback-only negative validations.
- `scripts/national-uat/export-report-data.ts` — final JSON/CSV evidence package for Word reporting.
- `scripts/national-uat/run.ts` — orchestrator with explicit phase gates; destructive phase requires `--execute-reset`.
- `scripts/national-uat/*.test.mjs` — static/unit regression tests for catalogue, schema, reset guard, finance mapping and reconciliation formulas.
- `app/dashboard/master/page.tsx` and/or a focused `app/dashboard/master/court-locations/page.tsx` — maintain Court Location master through the application if the existing master page cannot cleanly accommodate it.
- `.github/workflows/ci.yml` — add national-UAT static regression checks.

Existing workflow controls reused rather than replaced:

- `public.njss_prepare_budget_activation(...)`
- `public.njss_submit_budget_activation(...)`
- final Registrar activation RPC implemented by migrations 056–063
- `public.njss_transition_ff3(p_ff3_id, p_action, p_comments, p_user_email)`
- existing FF4, supplier and budget-revision RPCs in the current workflow modules.

---

### Task 1: Add Deterministic Catalogue Foundations

**Files:**
- Create: `scripts/national-uat/constants.ts`
- Create: `scripts/national-uat/deterministic-id.ts`
- Create: `scripts/national-uat/catalog/organisation.ts`
- Test: `scripts/national-uat/catalog.test.mjs`

**Interfaces:**
- Produces: `DATASET_VERSION`, `EXPECTED_PROJECT_REF`, `runIdFor(date)`, `deterministicUuid(key)`, `PROVINCES`, `COURT_LOCATIONS`, `WAIGANI_FUNCTIONS`, `PROVINCIAL_TEMPLATE`, `SUBREGISTRY_TEMPLATE`.
- Consumed by every later seed task.

- [ ] **Step 1: Write the failing catalogue test**

```js
import assert from 'node:assert/strict'
import { PROVINCES, COURT_LOCATIONS } from './catalog/organisation.ts'
import { deterministicUuid } from './deterministic-id.ts'

assert.equal(PROVINCES.length, 22)
assert.equal(COURT_LOCATIONS.length, 28)
assert.equal(new Set(PROVINCES.map(x => x.code)).size, 22)
assert.equal(new Set(COURT_LOCATIONS.map(x => x.code)).size, 28)
assert.equal(COURT_LOCATIONS.filter(x => x.locationType === 'NATIONAL_COURT_SUB_REGISTRY').length, 3)
assert.equal(deterministicUuid('province:NCD'), deterministicUuid('province:NCD'))
assert.notEqual(deterministicUuid('province:NCD'), deterministicUuid('province:MOR'))
for (const location of COURT_LOCATIONS) {
  assert.ok(PROVINCES.some(p => p.code === location.provinceCode), `unknown province ${location.provinceCode}`)
}
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node scripts/national-uat/catalog.test.mjs`

Expected: FAIL because catalogue modules do not exist.

- [ ] **Step 3: Implement deterministic UUID generation without adding a dependency**

Use `node:crypto` SHA-1 and set RFC-4122 version/variant bits:

```ts
import { createHash } from 'node:crypto'

export function deterministicUuid(key: string): string {
  const bytes = Buffer.from(createHash('sha1').update(`NJSS-NATIONAL-UAT-2026-V1:${key}`).digest().subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
```

Define all 22 approved jurisdictions and 28 approved locations exactly as the specification, with provenance `OFFICIAL` for province/location records.

- [ ] **Step 4: Run the test and verify pass**

Run: `node scripts/national-uat/catalog.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/national-uat/constants.ts scripts/national-uat/deterministic-id.ts scripts/national-uat/catalog/organisation.ts scripts/national-uat/catalog.test.mjs
git commit -m "testdata: define national UAT organisation catalogue"
```

---

### Task 2: Add Court Location and Seed-Run Schema

**Files:**
- Create: `supabase/migrations/066_national_uat_location_seed_registry.sql`
- Test: `scripts/national-uat/schema.test.mjs`

**Interfaces:**
- Produces tables `court_locations`, `uat_seed_runs`, `uat_seed_entities` and `departments.court_location_id`.
- Existing `sections` remain children of `departments`; `cost_centres` remain children of Department/Section, avoiding redundant location FKs.

- [ ] **Step 1: Write static migration assertions**

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'
const sql = fs.readFileSync('supabase/migrations/066_national_uat_location_seed_registry.sql', 'utf8')
for (const token of [
  'CREATE TABLE IF NOT EXISTS public.court_locations',
  'province_id uuid NOT NULL',
  "HEADQUARTERS",
  "NATIONAL_COURT_REGISTRY",
  "NATIONAL_COURT_SUB_REGISTRY",
  'ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS court_location_id',
  'CREATE TABLE IF NOT EXISTS public.uat_seed_runs',
  'CREATE TABLE IF NOT EXISTS public.uat_seed_entities',
  'ENABLE ROW LEVEL SECURITY',
  'service_role',
]) assert.ok(sql.includes(token), `missing ${token}`)
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/national-uat/schema.test.mjs`

Expected: FAIL because migration is absent.

- [ ] **Step 3: Implement migration 066**

Required constraints:

```sql
CREATE TABLE IF NOT EXISTS public.court_locations (
  id uuid PRIMARY KEY,
  province_id uuid NOT NULL REFERENCES public.provinces(id) ON DELETE RESTRICT,
  code varchar NOT NULL UNIQUE,
  name varchar NOT NULL,
  location_type varchar NOT NULL CHECK (location_type IN ('HEADQUARTERS','NATIONAL_COURT_REGISTRY','NATIONAL_COURT_SUB_REGISTRY')),
  town varchar NULL,
  is_headquarters boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS court_location_id uuid NULL
  REFERENCES public.court_locations(id) ON DELETE RESTRICT;
```

Create `uat_seed_runs` with `dataset_version`, `run_id`, status, started/completed timestamps, backup identifier, pre/post counts and validation result JSON. Create `uat_seed_entities` keyed by `(run_id, table_name, entity_id)` with provenance `OFFICIAL|DERIVED|UAT`.

RLS: revoke public/anon direct writes; permit authenticated read only where existing master-data read pattern requires it; `service_role` owns seed registry writes.

Do not set `departments.court_location_id NOT NULL` in migration 066 because existing rows must survive until the controlled reset. Enforce non-null for active rebuilt Departments in the seeding/validation layer first; a later hardening migration may make it NOT NULL after UAT acceptance.

- [ ] **Step 4: Run static test and existing migration regressions**

Run:

```bash
node scripts/national-uat/schema.test.mjs
node scripts/budget-activation-control.test.mjs
node scripts/master-data-cleanup.test.mjs
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/066_national_uat_location_seed_registry.sql scripts/national-uat/schema.test.mjs
git commit -m "feat: add court location and UAT seed registry schema"
```

---

### Task 3: Build Guarded Database and Actor Utilities

**Files:**
- Create: `scripts/national-uat/db.ts`
- Create: `scripts/national-uat/db-guard.test.mjs`

**Interfaces:**
- Produces `connectNjss()`, `assertExpectedProject()`, `withTransaction(fn)`, `setActorContext(client, userId)`.
- All destructive/seed scripts must use these functions; no ad-hoc `pg.Client` creation elsewhere.

- [ ] **Step 1: Write project-guard test**

```js
import assert from 'node:assert/strict'
import { projectRefFromUrl, assertProjectRef } from './db.ts'
assert.equal(projectRefFromUrl('https://qzsmmalfeinoagvronpb.supabase.co'), 'qzsmmalfeinoagvronpb')
assert.throws(() => assertProjectRef('wrong-project'), /Refusing NJSS National UAT operation/)
assert.doesNotThrow(() => assertProjectRef('qzsmmalfeinoagvronpb'))
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/national-uat/db-guard.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement guarded pooler connection**

Reuse the proven pooler pattern from `scripts/apply-sql.ts`, but fail closed unless the derived project ref equals `EXPECTED_PROJECT_REF`.

Actor context must resolve `users.auth_user_id`, then set transaction-local JWT claim before invoking workflow functions:

```ts
export async function setActorContext(client: Client, userId: string) {
  const { rows } = await client.query('select auth_user_id, email from public.users where id = $1', [userId])
  if (rows.length !== 1 || !rows[0].auth_user_id) throw new Error(`Cannot impersonate user ${userId}`)
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [rows[0].auth_user_id])
  await client.query(`select set_config('request.jwt.claim.email', $1, true)`, [rows[0].email])
}
```

Before relying on this for workflow seeding, Task 8 must prove `auth.uid()` equals the chosen actor within the transaction.

- [ ] **Step 4: Run test**

Run: `node scripts/national-uat/db-guard.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/national-uat/db.ts scripts/national-uat/db-guard.test.mjs
git commit -m "feat: add guarded NJSS UAT database utilities"
```

---

### Task 4: Build Financial and Scenario Catalogues

**Files:**
- Create: `scripts/national-uat/catalog/finance.ts`
- Create: `scripts/national-uat/catalog/scenarios.ts`
- Create: `scripts/national-uat/finance-catalog.test.mjs`

**Interfaces:**
- Produces `ECONOMIC_CLASSES`, `FINANCE_CODES`, `BUDGET_TIERS`, `MONTHLY_PROFILES`, `FUNDING_SOURCES`, `SUPPLIER_SCENARIOS`, `TRANSACTION_SCENARIOS`.

- [ ] **Step 1: Write catalogue integrity tests**

Test that parent codes are unique; every UAT Finance Code references an existing parent; every Finance Code is marked `provenance: 'UAT'`; each location receives one tier; only Waigani/approved representative centres receive detailed transaction scenarios; synthetic suppliers include `— UAT` or `UAT` in the legal/display name.

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/national-uat/finance-catalog.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement the approved finance catalogue**

Include the approved parent economic families and at least the Finance Codes explicitly listed in the specification, e.g. `221-01`, `223-01`, `224-01`, `225-01`, `227-01`, `227-02`, `228-01`, `231-01`, `233-01`, `271-02`.

Monthly profiles are integer basis points summing to 10,000 to avoid floating drift:

```ts
export const MONTHLY_PROFILES = {
  EVEN: [833,833,834,833,833,834,833,833,834,833,833,834],
  TRAVEL: [500,700,1100,900,1000,1100,900,800,1100,800,700,500],
  TRAINING: [200,300,500,1200,1400,600,500,600,1400,900,600,1800],
  EQUIPMENT: [200,300,500,900,1800,1600,900,500,700,900,1000,700],
}
```

Assert each sums to 10,000.

- [ ] **Step 4: Run tests**

Run: `node scripts/national-uat/finance-catalog.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/national-uat/catalog/finance.ts scripts/national-uat/catalog/scenarios.ts scripts/national-uat/finance-catalog.test.mjs
git commit -m "testdata: define UAT finance and scenario catalogues"
```

---

### Task 5: Implement Preflight, Protected Manifest and Reset Dry Run

**Files:**
- Create: `scripts/national-uat/preflight.ts`
- Create: `scripts/national-uat/reset.ts`
- Create: `scripts/national-uat/reset-guard.test.mjs`

**Interfaces:**
- Produces `captureProtectedManifest(client)`, `captureTableCounts(client)`, `buildPurgeOrder(client)`, `dryRunReset(client)`, `executeReset(client, runId)`.

- [ ] **Step 1: Write reset safety tests**

Static assertions must require:

- exact project-ref guard;
- `--execute-reset` argument before COMMIT path;
- fresh full backup function invocation before purge;
- user/role manifest comparison after purge;
- no `TRUNCATE public.users`, `TRUNCATE public.roles`, `TRUNCATE public.permissions`, `TRUNCATE public.audit_logs`;
- reset transaction uses `BEGIN` and either explicit rollback in dry-run or commit only after validation.

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/national-uat/reset-guard.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement preflight**

`captureProtectedManifest` records exact IDs/statuses for all users and rows/counts for `roles`, `user_roles`, `permissions`, `role_permissions`, `modules`, `menu_items`, `workflow_statuses`, `report_categories`, `report_definitions`, `system_settings`, `system_alert_settings`.

`preflight.ts` additionally verifies:

```sql
select count(*) = 10 as users_ok from public.users;
select count(*) filter (where is_active) = 7 as active_ok from public.users;
select count(*) filter (where archived_at is not null) = 3 as archived_ok from public.users;
```

Do not hard fail solely because table statistics estimates differ; use exact `COUNT(*)` for acceptance.

- [ ] **Step 4: Implement dependency-aware reset**

Before deleting old Departments/Sections:

```sql
UPDATE public.users SET department_id = NULL, section_id = NULL
WHERE department_id IS NOT NULL OR section_id IS NOT NULL;
```

Delete rebuildable tables child-first using the live FK graph. Use explicit `DELETE FROM` statements for business tables rather than `TRUNCATE ... CASCADE` so preserved tables cannot be accidentally reached.

Keep `system_backup_registry` and `system_backup_change_log` intact. Keep `audit_logs` intact by default. Insert a reset-boundary audit record if the current immutable-audit trigger/function supports a service/system entry; otherwise capture the boundary in `uat_seed_runs`.

Dry run executes the full delete sequence inside one transaction, checks that all rebuildable target counts are zero and protected manifests are unchanged, then `ROLLBACK`.

Actual reset uses the identical statements and commits only after the same assertions pass.

- [ ] **Step 5: Run safety test**

Run: `node scripts/national-uat/reset-guard.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/national-uat/preflight.ts scripts/national-uat/reset.ts scripts/national-uat/reset-guard.test.mjs
git commit -m "feat: add guarded national UAT reset preflight"
```

---

### Task 6: Seed National Organisation and Remap Retained Users

**Files:**
- Create: `scripts/national-uat/seed-master.ts`
- Create: `scripts/national-uat/master-seed.test.mjs`

**Interfaces:**
- Consumes deterministic organisation catalogue and migration 066.
- Produces all 22 `provinces`, 28 `court_locations`, Waigani/provincial Departments, Sections, Cost Centres, Budget Divisions and retained-user organisational assignments.

- [ ] **Step 1: Write generator tests without touching the database**

Generate an in-memory seed plan and assert:

```js
assert.equal(plan.provinces.length, 22)
assert.equal(plan.locations.length, 28)
assert.ok(plan.departments.length >= 150)
assert.ok(plan.sections.length >= 250)
assert.equal(new Set(plan.costCentres.map(x => x.code)).size, plan.costCentres.length)
for (const d of plan.departments) assert.ok(d.courtLocationId)
for (const s of plan.sections) assert.ok(plan.departments.some(d => d.id === s.departmentId))
for (const c of plan.costCentres) assert.ok(plan.departments.some(d => d.id === c.departmentId))
```

Use ranges rather than forcing the approximate target counts in the specification.

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/national-uat/master-seed.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement seed-plan generation and idempotent upserts**

Use predetermined UUIDs for every seeded master. Insert/upsert in the order:

`provinces -> court_locations -> departments -> sections -> cost_centres -> budget_divisions -> uat_seed_entities`.

All Departments must have a Court Location after seed. Use globally unique readable codes even though geography is also normalized.

- [ ] **Step 4: Implement Option A user remap**

Resolve retained users by immutable user UUID/email and assign exactly the approved UAT units:

- System Administrator accounts -> Waigani ICT units;
- active Registrar accounts -> Waigani Registry units;
- Line Supervisor -> Waigani HR Personnel/Records;
- Requisition Officer -> Waigani Procurement Operations;
- Payment/Reconciliation Officer -> Waigani Finance Reconciliation/Payments;
- archived users retain archive state and may receive null or a safe non-operational location assignment according to FK requirements.

Never change `auth_user_id`, email, password fields, `is_active`, `archived_at`, `user_roles` or permissions in this task.

- [ ] **Step 5: Run generator tests**

Run: `node scripts/national-uat/master-seed.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/national-uat/seed-master.ts scripts/national-uat/master-seed.test.mjs
git commit -m "feat: seed national NJSS organisation and user mapping"
```

---

### Task 7: Seed Explicit Financial Master and Canonical Mappings

**Files:**
- Create: `scripts/national-uat/seed-finance.ts`
- Create: `scripts/national-uat/finance-seed.test.mjs`

**Interfaces:**
- Produces `chart_of_accounts`, `expense_ledger`, expense categories/items, `expense_code_registry` Posting Codes and `finance_posting_mappings` only for contexts used by budget/scenario plans.

- [ ] **Step 1: Write finance-plan tests**

Assert each generated context contains exactly one Department, optional Section as defined, one Cost Centre, one Finance Code, one Posting Code and one CoA. Assert `(financial_year, expense_ledger_id, expense_code_registry_id, cost_centre_id)` contexts are unique.

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/national-uat/finance-seed.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement financial seed in dependency order**

Use existing master-table shapes and Task 9 one-to-one controls. Generate only budget-used combinations, never the Cartesian product.

For each mapping, call the canonical RPC introduced by migration 061 (`njss_upsert_finance_posting_mapping`) as the System Administrator actor when actor-context testing in Task 8 has proven reliable. If pre-actor static generation is needed, prepare rows but do not bypass the canonical mapping constraints.

Mapping notes must include dataset/run ID, e.g. `NJSS-NATIONAL-UAT-2026-V1 | UAT generated mapping`.

- [ ] **Step 4: Verify no fallback mapping path**

Run:

```bash
node scripts/national-uat/finance-seed.test.mjs
node scripts/budget-activation-approved-spec-conformance.test.mjs
node scripts/budget-activation-control.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/national-uat/seed-finance.ts scripts/national-uat/finance-seed.test.mjs
git commit -m "feat: generate canonical UAT finance mappings"
```

---

### Task 8: Seed Budgets Through Workflow and Dual-Control Activation

**Files:**
- Create: `scripts/national-uat/seed-budgets.ts`
- Create: `scripts/national-uat/budget-seed.test.mjs`

**Interfaces:**
- Produces FY2026 budget cycles, ceilings/submissions/lines/monthly allocations, selected approved submissions, activation batches/snapshots and operational `budget_allocations`.

- [ ] **Step 1: Write deterministic budget and monthly-profile tests**

For every generated budget line assert monthly integer cents sum exactly to annual cents. Assert every main National Court Registry receives at least one budget; sub-registries receive the approved smaller template.

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/national-uat/budget-seed.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Prove actor-context impersonation in a rollback-only live check before using workflow RPCs**

Inside a transaction:

```sql
select set_config('request.jwt.claim.sub', :auth_user_id::text, true);
select auth.uid() = :auth_user_id::uuid as actor_ok;
```

Require `actor_ok = true`; then rollback. If this fails, stop implementation and do not seed workflow states directly. The implementation must then add a separately reviewed service-role seed-only wrapper with exact actor validation rather than bypass role guards.

- [ ] **Step 4: Implement budget creation**

Generate deterministic submissions and lines using the current schema. Use supported budget workflow RPCs from `app/api/workflows/budget/route.ts`/migrations 019, 051–055 to move records through Prepared/Submitted/Approved states under the correct retained actors.

- [ ] **Step 5: Implement activation using existing Task 9 controls**

For every budget selected for operational use:

1. System Administrator actor calls `njss_prepare_budget_activation`;
2. Finance mappings are present and fingerprint-valid;
3. System Administrator submits readiness using `njss_submit_budget_activation`;
4. switch actor context to a different active Registrar;
5. call the current final activation RPC from migrations 062/063;
6. assert one active operational allocation per approved source budget line and K0.00 variance.

Never write activated `budget_allocations` directly.

- [ ] **Step 6: Run tests**

Run:

```bash
node scripts/national-uat/budget-seed.test.mjs
node scripts/budget-revision-reforecast.test.mjs
node scripts/budget-activation-control.test.mjs
node scripts/budget-activation-approved-spec-conformance.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/national-uat/seed-budgets.ts scripts/national-uat/budget-seed.test.mjs
git commit -m "feat: generate and activate national UAT budgets"
```

---

### Task 9: Seed Funding, Suppliers and Representative Transactions

**Files:**
- Create: `scripts/national-uat/seed-transactions.ts`
- Create: `scripts/national-uat/transaction-seed.test.mjs`

**Interfaces:**
- Produces UAT funding authorities/receipts/allocations/releases, 15–25 labelled synthetic suppliers, 25–40 FF3 scenarios, 15–25 FF4 scenarios and 6–10 budget revision cases across approved centres.

- [ ] **Step 1: Write scenario-distribution tests**

Assert detailed scenarios exist only for Waigani, Lae, Mt Hagen, Wewak, Kokopo, Alotau, Tari and Buka; require multiple workflow states; require at least one valid Supplementary, Virement, Reforecast/Reduction and returned/rejected revision case.

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/national-uat/transaction-seed.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Seed supplier and funding masters**

Use the current supplier/funding workflow RPCs where actor validation is required. Every synthetic supplier name/description must clearly carry UAT labelling.

- [ ] **Step 4: Seed FF3 base drafts and transition through existing workflow**

Create valid draft headers/items against activated allocations, then use:

```sql
select public.njss_transition_ff3(
  p_ff3_id := :ff3_id,
  p_action := :action,
  p_comments := :comments,
  p_user_email := :actor_email
);
```

Switch actor context according to role between submit/endorse/approve/reject/return actions. Do not set final statuses by direct UPDATE when an RPC exists.

- [ ] **Step 5: Seed commitments and FF4 lineage**

Create FF4 only from valid approved FF3/commitment lineage. Use existing FF4 workflow RPCs surfaced by `app/api/workflows/ff4/route.ts`. Include paid/reconciled cases and legitimate earlier states.

- [ ] **Step 6: Seed revision cases through existing budget revision workflow**

For Supplementary requests, require authority reference. For Virement, enforce total-before equals total-after. Preserve original operational baseline and supersession lineage.

- [ ] **Step 7: Run tests**

Run:

```bash
node scripts/national-uat/transaction-seed.test.mjs
node scripts/budget-revision-workspace.test.mjs
node scripts/budget-revision-hardening.test.mjs
node scripts/ff3-lookup-behavior.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/national-uat/seed-transactions.ts scripts/national-uat/transaction-seed.test.mjs
git commit -m "feat: add representative national UAT transactions"
```

---

### Task 10: Implement Positive and Rollback-Only Negative Validation Suite

**Files:**
- Create: `scripts/national-uat/validate.ts`
- Create: `scripts/national-uat/validation.test.mjs`

**Interfaces:**
- Produces `ValidationReport` JSON containing `positive`, `negative`, `reconciliation`, `counts`, `financialTotals`, `protectedManifestMatch`.

- [ ] **Step 1: Write validation-contract tests**

Require test IDs for every negative case in spec section 21 and positive sections 22/26. Each negative test result schema:

```ts
type NegativeResult = {
  id: string
  expectedFailure: string
  passed: boolean
  databaseMessage: string
}
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/national-uat/validation.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement positive reconciliation SQL**

Checks include:

- exactly 10 retained user IDs match pre-reset manifest;
- 7 active / 3 archived unchanged;
- 22 provinces / 28 court locations;
- no active Department without Court Location;
- no orphan Sections/Cost Centres;
- every activated source line has one active canonical mapping;
- monthly line totals = annual line amount;
- submission total = line totals;
- activation snapshot/allocation counts and totals reconcile;
- no active `EXCEL_BUDGET` allocation lacks source line/submission;
- funding authority/receipt/allocation/release amounts satisfy implemented limits.

- [ ] **Step 4: Implement negative tests inside SAVEPOINT/ROLLBACK**

Each deliberate invalid operation runs inside a savepoint and must be rolled back regardless of expected rejection:

```ts
await client.query('SAVEPOINT neg_case')
try {
  await client.query(invalidSql, params)
  result.passed = false
} catch (error) {
  result.passed = expectedPattern.test(error.message)
  result.databaseMessage = error.message
} finally {
  await client.query('ROLLBACK TO SAVEPOINT neg_case')
  await client.query('RELEASE SAVEPOINT neg_case')
}
```

Never leave intentionally invalid records in UAT.

- [ ] **Step 5: Run static validation tests**

Run: `node scripts/national-uat/validation.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/national-uat/validate.ts scripts/national-uat/validation.test.mjs
git commit -m "test: add national UAT validation and reconciliation suite"
```

---

### Task 11: Add Court Location Master Maintenance to the Application

**Files:**
- Modify: `app/dashboard/master/page.tsx` if it already cleanly hosts CRUD master panels, otherwise create `app/dashboard/master/court-locations/page.tsx`
- Modify: `lib/api.ts` or a new focused `lib/court-locations.ts`
- Test: `scripts/national-uat/court-location-ui.test.mjs`

**Interfaces:**
- Produces System Administrator CRUD for Court Locations with Province lookup and location type.

- [ ] **Step 1: Read the relevant Next.js 16 documentation under `node_modules/next/dist/docs/` before changing application files**

Document the specific guide used in the commit message/body if route/data-fetching APIs differ from existing repository patterns.

- [ ] **Step 2: Write static UI regression assertions**

Require labels `Court Location`, `Province`, `Location Type`, `Headquarters`, `National Court Registry`, `National Court Sub-Registry`; require role/permission guard consistent with other master-data administration.

- [ ] **Step 3: Run and verify failure**

Run: `node scripts/national-uat/court-location-ui.test.mjs`

Expected: FAIL.

- [ ] **Step 4: Implement minimal CRUD following existing master-data patterns**

Do not redesign the whole master-data page. Keep location code/name/type/province/active fields and reject duplicate codes at DB level.

- [ ] **Step 5: Run targeted and full frontend checks**

```bash
node scripts/national-uat/court-location-ui.test.mjs
bun run lint
bun run typecheck
bun run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/master/page.tsx app/dashboard/master/court-locations lib scripts/national-uat/court-location-ui.test.mjs
git commit -m "feat: add court location master maintenance"
```

Adjust the `git add` paths to only the files actually used; do not create both page approaches unnecessarily.

---

### Task 12: Add Orchestrator, CI Checks and Evidence Export

**Files:**
- Create: `scripts/national-uat/run.ts`
- Create: `scripts/national-uat/export-report-data.ts`
- Create: `scripts/national-uat/orchestrator.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- `bun scripts/national-uat/run.ts --preflight`
- `bun scripts/national-uat/run.ts --dry-run-reset`
- `bun scripts/national-uat/run.ts --execute-reset`
- `bun scripts/national-uat/run.ts --seed`
- `bun scripts/national-uat/run.ts --validate`
- `bun scripts/national-uat/export-report-data.ts --output /mnt/data/njss-national-uat-report-data.json`

- [ ] **Step 1: Write orchestrator static test**

Require destructive reset to be a separate explicit flag; `--seed` must refuse to run if no completed reset run exists for the same run ID; `--validate` must update `uat_seed_runs` only after all validation stages finish.

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/national-uat/orchestrator.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement phase orchestration**

Phase order:

```text
PREFLIGHT
BACKUP
DRY_RUN_RESET
EXECUTE_RESET
SEED_MASTER
REMAP_USERS
SEED_FINANCE
SEED_BUDGETS_AND_ACTIVATE
SEED_TRANSACTIONS
VALIDATE
EXPORT_REPORT_DATA
COMPLETE
```

Each phase writes status/timestamps to `uat_seed_runs`. A failure sets status `FAILED` with phase/message and stops immediately.

- [ ] **Step 4: Add CI regression commands**

Append to `.github/workflows/ci.yml` before lint:

```yaml
      - name: National UAT catalogue regression checks
        run: node scripts/national-uat/catalog.test.mjs
      - name: National UAT schema regression checks
        run: node scripts/national-uat/schema.test.mjs
      - name: National UAT reset guard checks
        run: node scripts/national-uat/reset-guard.test.mjs
      - name: National UAT finance and validation checks
        run: |
          node scripts/national-uat/finance-catalog.test.mjs
          node scripts/national-uat/master-seed.test.mjs
          node scripts/national-uat/finance-seed.test.mjs
          node scripts/national-uat/budget-seed.test.mjs
          node scripts/national-uat/transaction-seed.test.mjs
          node scripts/national-uat/validation.test.mjs
          node scripts/national-uat/orchestrator.test.mjs
```

- [ ] **Step 5: Run complete local regression suite**

Run:

```bash
node lib/rbac/four-group-rbac.test.mjs
node lib/rbac/admin-runtime-fallback.test.mjs
node lib/rbac/user-crud-edge.test.mjs
node lib/backup/full-differential-backup.test.mjs
node scripts/master-data-cleanup.test.mjs
node scripts/budget-revision-reforecast.test.mjs
node scripts/budget-revision-reporting.test.mjs
node scripts/budget-revision-hardening.test.mjs
node scripts/budget-revision-workspace.test.mjs
node scripts/budget-activation-control.test.mjs
node scripts/budget-activation-approved-spec-conformance.test.mjs
node scripts/national-uat/catalog.test.mjs
node scripts/national-uat/schema.test.mjs
node scripts/national-uat/reset-guard.test.mjs
node scripts/national-uat/finance-catalog.test.mjs
node scripts/national-uat/master-seed.test.mjs
node scripts/national-uat/finance-seed.test.mjs
node scripts/national-uat/budget-seed.test.mjs
node scripts/national-uat/transaction-seed.test.mjs
node scripts/national-uat/validation.test.mjs
node scripts/national-uat/orchestrator.test.mjs
bun run lint
bun run typecheck
bun run build
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/national-uat/run.ts scripts/national-uat/export-report-data.ts scripts/national-uat/orchestrator.test.mjs .github/workflows/ci.yml
git commit -m "ci: add national UAT rebuild orchestration checks"
```

---

### Task 13: Production/UAT Execution Gate — Backup and Dry Run

**Files:**
- Runtime only; no code change unless a verified defect is found.
- Evidence output: `/mnt/data/njss-national-uat-preflight.json`

**Interfaces:** Uses Tasks 1–12 code against project `qzsmmalfeinoagvronpb`.

- [ ] **Step 1: Confirm live project identity**

Check project name/status and require ref `qzsmmalfeinoagvronpb`.

- [ ] **Step 2: Run read-only preflight**

Run: `bun scripts/national-uat/run.ts --preflight`

Expected: protected manifest captured; exact live counts recorded; no mutation.

- [ ] **Step 3: Capture fresh full recovery snapshot**

Invoke the established backup route/function based on migration 049 / `njss-database-backup`, verify `system_backup_registry` status `COMPLETED`, non-zero table/record counts, file size and SHA-256 if file backup is generated.

- [ ] **Step 4: Apply migration 066 only after backup verification**

Run through the established migration path (for this repository `bun scripts/apply-sql.ts supabase/migrations/066_national_uat_location_seed_registry.sql` when executing locally with approved credentials).

Then run security/performance advisors and record relevant new findings. Do not claim legacy project-wide warnings are resolved.

- [ ] **Step 5: Run full destructive dry-run transaction**

Run: `bun scripts/national-uat/run.ts --dry-run-reset`

Expected: purge simulation reaches zero target counts, protected manifest remains identical, transaction rolls back, live counts remain unchanged afterward.

- [ ] **Step 6: Stop if any discrepancy exists**

No actual reset if user IDs, role assignments, archive states, protected counts, backup verification or dry-run post-rollback counts differ.

---

### Task 14: Execute Reset, Seed and Validate the National UAT Dataset

**Files:**
- Runtime evidence: `/mnt/data/njss-national-uat-validation.json`
- Runtime evidence: `/mnt/data/njss-national-uat-report-data.json`

- [ ] **Step 1: Execute guarded reset**

Run: `bun scripts/national-uat/run.ts --execute-reset`

Expected: only approved rebuildable data cleared; users/security preserved; run record shows reset phase completed.

- [ ] **Step 2: Seed all phases**

Run: `bun scripts/national-uat/run.ts --seed`

Expected: masters, remapped users, finance, budgets/activation and representative transactions complete with run/entity provenance registry populated.

- [ ] **Step 3: Execute validation suite**

Run: `bun scripts/national-uat/run.ts --validate`

Expected: all positive checks PASS; every required negative case rejects for intended reason; no negative test persists data.

- [ ] **Step 4: Re-run protected manifest comparison**

Require exact retained user IDs/auth IDs, active/archive states and role assignments to match pre-reset baseline.

- [ ] **Step 5: Run application smoke checks**

Verify at minimum:

- System Administrator sees national master data;
- retained Registrar and Line Supervisor assignments resolve correctly;
- budget activation queue contains/reflects seeded operational budgets correctly;
- FF3 lookup shows only spendable active allocations;
- FF4 lineage displays seeded valid cases;
- revision page shows eligible activated baselines and assigned-supervisor notifications;
- reports can aggregate by Province/Court Location through the new hierarchy.

- [ ] **Step 6: Export report evidence**

Run: `bun scripts/national-uat/export-report-data.ts --output /mnt/data/njss-national-uat-report-data.json`

Include exact counts, financial totals, user mapping, source/provenance catalogue, validation results, backup identity and run metadata.

---

### Task 15: Produce the Final Word Implementation Report

**Files:**
- Input: `/mnt/data/njss-national-uat-report-data.json`
- Create user artifact: `/mnt/data/NJSS_National_UAT_Data_Rebuild_Report_2026.docx`

**Interfaces:** Final document is not a database control artifact; it reports what was actually executed and validated.

- [ ] **Step 1: Read `/home/oai/skills/docx/SKILL.md` before generating the Word document**

Follow its formatting and verification requirements exactly.

- [ ] **Step 2: Generate the Word report from actual execution evidence, not planned target counts**

Required sections:

1. Executive Summary
2. Purpose and Approved Reset Boundary
3. Source-Gathering Methodology
4. OFFICIAL / DERIVED / UAT Provenance Rules
5. National Province and Court Location Register
6. Waigani and Provincial Organisational Structure
7. Identifier and Coding Conventions
8. Financial Master Architecture
9. Exact Installed Master Record Counts
10. Reset and Reload Steps Actually Executed
11. Retained User Reassignment
12. Budget Methodology and Actual Installed Totals
13. Funding, Supplier and Transaction Scenarios
14. Supplementary/Virement Test Cases
15. Positive and Negative Validation Results
16. Pre/Post Reset Counts
17. Financial Reconciliation
18. Recovery Snapshot and Dataset Run ID
19. Exceptions/Limitations and Official-Data Reconciliation Requirements

- [ ] **Step 3: Verify the DOCX opens and inspect rendered layout per the document skill**

Correct broken tables, page overflow or heading issues before delivery.

- [ ] **Step 4: Provide the Word file to the user with a sandbox link**

Final link format:

`[Download the NJSS National UAT Data Rebuild Report](sandbox:/mnt/data/NJSS_National_UAT_Data_Rebuild_Report_2026.docx)`

---

## Plan Self-Review Result

### Spec coverage

- Reset/preserve boundary: Tasks 5, 13, 14.
- Full national 22/28 hierarchy: Tasks 1, 2, 6.
- Deterministic IDs and readable codes: Tasks 1, 6.
- PNG-aligned/UAT financial model: Tasks 4, 7.
- No fallback CoA mappings: Tasks 7, 8, 10.
- User retention and Option A remapping: Tasks 5, 6, 10, 14.
- National budgets and monthly reconciliation: Task 8.
- Dual-control activation: Task 8.
- Funding/suppliers/FF3/FF4/revisions: Task 9.
- Positive/negative validation: Task 10.
- Backup/rollback: Tasks 5 and 13.
- Court Location maintainability: Task 11.
- CI/regression: Task 12.
- Final installed-record Word report: Task 15.

### Safety clarification

The design specification's phrase about rebuilding business audit history is implemented conservatively: `audit_logs` is not blanket-cleared. The pre-reset snapshot preserves all history; the live audit stream is retained unless a row is provably tied only to the disposable UAT dataset and can be safely removed under immutable-audit controls. The seed-run registry creates the authoritative reset boundary.

### Execution rule

Tasks 1–12 are implementation work and may be completed/reviewed before any live destructive reset. Tasks 13–15 are operational execution and must not begin until the code branch has passed CI/review and the fresh backup/dry-run gates succeed.
