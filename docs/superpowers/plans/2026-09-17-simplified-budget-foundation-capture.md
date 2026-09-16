# Simplified Budget Foundation and Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new Head Office annual-budget foundation, draft capture, private document control, Division locking, and annual activation without removing the existing FF3/FF4 financial-control engine.

**Architecture:** Add a new, additive budget-capture schema and secured RPC layer beside the legacy divisional-budget tables. Replace the current budget-template UI with a Budget Officer workspace that writes only Year → Division → Section → Ledger → Amount, stores official evidence in a private bucket, locks Division budgets immutably, and activates the annual cycle only after all required Divisions are locked. Legacy budget tables remain untouched during this phase.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, TypeScript 5, Supabase/PostgreSQL 17, Supabase Storage, existing RBAC tables, Node `.mjs` regression tests, Bun/CI.

**Spec:** `docs/superpowers/specs/2026-09-17-simplified-head-office-budget-design.md`

## Global Constraints

- Head Office only; no national/provincial budget-entry workflow.
- One annual budget record per Financial Year + Division, containing all Sections.
- All Sections use the same standard `expense_ledger` master.
- Draft budgets remain editable until the Budget Officer locks them.
- An official Registrar-signed/stamped document must exist before Division lock.
- Locked original budget amounts are immutable.
- Annual activation is separate from lock and may occur only after all required Divisions are locked and Registrar Office activation authority is recorded.
- Existing FF3/FF4, commitment, payment, funding, and legacy budget tables are not destructively removed in this phase.
- Private budget documents must use signed URLs; do not expose `getPublicUrl()` for the new bucket.
- UI hiding is insufficient: mutating operations must be protected by database-side permission checks/RPCs.

---

### Task 1: Add the additive Head Office budget schema, permissions, private bucket, and secured RPCs

**Files:**
- Create: `supabase/migrations/20260917010000_simplified_head_office_budget_foundation.sql`
- Test: `scripts/simplified-budget-foundation.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces tables: `annual_budget_cycles`, `division_budgets`, `division_budget_lines`, `budget_documents`.
- Produces private storage bucket: `njss-budget-documents`.
- Produces permissions: `budget.capture`, `budget.lock`, `budget.activate`, `budget.documents.manage` while retaining existing `budget.view`/report permissions.
- Produces RPCs:
  - `create_or_get_head_office_budget_cycle(p_financial_year integer) returns uuid`
  - `create_or_get_division_budget(p_financial_year integer, p_division_id uuid) returns uuid`
  - `upsert_division_budget_line(p_division_budget_id uuid, p_section_id uuid, p_expense_ledger_id uuid, p_original_amount numeric) returns uuid`
  - `lock_division_budget(p_division_budget_id uuid) returns void`
  - `activate_annual_budget(p_cycle_id uuid, p_authority_document_id uuid) returns void`
- Later tasks consume these RPCs through `lib/head-office-budget.ts`.

- [ ] **Step 1: Write the failing schema regression test**

Create `scripts/simplified-budget-foundation.test.mjs` with direct source assertions against the migration:

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'

const sql = fs.readFileSync('supabase/migrations/20260917010000_simplified_head_office_budget_foundation.sql', 'utf8')

for (const name of ['annual_budget_cycles', 'division_budgets', 'division_budget_lines', 'budget_documents']) {
  assert.match(sql, new RegExp(`create table(?: if not exists)? public\\.${name}`, 'i'))
}
assert.match(sql, /unique\s*\(financial_year\)/i)
assert.match(sql, /unique\s*\(annual_budget_cycle_id\s*,\s*division_id\)/i)
assert.match(sql, /unique\s*\(division_budget_id\s*,\s*section_id\s*,\s*expense_ledger_id\)/i)
assert.match(sql, /njss-budget-documents/i)
assert.match(sql, /public\s*=\s*false/i)
assert.match(sql, /create or replace function public\.lock_division_budget/i)
assert.match(sql, /create or replace function public\.activate_annual_budget/i)
assert.match(sql, /status\s*=\s*'LOCKED'/i)
assert.match(sql, /status\s*=\s*'ACTIVE'/i)
assert.match(sql, /budget\.capture/i)
assert.match(sql, /budget\.lock/i)
assert.match(sql, /budget\.activate/i)
assert.match(sql, /budget\.documents\.manage/i)

console.log('Simplified budget foundation migration contract passed')
```

- [ ] **Step 2: Run the test and confirm it fails because the migration does not exist**

Run:

```bash
node scripts/simplified-budget-foundation.test.mjs
```

Expected: failure reading `20260917010000_simplified_head_office_budget_foundation.sql`.

- [ ] **Step 3: Implement the migration**

Create the migration with these exact structural rules:

```sql
create table if not exists public.annual_budget_cycles (
  id uuid primary key default gen_random_uuid(),
  financial_year integer not null unique check (financial_year between 2000 and 2200),
  status varchar(32) not null default 'PREPARATION'
    check (status in ('PREPARATION','READY_FOR_ACTIVATION','ACTIVE','CLOSED')),
  activation_authority_document_id uuid null,
  activated_by uuid null references auth.users(id),
  activated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.division_budgets (
  id uuid primary key default gen_random_uuid(),
  annual_budget_cycle_id uuid not null references public.annual_budget_cycles(id),
  financial_year integer not null,
  division_id uuid not null references public.departments(id),
  status varchar(16) not null default 'DRAFT' check (status in ('DRAFT','LOCKED')),
  reference_number varchar(120),
  approval_date date,
  entered_by uuid references auth.users(id),
  locked_by uuid references auth.users(id),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (annual_budget_cycle_id, division_id)
);

create table if not exists public.division_budget_lines (
  id uuid primary key default gen_random_uuid(),
  division_budget_id uuid not null references public.division_budgets(id) on delete cascade,
  section_id uuid not null references public.sections(id),
  expense_ledger_id uuid not null references public.expense_ledger(id),
  original_amount numeric(18,2) not null default 0 check (original_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (division_budget_id, section_id, expense_ledger_id)
);

create table if not exists public.budget_documents (
  id uuid primary key default gen_random_uuid(),
  financial_year integer not null,
  division_budget_id uuid references public.division_budgets(id),
  related_entity_type varchar(64) not null,
  related_entity_id uuid,
  document_type varchar(64) not null,
  reference_number varchar(160),
  document_date date,
  description text,
  storage_bucket varchar(100) not null default 'njss-budget-documents',
  storage_path text not null,
  original_filename text not null,
  mime_type varchar(180),
  version_number integer not null default 1,
  supersedes_document_id uuid references public.budget_documents(id),
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);
```

Add the FK from `annual_budget_cycles.activation_authority_document_id` to `budget_documents(id)` after both tables exist.

Add indexes on `division_budgets(financial_year, division_id)`, `division_budget_lines(section_id, expense_ledger_id)`, and `budget_documents(division_budget_id, document_type)`.

Create the storage bucket idempotently:

```sql
insert into storage.buckets (id, name, public)
values ('njss-budget-documents', 'njss-budget-documents', false)
on conflict (id) do update set public = false;
```

Create/activate the permissions with `insert ... on conflict (code) do update`, and ensure the existing `Budget Officer` role is active and business-facing if present:

```sql
update public.roles
set is_active = true, is_business_role = true
where name = 'Budget Officer';
```

Do not make Budget Officer protected/system-level and do not grant Registrar-only reallocation authority in this foundation migration.

For RPC permission checks, reuse the repository's existing effective-permission helper if one exists; otherwise use a stable SQL helper local to this migration that checks the authenticated user's role permissions. Every `security definer` function must include:

```sql
set search_path = public, auth
```

and explicit authenticated execution grants only.

`upsert_division_budget_line` must reject writes when the parent Division is not `DRAFT`.

`lock_division_budget` must verify:

```sql
exists (
  select 1 from public.budget_documents
  where division_budget_id = p_division_budget_id
    and document_type = 'OFFICIAL_APPROVED_BUDGET'
)
```

and then set `LOCKED`, `locked_by = auth.uid()`, `locked_at = now()`.

After every lock, recalculate the cycle:

```sql
update public.annual_budget_cycles c
set status = case
  when exists (
    select 1 from public.division_budgets d
    where d.annual_budget_cycle_id = c.id and d.status <> 'LOCKED'
  ) then 'PREPARATION'
  else 'READY_FOR_ACTIVATION'
end
where c.id = v_cycle_id and c.status <> 'ACTIVE';
```

`activate_annual_budget` must reject unless cycle status is `READY_FOR_ACTIVATION`, the authority document is of type `REGISTRAR_ACTIVATION_AUTHORITY`, and the caller has `budget.activate`.

Enable RLS on all new tables; authenticated read access requires `budget.view` or one of the new budget permissions, while mutations occur through secured RPCs only. Revoke direct `insert/update/delete` from `anon, authenticated` for all new tables.

- [ ] **Step 4: Run the schema regression test**

Run:

```bash
node scripts/simplified-budget-foundation.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Add the regression test to CI**

Modify `.github/workflows/ci.yml` near the other budget regression checks:

```yaml
- name: Simplified Head Office budget foundation regression
  run: node scripts/simplified-budget-foundation.test.mjs
```

- [ ] **Step 6: Run migration-governance and security regression tests**

Run:

```bash
node scripts/migration-governance.test.mjs
node scripts/critical-rpc-lockdown.test.mjs
node scripts/client-table-privileges-runtime.test.mjs
```

Expected: PASS, or a failing assertion that is resolved by tightening the new migration rather than weakening an existing security test.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260917010000_simplified_head_office_budget_foundation.sql scripts/simplified-budget-foundation.test.mjs .github/workflows/ci.yml
git commit -m "feat: add simplified Head Office budget foundation"
```

---

### Task 2: Add a focused client API for draft budget capture and document metadata

**Files:**
- Create: `lib/head-office-budget.ts`
- Test: `scripts/head-office-budget-client.test.mjs`

**Interfaces:**
- Consumes RPCs from Task 1.
- Produces exported types `AnnualBudgetCycle`, `DivisionBudget`, `DivisionBudgetLine`, `BudgetDocument`.
- Produces functions:
  - `getHeadOfficeBudgetDashboard(financialYear: number)`
  - `getDivisionBudget(divisionBudgetId: string)`
  - `createOrGetDivisionBudget(financialYear: number, divisionId: string)`
  - `saveDivisionBudgetLine(input)`
  - `removeDivisionBudgetLine(lineId: string)` only while parent is DRAFT, through a secured RPC added to Task 1 if deletion is required by the UI
  - `registerBudgetDocument(input)`
  - `lockDivisionBudget(divisionBudgetId: string)`
  - `activateAnnualBudget(cycleId: string, authorityDocumentId: string)`

- [ ] **Step 1: Write a failing client contract test**

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'
const source = fs.readFileSync('lib/head-office-budget.ts', 'utf8')
for (const fn of [
  'getHeadOfficeBudgetDashboard',
  'getDivisionBudget',
  'createOrGetDivisionBudget',
  'saveDivisionBudgetLine',
  'registerBudgetDocument',
  'lockDivisionBudget',
  'activateAnnualBudget',
]) assert.equal(source.includes(`function ${fn}`) || source.includes(`const ${fn}`), true, `${fn} must exist`)
assert.equal(source.includes("supabase.rpc('upsert_division_budget_line'"), true)
assert.equal(source.includes("supabase.rpc('lock_division_budget'"), true)
assert.equal(source.includes("supabase.rpc('activate_annual_budget'"), true)
console.log('Head Office budget client contract passed')
```

- [ ] **Step 2: Run and verify failure**

Run `node scripts/head-office-budget-client.test.mjs`; expected failure because the file does not exist.

- [ ] **Step 3: Implement `lib/head-office-budget.ts`**

Use direct `select` queries for reads and only RPCs for controlled writes. Define numeric values as `number` in the UI boundary and normalize database numerics with `Number(...)`.

Example write:

```ts
export async function saveDivisionBudgetLine(input: {
  divisionBudgetId: string
  sectionId: string
  expenseLedgerId: string
  originalAmount: number
}) {
  const { data, error } = await supabase.rpc('upsert_division_budget_line', {
    p_division_budget_id: input.divisionBudgetId,
    p_section_id: input.sectionId,
    p_expense_ledger_id: input.expenseLedgerId,
    p_original_amount: input.originalAmount,
  })
  if (error) throw error
  return data as string
}
```

Dashboard read must return cycle status, all active Head Office Divisions, their budget status/total/document presence, and a calculated Head Office total.

- [ ] **Step 4: Run client contract, lint, and typecheck**

```bash
node scripts/head-office-budget-client.test.mjs
bun run lint
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/head-office-budget.ts scripts/head-office-budget-client.test.mjs
git commit -m "feat: add Head Office budget client API"
```

---

### Task 3: Make budget-document storage private and add budget-specific upload helpers

**Files:**
- Modify: `lib/storage.ts`
- Test: `scripts/budget-document-storage.test.mjs`

**Interfaces:**
- Adds `BUCKETS.BUDGET_DOCUMENTS = 'njss-budget-documents'`.
- Adds `uploadPrivateFile(bucket, recordPath, file)` returning metadata without a public URL.
- Uses existing `getSignedUrl` for retrieval.
- Budget UI must never call `getPublicUrl()` for `njss-budget-documents`.

- [ ] **Step 1: Write failing storage test**

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'
const source = fs.readFileSync('lib/storage.ts', 'utf8')
assert.equal(source.includes("BUDGET_DOCUMENTS: 'njss-budget-documents'"), true)
assert.equal(source.includes('export async function uploadPrivateFile'), true)
assert.match(source, /uploadPrivateFile[\s\S]*\.upload\(/)
console.log('Budget document private-storage contract passed')
```

- [ ] **Step 2: Run and verify failure**

Run `node scripts/budget-document-storage.test.mjs`; expected failure.

- [ ] **Step 3: Implement private upload helper**

```ts
export async function uploadPrivateFile(
  bucket: BucketName,
  recordPath: string,
  file: File
): Promise<UploadedFile> {
  const filePath = generateFilePath(bucket, recordPath, file.name)
  const { data, error } = await supabase.storage.from(bucket).upload(filePath, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw new Error(`Failed to upload file: ${error.message}`)
  return {
    id: data.id || data.path,
    name: file.name,
    size: file.size,
    type: file.type,
    url: '',
    path: data.path,
    uploadedAt: new Date().toISOString(),
  }
}
```

Keep existing public-bucket behavior unchanged for FF3/FF4/quotation attachments in this task.

- [ ] **Step 4: Run test, lint, typecheck**

```bash
node scripts/budget-document-storage.test.mjs
bun run lint
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add lib/storage.ts scripts/budget-document-storage.test.mjs
git commit -m "feat: add private budget document storage"
```

---

### Task 4: Replace the complex Budget Template UI with the simple Budget Officer capture workspace

**Files:**
- Modify: `app/dashboard/budget-template/page.tsx`
- Modify: `app/dashboard/layout.tsx`
- Test: `scripts/simplified-budget-entry-ui.test.mjs`
- Retire/replace expectations in: `scripts/budget-entry-layout.test.mjs`, `scripts/budget-division-selector.test.mjs`, `scripts/budget-row-selection.test.mjs` so they validate the new approved design rather than the superseded template.

**Interfaces:**
- Consumes `lib/head-office-budget.ts` and `lib/storage.ts`.
- Produces UI test IDs:
  - `head-office-budget-dashboard`
  - `division-budget-selector`
  - `section-budget-grid`
  - `budget-document-panel`
  - `lock-division-budget`
- Does not expose monthly allocation, funding source, priority, procurement method, unit-cost, activity-template, or internal submission/review workflow fields.

- [ ] **Step 1: Write the failing UI contract**

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'
const source = fs.readFileSync('app/dashboard/budget-template/page.tsx', 'utf8')
for (const id of ['head-office-budget-dashboard','division-budget-selector','section-budget-grid','budget-document-panel','lock-division-budget']) {
  assert.equal(source.includes(`data-testid="${id}"`), true, `${id} missing`)
}
for (const removed of ['Monthly allocation','Procurement method','Priority level','Business justification','Activity template']) {
  assert.equal(source.includes(removed), false, `${removed} should not appear in annual budget capture`)
}
assert.equal(source.includes('Section Total'), true)
assert.equal(source.includes('Division Total'), true)
assert.equal(source.includes('Save Draft'), true)
assert.equal(source.includes('Lock Division'), true)
console.log('Simplified annual-budget UI contract passed')
```

- [ ] **Step 2: Run and verify failure**

Run `node scripts/simplified-budget-entry-ui.test.mjs`; expected failure against the legacy complex page.

- [ ] **Step 3: Implement the new page**

The page must:

1. Load current financial year/cycle dashboard.
2. Let the Budget Officer choose a Division.
3. Create/get the Division draft on first use.
4. Load all active Sections for that Division and all active posting ledgers.
5. Display a grouped Section grid with Ledger Code, Description, Amount.
6. Store only non-zero lines; entering zero removes/omits the operational line.
7. Calculate Section total, Division total, and Head Office total client-side from persisted draft data.
8. Allow repeated draft edits while status is `DRAFT`.
9. Disable all amount editing while status is `LOCKED`.
10. Show official-document status and a link using a signed URL.
11. Gate mutation actions with `can('budget.capture')`, `can('budget.documents.manage')`, and `can('budget.lock')`.

Do not delete legacy database records; this is a UI cutover only.

- [ ] **Step 4: Update navigation labels**

Change the user-facing menu label from the old template terminology to `Annual Budget` while preserving the route `/dashboard/budget-template` during migration to avoid breaking bookmarks/permissions.

- [ ] **Step 5: Replace legacy layout assertions with approved-design assertions**

Update the three existing budget-entry tests so they no longer demand fields such as Budget Ceiling or monthly spreadsheet behavior that the approved design removed.

- [ ] **Step 6: Run UI tests, lint, typecheck, build**

```bash
node scripts/simplified-budget-entry-ui.test.mjs
node scripts/budget-entry-layout.test.mjs
node scripts/budget-division-selector.test.mjs
node scripts/budget-row-selection.test.mjs
bun run lint
bun run typecheck
bun run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/budget-template/page.tsx app/dashboard/layout.tsx scripts/simplified-budget-entry-ui.test.mjs scripts/budget-entry-layout.test.mjs scripts/budget-division-selector.test.mjs scripts/budget-row-selection.test.mjs
git commit -m "feat: simplify annual budget capture workspace"
```

---

### Task 5: Add official-document verification and Division lock controls

**Files:**
- Modify: `app/dashboard/budget-template/page.tsx`
- Modify: `lib/head-office-budget.ts`
- Test: `scripts/budget-lock-document-control.test.mjs`

**Interfaces:**
- `registerBudgetDocument()` stores metadata for uploaded private files.
- Official original uses `document_type = 'OFFICIAL_APPROVED_BUDGET'`.
- `lockDivisionBudget()` fails if official evidence is absent.

- [ ] **Step 1: Write failing lock/document UI test**

Assert that the page includes `OFFICIAL_APPROVED_BUDGET`, `Registrar-signed`, `Upload official approved budget`, and that Lock Division is guarded by document presence.

- [ ] **Step 2: Run and verify failure**

Run `node scripts/budget-lock-document-control.test.mjs`; expected failure.

- [ ] **Step 3: Implement document upload and metadata registration**

Use:

```ts
const uploaded = await uploadPrivateFile(
  BUCKETS.BUDGET_DOCUMENTS,
  `FY${financialYear}/${divisionCode}/original`,
  file,
)
await registerBudgetDocument({
  financialYear,
  divisionBudgetId,
  documentType: 'OFFICIAL_APPROVED_BUDGET',
  storagePath: uploaded.path,
  originalFilename: uploaded.name,
  mimeType: uploaded.type,
  referenceNumber,
  documentDate,
})
```

Use `ALLOWED_DOCUMENT_TYPES` and the existing file-size validator.

- [ ] **Step 4: Implement lock confirmation**

Before invoking the RPC, display a confirmation that original figures become immutable. After success, reload from database and verify status `LOCKED`; do not rely on optimistic UI state.

- [ ] **Step 5: Run tests and build**

```bash
node scripts/budget-lock-document-control.test.mjs
node scripts/simplified-budget-entry-ui.test.mjs
bun run lint
bun run typecheck
bun run build
```

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/budget-template/page.tsx lib/head-office-budget.ts scripts/budget-lock-document-control.test.mjs
git commit -m "feat: enforce official document before Division lock"
```

---

### Task 6: Replace the existing activation page with the approved year-level activation control

**Files:**
- Modify: `app/dashboard/budget/activation/page.tsx`
- Modify: `lib/head-office-budget.ts`
- Test: `scripts/simplified-budget-activation.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Official activation document type: `REGISTRAR_ACTIVATION_AUTHORITY`.
- Calls `activateAnnualBudget(cycleId, authorityDocumentId)`.
- Activation is available only when cycle is `READY_FOR_ACTIVATION`.

- [ ] **Step 1: Write failing activation UI test**

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'
const source = fs.readFileSync('app/dashboard/budget/activation/page.tsx', 'utf8')
assert.equal(source.includes('READY_FOR_ACTIVATION'), true)
assert.equal(source.includes('REGISTRAR_ACTIVATION_AUTHORITY'), true)
assert.equal(source.includes('Activate Annual Budget'), true)
assert.equal(source.includes('All required Divisions must be locked'), true)
console.log('Simplified budget activation UI contract passed')
```

- [ ] **Step 2: Run and verify failure**

Run `node scripts/simplified-budget-activation.test.mjs`; expected failure against the legacy activation workflow.

- [ ] **Step 3: Implement activation page**

Display:

- financial year;
- every required Division with DRAFT/LOCKED state;
- Head Office total;
- activation readiness;
- Registrar Office activation document upload/metadata;
- the activation button only for `budget.activate` users.

Reject activation in the UI if any Division is Draft, but rely on the Task 1 RPC as the authoritative server-side guard.

- [ ] **Step 4: Update CI**

Add:

```yaml
- name: Simplified annual budget activation regression
  run: node scripts/simplified-budget-activation.test.mjs
```

Keep existing activation/security tests unless they assert superseded business workflow; update only the business-specific assertions, not security/segregation-of-duty tests.

- [ ] **Step 5: Run the full budget regression slice**

```bash
node scripts/simplified-budget-foundation.test.mjs
node scripts/head-office-budget-client.test.mjs
node scripts/budget-document-storage.test.mjs
node scripts/simplified-budget-entry-ui.test.mjs
node scripts/budget-lock-document-control.test.mjs
node scripts/simplified-budget-activation.test.mjs
node scripts/budget-activation-control.test.mjs
node scripts/budget-activation-approved-spec-conformance.test.mjs
bun run lint
bun run typecheck
bun run build
```

Expected: PASS after reconciling superseded activation assertions to the new approved design.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/budget/activation/page.tsx lib/head-office-budget.ts scripts/simplified-budget-activation.test.mjs .github/workflows/ci.yml scripts/budget-activation-control.test.mjs scripts/budget-activation-approved-spec-conformance.test.mjs
git commit -m "feat: add Registrar-authorised annual budget activation"
```

---

### Task 7: Validate database migration safely before live deployment

**Files:**
- No new code unless validation identifies a defect.

**Interfaces:**
- Confirms migration is additive, idempotent, and does not modify existing financial rows.

- [ ] **Step 1: Capture pre-deployment row counts from live Supabase**

Read-only SQL for at least:

```sql
select 'budget_allocations' as table_name, count(*) from public.budget_allocations
union all select 'ff3_headers', count(*) from public.ff3_headers
union all select 'ff3_commitments', count(*) from public.ff3_commitments
union all select 'ff4_headers', count(*) from public.ff4_headers
union all select 'divisional_budget_submissions', count(*) from public.divisional_budget_submissions
union all select 'divisional_budget_lines', count(*) from public.divisional_budget_lines;
```

- [ ] **Step 2: Apply the migration through the managed migration interface, not raw DDL SQL**

Deploy `20260917010000_simplified_head_office_budget_foundation.sql` using Supabase `apply_migration` when that action is available in the execution environment.

- [ ] **Step 3: Run post-deployment structural checks**

Verify tables, RLS, bucket privacy, permissions, RPC `proconfig`/search paths, and direct authenticated table privileges.

- [ ] **Step 4: Recheck legacy row counts**

Expected: all legacy row counts from Step 1 are unchanged.

- [ ] **Step 5: Exercise only non-destructive smoke operations**

Create a dedicated test financial year only if project conventions permit isolated UAT records; otherwise stop at structural verification and wait for approved UAT data. Do not modify current production budget figures as part of migration validation.

- [ ] **Step 6: Record deployment evidence**

Add a short evidence note under `docs/governance/` containing migration version, deployed timestamp, pre/post row counts, RLS/security verification, and any deferred UAT items.

---

## Phase 1 Completion Gate

Phase 1 is complete only when:

1. New additive schema and private storage are deployed safely.
2. Budget Officer can create/edit Division drafts using Year → Division → Section → Ledger → Amount only.
3. Official Registrar-approved documents are privately stored and retrievable through signed URLs.
4. Division lock is impossible without official document evidence and makes original figures immutable.
5. The annual cycle becomes Ready only when all required Division budgets are locked.
6. Budget Officer can activate only after Registrar activation authority is recorded.
7. Existing FF3/FF4/commitment/payment rows remain unchanged by the migration.
8. CI, lint, typecheck, build, and the relevant regression suite are green.

The next plan after this gate is `Simplified Budget Adjustments and Registrar Reallocation`, followed by `FF3 Insufficient-Budget Review Integration`, then `FF4/Reporting Reconciliation and Legacy Retirement`.