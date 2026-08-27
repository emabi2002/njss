# NJSS Budget Revision and Reforecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add controlled post-approval Budget Revision / Reforecast capability so approved budgets remain immutable while authorised Line Supervisors can create a new version, compare it against actual expenditure and outstanding commitments, submit controlled adjustments, and have the Registrar approve a new authoritative budget version.

**Architecture:** Preserve the existing Budget Preparation workflow, versioned `divisional_budget_submissions`, operational `budget_allocations`, FF3 commitment ledger, FF4/payment data and four-group RBAC. Add revision-specific tables, permissions and transactional RPCs. Revisions reuse existing submission statuses and copy an approved budget into a new DRAFT version. Approval updates the existing operational allocation IDs so existing commitments and payments remain linked, while the previous approved submission remains immutable and traceable. All protected-minimum and approval-time checks execute in PostgreSQL, not only in the browser.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Supabase/PostgreSQL 17.6, Node built-in `assert` regression checks, Bun CI, ESLint, TypeScript compiler, Netlify deploy previews.

**Spec:** `docs/superpowers/specs/2026-08-27-budget-revision-reforecast-design.md`

## Global Constraints

- Do not modify historical migrations 000-050.
- Approved/historical `divisional_budget_submissions` and their lines remain immutable.
- A revision is always a new submission version linked by `parent_submission_id`; the old approved version is linked forward through `superseded_by_id` only after successful approval.
- Reuse existing submission statuses (`DRAFT`, `SUBMITTED`, `RETURNED`, `RESUBMITTED`, `REVIEWED`, `APPROVED`, `REJECTED`, `ARCHIVED`). Do not create a second competing workflow-status model.
- Only one active revision may exist for the current approved parent version.
- Protected minimum is always `actual expenditure + outstanding commitments` and is recalculated at submission and again at approval.
- Existing `budget_allocation.id` values must be preserved for revised existing lines so FF3 commitments, payment transactions and funding references remain attached.
- No direct client write may change authoritative budget revision values. Create/submit/review/approve operations go through guarded API + PostgreSQL RPC.
- Requisition Officer and Payment/Reconciliation Officer are read-only for revisions. Line Supervisor originates/edits/submits. Registrar reviews/returns/rejects/approves.
- Section-wide and system-wide scope remain governed by the existing four-group RBAC rules.
- UI hiding is not authorization.
- No production migration is applied until the feature branch has passed regression checks, lint, typecheck, production build and the correct `njsscrem` Netlify preview.

## Important schema clarification

The live database currently defines `budget_allocations.revised_budget` as a stored generated column:

```sql
revised_budget = original_budget + COALESCE(supplemental_budget, 0)
```

That formula cannot represent a reduction or virement without incorrectly treating those movements as supplementary funding. Migration 051 therefore introduces a signed `revision_adjustment` field and converts `revised_budget` to an ordinary stored value maintained by a trigger:

```text
Current Revised Budget = Original Budget + Supplementary Budget + Revision Adjustment
```

`revision_adjustment` stores non-supplementary approved movements: virement, reduction, reclassification and annual-value reforecast changes. `supplemental_budget` remains reserved for genuine supplementary funding. This preserves correct financial meaning while keeping the existing `revised_budget` API/view contract intact.

---

### Task 1: Add regression contract and revision permissions

**Files:**
- Create: `scripts/budget-revision-reforecast.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `lib/rbac/config.ts`
- Create later in Task 2: `supabase/migrations/051_budget_revision_reforecast_schema.sql`

**Interfaces:**
- New permission codes:
  - `budget.revision.view`
  - `budget.revision.create`
  - `budget.revision.edit`
  - `budget.revision.submit`
  - `budget.revision.review`
  - `budget.revision.approve`
  - `budget.revision.reject`
  - `budget.revision.return`
  - `budget.revision.report`
- Existing menu routes remain unchanged: revisions live inside Budget Preparation and Budget Control.

- [ ] **Step 1: Write the failing regression test**

Create `scripts/budget-revision-reforecast.test.mjs` that reads the relevant migration/runtime/UI files and initially asserts that the permission catalogue contains all nine revision permissions and that migration 051 exists.

Use this structure:

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')
const config = read('lib/rbac/config.ts')

for (const permission of [
  'budget.revision.view',
  'budget.revision.create',
  'budget.revision.edit',
  'budget.revision.submit',
  'budget.revision.review',
  'budget.revision.approve',
  'budget.revision.reject',
  'budget.revision.return',
  'budget.revision.report',
]) {
  assert.ok(config.includes(permission), `missing ${permission}`)
}

assert.ok(fs.existsSync('supabase/migrations/051_budget_revision_reforecast_schema.sql'))
```

- [ ] **Step 2: Run the regression and confirm RED**

Run:

```bash
node scripts/budget-revision-reforecast.test.mjs
```

Expected: FAIL because the revision permissions/migration do not yet exist.

- [ ] **Step 3: Add runtime permission catalogue entries**

Modify `lib/rbac/config.ts`.

Add the revision permissions to the budget catalogue. Because `budget.revision.return` is a workflow capability rather than a generic RBAC action suffix, represent it with an existing supported action such as `edit` instead of expanding the global RBAC action vocabulary solely for this feature.

Expected runtime mapping:

```ts
['budget.revision.view', 'View budget revisions'],
['budget.revision.create', 'Create budget revisions'],
['budget.revision.edit', 'Edit budget revision drafts'],
['budget.revision.submit', 'Submit budget revisions'],
['budget.revision.review', 'Review budget revisions'],
['budget.revision.approve', 'Approve budget revisions'],
['budget.revision.reject', 'Reject budget revisions'],
['budget.revision.report', 'View budget revision reports'],
```

Add `budget.revision.return` explicitly to `PERMISSION_CATALOG` with action `edit`.

- [ ] **Step 4: Add CI step**

In `.github/workflows/ci.yml`, add after the existing budget row-selection regression:

```yaml
      - name: Budget revision and reforecast regression checks
        run: node scripts/budget-revision-reforecast.test.mjs
```

- [ ] **Step 5: Commit the RED contract before implementation**

Commit the test/CI/catalog changes separately so the test-first sequence remains reviewable.

---

### Task 2: Add migration 051 — revision schema, financial adjustment semantics and RBAC bundles

**Files:**
- Create: `supabase/migrations/051_budget_revision_reforecast_schema.sql`
- Extend: `scripts/budget-revision-reforecast.test.mjs`

**Interfaces:**
- Creates `budget_revisions`.
- Creates `budget_revision_lines`.
- Adds `budget_allocations.revision_adjustment`.
- Converts `budget_allocations.revised_budget` from generated to trigger-maintained stored value without changing its name/type contract.
- Adds revision permissions to the controlled role bundles without removing existing permissions.
- Enforces one active revision per approved parent.
- Authenticated users may select revision records according to permission/scope; revision writes occur through RPCs only.

- [ ] **Step 1: Extend the failing regression**

Assert migration 051 contains:

```text
CREATE TABLE budget_revisions
CREATE TABLE budget_revision_lines
revision_adjustment
ALTER COLUMN revised_budget DROP EXPRESSION
budget.revision.create
budget.revision.approve
ux_budget_revisions_one_active_parent
```

Also assert the role mapping strings for Requisition Officer, Line Supervisor, Registrar and Payment/Reconciliation Officer.

- [ ] **Step 2: Implement safe `revised_budget` evolution**

In migration 051:

```sql
ALTER TABLE budget_allocations
  ADD COLUMN IF NOT EXISTS revision_adjustment NUMERIC(15,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'budget_allocations'
      AND column_name = 'revised_budget'
      AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE budget_allocations ALTER COLUMN revised_budget DROP EXPRESSION;
  END IF;
END $$;

UPDATE budget_allocations
SET revised_budget = COALESCE(original_budget,0)
                   + COALESCE(supplemental_budget,0)
                   + COALESCE(revision_adjustment,0);
```

Add `njss_sync_revised_budget()` and a `BEFORE INSERT OR UPDATE OF original_budget, supplemental_budget, revision_adjustment` trigger that always recomputes `NEW.revised_budget` using the same formula. Add a non-negative revised-budget guard.

Do not repurpose `supplemental_budget` for reductions or virements.

- [ ] **Step 3: Create `budget_revisions`**

Use the approved fields, foreign keys and controlled revision types:

```sql
revision_type IN ('VIREMENT','SUPPLEMENTARY','REDUCTION','RECLASSIFICATION','REFORECAST')
```

Store the revision's reporting status synchronized with the linked submission status. Include creator/approver identity, reason, authority reference, effective date and supporting reference.

- [ ] **Step 4: Create `budget_revision_lines`**

Include source allocation/source line/revision line links and both submission/approval snapshots. Add a unique constraint on `(budget_revision_id, revision_budget_line_id)` and indexes on source allocation and revision id.

- [ ] **Step 5: Enforce one active revision per parent**

Create a partial unique index:

```sql
CREATE UNIQUE INDEX ux_budget_revisions_one_active_parent
ON budget_revisions(parent_submission_id)
WHERE status IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','REVIEWED');
```

- [ ] **Step 6: Add RBAC permission rows and role assignments**

Insert the nine permissions into `permissions` using `ON CONFLICT ... DO UPDATE`.

Add permissions without replacing the existing role bundles:

```text
Requisition Officer -> view
Line Supervisor -> view, create, edit, submit, report
Registrar -> view, review, approve, reject, return, report
Payment/Reconciliation Officer -> view, report
System Administrator -> existing `all` only
```

Use additive `INSERT INTO role_permissions ... ON CONFLICT ... DO UPDATE SET is_allowed=true` rather than calling a bundle-replacement helper.

- [ ] **Step 7: Add RLS/read policies**

Enable RLS on both revision tables. Allow SELECT only when the caller has `budget.revision.view`/`budget.revision.report` and the linked budget division/submission is inside the user's existing data scope. Do not create direct authenticated INSERT/UPDATE/DELETE policies; those operations are performed by guarded RPCs.

- [ ] **Step 8: Run source regression and static checks**

Run:

```bash
node scripts/budget-revision-reforecast.test.mjs
bun run typecheck
bun run lint
```

Expected: regression may still fail on Task 3 RPC assertions, but schema/RBAC assertions pass and static checks remain green.

---

### Task 3: Add migration 052 — revision position view and transactional workflow RPCs

**Files:**
- Create: `supabase/migrations/052_budget_revision_workflow.sql`
- Extend: `scripts/budget-revision-reforecast.test.mjs`

**Interfaces:**
- `v_budget_revision_position`
- `njss_create_budget_revision(...)`
- `njss_transition_budget_revision(...)`
- Existing `transition_divisional_budget_submission(...)` remains the canonical linked submission-state transition.

- [ ] **Step 1: Add failing RPC assertions**

Extend the regression test to require:

```text
njss_create_budget_revision
njss_transition_budget_revision
FOR UPDATE
protected_minimum
actual_expenditure_at_submission
actual_expenditure_at_approval
superseded_by_id
```

Require explicit handling of each revision type and one-active-revision concurrency.

- [ ] **Step 2: Build `v_budget_revision_position`**

Join revision lines to `v_authoritative_budget_position`, the source/revision budget lines and monthly payment activity. Expose at least:

```text
revision_id
revision_line_id
revision_budget_line_id
source_budget_allocation_id
original_budget
current_revised_budget
actual_expenditure
outstanding_commitment
protected_minimum
proposed_revised_budget
adjustment_amount
available_after_revision
actual_monthly JSONB
closed_month_numbers INTEGER[]
```

`protected_minimum` is calculated as `actual_expenditure + outstanding_commitment`. Derive monthly actuals from authoritative payment transactions by `budget_allocation_id` and transaction month. Derive closed months from `budget_periods.is_open = false` for the linked cycle.

- [ ] **Step 3: Implement revision creation RPC**

`njss_create_budget_revision` must:

1. check `budget.revision.create` inside the function;
2. lock the parent submission;
3. require parent status `APPROVED`, `is_locked=true`, and `superseded_by_id IS NULL`;
4. enforce scope using the existing scope helper;
5. reject when an active revision already exists;
6. create the next `divisional_budget_submissions.version` as `DRAFT` with `parent_submission_id=parent.id`;
7. copy all approved `divisional_budget_lines`;
8. copy all `budget_monthly_allocations` using the newly created revision-line ids;
9. create `budget_revisions`;
10. create one `budget_revision_lines` row per copied line, mapped to the current operational `budget_allocation.id` where available;
11. seed `proposed_revised_budget` from the current revised amount;
12. write audit/workflow history;
13. return revision id, revision submission id and revision number.

Use a server-generated number such as `REV-2027-00001`.

- [ ] **Step 4: Implement submit/resubmit validation**

For `SUBMIT` and `RESUBMIT`:

- run existing budget-line/monthly validation;
- set `proposed_revised_budget` from the revision line's `annual_estimate` so there is one authoritative proposed amount;
- read current actual/outstanding values from the authoritative position;
- store submission snapshots;
- reject any line where proposed < protected minimum;
- reject a negative available-after-revision value;
- for `VIREMENT` and `RECLASSIFICATION`, require total negative adjustments + total positive adjustments = 0 within K0.01;
- for `SUPPLEMENTARY`, require authority reference and positive net increase;
- for `REDUCTION`, require net decrease <= 0;
- for `REFORECAST`, permit zero annual adjustment and monthly rephasing; if annual value changes, the delta later posts to `revision_adjustment`;
- transition the linked submission through existing workflow and synchronize `budget_revisions.status`.

- [ ] **Step 5: Implement REVIEW/RETURN/REJECT**

Require the corresponding revision permission inside the RPC and call the existing submission transition RPC/function so locking/history behavior remains consistent. Synchronize revision status in the same transaction.

- [ ] **Step 6: Implement atomic APPROVE**

Approval must execute entirely inside `njss_transition_budget_revision`:

1. require `budget.revision.approve`;
2. lock revision, revision submission, parent submission and all referenced `budget_allocations` with `FOR UPDATE`;
3. re-read current actuals/outstanding commitments;
4. store approval snapshots;
5. re-run protected-minimum/type/funding checks;
6. abort the transaction if the financial position has made any proposed amount invalid;
7. for an existing allocation, preserve the allocation id and update:
   - `supplemental_budget += positive adjustment` only for `SUPPLEMENTARY`;
   - `revision_adjustment += adjustment_amount` for `VIREMENT`, `REDUCTION`, `RECLASSIFICATION`, and annual-value `REFORECAST`;
   - `monthly_cashflow`, Q1-Q4 values from the approved revision line;
   - `source_budget_submission_id` and `source_budget_line_id` to the new approved version;
8. for a genuinely new revision line without a source allocation, create a new active allocation with `original_budget=0`; post the proposed amount to `supplemental_budget` only for supplementary funding, otherwise to `revision_adjustment`;
9. never delete an existing allocation because a line is reduced to zero; retain it for history with revised budget zero only if protected minimum is also zero;
10. call the existing submission approval transition;
11. set parent `superseded_by_id = revision_submission_id`;
12. mark the revision approved with approver/timestamp;
13. write audit events containing before/after amounts and approval snapshots;
14. commit all or roll back all.

- [ ] **Step 7: Defend RPCs from direct-browser bypass**

The RPCs are `SECURITY DEFINER`, but they must still execute permission and data-scope checks internally using the authenticated JWT context. Grant execute only as required for authenticated API calls. The Next.js route guard is defense-in-depth, not the sole authorization boundary.

- [ ] **Step 8: Run regression checks**

```bash
node scripts/budget-revision-reforecast.test.mjs
```

Expected: migration/RPC contract assertions PASS.

---

### Task 4: Add TypeScript revision service and guarded API operations

**Files:**
- Create: `lib/budget-revision.ts`
- Modify: `lib/budget-module.ts`
- Modify: `app/api/workflows/budget/route.ts`
- Extend: `scripts/budget-revision-reforecast.test.mjs`

**Interfaces:**

```ts
export type BudgetRevisionType =
  | 'VIREMENT'
  | 'SUPPLEMENTARY'
  | 'REDUCTION'
  | 'RECLASSIFICATION'
  | 'REFORECAST'

export type BudgetRevisionAction =
  | 'SUBMIT'
  | 'RESUBMIT'
  | 'REVIEW'
  | 'RETURN'
  | 'REJECT'
  | 'APPROVE'
```

Client functions:

```ts
getRevisionForSubmission(submissionId)
getBudgetRevisionPosition(revisionId)
getBudgetRevisionHistory(parentSubmissionId)
createBudgetRevision(input)
transitionBudgetRevision(revisionId, action, comments)
```

- [ ] **Step 1: Extend failing source assertions**

Require the new service, API operation names and permission mapping.

- [ ] **Step 2: Implement `lib/budget-revision.ts`**

Keep revision-specific types/API calls out of the already-large Budget Preparation page. Reads use Supabase views/tables. Mutating operations POST to `/api/workflows/budget`.

Creation payload:

```ts
{
  operation: 'create-budget-revision',
  parentSubmissionId,
  revisionType,
  reason,
  authorityReference,
  effectiveDate,
  supportingReference,
}
```

Transition payload:

```ts
{
  operation: 'transition-budget-revision',
  revisionId,
  action,
  comments,
}
```

- [ ] **Step 3: Extend `BudgetSubmission` type**

In `lib/budget-module.ts`, add nullable `parent_submission_id` and `superseded_by_id` so UI/version lineage is typed rather than cast.

- [ ] **Step 4: Add API operations and permission map**

In `app/api/workflows/budget/route.ts` add:

```ts
const REVISION_PERMISSION: Record<string, string[]> = {
  SUBMIT: ['budget.revision.submit'],
  RESUBMIT: ['budget.revision.submit'],
  REVIEW: ['budget.revision.review'],
  RETURN: ['budget.revision.return'],
  REJECT: ['budget.revision.reject'],
  APPROVE: ['budget.revision.approve'],
}
```

`create-budget-revision` requires `budget.revision.create`; `transition-budget-revision` uses the action-specific permission. Both call the new RPCs through the request-scoped authenticated Supabase client.

- [ ] **Step 5: Preserve audit source identity**

Pass authenticated `guard.context.email/name/userId` to the RPC/audit path. Do not trust a browser-supplied user email.

- [ ] **Step 6: Run tests/static checks**

```bash
node scripts/budget-revision-reforecast.test.mjs
bun run typecheck
bun run lint
```

Expected: PASS.

---

### Task 5: Add revision UX to Budget Preparation

**Files:**
- Modify: `app/dashboard/budget-template/page.tsx`
- Prefer create: `app/dashboard/budget-template/BudgetRevisionPanel.tsx`
- Prefer create: `app/dashboard/budget-template/BudgetRevisionDialog.tsx`
- Extend: `scripts/budget-revision-reforecast.test.mjs`

**Interfaces:**
- Approved current version remains read-only.
- `Create Budget Revision` appears only for callers with `budget.revision.create` and only when the approved submission is current (`superseded_by_id == null`).
- Revision DRAFT/RETURNED is editable only for revision editors.
- Submitted/reviewed/approved revision remains read-only.
- Registrar workflow buttons use revision permissions, not the ordinary initial-budget buttons.

- [ ] **Step 1: Add failing UI assertions**

Assert the page/components contain:

```text
Create Budget Revision
Original Approved
Current Revised
Actual Paid
Outstanding Commitments
Protected Minimum
Available After Revision
Revision Type
Current Authoritative
```

Also assert the UI uses `budget.revision.create/edit/submit/review/approve` permission checks.

- [ ] **Step 2: Add revision creation dialog**

Create a controlled dialog/form with:

- revision type;
- reason/justification;
- authority reference;
- effective date;
- supporting reference.

Require authority reference client-side for `SUPPLEMENTARY`; server validation remains authoritative.

After creation, switch the selected submission to the returned revision submission id.

- [ ] **Step 3: Load revision metadata and position**

When a selected submission is revision-linked, load `budget_revisions`, `v_budget_revision_position` and version history. Build a lookup keyed by `revision_budget_line_id` for financial-control columns.

- [ ] **Step 4: Add financial-control columns**

Near the left side of the spreadsheet add read-only columns:

```text
Original Approved
Current Revised
Actual Paid
Outstanding Commitments
Protected Minimum
Adjustment
Available After Revision
```

The existing `Calculated Estimate (K)` / annual estimate is the editable proposed revised amount. Do not create a second independent editable annual total that can diverge from quantity × unit cost × frequency + other costs.

Calculate display-only adjustment as:

```ts
annualEstimate(row) - currentRevisedBudget
```

and display available after as:

```ts
annualEstimate(row) - actualExpenditure - outstandingCommitment
```

Show negative/invalid values in the existing validation/error style and block submission via the server regardless of browser display.

- [ ] **Step 5: Lock actual/closed monthly periods**

For revision drafts, disable a monthly allocation input when either:

- the linked budget period has `is_open=false`; or
- that source allocation has non-zero actual expenditure in that month.

Future/open months remain editable. Ordinary initial-budget drafts retain current behavior.

- [ ] **Step 6: Add version/revision summary**

In the header/comparison panel show:

```text
Version
Revision number/type
Original budget
Current revised budget
Proposed revision
Actual expenditure
Outstanding commitments
Available balance
Net increase/decrease
Status
Current Authoritative / Historical Version
```

- [ ] **Step 7: Wire workflow buttons**

For a revision:

- DRAFT/RETURNED + Line Supervisor -> Save / Submit or Resubmit
- SUBMITTED + Registrar -> Review / Return / Reject
- REVIEWED + Registrar -> Approve / Reject
- APPROVED -> view-only

Keep the initial-budget workflow unchanged for non-revision submissions.

- [ ] **Step 8: Add version history panel**

Display version, revision number/type, status, reason/reference, submitted/approved identity/date, total and net adjustment. Selecting a historic version loads it read-only.

- [ ] **Step 9: Run UI regression/static build**

```bash
node scripts/budget-revision-reforecast.test.mjs
bun run lint
bun run typecheck
bun run build
```

Expected: PASS.

---

### Task 6: Update Budget Control and reporting to distinguish original, supplementary and revision adjustments

**Files:**
- Modify: `lib/api.ts`
- Modify: `app/dashboard/budget/page.tsx`
- Extend in migration 052 or create: `supabase/migrations/053_budget_revision_reporting.sql`
- Extend: `scripts/budget-revision-reforecast.test.mjs`

**Interfaces:**
- Budget Control exposes:
  - Original Budget
  - Supplementary Budget
  - Revision Adjustment
  - Current Revised Budget
  - Actual Expenditure
  - Outstanding Commitments
  - Available Balance
  - latest revision number/type/effective date
- Existing funded/released/pending measures remain available.

- [ ] **Step 1: Add failing reporting assertions**

Require `revision_adjustment`, `latest_revision_number`, `latest_revision_type` and UI labels for Original/Supplementary/Current Revised.

- [ ] **Step 2: Extend authoritative reporting view**

If not already included in migration 052, create migration 053 to replace the current financial position view definitions without altering history. Expose `original_budget`, `supplemental_budget`, `revision_adjustment`, `revised_budget` and latest approved revision metadata while preserving all current column names consumed elsewhere.

Use a lateral join/latest-approved-revision view rather than duplicating revision totals in application code.

- [ ] **Step 3: Update `AuthoritativeBudgetPosition`**

Add typed fields in `lib/api.ts`:

```ts
original_budget: number
supplemental_budget: number
revision_adjustment: number
revised_budget: number
latest_revision_number?: string | null
latest_revision_type?: string | null
latest_revision_effective_date?: string | null
```

- [ ] **Step 4: Update Budget Control UI**

Preserve the operational dashboard but make the budget lineage explicit. Summary/table/export should distinguish original, true supplementary funding and non-supplementary revision adjustments instead of showing one ambiguous approved amount.

- [ ] **Step 5: Verify formulas**

For each allocation:

```text
Current Revised = Original + Supplementary + Revision Adjustment
Available = Current Revised - Actual - Outstanding Commitments
```

Where the existing control view uses released/funded availability for cash-control purposes, retain that measure under its existing label and add the revised-budget availability as a distinct amount. Do not silently change the meaning of a pre-existing cash-availability metric.

- [ ] **Step 6: Run regression/static build**

```bash
node scripts/budget-revision-reforecast.test.mjs
bun run lint
bun run typecheck
bun run build
```

Expected: PASS.

---

### Task 7: Harden audit, concurrency and financial edge cases

**Files:**
- Modify: `supabase/migrations/052_budget_revision_workflow.sql` or `053_budget_revision_reporting.sql` as appropriate before migration is applied
- Extend: `scripts/budget-revision-reforecast.test.mjs`

**Interfaces:**
- No lost update if commitments/payments change during review.
- No concurrent active revisions for the same parent.
- No revision can move a line below protected minimum.
- Restricted/supplementary funding rules are validated from authoritative funding data.

- [ ] **Step 1: Add contract assertions for edge cases**

Require migration source to contain explicit errors/guards for:

```text
active revision already exists
protected minimum
virement must balance
supplementary authority
approved version is historical/superseded
financial position changed
```

- [ ] **Step 2: Verify approval uses current data, not stored submission snapshots**

Submission snapshots are evidence only. Approval must requery current authoritative position after locks are obtained and calculate `_at_approval` values from that data.

- [ ] **Step 3: Verify funding restrictions**

For supplementary revisions, validate an appropriate funding authority/reference and ensure the requested increase does not exceed authorised available funding. For restricted funding, prevent a virement/reclassification across incompatible funding/project/department/section/cost-centre/expense-code restrictions.

- [ ] **Step 4: Verify immutable historical versions**

Existing DB guards plus revision RPCs must prevent edits to the approved parent and any superseded approved version. Revision creation from a superseded version must fail.

- [ ] **Step 5: Verify audit payloads**

Audit rows must include revision number/type, parent/new submission ids, reason/reference, affected allocation ids, before/proposed/approved values and submission/approval financial snapshots.

---

### Task 8: Full verification, Supabase migration, deploy preview and merge

**Files:**
- Review all feature changes
- No new functional scope unless verification finds a defect

**Interfaces:**
- Approved baseline remains immutable.
- New revisions create new versions.
- Line Supervisor can originate/submit within scope.
- Registrar can review/approve system-wide.
- Actuals/commitments protect already-spent/obligated funds.
- Existing commitments/payments retain their allocation ids after revision approval.

- [ ] **Step 1: Run the full local/CI-equivalent gate**

```bash
node lib/rbac/four-group-rbac.test.mjs
node lib/rbac/admin-runtime-fallback.test.mjs
node lib/rbac/user-crud-edge.test.mjs
node lib/backup/full-differential-backup.test.mjs
node scripts/master-data-cleanup.test.mjs
node scripts/budget-division-selector.test.mjs
node scripts/budget-row-selection.test.mjs
node scripts/budget-revision-reforecast.test.mjs
bun run lint
bun run typecheck
bun run build
```

Expected: every command PASS.

- [ ] **Step 2: Open PR and verify diff**

Confirm only intended schema/RBAC/service/UI/reporting/test files changed. Confirm historical migrations 000-050 are untouched.

- [ ] **Step 3: Wait for GitHub CI**

Require the normal `Build and validate` job to pass including the new revision regression step.

- [ ] **Step 4: Verify the correct Netlify project**

Require `netlify/njsscrem/deploy-preview` = success. Do not treat the legacy/duplicate `njsscrems` status as the production gate.

- [ ] **Step 5: Apply tracked Supabase migrations in order**

Apply 051, 052 and 053 if Task 6 required a separate reporting migration. Do not manually edit historical schema objects outside tracked migrations.

After migration, run read-only verification queries confirming:

```text
budget_revisions exists
budget_revision_lines exists
budget_allocations.revision_adjustment exists
budget_allocations.revised_budget is no longer generated
all nine revision permissions exist
role permission mapping matches the approved four-group design
revision RPCs/views exist
```

Also verify existing budget-allocation counts and commitment/payment foreign-key counts are unchanged by the schema migration.

- [ ] **Step 6: Do non-destructive live smoke checks**

Without creating real financial transactions, verify:

- approved submissions remain locked;
- revision action visibility resolves from RBAC;
- Budget Control renders new fields;
- existing FF3/FF4/commitment pages still load;
- current `revised_budget` values equal `original + supplemental + revision_adjustment` for all existing allocations.

Full create/submit/approve revision workflow becomes a controlled UAT exercise using an approved UAT budget record rather than silently creating production financial data.

- [ ] **Step 7: Merge only after all gates pass**

Merge the implementation PR to `main` and capture the new SHA for Netlify production deployment.

- [ ] **Step 8: Post-merge production verification**

After the `njsscrem` production deploy reports success, verify the Budget Preparation and Budget Control pages load from `main` and that no existing approved budget was mutated by deployment.

## UAT execution set

During controlled UAT, cover at minimum:

1. Create revision only from current approved version.
2. Reject a second simultaneous active revision.
3. Confirm parent approved version remains unchanged.
4. Copy all lines/months into new version.
5. Show actuals and outstanding commitments automatically.
6. Block proposed amount below protected minimum.
7. Permit amount equal to protected minimum.
8. Balanced virement passes; unbalanced virement fails.
9. Supplementary increase requires authority/reference.
10. Reduction preserves original budget and posts signed revision adjustment.
11. Reclassification preserves actuals/commitments and balances source/target.
12. Reforecast locks closed/actual months and permits future months.
13. Submission captures financial snapshots.
14. Changed commitments between submit and approve cause approval revalidation.
15. Registrar can return/reject/approve; Line Supervisor cannot approve.
16. Requisition Officer and Payment/Reconciliation Officer cannot edit revisions.
17. Approval preserves existing `budget_allocation.id` for existing lines.
18. Approval updates source line/submission linkage to the new current version.
19. Old approved version links to new via `superseded_by_id`.
20. New approved version is locked/current-authoritative.
21. Original budget remains unchanged.
22. Supplementary and non-supplementary adjustments remain separately reportable.
23. Budget Control correctly reports Current Revised, Actual, Outstanding and Available.
24. Audit/history shows complete before/after and submission/approval snapshot evidence.
