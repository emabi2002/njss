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
- Copied baseline lines may be reduced, but they are never physically deleted from a revision. A copied line can reach zero only when its protected minimum is zero.
- Finance code, funding source and other posting identity fields on a copied baseline line remain fixed. Virement/reclassification to another code is represented by decreasing the source line and creating a new target line, never by silently changing the identity of an allocation carrying history.
- Newly added revision target lines may be deleted while the revision is still DRAFT/RETURNED because they have no approved allocation history yet.
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

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'

const config = fs.readFileSync('lib/rbac/config.ts', 'utf8')
for (const permission of [
  'budget.revision.view', 'budget.revision.create', 'budget.revision.edit',
  'budget.revision.submit', 'budget.revision.review', 'budget.revision.approve',
  'budget.revision.reject', 'budget.revision.return', 'budget.revision.report',
]) {
  assert.ok(config.includes(permission), `missing ${permission}`)
}
assert.ok(fs.existsSync('supabase/migrations/051_budget_revision_reforecast_schema.sql'))
```

- [ ] **Step 2: Run the regression and confirm RED**

```bash
node scripts/budget-revision-reforecast.test.mjs
```

Expected: FAIL because revision permissions/migration do not yet exist.

- [ ] **Step 3: Add runtime permission catalogue entries**

Modify `lib/rbac/config.ts`. Add the revision permissions to the budget catalogue. Represent `budget.revision.return` explicitly in `PERMISSION_CATALOG` with supported action `edit` rather than expanding the global RBAC action vocabulary solely for this feature.

- [ ] **Step 4: Add CI step**

In `.github/workflows/ci.yml` add:

```yaml
      - name: Budget revision and reforecast regression checks
        run: node scripts/budget-revision-reforecast.test.mjs
```

- [ ] **Step 5: Commit the RED contract**

Commit test/CI/catalog changes before schema implementation.

---

### Task 2: Add migration 051 — revision schema, financial adjustment semantics and RBAC bundles

**Files:**
- Create: `supabase/migrations/051_budget_revision_reforecast_schema.sql`
- Extend: `scripts/budget-revision-reforecast.test.mjs`

**Interfaces:**
- Creates `budget_revisions` and `budget_revision_lines`.
- Adds `budget_allocations.revision_adjustment`.
- Converts `budget_allocations.revised_budget` from generated to trigger-maintained stored value without changing its public name/type.
- Adds revision permissions to controlled roles without removing existing permissions.
- Enforces one active revision per approved parent.
- Revision-table writes are RPC-only.

- [ ] **Step 1: Extend the failing regression**

Assert migration 051 contains `CREATE TABLE budget_revisions`, `CREATE TABLE budget_revision_lines`, `revision_adjustment`, `ALTER COLUMN revised_budget DROP EXPRESSION`, the revision permission codes and `ux_budget_revisions_one_active_parent`.

- [ ] **Step 2: Implement safe `revised_budget` evolution**

```sql
ALTER TABLE budget_allocations
  ADD COLUMN IF NOT EXISTS revision_adjustment NUMERIC(15,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='budget_allocations'
      AND column_name='revised_budget' AND is_generated='ALWAYS'
  ) THEN
    ALTER TABLE budget_allocations ALTER COLUMN revised_budget DROP EXPRESSION;
  END IF;
END $$;

UPDATE budget_allocations
SET revised_budget = COALESCE(original_budget,0)
                   + COALESCE(supplemental_budget,0)
                   + COALESCE(revision_adjustment,0);
```

Add `njss_sync_revised_budget()` plus a `BEFORE INSERT OR UPDATE OF original_budget, supplemental_budget, revision_adjustment` trigger. Add a guard preventing negative `revised_budget`. Do not repurpose `supplemental_budget` for virement/reduction.

- [ ] **Step 3: Create `budget_revisions`**

Use approved fields/FKs and:

```sql
CHECK (revision_type IN ('VIREMENT','SUPPLEMENTARY','REDUCTION','RECLASSIFICATION','REFORECAST'))
```

Revision status mirrors the linked submission status and is updated transactionally by the revision RPC.

- [ ] **Step 4: Create `budget_revision_lines`**

Include source allocation/source line/revision line links, original/current/proposed values, adjustment amount/reason, and both submission/approval actual/commitment/protected-minimum snapshots. Use `ON DELETE SET NULL` only for `revision_budget_line_id` so a newly added draft target can be removed without deleting audit structure; baseline-source metadata remains protected.

- [ ] **Step 5: Enforce one active revision per parent**

```sql
CREATE UNIQUE INDEX ux_budget_revisions_one_active_parent
ON budget_revisions(parent_submission_id)
WHERE status IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','REVIEWED');
```

- [ ] **Step 6: Add RBAC rows/mappings additively**

Map:

```text
Requisition Officer -> view
Line Supervisor -> view, create, edit, submit, report
Registrar -> view, review, approve, reject, return, report
Payment/Reconciliation Officer -> view, report
System Administrator -> existing all
```

Use additive `INSERT ... ON CONFLICT ... is_allowed=true`; do not replace existing bundles.

- [ ] **Step 7: Add RLS/read policies**

Enable RLS on both revision tables. SELECT requires revision view/report permission and existing scope logic through the linked submission/division. Do not grant direct authenticated INSERT/UPDATE/DELETE policies.

- [ ] **Step 8: Run checks**

```bash
node scripts/budget-revision-reforecast.test.mjs
bun run typecheck
bun run lint
```

---

### Task 3: Add migration 052 — revision position view and transactional workflow RPCs

**Files:**
- Create: `supabase/migrations/052_budget_revision_workflow.sql`
- Extend: `scripts/budget-revision-reforecast.test.mjs`

**Interfaces:**
- `v_budget_revision_position`
- `njss_create_budget_revision(...)`
- `njss_transition_budget_revision(...)`
- Existing `transition_divisional_budget_submission(...)` remains canonical submission-state transition.

- [ ] **Step 1: Add failing RPC assertions**

Require `njss_create_budget_revision`, `njss_transition_budget_revision`, `FOR UPDATE`, protected-minimum submission/approval snapshots, `superseded_by_id`, all revision types, and source-line identity checks.

- [ ] **Step 2: Build `v_budget_revision_position`**

Expose:

```text
revision_id, revision_line_id, revision_budget_line_id,
source_budget_allocation_id, original_budget, current_revised_budget,
actual_expenditure, outstanding_commitment, protected_minimum,
proposed_revised_budget, adjustment_amount, available_after_revision,
actual_monthly JSONB, closed_month_numbers INTEGER[]
```

For DRAFT/RETURNED rows, derive displayed `proposed_revised_budget` from the linked revision line's current `annual_estimate`; the stored proposal is refreshed at submit/resubmit and approval.

Use `v_authoritative_budget_position` for total actual/outstanding amounts. For monthly lock indicators, aggregate `v_ff4_payment_register` rows with `status IN ('PAID','RECONCILED')` by `budget_allocation_id` and payment month. Derive formally closed months from `budget_periods.is_open=false` for the linked cycle.

- [ ] **Step 3: Implement revision creation RPC**

`njss_create_budget_revision` must:

1. check `budget.revision.create` internally;
2. lock parent submission;
3. require current `APPROVED`, locked, unsuperseded parent;
4. enforce existing data scope;
5. reject an existing active revision;
6. create next submission version as `DRAFT` with `parent_submission_id`;
7. copy approved budget lines and monthly allocations;
8. create revision header;
9. create one revision-line metadata row for each copied baseline line and map its current operational allocation;
10. seed proposal/current values;
11. write audit/history;
12. return revision id, revision submission id and `REV-YYYY-#####` number.

- [ ] **Step 4: Implement submit/resubmit validation**

Before transition:

- synchronize all existing `budget_revision_lines.proposed_revised_budget` and `adjustment_amount` from linked revision lines;
- create metadata rows for any new target lines added during the revision;
- reject if any copied baseline revision line has been physically removed;
- verify copied baseline line posting identity (finance code/expense code, funding source and source allocation identity) has not changed;
- run existing line/month validation;
- read current actual/outstanding amounts and store submission snapshots;
- enforce proposed >= protected minimum and non-negative available-after;
- VIREMENT/RECLASSIFICATION: sum increases/decreases must net to zero within K0.01;
- SUPPLEMENTARY: authority reference required and net increase > 0;
- REDUCTION: net adjustment < 0;
- REFORECAST: zero annual adjustment is valid; non-zero annual delta posts later as revision adjustment;
- transition linked submission and synchronize revision status.

- [ ] **Step 5: Implement REVIEW/RETURN/REJECT**

Check corresponding permission inside RPC, call existing submission transition, synchronize revision status and audit in the same transaction.

- [ ] **Step 6: Implement atomic APPROVE**

1. require `budget.revision.approve`;
2. lock revision, new submission, parent and referenced allocations with `FOR UPDATE`;
3. re-read actual/outstanding position;
4. store approval snapshots;
5. re-run all protected minimum, type, identity and funding checks;
6. abort if position changed and proposal is now invalid;
7. existing allocation: preserve allocation id; for SUPPLEMENTARY increase `supplemental_budget`; for other annual adjustments increase/decrease `revision_adjustment`; update monthly cashflow/Q1-Q4 and source submission/line linkage to the new approved line;
8. new target line: create allocation with `original_budget=0`; use `supplemental_budget` only for genuine supplementary funding, otherwise `revision_adjustment`;
9. never delete existing allocation; revised zero is allowed only when protected minimum is zero;
10. approve linked submission through existing transition;
11. set parent `superseded_by_id`;
12. mark revision approved/locked with identity/timestamp;
13. write before/after + snapshot audit payload;
14. commit all or roll back all.

- [ ] **Step 7: Defend against direct RPC bypass**

RPCs are `SECURITY DEFINER` but must themselves check JWT-backed permission and scope. Next.js route guards are defense-in-depth, not the only authorization boundary.

- [ ] **Step 8: Run regression**

```bash
node scripts/budget-revision-reforecast.test.mjs
```

---

### Task 4: Add TypeScript revision service and guarded API operations

**Files:**
- Create: `lib/budget-revision.ts`
- Modify: `lib/budget-module.ts`
- Modify: `app/api/workflows/budget/route.ts`
- Extend: `scripts/budget-revision-reforecast.test.mjs`

**Interfaces:**

```ts
export type BudgetRevisionType = 'VIREMENT' | 'SUPPLEMENTARY' | 'REDUCTION' | 'RECLASSIFICATION' | 'REFORECAST'
export type BudgetRevisionAction = 'SUBMIT' | 'RESUBMIT' | 'REVIEW' | 'RETURN' | 'REJECT' | 'APPROVE'
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

Require service file, API operation names and revision permission map.

- [ ] **Step 2: Implement `lib/budget-revision.ts`**

Reads use revision tables/views; mutations POST to `/api/workflows/budget`.

```ts
// create
{ operation:'create-budget-revision', parentSubmissionId, revisionType, reason, authorityReference, effectiveDate, supportingReference }
// transition
{ operation:'transition-budget-revision', revisionId, action, comments }
```

- [ ] **Step 3: Extend `BudgetSubmission` typing**

Add nullable `parent_submission_id` and `superseded_by_id` in `lib/budget-module.ts`.

- [ ] **Step 4: Add API operations and action permission map**

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

Create requires `budget.revision.create`. Both operations call request-scoped authenticated Supabase RPCs.

- [ ] **Step 5: Preserve authenticated audit identity**

Pass `guard.context` identity; ignore browser-supplied identity fields.

- [ ] **Step 6: Run checks**

```bash
node scripts/budget-revision-reforecast.test.mjs
bun run typecheck
bun run lint
```

---

### Task 5: Add revision UX to Budget Preparation

**Files:**
- Modify: `app/dashboard/budget-template/page.tsx`
- Create: `app/dashboard/budget-template/BudgetRevisionPanel.tsx`
- Create: `app/dashboard/budget-template/BudgetRevisionDialog.tsx`
- Extend: `scripts/budget-revision-reforecast.test.mjs`

**Interfaces:**
- Approved current version remains read-only.
- `Create Budget Revision` only for `budget.revision.create` and current unsuperseded approved version.
- Revision DRAFT/RETURNED editable only for revision editor.
- Submitted/reviewed/approved revision read-only.
- Registrar buttons use revision permissions.

- [ ] **Step 1: Add failing UI assertions**

Require labels: `Create Budget Revision`, `Original Approved`, `Current Revised`, `Actual Paid`, `Outstanding Commitments`, `Protected Minimum`, `Available After Revision`, `Revision Type`, `Current Authoritative`, and revision permission checks.

- [ ] **Step 2: Add creation dialog**

Fields: revision type, reason, authority reference, effective date, supporting reference. Require authority reference client-side for SUPPLEMENTARY; server remains authoritative. Select returned revision submission after creation.

- [ ] **Step 3: Load metadata/position/history**

For revision-linked submission load revision header, `v_budget_revision_position` and lineage. Index position by `revision_budget_line_id`.

- [ ] **Step 4: Add financial-control columns**

Add read-only columns near the left:

```text
Original Approved | Current Revised | Actual Paid | Outstanding Commitments |
Protected Minimum | Adjustment | Available After Revision
```

The existing Calculated Estimate is the proposed revised annual amount. Do not add a second editable annual total.

- [ ] **Step 5: Protect baseline rows and posting identity**

For copied baseline rows in a revision:

- disable checkbox deletion;
- disable Finance Code and Funding Source changes;
- preserve source allocation identity;
- allow quantity/unit cost/frequency/other costs to change so the proposed annual value can be adjusted;
- allow reduction to zero only when server-side protected minimum is zero.

For VIREMENT/RECLASSIFICATION, user decreases the existing source row and uses `Add Row` for the new target code. Newly added target rows may be checkbox-deleted before approval.

- [ ] **Step 6: Lock actual/closed monthly periods**

Disable month input when `budget_periods.is_open=false` or the source allocation has PAID/RECONCILED actual expenditure in that month. Future/open/no-actual months remain editable. Non-revision initial drafts keep existing behavior.

- [ ] **Step 7: Add summary/version badges**

Show version, revision number/type, Original, Current Revised, Proposed, Actual, Outstanding, Available, net adjustment, status and Current Authoritative/Historical.

- [ ] **Step 8: Wire revision workflow buttons**

```text
DRAFT/RETURNED + Line Supervisor -> Save / Submit or Resubmit
SUBMITTED + Registrar -> Review / Return / Reject
REVIEWED + Registrar -> Approve / Reject
APPROVED -> view-only
```

Keep initial-budget workflow unchanged for non-revision submissions.

- [ ] **Step 9: Add version history panel**

Show version, revision number/type, status, reason/reference, submit/approval identity/date, total and net adjustment. Historic selection is immutable.

- [ ] **Step 10: Run UI/static build**

```bash
node scripts/budget-revision-reforecast.test.mjs
bun run lint
bun run typecheck
bun run build
```

---

### Task 6: Add migration 053 and update Budget Control/reporting

**Files:**
- Create: `supabase/migrations/053_budget_revision_reporting.sql`
- Modify: `lib/api.ts`
- Modify: `app/dashboard/budget/page.tsx`
- Extend: `scripts/budget-revision-reforecast.test.mjs`

**Interfaces:**
- Budget Control exposes Original Budget, Supplementary Budget, Revision Adjustment, Current Revised Budget, Actual Expenditure, Outstanding Commitments, Available Balance and latest approved revision metadata.
- Existing funded/released/pending metrics remain.

- [ ] **Step 1: Add failing reporting assertions**

Require `revision_adjustment`, `latest_revision_number`, `latest_revision_type`, migration 053 and UI labels.

- [ ] **Step 2: Replace reporting views through migration 053**

Recreate affected current financial position views to expose:

```text
original_budget
supplemental_budget
revision_adjustment
revised_budget
latest_revision_number
latest_revision_type
latest_revision_effective_date
```

Preserve every existing column name consumed elsewhere. Use latest approved revision joins in SQL rather than reconstructing lineage in React.

- [ ] **Step 3: Update TypeScript API type**

```ts
original_budget: number
supplemental_budget: number
revision_adjustment: number
revised_budget: number
latest_revision_number?: string | null
latest_revision_type?: string | null
latest_revision_effective_date?: string | null
```

- [ ] **Step 4: Update Budget Control UI/export**

Make Original, Supplementary and non-supplementary Revision Adjustment distinct. Preserve funded/released/pending/actual/commitment metrics.

- [ ] **Step 5: Preserve cash-availability semantics**

Budget-value availability is:

```text
Current Revised - Actual - Outstanding Commitments
```

If an existing view/card uses released/funded cash availability, keep that measure with its existing meaning and display budget-value availability separately. Do not silently redefine a current metric.

- [ ] **Step 6: Run checks**

```bash
node scripts/budget-revision-reforecast.test.mjs
bun run lint
bun run typecheck
bun run build
```

---

### Task 7: Harden audit, concurrency and financial edge cases

**Files:**
- Modify before application: `supabase/migrations/052_budget_revision_workflow.sql`
- Modify before application: `supabase/migrations/053_budget_revision_reporting.sql`
- Extend: `scripts/budget-revision-reforecast.test.mjs`

**Interfaces:**
- No lost update if commitments/payments change during review.
- No concurrent active revisions for same parent.
- No source row below protected minimum.
- No hidden posting-code mutation of existing allocation history.
- Funding restrictions enforced from authoritative funding data.

- [ ] **Step 1: Add edge-case assertions**

Require explicit guards/errors for active revision, protected minimum, balanced virement, supplementary authority, superseded parent, source posting identity, and changed financial position.

- [ ] **Step 2: Approval uses fresh position**

Submission snapshots are evidence only. After allocation locks, requery authoritative actual/outstanding values and write approval snapshots.

- [ ] **Step 3: Enforce funding restrictions**

SUPPLEMENTARY must match valid authority/reference and available authorised amount. Virement/reclassification across restricted project/department/section/cost-centre/expense-code boundaries is rejected.

- [ ] **Step 4: Enforce immutable history**

Reject edits/revision creation from approved superseded versions. Reject missing copied baseline rows and altered source posting identity.

- [ ] **Step 5: Verify audit payloads**

Include revision number/type, parent/new submission ids, reason/reference, allocation ids, before/proposed/approved values and both snapshot sets.

---

### Task 8: Full verification, Supabase migration, deploy preview and merge

**Files:**
- Review all feature changes only.

**Interfaces:**
- Approved baseline immutable.
- New revisions are versioned.
- Line Supervisor originates/submits in scope.
- Registrar reviews/approves system-wide.
- Actuals/commitments protect obligations.
- Existing allocation IDs persist for existing lines.

- [ ] **Step 1: Run full CI-equivalent gate**

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

Expected: all PASS.

- [ ] **Step 2: Open PR and inspect diff**

Confirm only intended schema/RBAC/service/UI/reporting/test files changed and migrations 000-050 are untouched.

- [ ] **Step 3: Require GitHub CI success**

`Build and validate` must pass including revision regression.

- [ ] **Step 4: Require correct Netlify preview**

`netlify/njsscrem/deploy-preview` must be success. Do not use legacy/duplicate `njsscrems` as production gate.

- [ ] **Step 5: Apply tracked migrations 051, 052, 053 in order**

After application, read-only verification confirms revision tables, `revision_adjustment`, ordinary trigger-maintained `revised_budget`, all nine permissions, role mappings, views and RPCs. Confirm existing allocation, commitment and payment relationships/counts are unchanged by migration.

- [ ] **Step 6: Non-destructive live smoke checks**

Without creating real financial transactions verify approved submissions remain locked, revision controls resolve from RBAC, Budget Control renders new fields, FF3/FF4/Commitments still load, and every existing allocation satisfies:

```text
revised_budget = original_budget + supplemental_budget + revision_adjustment
```

Full revision create/submit/approve is performed only as controlled UAT using an approved UAT budget record.

- [ ] **Step 7: Merge after all gates pass**

Merge implementation PR to `main` and capture new SHA for Netlify production deployment.

- [ ] **Step 8: Post-merge production verification**

After `njsscrem` production deploy succeeds, verify Budget Preparation/Budget Control load and deployment did not mutate any approved budget.

## UAT execution set

1. Create revision only from current approved version.
2. Reject second simultaneous active revision.
3. Parent approved version remains unchanged.
4. Copy all lines/months into new version.
5. Actuals/outstanding commitments appear automatically.
6. Block proposal below protected minimum.
7. Permit proposal equal to protected minimum.
8. Balanced virement passes; unbalanced fails.
9. Supplementary increase requires authority/reference.
10. Reduction preserves original and posts signed revision adjustment.
11. Reclassification uses source decrease + target new line; source posting identity remains unchanged.
12. Copied baseline row cannot be physically deleted; new target draft row can.
13. Reforecast locks closed/PAID/RECONCILED actual months and permits future months.
14. Submission captures financial snapshots.
15. Changed commitments before approval trigger fresh revalidation.
16. Registrar can return/reject/approve; Line Supervisor cannot approve.
17. Requisition Officer and Payment/Reconciliation Officer cannot edit revisions.
18. Existing line approval preserves `budget_allocation.id`.
19. Approval updates source line/submission linkage to new current version.
20. Old approved version links forward via `superseded_by_id`.
21. New approved version is locked/current-authoritative.
22. Original budget remains unchanged.
23. True supplementary and non-supplementary adjustments remain separately reportable.
24. Budget Control reports Current Revised, Actual, Outstanding and budget-value Available correctly.
25. Existing cash/funding availability metric retains its prior meaning.
26. Audit/history contains complete before/after plus submission/approval snapshot evidence.
