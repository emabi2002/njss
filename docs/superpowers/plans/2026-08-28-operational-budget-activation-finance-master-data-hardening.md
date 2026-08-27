# Task 9 Operational Budget Activation & Finance Master-Data Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate approved-budget authority from operational allocation activation, remove fallback Chart of Accounts posting, and enforce System Administrator preparation plus Registrar authorisation before FF3/FF4 can consume approved budgets.

**Architecture:** Migration 056 becomes the authoritative transaction boundary: approval creates a draft activation batch but never operational allocations; System Administrator validation snapshots every approved line through exact Finance Code → Posting Code → Chart of Accounts mapping; Registrar activation revalidates and inserts all operational allocations atomically. A dedicated API/service/UI exposes the dual-control workflow while database role checks remain authoritative even when a System Administrator holds the broad `all` application permission.

**Tech Stack:** Next.js 16.2.4 App Router, React 19.2.4, TypeScript 5, Supabase/PostgreSQL, `@supabase/ssr`, Node regression scripts, GitHub Actions CI, Netlify.

**Spec:** `docs/superpowers/specs/2026-08-28-operational-budget-activation-finance-master-data-hardening-design.md`

## Global Constraints

- Do not modify approved budget quantities, unit costs, monthly cash flow, annual estimates, or source Finance Codes during activation.
- No first-active-account, inferred Finance Code, silent remapping, or partial operational allocation is permitted.
- System Administrator may prepare/validate/submit but must not authorise activation.
- Registrar may authorise activation but must not prepare technical mappings through the activation workflow.
- `ACTIVATED` is terminal for financial activation data.
- Existing approved submissions are not auto-activated by migration 056.
- Task 8 revision eligibility remains dependent on exactly one valid active operational allocation per approved source line.
- Production secrets must stay outside source control.

---

### Task 1: Add the failing Task 9 regression contract

**Files:**
- Create: `scripts/budget-activation-control.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: approved Task 9 specification.
- Produces: a CI contract that fails until migration 056, the activation API/service and the activation workspace exist with the required safety semantics.

- [ ] **Step 1: Write the failing regression test**

Create `scripts/budget-activation-control.test.mjs` with assertions that require:

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')

assert.ok(fs.existsSync('supabase/migrations/056_operational_budget_activation_finance_master_data.sql'))
assert.ok(fs.existsSync('lib/budget-activation.ts'))
assert.ok(fs.existsSync('app/api/budget-activation/route.ts'))
assert.ok(fs.existsSync('app/dashboard/budget/activation/page.tsx'))

const migration = read('supabase/migrations/056_operational_budget_activation_finance_master_data.sql')
for (const token of [
  'budget_activation_batches',
  'budget_activation_lines',
  'chart_of_account_id',
  'DRAFT_MAPPING',
  'VALIDATION_FAILED',
  'READY_FOR_ACTIVATION',
  'ACTIVATED',
  'njss_prepare_budget_activation',
  'njss_submit_budget_activation',
  'njss_activate_approved_budget',
  'BUDGET_ACTIVATION_VALIDATED',
  'BUDGET_ACTIVATED',
]) assert.ok(migration.includes(token), `missing ${token}`)

assert.ok(!/SELECT\s+id\s+INTO\s+v_fallback_account[\s\S]*FROM\s+chart_of_accounts/i.test(migration))
assert.match(migration, /REVOKE EXECUTE ON FUNCTION\s+(public\.)?create_operational_allocations_from_divisional_budget/i)
assert.match(migration, /System Administrator cannot authorise operational budget activation/i)
assert.match(migration, /Only a Registrar may authorise activation/i)
assert.match(migration, /source_budget_line_id[\s\S]*is_active\s*=\s*true/i)

const service = read('lib/budget-activation.ts')
for (const token of ['getBudgetActivationQueue', 'prepareBudgetActivation', 'submitBudgetActivation', 'activateApprovedBudget']) {
  assert.ok(service.includes(token), `service missing ${token}`)
}

const route = read('app/api/budget-activation/route.ts')
for (const token of ["operation === 'prepare'", "operation === 'submit'", "operation === 'activate'"]) {
  assert.ok(route.includes(token), `route missing ${token}`)
}

const page = read('app/dashboard/budget/activation/page.tsx')
for (const label of ['Budget Activation', 'Prepare Activation', 'Submit for Activation', 'Activate Approved Budget', 'Approved Total', 'Activation Total', 'Variance']) {
  assert.ok(page.includes(label), `activation page missing ${label}`)
}

console.log('budget activation control regression checks passed')
```

- [ ] **Step 2: Wire the test into CI**

Add immediately after the Task 8 workspace regression step in `.github/workflows/ci.yml`:

```yaml
      - name: Budget activation control regression checks
        run: node scripts/budget-activation-control.test.mjs
```

- [ ] **Step 3: Verify RED**

Run through GitHub Actions on the Task 9 branch. Expected result: **FAIL**, with the first failure reporting missing migration 056.

- [ ] **Step 4: Commit the RED contract**

```bash
git add scripts/budget-activation-control.test.mjs .github/workflows/ci.yml
git commit -m "test: define Task 9 activation control contract"
```

---

### Task 2: Implement migration 056 — activation data model, exact mapping and database role separation

**Files:**
- Create: `supabase/migrations/056_operational_budget_activation_finance_master_data.sql`
- Test: `scripts/budget-activation-control.test.mjs`

**Interfaces:**
- Consumes: `divisional_budget_submissions`, `divisional_budget_lines`, `budget_monthly_allocations`, `expense_ledger`, `expense_code_registry`, `chart_of_accounts`, `cost_centres`, `budget_allocations`, `users`, `roles`, `user_roles`, `permissions`, `role_permissions`, `menu_items`, `notifications`, `log_audit_event`, `fn_current_app_user_id()`.
- Produces: `budget_activation_batches`, `budget_activation_lines`, `v_budget_activation_queue`, `njss_prepare_budget_activation(UUID,TEXT)`, `njss_submit_budget_activation(UUID,TEXT)`, `njss_activate_approved_budget(UUID,TEXT)`, and a revised `transition_divisional_budget_submission(UUID,TEXT,TEXT,TEXT)`.

- [ ] **Step 1: Add additive schema and RBAC records**

Migration 056 must begin with `BEGIN;`, add `expense_code_registry.chart_of_account_id`, create the activation header/line tables and indexes, and insert permissions:

```sql
INSERT INTO permissions (code, module_code, menu_code, action, label, description, is_active) VALUES
  ('budget.activation.view','budget','budget.activation','view','View budget activation','View approved budget activation and reconciliation',true),
  ('budget.activation.prepare','budget','budget.activation','edit','Prepare budget activation','Prepare and validate Finance mappings',true),
  ('budget.activation.validate','budget','budget.activation','verify','Validate budget activation','Revalidate approved budget Finance mappings',true),
  ('budget.activation.submit','budget','budget.activation','submit','Submit budget activation','Submit a fully reconciled activation for Registrar authorisation',true),
  ('budget.activation.authorize','budget','budget.activation','approve','Authorise budget activation','Authorise atomic operational budget activation',true)
ON CONFLICT (code) DO UPDATE SET is_active = true, label = EXCLUDED.label, description = EXCLUDED.description;
```

Create/update the database menu entry:

```sql
INSERT INTO menu_items (code,module_code,parent_code,label,href,icon,sort_order,required_permissions,is_active)
VALUES ('budget.activation','budget','budget.control','Budget Activation','/dashboard/budget/activation','Wallet',34,
        ARRAY['budget.activation.view','budget.activation.prepare','budget.activation.submit','budget.activation.authorize'],true)
ON CONFLICT (code) DO UPDATE SET href = EXCLUDED.href, label = EXCLUDED.label,
  required_permissions = EXCLUDED.required_permissions, is_active = true, updated_at = NOW();
```

Grant System Administrator view/prepare/validate/submit and Registrar view/authorize. Do not rely on `all` for database business-role enforcement.

- [ ] **Step 2: Add explicit master-data mapping validation**

`njss_prepare_budget_activation` must resolve each approved line using the canonical source chain and capture human-readable validation errors. The successful line path must use:

```sql
JOIN expense_ledger el ON el.id = l.expense_ledger_id
LEFT JOIN expense_code_registry ecr ON ecr.id = el.expense_code_registry_id
LEFT JOIN chart_of_accounts coa ON coa.id = ecr.chart_of_account_id
LEFT JOIN cost_centres cc
  ON cc.is_active = true
 AND (cc.code = bd.cost_centre_code OR cc.name = bd.cost_centre_name)
```

A line is `READY` only when the ledger is active/posting, the registry row is active and linked back to that ledger, `chart_of_account_id` resolves to an active account, a cost centre resolves, and monthly/annual values reconcile within `0.009`.

- [ ] **Step 3: Decouple approval from operational allocation creation**

Replace the current transition RPC so the APPROVE branch creates/refreshes a `DRAFT_MAPPING` batch instead of calling the legacy allocation function:

```sql
IF UPPER(p_action) = 'APPROVE' THEN
  INSERT INTO budget_activation_batches (submission_id, financial_year, department_id, budget_division_id, status, approved_line_count, approved_total)
  SELECT s.id, s.budget_year, s.department_id, s.division_id, 'DRAFT_MAPPING', COUNT(l.id), COALESCE(SUM(l.annual_estimate),0)
  FROM divisional_budget_submissions s
  JOIN divisional_budget_lines l ON l.submission_id = s.id
  WHERE s.id = p_submission_id
  GROUP BY s.id, s.budget_year, s.department_id, s.division_id
  ON CONFLICT (submission_id) DO UPDATE SET
    status = CASE WHEN budget_activation_batches.status = 'ACTIVATED' THEN 'ACTIVATED' ELSE 'DRAFT_MAPPING' END,
    approved_line_count = EXCLUDED.approved_line_count,
    approved_total = EXCLUDED.approved_total,
    updated_at = NOW();
END IF;
```

Do not call `create_operational_allocations_from_divisional_budget()` from APPROVE.

- [ ] **Step 4: Disable the unsafe legacy allocation entry point**

Redefine the legacy function as a blocked compatibility stub or revoke all ordinary execution. It must contain no fallback account query:

```sql
CREATE OR REPLACE FUNCTION create_operational_allocations_from_divisional_budget(UUID, TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Direct operational allocation creation is retired. Use Budget Activation dual control.';
END;
$$;

REVOKE ALL ON FUNCTION create_operational_allocations_from_divisional_budget(UUID,TEXT) FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 5: Implement System Administrator preparation and submit controls**

Both functions resolve the authenticated application user from `fn_current_app_user_id()` and require an active `System Administrator` role. `njss_prepare_budget_activation` must be idempotent before activation; it rebuilds activation-line snapshots, recalculates counts/totals/variance and records `VALIDATION_FAILED` or `DRAFT_MAPPING`. `njss_submit_budget_activation` requires zero errors, equal line counts, equal totals and zero variance, then changes status to `READY_FOR_ACTIVATION` and creates an idempotent notification for active Registrars.

- [ ] **Step 6: Implement Registrar-only atomic activation**

`njss_activate_approved_budget` must lock the batch, reject System Administrator callers, require an active Registrar role, confirm the preparer is an active System Administrator, independently revalidate every source line, reject duplicates, then insert all allocations in one SQL transaction from exact line snapshots:

```sql
INSERT INTO budget_allocations (..., account_id, expense_code_registry_id, source_budget_submission_id, source_budget_line_id, ...)
SELECT ..., bal.chart_of_account_id, bal.expense_code_registry_id, bab.submission_id, bal.budget_line_id, ...
FROM budget_activation_lines bal
JOIN budget_activation_batches bab ON bab.id = bal.activation_batch_id
WHERE bal.activation_batch_id = p_activation_batch_id
  AND bal.mapping_status = 'READY';
```

After the insert, require inserted row count = approved line count, update the batch to `ACTIVATED`, write `BUDGET_ACTIVATED`, and notify the relevant budget owner/Line Supervisor where one can be resolved.

- [ ] **Step 7: Add RLS and queue view**

Enable RLS on both new tables. System Administrator and Registrar may view. Only secured RPCs may mutate activation state; revoke direct insert/update/delete from authenticated. `v_budget_activation_queue` returns batch/header reconciliation plus division/department/preparer/authoriser names and is granted read access to authenticated users whose application permissions expose the workspace.

- [ ] **Step 8: Verify GREEN for migration contract**

Run:

```bash
node scripts/budget-activation-control.test.mjs
```

Expected: the migration assertions pass; service/UI assertions remain failing until Tasks 3–4.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/056_operational_budget_activation_finance_master_data.sql
git commit -m "feat: add dual-control operational budget activation engine"
```

---

### Task 3: Add the budget activation service and secured API route

**Files:**
- Create: `lib/budget-activation.ts`
- Create: `app/api/budget-activation/route.ts`
- Test: `scripts/budget-activation-control.test.mjs`

**Interfaces:**
- Consumes RPCs/view from Task 2 and `requirePermission`, `createRequestSupabaseClient` from `lib/rbac/server.ts`.
- Produces client functions `getBudgetActivationQueue()`, `getBudgetActivationLines(batchId)`, `prepareBudgetActivation(batchId)`, `submitBudgetActivation(batchId)`, `activateApprovedBudget(batchId)`.

- [ ] **Step 1: Define typed client service**

The service should define `BudgetActivationBatch` and `BudgetActivationLine` types and load queue/line data with Supabase. Mutations POST to `/api/budget-activation` using an operation discriminator.

```ts
export async function prepareBudgetActivation(batchId: string) {
  return mutateBudgetActivation('prepare', batchId)
}
export async function submitBudgetActivation(batchId: string) {
  return mutateBudgetActivation('submit', batchId)
}
export async function activateApprovedBudget(batchId: string) {
  return mutateBudgetActivation('activate', batchId)
}
```

- [ ] **Step 2: Implement role-sensitive API operations**

`app/api/budget-activation/route.ts` must authenticate all requests. The API permission guard is defense in depth; the RPC remains authoritative for role separation.

```ts
if (operation === 'prepare') return runRpc(request, body, ['budget.activation.prepare'], 'njss_prepare_budget_activation')
if (operation === 'submit') return runRpc(request, body, ['budget.activation.submit'], 'njss_submit_budget_activation')
if (operation === 'activate') return runRpc(request, body, ['budget.activation.authorize'], 'njss_activate_approved_budget')
```

Pass `p_activation_batch_id` and authenticated `guard.context?.email` to each RPC. Return database validation messages as HTTP 400 without masking them.

- [ ] **Step 3: Run the Task 9 regression script**

Expected: migration/service/API checks pass; UI checks remain failing.

- [ ] **Step 4: Commit**

```bash
git add lib/budget-activation.ts app/api/budget-activation/route.ts
git commit -m "feat: expose secured budget activation workflow"
```

---

### Task 4: Add the role-sensitive Budget Activation workspace

**Files:**
- Create: `app/dashboard/budget/activation/page.tsx`
- Test: `scripts/budget-activation-control.test.mjs`

**Interfaces:**
- Consumes `useAuth()` role/permission context and all Task 3 service methods.
- Produces the operational System Administrator and Registrar UI at `/dashboard/budget/activation`.

- [ ] **Step 1: Implement queue and reconciliation UI**

The page must show:

```text
Budget Activation
Approved Total
Activation Total
Variance
Approved Lines
Mapped Lines
Unmapped Lines
Prepared By
Validated At
```

System Administrator view exposes `Prepare Activation`, `Revalidate`, and `Submit for Activation`; Registrar view exposes only read-only reconciliation plus `Activate Approved Budget` when status is `READY_FOR_ACTIVATION`.

- [ ] **Step 2: Implement validation-line detail**

Selecting a batch loads activation lines and displays Finance Code, description, Posting Code, Chart of Accounts, Cost Centre, approved amount, mapping status and validation errors. Invalid rows must make the reason visible and never provide a budget-value edit control.

- [ ] **Step 3: Add finance-master-data readiness guidance**

For invalid mappings, display actionable guidance such as:

```text
Finance Code is not mapped to an active Posting Code.
Posting Code has no active Chart of Accounts mapping.
Cost Centre relationship is missing or inactive.
```

The workspace may direct an administrator to the existing master-data register, but must not allow approved budget values to be changed.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node scripts/budget-activation-control.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/budget/activation/page.tsx
git commit -m "feat: add dual-control budget activation workspace"
```

---

### Task 5: Full regression, Next.js build and deployment-readiness evidence

**Files:**
- Modify only if verification identifies a defect: Task 9 files above.
- Create: `docs/superpowers/plans/2026-08-28-operational-budget-activation-progress.md`

**Interfaces:**
- Consumes all Task 9 deliverables.
- Produces reviewable evidence for merge and later controlled Supabase/Netlify deployment.

- [ ] **Step 1: Run the complete CI-equivalent suite**

GitHub Actions must run the existing RBAC, backup, master-data, budget revision/reforecast/workspace tests plus:

```bash
node scripts/budget-activation-control.test.mjs
bun run lint
bun run typecheck
bun run build
```

Expected: all checks pass.

- [ ] **Step 2: Verify migration safety by static review**

Confirm:

```text
APPROVE does not call create_operational_allocations_from_divisional_budget
no v_fallback_account remains in migration 056
legacy allocation function is revoked/blocked
System Administrator cannot authorise
Registrar is required for activation
one active source_budget_line_id allocation is enforced
migration does not auto-activate existing APPROVED submissions
```

- [ ] **Step 3: Review PR diff and CI status**

Check PR #13 changed files and full diff. Resolve any regression or accidental unrelated change before marking ready.

- [ ] **Step 4: Record progress/deployment gate**

Create `docs/superpowers/plans/2026-08-28-operational-budget-activation-progress.md` documenting commits, tests, CI outcome and the production gate: migration 055/056 may be applied only after the actual NJSS Supabase project/service credentials are connected or supplied through an approved secret store. Do not commit credentials.

- [ ] **Step 5: Commit evidence**

```bash
git add docs/superpowers/plans/2026-08-28-operational-budget-activation-progress.md
git commit -m "docs: record Task 9 implementation verification"
```

- [ ] **Step 6: Complete the development branch**

Use `superpowers:finishing-a-development-branch` after all verification is green. Keep PR #13 unmerged until review is complete; production deployment remains a separate controlled action because the NJSS Supabase project is not connected in the current tool context.
