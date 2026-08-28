# Task 9 Approved-Spec Conformance Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the already-merged Task 9 operational budget activation implementation into full conformance with the stricter approved 28 August 2026 architecture: canonical Finance mapping records, exact Cost Centre foreign keys, deterministic stale-state fingerprints, immutable activation snapshots, complete notification deep-links, and production reconciliation safeguards.

**Architecture:** Task 9 is already merged on `main` at commit `2c3cc756147a0adb587e1164955f595d655116bb`, including migrations 056–060, the activation API/service/UI, Finance Mapping screen and regression checks. This plan is therefore an incremental hardening delta beginning at migration 061; it preserves the working 056–060 dual-control flow while replacing legacy pointer/name-based activation resolution with explicit canonical mapping and foreign-key controls.

**Tech Stack:** Next.js 16.2.4 App Router, React 19.2.4, TypeScript 5, Supabase/PostgreSQL, `@supabase/ssr`, Node `.mjs` regression scripts, GitHub Actions CI, Netlify.

**Spec:** `docs/superpowers/specs/2026-08-28-operational-budget-activation-finance-master-data-design.md`

## Global Constraints

- Do not modify approved budget quantities, unit costs, monthly cash flow, annual estimates, source Finance Codes, or approved business workflow history during activation hardening.
- System Administrator prepares/validates/submits activation; Registrar alone authorises final activation.
- `APPROVE` remains business approval only and must never create `budget_allocations`.
- No first-active-account, inferred Finance Code, Posting Code string inference, Cost Centre name fallback, or silent substitution is permitted.
- Every new operational allocation must resolve through one explicit active Finance Code → canonical mapping → Posting Code → Chart of Accounts → Cost Centre chain.
- Final activation remains atomic: if one source line fails, no new source lines may be activated.
- `ACTIVATED` remains terminal for initial baseline activation; Task 8 remains the post-activation supplementary/revision process.
- Existing FF3/FF4/payment records and active allocation lineage must not be deleted, re-keyed, or silently rewritten.
- Existing legacy reciprocal pointers `expense_ledger.expense_code_registry_id` and `expense_code_registry.expense_ledger_id` may remain for backward compatibility, but Task 9 activation must no longer rely on them as the authoritative mapping source.
- Production secrets remain outside source control.
- Before modifying any Next.js route or page, read the relevant installed Next.js 16.2.4 guide under `node_modules/next/dist/docs/` as required by `AGENTS.md`.
- Migrations 056–060 are historical and must not be edited after merge; all database hardening is additive from migration 061 onward.

---

## File Structure and Responsibility Map

- `scripts/budget-activation-approved-spec-conformance.test.mjs` — static regression contract for the newly approved stricter architecture.
- `.github/workflows/ci.yml` — executes the new conformance contract with the existing Task 9, Task 8, lint, typecheck and build gates.
- `supabase/migrations/061_explicit_finance_posting_mapping_and_cost_centre_fk.sql` — canonical mapping table, exact `budget_divisions.cost_centre_id`, mapping administration RPCs/view, report permission and deterministic legacy backfill.
- `supabase/migrations/062_budget_activation_fingerprint_and_immutable_snapshot.sql` — mapping-aware staging, deterministic fingerprint, stale-preparation protection, immutable post-activation snapshots and revised prepare/submit/activate RPCs.
- `supabase/migrations/063_budget_activation_fk_only_guards.sql` — replaces migration-058/060 guard behavior with exact foreign-key/canonical-mapping checks only; removes all Cost Centre name/string fallback from the live transaction boundary.
- `lib/finance-posting-mapping.ts` — typed client access to canonical Finance mapping administration data and secured mapping RPCs.
- `lib/budget-activation.ts` — extended activation types, fingerprint state and immutable snapshot retrieval.
- `app/api/budget-activation/route.ts` — secured mutation endpoint; translates a committed stale-fingerprint return into HTTP 409 without rolling back the database state change.
- `app/dashboard/master/finance-mapping/page.tsx` — canonical Finance mapping register/editor with all approved columns and statuses.
- `app/dashboard/master/page.tsx` — Posting Code builder integration so a System Administrator can establish an explicit canonical Finance/CoA relationship after creating a controlled posting code.
- `app/dashboard/budget/activation/page.tsx` — batch deep-linking, fingerprint/stale-state visibility, role-specific queues and immutable activation history.
- `lib/notifications.ts` — Task 9 notification/reference type definitions.
- `components/NotificationsDropdown.tsx` — Task 9 notification icon/link routing.
- `app/dashboard/notifications/page.tsx` — Task 9 filter and deep-link routing.
- Existing `scripts/ff3-lookup-behavior.test.mjs`, `scripts/budget-revision-workspace.test.mjs`, and `scripts/budget-revision-hardening.test.mjs` — downstream compatibility gates; change only if an approved-spec assertion cannot be expressed in the new conformance script.

---

### Task 1: Add the RED approved-spec conformance contract

**Files:**
- Create: `scripts/budget-activation-approved-spec-conformance.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: merged Task 9 files/migrations 056–060 and the approved design spec.
- Produces: a CI contract that stays red until migrations 061–063 and the application hardening are complete.

- [ ] **Step 1: Create the failing conformance script**

Create `scripts/budget-activation-approved-spec-conformance.test.mjs`:

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')
const migration061 = 'supabase/migrations/061_explicit_finance_posting_mapping_and_cost_centre_fk.sql'
const migration062 = 'supabase/migrations/062_budget_activation_fingerprint_and_immutable_snapshot.sql'
const migration063 = 'supabase/migrations/063_budget_activation_fk_only_guards.sql'

for (const path of [migration061, migration062, migration063]) {
  assert.ok(fs.existsSync(path), `missing ${path}`)
}

const m61 = read(migration061)
const m62 = read(migration062)
const m63 = read(migration063)

for (const token of [
  'finance_posting_mappings',
  'budget_divisions',
  'cost_centre_id',
  'njss_resolve_finance_posting_mapping',
  'njss_upsert_finance_posting_mapping',
  'njss_deactivate_finance_posting_mapping',
  'v_finance_posting_mapping_admin',
  'budget.activation.report',
]) assert.ok(m61.includes(token), `migration 061 missing ${token}`)

for (const token of [
  'validation_fingerprint',
  'prepared_against_submission_updated_at',
  'finance_posting_mapping_id',
  'budget_activation_line_snapshots',
  'budget_allocation_id',
  'njss_budget_activation_fingerprint',
  'VALIDATION_FAILED',
]) assert.ok(m62.includes(token), `migration 062 missing ${token}`)

assert.match(m62, /digest\s*\(/i, 'fingerprint must be cryptographic and deterministic')
assert.match(m62, /WITH\s+inserted_allocations\s+AS\s*\([\s\S]*INSERT\s+INTO\s+budget_allocations[\s\S]*RETURNING[\s\S]*source_budget_line_id/i)
assert.match(m62, /INSERT\s+INTO\s+budget_activation_line_snapshots/i)
assert.match(m62, /UPDATE\s+budget_activation_batches[\s\S]*status\s*=\s*'VALIDATION_FAILED'[\s\S]*validation_fingerprint\s*=\s*NULL/i)

for (const source of [m62, m63]) {
  assert.doesNotMatch(source, /cost_centre_name/i, 'activation hardening must not resolve Cost Centre by name')
  assert.doesNotMatch(source, /submission_cost_centre/i, 'activation hardening must not resolve Cost Centre from free-text submission value')
  assert.doesNotMatch(source, /cc\.name\s*=|lower\s*\(\s*trim\s*\(\s*coalesce\s*\(\s*[^)]*cc\.name/i, 'no Cost Centre name fallback is allowed')
}

const service = read('lib/budget-activation.ts')
for (const token of ['validation_fingerprint', 'finance_posting_mapping_id', 'getBudgetActivationSnapshots']) {
  assert.ok(service.includes(token), `budget activation service missing ${token}`)
}

const mappingService = read('lib/finance-posting-mapping.ts')
for (const token of ['FinancePostingMapping', 'getFinancePostingMappings', 'saveFinancePostingMapping', 'deactivateFinancePostingMapping']) {
  assert.ok(mappingService.includes(token), `finance mapping service missing ${token}`)
}

const api = read('app/api/budget-activation/route.ts')
assert.match(api, /status\s*===\s*['"]VALIDATION_FAILED['"][\s\S]*409/, 'stale activation must return HTTP 409 after committing validation failure')

const notificationTypes = read('lib/notifications.ts')
assert.ok(notificationTypes.includes("'BUDGET_ACTIVATION_READY'"))
assert.ok(notificationTypes.includes("'BUDGET_ACTIVATED'"))
assert.ok(notificationTypes.includes("'BUDGET_ACTIVATION'"))

for (const path of ['components/NotificationsDropdown.tsx', 'app/dashboard/notifications/page.tsx']) {
  const source = read(path)
  assert.ok(source.includes("reference_type === 'BUDGET_ACTIVATION'"), `${path} missing activation deep-link routing`)
  assert.ok(source.includes('/dashboard/budget/activation?batch='), `${path} missing exact batch link`)
}

const activationPage = read('app/dashboard/budget/activation/page.tsx')
for (const token of ['useSearchParams', 'validation_fingerprint', 'getBudgetActivationSnapshots', 'Activated History']) {
  assert.ok(activationPage.includes(token), `activation page missing ${token}`)
}

const mappingPage = read('app/dashboard/master/finance-mapping/page.tsx')
for (const label of ['Section', 'Category', 'Expense Item', 'Financial Year', 'Last Updated By', 'Last Updated At', 'Ambiguous Mapping']) {
  assert.ok(mappingPage.includes(label), `finance mapping page missing ${label}`)
}

console.log('approved Task 9 spec conformance checks passed')
```

- [ ] **Step 2: Add the new regression to CI immediately after the existing Task 9 regression**

Add to `.github/workflows/ci.yml`:

```yaml
      - name: Approved Task 9 spec conformance checks
        run: node scripts/budget-activation-approved-spec-conformance.test.mjs
```

- [ ] **Step 3: Verify RED**

Run:

```bash
node scripts/budget-activation-approved-spec-conformance.test.mjs
```

Expected: failure on missing migration 061.

- [ ] **Step 4: Commit the RED contract**

```bash
git add scripts/budget-activation-approved-spec-conformance.test.mjs .github/workflows/ci.yml
git commit -m "test: define approved Task 9 conformance contract"
```

---

### Task 2: Add canonical Finance mapping and exact Budget Division Cost Centre ownership

**Files:**
- Create: `supabase/migrations/061_explicit_finance_posting_mapping_and_cost_centre_fk.sql`
- Test: `scripts/budget-activation-approved-spec-conformance.test.mjs`

**Interfaces:**
- Consumes: `expense_ledger`, `expense_code_registry`, `chart_of_accounts`, `cost_centres`, `departments`, `sections`, `budget_divisions`, `users`, `roles`, `user_roles`, `log_audit_event`.
- Produces:
  - table `finance_posting_mappings`;
  - `budget_divisions.cost_centre_id`;
  - `njss_resolve_finance_posting_mapping(UUID,INTEGER,UUID)`;
  - `njss_upsert_finance_posting_mapping(UUID,INTEGER,UUID,UUID,UUID,UUID,UUID,UUID,TEXT)`;
  - `njss_deactivate_finance_posting_mapping(UUID,TEXT)`;
  - view `v_finance_posting_mapping_admin`;
  - permission `budget.activation.report`.

- [ ] **Step 1: Add the exact Cost Centre foreign key and deterministic code-only backfill**

Migration 061 starts with `BEGIN;` and adds:

```sql
ALTER TABLE budget_divisions
  ADD COLUMN IF NOT EXISTS cost_centre_id UUID REFERENCES cost_centres(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_budget_divisions_cost_centre_id
  ON budget_divisions(cost_centre_id)
  WHERE cost_centre_id IS NOT NULL;

UPDATE budget_divisions bd
SET cost_centre_id = candidate.id
FROM LATERAL (
  SELECT cc.id
  FROM cost_centres cc
  WHERE cc.is_active = true
    AND NULLIF(trim(bd.cost_centre_code), '') IS NOT NULL
    AND upper(trim(cc.code)) = upper(trim(bd.cost_centre_code))
    AND (bd.department_id IS NULL OR cc.department_id = bd.department_id)
    AND (bd.section_id IS NULL OR cc.section_id IS NULL OR cc.section_id = bd.section_id)
  GROUP BY cc.id
  HAVING COUNT(*) = 1
  LIMIT 1
) candidate
WHERE bd.cost_centre_id IS NULL
  AND 1 = (
    SELECT COUNT(*)
    FROM cost_centres cc2
    WHERE cc2.is_active = true
      AND upper(trim(cc2.code)) = upper(trim(bd.cost_centre_code))
      AND (bd.department_id IS NULL OR cc2.department_id = bd.department_id)
      AND (bd.section_id IS NULL OR cc2.section_id IS NULL OR cc2.section_id = bd.section_id)
  );
```

Do not use `cost_centre_name` for backfill. Unresolved divisions stay `NULL` and are blocked by activation validation.

- [ ] **Step 2: Create the canonical mapping table**

```sql
CREATE TABLE IF NOT EXISTS finance_posting_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year INTEGER,
  expense_ledger_id UUID NOT NULL REFERENCES expense_ledger(id) ON DELETE RESTRICT,
  expense_code_registry_id UUID NOT NULL REFERENCES expense_code_registry(id) ON DELETE RESTRICT,
  chart_of_account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  cost_centre_id UUID NOT NULL REFERENCES cost_centres(id) ON DELETE RESTRICT,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  section_id UUID REFERENCES sections(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  mapping_notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  deactivated_at TIMESTAMPTZ,
  deactivation_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_mapping_active_specific_year
  ON finance_posting_mappings(expense_ledger_id, cost_centre_id, financial_year)
  WHERE is_active = true AND financial_year IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_mapping_active_generic
  ON finance_posting_mappings(expense_ledger_id, cost_centre_id)
  WHERE is_active = true AND financial_year IS NULL;
```

This permits one generic mapping plus a more specific year mapping; the resolver always prefers the exact financial year.

- [ ] **Step 3: Backfill only deterministic reciprocal legacy mappings**

Backfill rows only when all existing references are active, reciprocal and complete:

```sql
INSERT INTO finance_posting_mappings (
  financial_year, expense_ledger_id, expense_code_registry_id,
  chart_of_account_id, cost_centre_id, department_id, section_id,
  is_active, mapping_notes
)
SELECT
  ecr.financial_year,
  el.id,
  ecr.id,
  ecr.chart_of_account_id,
  ecr.cost_centre_id,
  ecr.department_id,
  ecr.section_id,
  true,
  'Deterministic legacy reciprocal mapping backfill from migration 061'
FROM expense_ledger el
JOIN expense_code_registry ecr
  ON ecr.id = el.expense_code_registry_id
 AND ecr.expense_ledger_id = el.id
JOIN chart_of_accounts coa
  ON coa.id = ecr.chart_of_account_id AND coa.is_active = true
JOIN cost_centres cc
  ON cc.id = ecr.cost_centre_id AND cc.is_active = true
JOIN departments d
  ON d.id = ecr.department_id AND d.is_active = true
WHERE el.is_active = true
  AND el.is_posting = true
  AND ecr.is_active = true
  AND cc.department_id = d.id
  AND (ecr.section_id IS NULL OR cc.section_id IS NULL OR cc.section_id = ecr.section_id)
ON CONFLICT DO NOTHING;
```

Do not manufacture a mapping when any required relationship is missing or ambiguous.

- [ ] **Step 4: Add a deterministic resolver with exact-year precedence**

```sql
CREATE OR REPLACE FUNCTION public.njss_resolve_finance_posting_mapping(
  p_expense_ledger_id UUID,
  p_financial_year INTEGER,
  p_cost_centre_id UUID
)
RETURNS finance_posting_mappings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result finance_posting_mappings;
  v_count INTEGER;
  v_use_exact BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM finance_posting_mappings fpm
    WHERE fpm.is_active = true
      AND fpm.expense_ledger_id = p_expense_ledger_id
      AND fpm.cost_centre_id = p_cost_centre_id
      AND fpm.financial_year = p_financial_year
  ) INTO v_use_exact;

  SELECT COUNT(*), (array_agg(fpm ORDER BY fpm.updated_at DESC))[1]
  INTO v_count, v_result
  FROM finance_posting_mappings fpm
  WHERE fpm.is_active = true
    AND fpm.expense_ledger_id = p_expense_ledger_id
    AND fpm.cost_centre_id = p_cost_centre_id
    AND (
      (v_use_exact AND fpm.financial_year = p_financial_year)
      OR (NOT v_use_exact AND fpm.financial_year IS NULL)
    );

  IF v_count = 0 THEN
    RETURN NULL;
  END IF;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Finance Code must resolve to exactly one active canonical posting mapping for the approved Cost Centre and financial year.';
  END IF;
  RETURN v_result;
END;
$$;
```

If PostgreSQL composite `array_agg` syntax is rejected in the implementation environment, use a `SELECT ... INTO v_result` plus a separate count query; the function signature and exact-year precedence must remain unchanged.

- [ ] **Step 5: Add guarded mapping upsert/deactivation RPCs**

`njss_upsert_finance_posting_mapping(...)` must:
- resolve actor with `fn_current_app_user_id()`;
- require active `System Administrator` through `njss_current_user_has_role('System Administrator')`;
- require active posting `expense_ledger`;
- require active Posting Code, CoA and Cost Centre;
- require `department_id = cost_centres.department_id`;
- require Section consistency when Section is present;
- reject a supplied Department/Section that differs from the controlled Posting Code/Cost Centre organization;
- insert/update one canonical row;
- audit `FINANCE_POSTING_MAPPING_CREATED` or `FINANCE_POSTING_MAPPING_UPDATED`.

Use this exact public signature:

```sql
public.njss_upsert_finance_posting_mapping(
  p_mapping_id UUID,
  p_financial_year INTEGER,
  p_expense_ledger_id UUID,
  p_expense_code_registry_id UUID,
  p_chart_of_account_id UUID,
  p_cost_centre_id UUID,
  p_department_id UUID,
  p_section_id UUID,
  p_mapping_notes TEXT
) RETURNS finance_posting_mappings
```

Use this deactivation signature:

```sql
public.njss_deactivate_finance_posting_mapping(
  p_mapping_id UUID,
  p_reason TEXT
) RETURNS finance_posting_mappings
```

Deactivation requires a non-blank reason and writes `FINANCE_POSTING_MAPPING_DEACTIVATED`.

- [ ] **Step 6: Add the administration view and report permission**

Create `v_finance_posting_mapping_admin` containing mapping id/status, Finance Code/description, Posting Code/description, Department, Section, Cost Centre, Category, Expense Item, Chart of Accounts, Financial Year, created/updated actor/time and a derived mapping status.

Add:

```sql
INSERT INTO permissions (code, module_code, menu_code, action, label, description, is_active)
VALUES ('budget.activation.report','budget','budget.activation','report','Report budget activation','View activation reconciliation, mapping and immutable activation history',true)
ON CONFLICT (code) DO UPDATE SET is_active = true, label = EXCLUDED.label, description = EXCLUDED.description;
```

Grant `budget.activation.report` to System Administrator and Registrar. Keep mutation RPC role checks exact; `all` is never Registrar authority.

- [ ] **Step 7: Harden grants/RLS and commit**

Enable RLS on `finance_posting_mappings`; permit SELECT to System Administrator/Registrar where appropriate, but revoke direct authenticated INSERT/UPDATE/DELETE. Grant mutation only through the secured RPCs. End migration with `COMMIT;`.

Run:

```bash
node scripts/budget-activation-approved-spec-conformance.test.mjs
```

Expected: migration-061 checks pass; failure moves to missing migration-062 behavior.

Commit:

```bash
git add supabase/migrations/061_explicit_finance_posting_mapping_and_cost_centre_fk.sql
git commit -m "feat: add canonical finance posting mappings"
```

---

### Task 3: Add deterministic activation fingerprint and immutable post-activation snapshots

**Files:**
- Create: `supabase/migrations/062_budget_activation_fingerprint_and_immutable_snapshot.sql`
- Test: `scripts/budget-activation-approved-spec-conformance.test.mjs`

**Interfaces:**
- Consumes: Task 2 canonical mapping resolver/table plus current `budget_activation_batches`, `budget_activation_lines`, source budget tables and `budget_allocations`.
- Produces:
  - `budget_activation_batches.validation_fingerprint TEXT`;
  - `budget_activation_batches.prepared_against_submission_updated_at TIMESTAMPTZ`;
  - `budget_activation_lines.finance_posting_mapping_id UUID`;
  - immutable `budget_activation_line_snapshots`;
  - `njss_budget_activation_fingerprint(UUID) RETURNS TEXT`;
  - revised `njss_prepare_budget_activation`, `njss_submit_budget_activation`, `njss_activate_approved_budget`.

- [ ] **Step 1: Extend the batch/staging schema and create immutable snapshots**

Add:

```sql
ALTER TABLE budget_activation_batches
  ADD COLUMN IF NOT EXISTS validation_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS prepared_against_submission_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validation_error_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE budget_activation_lines
  ADD COLUMN IF NOT EXISTS finance_posting_mapping_id UUID REFERENCES finance_posting_mappings(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS budget_activation_line_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_batch_id UUID NOT NULL REFERENCES budget_activation_batches(id) ON DELETE RESTRICT,
  source_budget_submission_id UUID NOT NULL REFERENCES divisional_budget_submissions(id) ON DELETE RESTRICT,
  source_budget_line_id UUID NOT NULL REFERENCES divisional_budget_lines(id) ON DELETE RESTRICT,
  budget_allocation_id UUID NOT NULL UNIQUE REFERENCES budget_allocations(id) ON DELETE RESTRICT,
  finance_posting_mapping_id UUID NOT NULL REFERENCES finance_posting_mappings(id) ON DELETE RESTRICT,
  expense_ledger_id UUID NOT NULL REFERENCES expense_ledger(id) ON DELETE RESTRICT,
  finance_code_snapshot TEXT NOT NULL,
  finance_description_snapshot TEXT,
  expense_code_registry_id UUID NOT NULL REFERENCES expense_code_registry(id) ON DELETE RESTRICT,
  posting_code_snapshot TEXT NOT NULL,
  posting_description_snapshot TEXT,
  chart_of_account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  chart_account_code_snapshot TEXT NOT NULL,
  chart_account_name_snapshot TEXT,
  cost_centre_id UUID NOT NULL REFERENCES cost_centres(id) ON DELETE RESTRICT,
  cost_centre_code_snapshot TEXT NOT NULL,
  cost_centre_name_snapshot TEXT,
  approved_amount NUMERIC(15,2) NOT NULL,
  monthly_cashflow_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (activation_batch_id, source_budget_line_id)
);
```

- [ ] **Step 2: Enforce snapshot immutability**

Create a trigger function that raises on UPDATE or DELETE:

```sql
CREATE OR REPLACE FUNCTION public.njss_block_activation_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Activated budget line snapshots are immutable.';
END;
$$;
```

Attach `BEFORE UPDATE OR DELETE` to `budget_activation_line_snapshots`. Authenticated clients receive SELECT only; no direct mutation grants.

- [ ] **Step 3: Implement the deterministic fingerprint helper**

Use `pgcrypto.digest` over a canonical JSON payload sorted by source line id. The payload must include source submission id/version/update timestamp, each source line id/amount/Finance Code id, monthly amounts, canonical mapping id, Posting Code id, CoA id and Cost Centre id.

The helper signature is:

```sql
public.njss_budget_activation_fingerprint(p_activation_batch_id UUID)
RETURNS TEXT
```

Core digest form:

```sql
SELECT encode(
  digest(
    convert_to(
      jsonb_build_object(
        'submission_id', s.id,
        'submission_version', s.version,
        'submission_updated_at', s.updated_at,
        'lines', jsonb_agg(
          jsonb_build_object(
            'line_id', l.id,
            'annual_estimate', l.annual_estimate,
            'expense_ledger_id', l.expense_ledger_id,
            'monthly', monthly.months,
            'mapping_id', bal.finance_posting_mapping_id,
            'posting_code_id', bal.expense_code_registry_id,
            'chart_of_account_id', bal.chart_of_account_id,
            'cost_centre_id', bal.cost_centre_id
          ) ORDER BY l.id::text
        )
      )::text,
      'UTF8'
    ),
    'sha256'
  ),
  'hex'
)
```

Construct `monthly.months` with a deterministic ordered JSON representation from `budget_monthly_allocations`; do not hash timestamps alone in place of amounts.

- [ ] **Step 4: Redefine preparation to use only canonical mapping + exact division Cost Centre FK**

`njss_prepare_budget_activation` must no longer resolve through `expense_ledger.expense_code_registry_id` or `budget_divisions.cost_centre_code/name`. For each line:

1. require `budget_divisions.cost_centre_id`;
2. call/resolve `njss_resolve_finance_posting_mapping(l.expense_ledger_id, s.budget_year, bd.cost_centre_id)`;
3. verify mapping Department/Section against approved organization;
4. verify Posting Code, CoA and Cost Centre remain active;
5. store `finance_posting_mapping_id` plus exact ids in `budget_activation_lines`;
6. classify zero/partial/complete existing active allocations across the whole submission.

Partial legacy state must be a batch-level error:

```sql
IF v_existing_allocation_count > 0
   AND v_existing_allocation_count < v_approved_count THEN
  UPDATE budget_activation_batches
  SET status = 'VALIDATION_FAILED',
      validation_error_count = validation_error_count + 1,
      validation_fingerprint = NULL,
      validation_snapshot = validation_snapshot || jsonb_build_object(
        'legacy_allocation_state', 'PARTIAL',
        'legacy_allocation_count', v_existing_allocation_count,
        'approved_line_count', v_approved_count,
        'error', 'Partial legacy operational allocation requires reconciliation; activation will not auto-complete it.'
      )
  WHERE id = p_activation_batch_id;
END IF;
```

A complete legacy allocation set is preserved and reported; it must not be reinserted or remapped.

- [ ] **Step 5: Store the fingerprint only when System Administrator submits a valid batch**

After `njss_submit_budget_activation` re-prepares and confirms all counts/totals, set:

```sql
UPDATE budget_activation_batches
SET status = 'READY_FOR_ACTIVATION',
    validation_fingerprint = public.njss_budget_activation_fingerprint(id),
    prepared_against_submission_updated_at = (
      SELECT s.updated_at FROM divisional_budget_submissions s WHERE s.id = submission_id
    ),
    submitted_for_activation_at = NOW(),
    updated_at = NOW()
WHERE id = p_activation_batch_id;
```

The READY notification is sent only after the fingerprint is present.

- [ ] **Step 6: Make stale activation rejection persist instead of rolling back**

At the start of `njss_activate_approved_budget`, recompute the fingerprint inside the locked transaction. On mismatch, do **not** raise after updating state, because an exception would roll the update back. Persist the failure and return the batch without inserting allocations:

```sql
v_current_fingerprint := public.njss_budget_activation_fingerprint(p_activation_batch_id);

IF v_batch.validation_fingerprint IS NULL
   OR v_current_fingerprint IS DISTINCT FROM v_batch.validation_fingerprint THEN
  UPDATE budget_activation_batches
  SET status = 'VALIDATION_FAILED',
      validation_fingerprint = NULL,
      validation_error_count = GREATEST(validation_error_count, 1),
      validation_snapshot = validation_snapshot || jsonb_build_object(
        'stale_validation', true,
        'stale_detected_at', NOW(),
        'error', 'Technical mapping or approved budget state changed after Administrator validation. Re-prepare activation.'
      ),
      updated_at = NOW()
  WHERE id = p_activation_batch_id
  RETURNING * INTO v_out;

  RETURN v_out;
END IF;
```

The API translates this committed `VALIDATION_FAILED` return into HTTP 409 in Task 5.

- [ ] **Step 7: Insert operational allocations and immutable snapshots in one atomic statement**

Use one writable CTE so the snapshot captures each returned allocation id:

```sql
WITH inserted_allocations AS (
  INSERT INTO budget_allocations (
    financial_year, department_id, section_id, cost_centre_id,
    funding_source_id, account_id, expense_code_registry_id,
    source_budget_submission_id, source_budget_line_id, budget_division_id,
    source_module, original_budget, supplemental_budget, monthly_cashflow,
    q1_planned, q2_planned, q3_planned, q4_planned, is_active, created_by, updated_at
  )
  SELECT
    s.budget_year, fpm.department_id, fpm.section_id, fpm.cost_centre_id,
    l.funding_source_id, fpm.chart_of_account_id, fpm.expense_code_registry_id,
    s.id, l.id, s.division_id, 'EXCEL_BUDGET', l.annual_estimate, 0,
    monthly.monthly_cashflow,
    monthly.q1, monthly.q2, monthly.q3, monthly.q4,
    true, v_user_id, NOW()
  FROM budget_activation_lines bal
  JOIN finance_posting_mappings fpm ON fpm.id = bal.finance_posting_mapping_id AND fpm.is_active = true
  JOIN divisional_budget_lines l ON l.id = bal.budget_line_id
  JOIN divisional_budget_submissions s ON s.id = l.submission_id
  JOIN LATERAL public.njss_budget_line_monthly_snapshot(l.id) monthly ON true
  WHERE bal.activation_batch_id = p_activation_batch_id
    AND bal.mapping_status = 'READY'
  RETURNING id, source_budget_line_id
)
INSERT INTO budget_activation_line_snapshots (
  activation_batch_id, source_budget_submission_id, source_budget_line_id,
  budget_allocation_id, finance_posting_mapping_id, expense_ledger_id,
  finance_code_snapshot, finance_description_snapshot,
  expense_code_registry_id, posting_code_snapshot, posting_description_snapshot,
  chart_of_account_id, chart_account_code_snapshot, chart_account_name_snapshot,
  cost_centre_id, cost_centre_code_snapshot, cost_centre_name_snapshot,
  approved_amount, monthly_cashflow_snapshot
)
SELECT
  p_activation_batch_id, bab.submission_id, bal.budget_line_id,
  ia.id, bal.finance_posting_mapping_id, bal.expense_ledger_id,
  el.finance_code, el.standard_description,
  ecr.id, ecr.full_expense_code, ecr.description,
  coa.id, coa.account_code, coa.account_name,
  cc.id, cc.code, cc.name,
  bal.approved_amount, monthly.monthly_cashflow
FROM inserted_allocations ia
JOIN budget_activation_lines bal ON bal.budget_line_id = ia.source_budget_line_id AND bal.activation_batch_id = p_activation_batch_id
JOIN budget_activation_batches bab ON bab.id = bal.activation_batch_id
JOIN expense_ledger el ON el.id = bal.expense_ledger_id
JOIN expense_code_registry ecr ON ecr.id = bal.expense_code_registry_id
JOIN chart_of_accounts coa ON coa.id = bal.chart_of_account_id
JOIN cost_centres cc ON cc.id = bal.cost_centre_id
JOIN LATERAL public.njss_budget_line_monthly_snapshot(bal.budget_line_id) monthly ON true;
```

Implement `njss_budget_line_monthly_snapshot(UUID)` in the same migration to return `monthly_cashflow JSONB, q1 NUMERIC, q2 NUMERIC, q3 NUMERIC, q4 NUMERIC` from authoritative monthly rows.

After the statement, require snapshot insert count = approved line count before setting `ACTIVATED`.

- [ ] **Step 8: Preserve audit and notification behavior, then commit**

Keep `BUDGET_ACTIVATION_READY`, `BUDGET_ACTIVATED`, preparer/authoriser ids/timestamps, totals and K0.00 variance. Add fingerprint and immutable snapshot counts to audit metadata.

Run:

```bash
node scripts/budget-activation-approved-spec-conformance.test.mjs
```

Expected: migration-061/062 checks pass; failure moves to migration-063 or UI/service gaps.

Commit:

```bash
git add supabase/migrations/062_budget_activation_fingerprint_and_immutable_snapshot.sql
git commit -m "feat: add activation fingerprint and immutable snapshots"
```

---

### Task 4: Replace live activation guards with exact FK-only canonical mapping checks

**Files:**
- Create: `supabase/migrations/063_budget_activation_fk_only_guards.sql`
- Test: `scripts/budget-activation-approved-spec-conformance.test.mjs`

**Interfaces:**
- Consumes: `budget_divisions.cost_centre_id`, `finance_posting_mappings`, `budget_activation_lines.finance_posting_mapping_id` and immutable snapshots.
- Produces: replacement `njss_guard_budget_activation_line_org()` and `njss_guard_operational_allocation_org()` logic with no name/free-text fallback.

- [ ] **Step 1: Replace the staging-line organization guard**

Redefine `njss_guard_budget_activation_line_org()` so expected ownership is obtained only from:

```sql
SELECT
  COALESCE(s.department_id, bd.department_id),
  bd.section_id,
  bd.cost_centre_id
INTO v_expected_department_id, v_expected_section_id, v_expected_cost_centre_id
FROM budget_activation_batches bab
JOIN divisional_budget_submissions s ON s.id = bab.submission_id
JOIN budget_divisions bd ON bd.id = s.division_id
WHERE bab.id = NEW.activation_batch_id;
```

If `v_expected_cost_centre_id IS NULL`, mark the line invalid with `Approved budget Division has no exact Cost Centre mapping.` No code/name lookup is permitted.

Require `NEW.cost_centre_id = v_expected_cost_centre_id`, and require the selected `finance_posting_mapping_id` to contain the same Cost Centre/Department/Section.

- [ ] **Step 2: Replace the operational-allocation transaction-boundary guard**

Redefine `njss_guard_operational_allocation_org()` so the protected `EXCEL_BUDGET` insert verifies:
- source submission is still APPROVED;
- source line belongs to source submission/division/year;
- `budget_divisions.cost_centre_id = NEW.cost_centre_id`;
- matching READY activation line exists;
- matching active `finance_posting_mappings.id = bal.finance_posting_mapping_id` exists;
- mapping Finance Code, Posting Code, CoA, Cost Centre, Department and Section equal the inserted allocation dimensions;
- amount/funding/monthly totals remain authoritative.

Do not reference `cost_centre_name`, submission `cost_centre` free text, or compare `cc.name` anywhere in migration 063.

- [ ] **Step 3: Add explicit error messages**

Use deterministic messages including:
- `Approved budget Division has no exact Cost Centre mapping.`
- `Operational allocation Cost Centre does not match budget_divisions.cost_centre_id.`
- `Operational allocation has no matching active canonical Finance posting mapping.`
- `Operational allocation Finance/Posting/CoA lineage changed after activation validation.`

- [ ] **Step 4: Extend the queue view with fingerprint/reconciliation state**

Redefine `v_budget_activation_queue` to expose `validation_fingerprint`, `validation_error_count`, `prepared_against_submission_updated_at`, immutable snapshot count and derived `fingerprint_state`:

```sql
CASE
  WHEN bab.status = 'ACTIVATED' THEN 'ACTIVATED'
  WHEN bab.validation_fingerprint IS NULL THEN 'NOT_VALIDATED'
  ELSE 'VALIDATED'
END AS fingerprint_state
```

- [ ] **Step 5: Verify source-level no-name-fallback checks and commit**

Run:

```bash
node scripts/budget-activation-approved-spec-conformance.test.mjs
```

Expected: all database static conformance checks pass; next failure is application/service hardening.

Commit:

```bash
git add supabase/migrations/063_budget_activation_fk_only_guards.sql
git commit -m "fix: enforce exact activation organization mappings"
```

---

### Task 5: Extend activation service/API for fingerprint state and immutable history

**Files:**
- Modify: `lib/budget-activation.ts`
- Modify: `app/api/budget-activation/route.ts`
- Test: `scripts/budget-activation-approved-spec-conformance.test.mjs`

**Interfaces:**
- Consumes: queue/view/RPCs from Tasks 3–4.
- Produces:
  - `BudgetActivationBatch.validation_fingerprint` and fingerprint metadata;
  - `BudgetActivationLine.finance_posting_mapping_id`;
  - `BudgetActivationSnapshot`;
  - `getBudgetActivationSnapshots(batchId)`;
  - HTTP 409 response for committed stale activation state.

- [ ] **Step 1: Read installed Next.js route-handler documentation**

Before changing `app/api/budget-activation/route.ts`, read the relevant Next.js 16.2.4 route-handler documentation under `node_modules/next/dist/docs/`. Record no code changes from training-memory assumptions that conflict with installed docs.

- [ ] **Step 2: Extend service types**

Add to `BudgetActivationBatch`:

```ts
validation_fingerprint: string | null
validation_error_count: number
prepared_against_submission_updated_at: string | null
fingerprint_state?: 'NOT_VALIDATED' | 'VALIDATED' | 'ACTIVATED'
activation_snapshot_count?: number
```

Add to `BudgetActivationLine`:

```ts
finance_posting_mapping_id: string | null
```

Add:

```ts
export type BudgetActivationSnapshot = {
  id: string
  activation_batch_id: string
  source_budget_submission_id: string
  source_budget_line_id: string
  budget_allocation_id: string
  finance_posting_mapping_id: string
  finance_code_snapshot: string
  finance_description_snapshot: string | null
  posting_code_snapshot: string
  posting_description_snapshot: string | null
  chart_account_code_snapshot: string
  chart_account_name_snapshot: string | null
  cost_centre_code_snapshot: string
  cost_centre_name_snapshot: string | null
  approved_amount: number
  monthly_cashflow_snapshot: Record<string, number>
  created_at: string
}
```

- [ ] **Step 3: Add immutable snapshot retrieval**

```ts
export async function getBudgetActivationSnapshots(batchId: string): Promise<BudgetActivationSnapshot[]> {
  const { data, error } = await supabase
    .from('budget_activation_line_snapshots')
    .select('*')
    .eq('activation_batch_id', batchId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []) as BudgetActivationSnapshot[]
}
```

- [ ] **Step 4: Translate committed stale validation to HTTP 409**

After the activation RPC succeeds at the protocol level, inspect the returned batch before returning HTTP 200:

```ts
if (rpc === 'njss_activate_approved_budget' && data?.status === 'VALIDATION_FAILED') {
  return NextResponse.json(
    {
      error: 'Technical mapping or approved budget state changed after Administrator validation. Re-prepare activation.',
      data,
    },
    { status: 409 },
  )
}
```

Do not convert this database return into an exception inside PostgreSQL; the `VALIDATION_FAILED` state must remain committed.

- [ ] **Step 5: Run conformance check and commit**

```bash
node scripts/budget-activation-approved-spec-conformance.test.mjs
git add lib/budget-activation.ts app/api/budget-activation/route.ts
git commit -m "feat: expose activation fingerprint and history"
```

Expected: service/API checks pass; remaining failures identify Finance Mapping UI/notifications/activation page.

---

### Task 6: Move Finance Mapping UI and Posting Code builder onto the canonical mapping model

**Files:**
- Create: `lib/finance-posting-mapping.ts`
- Modify: `app/dashboard/master/finance-mapping/page.tsx`
- Modify: `app/dashboard/master/page.tsx`
- Test: `scripts/budget-activation-approved-spec-conformance.test.mjs`
- Test: `scripts/ff3-lookup-behavior.test.mjs`

**Interfaces:**
- Consumes: `v_finance_posting_mapping_admin`, `njss_upsert_finance_posting_mapping`, `njss_deactivate_finance_posting_mapping`.
- Produces typed canonical mapping administration and a Posting Code creation workflow that can establish the explicit mapping without modifying an approved budget line.

- [ ] **Step 1: Read installed Next.js client-page documentation**

Before modifying either page, read the relevant Next.js 16.2.4 App Router/client component documentation under `node_modules/next/dist/docs/`.

- [ ] **Step 2: Create the canonical mapping service**

Create `lib/finance-posting-mapping.ts` with:

```ts
import { supabase } from './supabase'

export type FinancePostingMapping = {
  id: string
  financial_year: number | null
  expense_ledger_id: string
  finance_code: string
  finance_description: string | null
  expense_code_registry_id: string
  posting_code: string
  posting_description: string | null
  chart_of_account_id: string
  chart_account_code: string
  chart_account_name: string | null
  department_id: string
  department_code: string
  department_name: string
  section_id: string | null
  section_code: string | null
  section_name: string | null
  cost_centre_id: string
  cost_centre_code: string
  cost_centre_name: string
  expense_category_id: string | null
  expense_category_code: string | null
  expense_category_name: string | null
  expense_item_id: string | null
  expense_item_code: string | null
  expense_item_name: string | null
  mapping_status: string
  is_active: boolean
  mapping_notes: string | null
  updated_by_name: string | null
  updated_at: string
}

export async function getFinancePostingMappings(): Promise<FinancePostingMapping[]> {
  const { data, error } = await supabase.from('v_finance_posting_mapping_admin').select('*').order('finance_code')
  if (error) throw error
  return (data || []) as FinancePostingMapping[]
}

export async function saveFinancePostingMapping(input: {
  mappingId: string | null
  financialYear: number | null
  expenseLedgerId: string
  expenseCodeRegistryId: string
  chartOfAccountId: string
  costCentreId: string
  departmentId: string
  sectionId: string | null
  mappingNotes: string | null
}) {
  const { data, error } = await supabase.rpc('njss_upsert_finance_posting_mapping', {
    p_mapping_id: input.mappingId,
    p_financial_year: input.financialYear,
    p_expense_ledger_id: input.expenseLedgerId,
    p_expense_code_registry_id: input.expenseCodeRegistryId,
    p_chart_of_account_id: input.chartOfAccountId,
    p_cost_centre_id: input.costCentreId,
    p_department_id: input.departmentId,
    p_section_id: input.sectionId,
    p_mapping_notes: input.mappingNotes,
  })
  if (error) throw error
  return data
}

export async function deactivateFinancePostingMapping(mappingId: string, reason: string) {
  const { data, error } = await supabase.rpc('njss_deactivate_finance_posting_mapping', {
    p_mapping_id: mappingId,
    p_reason: reason,
  })
  if (error) throw error
  return data
}
```

- [ ] **Step 3: Rebuild the Finance Mapping register around canonical rows**

Change `app/dashboard/master/finance-mapping/page.tsx` to load the view/service rather than deriving readiness from reciprocal legacy pointers.

The table must visibly contain these exact headers:

```text
Finance Code
Finance Description
Department
Section
Cost Centre
Category
Expense Item
Posting Code
Chart of Accounts
Financial Year
Mapping Status
Last Updated By
Last Updated At
```

Derived statuses displayed by the view/UI must include at least:
- Ready
- Finance Code Missing
- Posting Code Missing
- Chart Account Missing
- Cost Centre Missing
- Ambiguous Mapping
- Inactive Reference

Editing/deactivation remains System Administrator only.

- [ ] **Step 4: Keep controlled Posting Code creation separate from approved budget values but allow explicit mapping completion**

In `app/dashboard/master/page.tsx`, extend the existing `Expense / Posting Codes` builder after Department → Cost Centre → Category → Item selection with optional controlled fields:
- Finance Code
- Chart of Accounts
- Financial Year/applicability

Create the Posting Code as today, return its new `id`, and when Finance Code + CoA are supplied call `saveFinancePostingMapping()` with the selected Department/Section/Cost Centre. If mapping inputs are omitted, the new code remains clearly `Incomplete`; do not auto-select an account or Finance Code.

The approved budget line itself is never updated by this builder.

- [ ] **Step 5: Verify UI/source and FF3 lookup regressions**

Run:

```bash
node scripts/budget-activation-approved-spec-conformance.test.mjs
node scripts/ff3-lookup-behavior.test.mjs
```

Expected: mapping page column checks pass and existing controlled Posting Code payload tests remain green.

- [ ] **Step 6: Commit**

```bash
git add lib/finance-posting-mapping.ts app/dashboard/master/finance-mapping/page.tsx app/dashboard/master/page.tsx
git commit -m "feat: harden canonical finance mapping administration"
```

---

### Task 7: Complete activation workspace deep-linking, role queues, fingerprint visibility and notifications

**Files:**
- Modify: `app/dashboard/budget/activation/page.tsx`
- Modify: `lib/notifications.ts`
- Modify: `components/NotificationsDropdown.tsx`
- Modify: `app/dashboard/notifications/page.tsx`
- Test: `scripts/budget-activation-approved-spec-conformance.test.mjs`

**Interfaces:**
- Consumes: Task 5 service types/snapshot loader and existing Task 8 notification framework.
- Produces exact `?batch=<id>` navigation, activation notification typing/routing, fingerprint state and immutable history display.

- [ ] **Step 1: Read installed Next.js `useSearchParams` documentation**

Read the installed Next.js 16.2.4 documentation for `useSearchParams` and client-side search parameter handling before changing the activation page.

- [ ] **Step 2: Add Task 9 notification types/reference type**

Extend `NotificationType` in `lib/notifications.ts`:

```ts
  | 'BUDGET_ACTIVATION_READY'
  | 'BUDGET_ACTIVATED'
```

Extend `createNotification` reference type union with:

```ts
'BUDGET_ACTIVATION'
```

- [ ] **Step 3: Deep-link both notification surfaces**

In both `components/NotificationsDropdown.tsx` and `app/dashboard/notifications/page.tsx`, add before fallback:

```ts
if (notification.reference_type === 'BUDGET_ACTIVATION') {
  return `/dashboard/budget/activation?batch=${encodeURIComponent(notification.reference_id)}`
}
```

Add `BUDGET_ACTIVATION` to the full notification-page type filter and use a budget/approval icon treatment consistent with the existing UI.

- [ ] **Step 4: Select the exact batch from `?batch=`**

In `app/dashboard/budget/activation/page.tsx`:

```ts
const searchParams = useSearchParams()
const requestedBatchId = searchParams.get('batch')
```

When queue data loads, prefer `requestedBatchId` if it exists in the authorised queue; otherwise preserve the current selection, then fall back to the first row. Never reveal a batch outside database RLS.

- [ ] **Step 5: Add fingerprint and immutable activation history**

Load `getBudgetActivationSnapshots(selected.id)` when status is `ACTIVATED`. Display:
- fingerprint state;
- abbreviated fingerprint (first/last 8 characters, not as a security secret but for audit correlation);
- prepared-against timestamp;
- activation snapshot count;
- immutable history table containing Finance Code, Posting Code, CoA, Cost Centre, approved amount and resulting allocation id.

For `VALIDATION_FAILED` after a stale activation attempt, show the explicit re-prepare requirement returned by the API.

- [ ] **Step 6: Align role-specific queue tabs with the approved spec**

System Administrator labels:
- Awaiting Preparation
- Mapping Issues
- Ready for Registrar
- Activated History

Registrar labels:
- Ready for My Action
- Activated History

Use the same authoritative queue data; these are filters only, not a new permission boundary.

- [ ] **Step 7: Run conformance test and commit**

```bash
node scripts/budget-activation-approved-spec-conformance.test.mjs
git add app/dashboard/budget/activation/page.tsx lib/notifications.ts components/NotificationsDropdown.tsx app/dashboard/notifications/page.tsx
git commit -m "feat: complete activation audit navigation"
```

Expected: approved Task 9 conformance source checks pass.

---

### Task 8: Prove FF3 and Task 8 remain gated by operational allocations

**Files:**
- Modify only if required by failing assertions: `scripts/budget-activation-approved-spec-conformance.test.mjs`
- Verify: `scripts/ff3-lookup-behavior.test.mjs`
- Verify: `scripts/budget-revision-workspace.test.mjs`
- Verify: `scripts/budget-revision-hardening.test.mjs`
- Verify: `scripts/budget-activation-control.test.mjs`

**Interfaces:**
- Consumes: current `v_budget_by_code`/`budget_allocations` consumption, FF3 lookup logic and Task 8 revision eligibility.
- Produces regression evidence that approved-but-unactivated budgets remain non-spendable and revisions still require operational lineage.

- [ ] **Step 1: Add source assertions for downstream gating where necessary**

The conformance script must verify that the operational budget views used by FF3 derive from active `budget_allocations`, not directly from `divisional_budget_submissions` merely because status is APPROVED. It must also verify Task 8 still contains the operational-allocation prerequisite.

Use source assertions against the current migration/view definitions rather than changing working FF3 business behavior unless a real bypass is found.

- [ ] **Step 2: Run the focused regression suite**

```bash
node scripts/budget-activation-control.test.mjs
node scripts/budget-activation-approved-spec-conformance.test.mjs
node scripts/ff3-lookup-behavior.test.mjs
node scripts/budget-revision-workspace.test.mjs
node scripts/budget-revision-hardening.test.mjs
```

Expected: all PASS.

- [ ] **Step 3: Run application quality gates**

```bash
bun run lint
bun run typecheck
bun run build
```

Expected: all exit 0.

- [ ] **Step 4: Commit only if regression files required adjustment**

If source assertions were added:

```bash
git add scripts/budget-activation-approved-spec-conformance.test.mjs
git commit -m "test: verify activation downstream controls"
```

If no regression file changed, do not create an empty commit.

---

### Task 9: Production reconciliation, migration gate and controlled UAT

**Files:**
- No application source change is required for this gate.
- Operational evidence may be recorded in the PR description or an approved deployment record; do not commit production secrets or live personal data.

**Interfaces:**
- Consumes: production read-only database access, CI/preview results and migrations 061–063.
- Produces: an explicit go/no-go classification for the current approved 68-line budget and a controlled deployment/UAT decision.

- [ ] **Step 1: Classify approved budgets before applying migration 061**

Run this read-only query against production/staging with authorised credentials:

```sql
WITH approved AS (
  SELECT
    s.id AS submission_id,
    s.submission_number,
    s.budget_year,
    s.department_id,
    s.division_id,
    COUNT(l.id)::INTEGER AS approved_line_count,
    COALESCE(SUM(l.annual_estimate),0)::NUMERIC(15,2) AS approved_total
  FROM divisional_budget_submissions s
  JOIN divisional_budget_lines l ON l.submission_id = s.id
  WHERE s.status = 'APPROVED'
  GROUP BY s.id, s.submission_number, s.budget_year, s.department_id, s.division_id
), allocated AS (
  SELECT
    ba.source_budget_submission_id AS submission_id,
    COUNT(*) FILTER (WHERE ba.is_active = true)::INTEGER AS active_allocation_count,
    COALESCE(SUM(ba.original_budget) FILTER (WHERE ba.is_active = true),0)::NUMERIC(15,2) AS active_allocation_total
  FROM budget_allocations ba
  WHERE ba.source_module = 'EXCEL_BUDGET'
    AND ba.source_budget_submission_id IS NOT NULL
  GROUP BY ba.source_budget_submission_id
)
SELECT
  a.*,
  COALESCE(x.active_allocation_count,0) AS active_allocation_count,
  COALESCE(x.active_allocation_total,0) AS active_allocation_total,
  CASE
    WHEN COALESCE(x.active_allocation_count,0) = 0 THEN 'ZERO'
    WHEN x.active_allocation_count = a.approved_line_count
         AND ABS(x.active_allocation_total - a.approved_total) <= 0.009 THEN 'COMPLETE'
    ELSE 'PARTIAL'
  END AS legacy_allocation_state
FROM approved a
LEFT JOIN allocated x ON x.submission_id = a.submission_id
ORDER BY a.budget_year DESC, a.submission_number;
```

Identify the expected 68-line approved submission by `approved_line_count = 68`; do not guess its UUID.

- [ ] **Step 2: Enforce the partial-allocation stop condition**

If the 68-line budget is `PARTIAL`, stop deployment/activation for that submission. Reconcile the legacy allocation rows manually through authorised finance governance; do not allow migration code or the activation RPC to silently complete the missing lines.

If `ZERO`, it proceeds through normal Task 9 preparation after migrations.

If `COMPLETE`, preserve the existing allocations and treat them as legacy operational lineage; do not remap or recreate them merely to generate a new Task 9 activation event.

- [ ] **Step 3: Confirm deterministic Cost Centre and mapping readiness**

Before production migration, run read-only diagnostics showing:
- approved divisions where `cost_centre_code` has zero or multiple exact active matches;
- reciprocal legacy Finance/Posting mappings missing CoA/Cost Centre/Department;
- duplicate active candidate mappings that would violate migration-061 uniqueness.

Any non-zero unresolved result is a remediation item for System Administrator before the relevant budget can reach READY_FOR_ACTIVATION.

- [ ] **Step 4: Verify branch CI and deployment preview before database migration**

Required gates:
- GitHub Actions green for the branch/PR;
- existing Task 9 regression green;
- approved-spec conformance regression green;
- Task 8 revision regressions green;
- lint, typecheck and production build green;
- Netlify deploy preview renders `/dashboard/budget/activation` and `/dashboard/master/finance-mapping` without runtime errors.

- [ ] **Step 5: Apply database changes strictly in order**

Apply:

```text
061_explicit_finance_posting_mapping_and_cost_centre_fk.sql
062_budget_activation_fingerprint_and_immutable_snapshot.sql
063_budget_activation_fk_only_guards.sql
```

Do not skip or reorder migrations.

- [ ] **Step 6: Post-migration verification**

Verify with read-only catalog/data queries:
- `budget_divisions.cost_centre_id` exists with FK;
- `finance_posting_mappings` exists with RLS and active uniqueness indexes;
- `budget_activation_batches.validation_fingerprint` exists;
- `budget_activation_lines.finance_posting_mapping_id` exists;
- `budget_activation_line_snapshots` exists and UPDATE/DELETE are blocked;
- `budget.activation.report` exists and role grants are correct;
- `njss_prepare_budget_activation`, `njss_submit_budget_activation`, `njss_activate_approved_budget` execute only under intended roles;
- no current guard function definition contains Cost Centre name/free-text fallback.

- [ ] **Step 7: Controlled UAT**

Use controlled UAT/test data, not invented live financial transactions:
1. Line Supervisor prepares/submits a budget.
2. Registrar reviews/approves it.
3. Confirm approval creates no operational allocation.
4. System Administrator opens Budget Activation.
5. Force one missing canonical mapping and confirm preparation shows the exact error.
6. Confirm Submit for Activation remains blocked.
7. Correct the canonical mapping in Finance Mapping.
8. Re-prepare; confirm line counts/totals reconcile and fingerprint is created only on Submit for Activation.
9. Change one activation-critical mapping after submission; Registrar activation must return HTTP 409, persist `VALIDATION_FAILED`, clear fingerprint and create zero allocations.
10. Re-prepare/re-submit without changing approved amounts.
11. Registrar activates.
12. Confirm all source lines create allocations atomically and immutable snapshots contain the returned allocation ids.
13. Confirm FF3 can consume the activated allocation and cannot consume a separate approved-but-unactivated budget.
14. Confirm Task 8 revision workflow recognises the activated baseline and preserves allocation lineage.
15. Confirm activation notifications open `/dashboard/budget/activation?batch=<id>` for the exact batch.

- [ ] **Step 8: Final full CI gate**

Run locally/CI:

```bash
node scripts/budget-activation-control.test.mjs
node scripts/budget-activation-approved-spec-conformance.test.mjs
node scripts/ff3-lookup-behavior.test.mjs
node scripts/budget-revision-workspace.test.mjs
node scripts/budget-revision-hardening.test.mjs
bun run lint
bun run typecheck
bun run build
```

Expected: all PASS/exit 0 before merge.

---

## Rollback and Failure Boundaries

- Application/UI commits may be reverted normally before production migration.
- Database migrations are additive. Do not roll back by deleting production finance data after activation has occurred.
- If migration 061 encounters duplicate/ambiguous mapping state, let it fail before creating unsafe uniqueness assumptions; resolve the data and rerun.
- If migration 062/063 has not yet been used to create new allocations, a forward-fix migration is preferred over editing historical migrations.
- Once a batch has `ACTIVATED` allocations/snapshots, never delete/re-key them as rollback. Correct subsequent issues through an audited forward migration or Task 8 budget-change process as appropriate.
- A stale fingerprint is not an exceptional database rollback condition: persist `VALIDATION_FAILED`, create no allocations and require System Administrator re-preparation.
- A partial legacy allocation is a deployment/activation stop condition for that submission, not an auto-repair case.

## Acceptance Mapping to Approved Spec

- Canonical `finance_posting_mappings`: Task 2.
- Exact `budget_divisions.cost_centre_id`; no name fallback: Tasks 2 and 4.
- Deterministic validation fingerprint and stale-state rejection: Task 3 plus Task 5 HTTP behavior.
- Immutable activation snapshot with `budget_allocation_id`: Task 3.
- `budget.activation.report`: Task 2.
- Full Finance Mapping columns/statuses and Posting Code builder integration: Task 6.
- Activation notification types and `?batch=` deep links: Task 7.
- Role-sensitive activation workspace and fingerprint/history display: Task 7.
- FF3 approved-but-unactivated gating and Task 8 compatibility: Task 8.
- 68-line zero/partial/complete classification and no silent legacy completion: Task 9.
- Atomic final allocation and K0.00 reconciliation: Task 3, rechecked in Tasks 8–9.
- No System Administrator final authorisation / Registrar technical preparation: existing 056 plus regression gates in Tasks 1, 3 and 8.

## Final Verification Sequence

Before calling this hardening complete, the executor must show evidence in this order:

```text
1. Existing Task 9 regression PASS
2. New approved-spec conformance regression PASS
3. FF3 lookup regression PASS
4. Task 8 workspace/hardening regressions PASS
5. Lint PASS
6. Typecheck PASS
7. Production build PASS
8. CI/Netlify preview PASS
9. Pre-migration 68-line classification recorded
10. Migrations 061 → 062 → 063 applied in order
11. Post-migration catalog/RLS/RPC checks PASS
12. Controlled dual-control UAT PASS
```
