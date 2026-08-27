# Budget Revision Workspace & Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated Budget Revision & Supplementary Budget workspace where the Registrar initiates and assigns a post-approval change request to the responsible Line Supervisor, the supervisor prepares/submits it, the Registrar approves/returns/rejects it, and both parties receive secure in-app notifications.

**Architecture:** Reuse the hardened revision engine from migrations 051–054 and add a Task 8 workspace layer through migration 055, a focused client service, a dedicated `/dashboard/budget/revisions` page, and budget-revision notification routing. Assignment and workflow notification creation are enforced at the database boundary; the UI is a role-specific work queue over the same revision records, not a second revision engine.

**Tech Stack:** Next.js/React, Supabase/PostgreSQL, existing RBAC/notification framework, SECURITY DEFINER RPCs, RLS, Node regression scripts, GitHub Actions CI, Netlify.

**Spec:** `docs/superpowers/specs/2026-08-27-budget-revision-workspace-notifications-design.md`

## Global Constraints

- Preserve migrations 051–054 and all existing revision financial controls.
- Registrar alone initiates a revision request.
- Only an active exact-section Line Supervisor can be assigned and can edit/submit the revision.
- Registrar alone approves, returns, or rejects.
- No separate user-facing revision REVIEW action.
- Existing approved budget remains locked and historical versions remain immutable.
- `notifications.user_id` is the NJSS `users.id`; authenticated identity is resolved through `users.auth_user_id = auth.uid()`.
- Notification creation occurs server-side/database-side; authenticated clients cannot insert/delete notifications directly.
- Correct menu placement is between Budget Control and Funding Management.
- Correct production site is `njsscrem`; ignore duplicate `njsscrems` status.
- Migration 055 is not applied to production until CI, lint, typecheck, build, review, and `njsscrem` deploy-preview are green.

---

### Task 1: TDD contract for workspace, menu, assignment and notifications

**Files:**
- Create: `scripts/budget-revision-workspace.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: migrations 051–054, `lib/rbac/config.ts`, existing notification components/hooks.
- Produces: executable Task 8 contract used by later tasks.

- [ ] **Step 1: Write the failing Task 8 regression**

The regression must assert all of the following before implementation exists:

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')

assert.ok(fs.existsSync('supabase/migrations/055_budget_revision_workspace_notifications.sql'))
assert.ok(fs.existsSync('app/dashboard/budget/revisions/page.tsx'))
assert.ok(fs.existsSync('lib/budget-revision-workspace.ts'))

const migration = read('supabase/migrations/055_budget_revision_workspace_notifications.sql')
for (const token of [
  'assigned_line_supervisor_id',
  'request_instruction',
  'requested_change_amount',
  'v_budget_revision_work_queue',
  'njss_create_budget_revision_request',
  'njss_get_eligible_line_supervisors',
  'BUDGET_REVISION_REQUESTED',
  'BUDGET_REVISION_SUBMITTED',
  'BUDGET_REVISION_RESUBMITTED',
  'BUDGET_REVISION_RETURNED',
  'BUDGET_REVISION_APPROVED',
  'BUDGET_REVISION_REJECTED',
  'users.auth_user_id = auth.uid()',
]) assert.ok(migration.includes(token), `missing ${token}`)

assert.match(migration, /ALTER TABLE notifications ENABLE ROW LEVEL SECURITY/i)
assert.match(migration, /REVOKE INSERT, DELETE ON notifications FROM authenticated/i)
assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.njss_create_budget_revision\(/i)

const config = read('lib/rbac/config.ts')
assert.ok(config.includes("code: 'budget.revisions'"))
assert.ok(config.includes("href: '/dashboard/budget/revisions'"))
assert.ok(config.includes("label: 'Budget Revision & Supplementary Budget'"))

const dropdown = read('components/NotificationsDropdown.tsx')
const notificationsPage = read('app/dashboard/notifications/page.tsx')
assert.ok(dropdown.includes("reference_type === 'BUDGET_REVISION'"))
assert.ok(notificationsPage.includes("reference_type === 'BUDGET_REVISION'"))
assert.ok(dropdown.includes('/dashboard/budget/revisions?revision='))
assert.ok(notificationsPage.includes('/dashboard/budget/revisions?revision='))

console.log('budget revision workspace regression checks passed')
```

- [ ] **Step 2: Add the regression to CI**

Add after the existing hardening regression in `.github/workflows/ci.yml`:

```yaml
- name: Budget revision workspace regression checks
  run: node scripts/budget-revision-workspace.test.mjs
```

- [ ] **Step 3: Run CI and verify RED**

Expected failure: migration 055 / workspace page / workspace service is missing.

- [ ] **Step 4: Commit the RED contract**

Commit message:

```text
test: define Task 8 budget revision workspace contract
```

---

### Task 2: Migration 055 — assignment, secure notification plumbing and work-queue view

**Files:**
- Create: `supabase/migrations/055_budget_revision_workspace_notifications.sql`
- Test: `scripts/budget-revision-workspace.test.mjs`

**Interfaces:**
- Consumes: `budget_revisions`, `budget_revision_lines`, `budget_divisions`, `divisional_budget_submissions`, `users`, `roles`, `user_roles`, `notifications`, hardened `njss_create_budget_revision(...)`, hardened `njss_transition_budget_revision(...)`.
- Produces: `njss_create_budget_revision_request(...)`, `njss_get_eligible_line_supervisors(UUID)`, `v_budget_revision_work_queue`, assignment metadata, secure notification behavior.

- [ ] **Step 1: Add assignment columns**

```sql
ALTER TABLE budget_revisions
  ADD COLUMN IF NOT EXISTS assigned_line_supervisor_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS request_instruction TEXT,
  ADD COLUMN IF NOT EXISTS requested_change_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

ALTER TABLE budget_revisions
  DROP CONSTRAINT IF EXISTS chk_budget_revisions_requested_change_amount;
ALTER TABLE budget_revisions
  ADD CONSTRAINT chk_budget_revisions_requested_change_amount
  CHECK (requested_change_amount IS NULL OR requested_change_amount >= 0) NOT VALID;
```

- [ ] **Step 2: Harden notification RLS using NJSS profile identity mapping**

Migration must:

```sql
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, DELETE ON notifications FROM authenticated;
GRANT SELECT, UPDATE ON notifications TO authenticated;

DROP POLICY IF EXISTS notifications_select_own ON notifications;
CREATE POLICY notifications_select_own ON notifications
FOR SELECT USING (
  user_id IS NULL
  OR EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = notifications.user_id
      AND u.auth_user_id = auth.uid()
      AND u.is_active = true
  )
);

DROP POLICY IF EXISTS notifications_update_own ON notifications;
CREATE POLICY notifications_update_own ON notifications
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = notifications.user_id
      AND u.auth_user_id = auth.uid()
      AND u.is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = notifications.user_id
      AND u.auth_user_id = auth.uid()
      AND u.is_active = true
  )
);
```

The update path must be additionally guarded so authenticated users can only change `is_read` and `read_at`; implement this with a trigger comparing `NEW` to `OLD` and rejecting changes to recipient, type, title, message, reference, priority, or timestamps other than `read_at`.

- [ ] **Step 3: Add internal notification helper with idempotency**

Create:

```sql
njss_create_budget_revision_notification(
  p_revision_id UUID,
  p_notification_type TEXT,
  p_recipient_user_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_priority TEXT DEFAULT 'HIGH'
) RETURNS UUID
```

The helper must be `SECURITY DEFINER`, revoked from `PUBLIC, authenticated`, and skip insertion when an equivalent notification already exists for the same `revision_id + notification_type + recipient`.

Use:

```sql
reference_type = 'BUDGET_REVISION'
reference_id = p_revision_id::TEXT
```

- [ ] **Step 4: Add exact-section eligible-supervisor RPC**

Create:

```sql
public.njss_get_eligible_line_supervisors(p_division_id UUID)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  email TEXT,
  department_id UUID,
  section_id UUID
)
```

Requirements:
- authenticated Registrar only;
- caller has `budget.revision.create`;
- target division is within caller scope;
- candidates are active `users` with active `Line Supervisor` role and `users.section_id = budget_divisions.section_id`;
- result ordered by full name/email.

- [ ] **Step 5: Add Registrar request wrapper RPC**

Create:

```sql
public.njss_create_budget_revision_request(
  p_parent_submission_id UUID,
  p_revision_type TEXT,
  p_reason TEXT,
  p_authority_reference TEXT DEFAULT NULL,
  p_effective_date DATE DEFAULT CURRENT_DATE,
  p_supporting_reference TEXT DEFAULT NULL,
  p_assigned_line_supervisor_id UUID DEFAULT NULL,
  p_request_instruction TEXT DEFAULT NULL,
  p_requested_change_amount NUMERIC DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
) RETURNS JSONB
```

Flow:
1. Resolve current app user and require active Registrar role + `budget.revision.create`.
2. Load parent submission/division and enforce current approved locked unsuperseded state and scope.
3. Require assigned supervisor.
4. Verify assigned user is active, has active Line Supervisor role, and `section_id` exactly equals target division section.
5. Call the existing hardened `njss_create_budget_revision(...)` internally.
6. Update the newly created `budget_revisions` row with assignment/instruction/change amount/assigned_at.
7. Insert `BUDGET_REVISION_REQUESTED` notification to the assigned supervisor in the same transaction.
8. Return the revision payload plus assignment.

After this wrapper exists:

```sql
REVOKE EXECUTE ON FUNCTION public.njss_create_budget_revision(UUID,TEXT,TEXT,TEXT,DATE,TEXT,TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.njss_create_budget_revision_request(UUID,TEXT,TEXT,TEXT,DATE,TEXT,UUID,TEXT,NUMERIC,TEXT) TO authenticated;
```

- [ ] **Step 6: Extend transition notification behavior without changing financial semantics**

Wrap or replace the public transition wrapper while preserving the existing hardened transition engine. After successful state transition:
- SUBMIT → requester Registrar receives `BUDGET_REVISION_SUBMITTED`;
- RESUBMIT → requester Registrar receives `BUDGET_REVISION_RESUBMITTED`;
- RETURN → assigned supervisor receives `BUDGET_REVISION_RETURNED`;
- APPROVE → assigned supervisor receives `BUDGET_REVISION_APPROVED`;
- REJECT → assigned supervisor receives `BUDGET_REVISION_REJECTED`.

The notification must be in the same transaction as the successful transition.

- [ ] **Step 7: Create security-invoker work-queue view**

Create `v_budget_revision_work_queue WITH (security_invoker=true)` exposing:
- revision id/number/type/status/reason/reference/effective date;
- request instruction and requested change amount;
- requesting Registrar id/name/email;
- assigned supervisor id/name/email;
- parent and revision submission ids/numbers/versions;
- budget year, department, section, division names/codes;
- aggregate original budget/current revised/proposed revised/actual/outstanding/protected minimum;
- queue state:
  - DRAFT/RETURNED → `SUPERVISOR_ACTION`
  - SUBMITTED/RESUBMITTED → `REGISTRAR_ACTION`
  - APPROVED/REJECTED/ARCHIVED → `COMPLETED`
- created/assigned/approved timestamps.

Grant authenticated SELECT; underlying RLS/data-scope remains authoritative.

- [ ] **Step 8: Register runtime menu row**

Insert/update `menu_items`:

```sql
('budget.revisions','budget',NULL,'Budget Revision & Supplementary Budget',
 '/dashboard/budget/revisions','RefreshCcw',23,
 ARRAY['budget.revision.view','budget.revision.create','budget.revision.edit','budget.revision.submit','budget.revision.approve','budget.revision.return','budget.revision.reject','budget.revision.report'],true)
```

Use only an icon key actually registered in `ICONS`; if `RefreshCcw` is added, update `lib/rbac/config.ts` in Task 3. Otherwise use an existing supported icon such as `ClipboardList`.

- [ ] **Step 9: Run the Task 8 regression**

Expected: migration source assertions pass; UI/service assertions still fail until later tasks.

- [ ] **Step 10: Commit migration 055**

Commit message:

```text
feat: add revision workspace assignment and notification controls
```

---

### Task 3: Static RBAC fallback and workspace client service/API

**Files:**
- Create: `lib/budget-revision-workspace.ts`
- Modify: `lib/rbac/config.ts`
- Modify: `app/api/workflows/budget/route.ts`
- Modify: `lib/budget-revision.ts`
- Test: `scripts/budget-revision-workspace.test.mjs`

**Interfaces:**
- Consumes: migration 055 RPC/view names.
- Produces: typed client functions used by the workspace page and new request form.

- [ ] **Step 1: Add static menu fallback and route permission**

Add a menu item equivalent to the runtime row:

```ts
{
  code: 'budget.revisions',
  module_code: 'njss_operations',
  label: 'Budget Revision & Supplementary Budget',
  href: '/dashboard/budget/revisions',
  icon: 'ClipboardList',
  sort_order: 35,
  required_permissions: [
    'budget.revision.view','budget.revision.create','budget.revision.edit',
    'budget.revision.submit','budget.revision.approve','budget.revision.return',
    'budget.revision.reject','budget.revision.report'
  ],
  is_active: true,
}
```

Place between Budget Control and Funding in fallback ordering. Add `/dashboard/budget/revisions` route permissions before the broader `/dashboard/budget($|/)` matcher so revision permissions are evaluated correctly.

- [ ] **Step 2: Define workspace types**

In `lib/budget-revision-workspace.ts` define:

```ts
export type EligibleLineSupervisor = {
  user_id: string
  full_name: string | null
  email: string | null
  department_id: string | null
  section_id: string | null
}

export type BudgetRevisionQueueItem = {
  revision_id: string
  revision_number: string
  revision_type: BudgetRevisionType
  status: string
  queue_state: 'SUPERVISOR_ACTION' | 'REGISTRAR_ACTION' | 'COMPLETED'
  budget_year: number
  department_name: string | null
  section_name: string | null
  division_code: string | null
  division_name: string | null
  parent_submission_id: string
  revision_submission_id: string
  assigned_line_supervisor_id: string | null
  assigned_line_supervisor_name: string | null
  requested_by: string | null
  requested_by_name: string | null
  request_instruction: string | null
  requested_change_amount: number | null
  original_budget: number
  current_revised_budget: number
  proposed_revised_budget: number
  actual_expenditure: number
  outstanding_commitment: number
  protected_minimum: number
  created_at: string
  assigned_at: string | null
  approved_at: string | null
}
```

- [ ] **Step 3: Add service functions**

Implement:

```ts
export async function getBudgetRevisionWorkQueue(): Promise<BudgetRevisionQueueItem[]>
export async function getEligibleLineSupervisors(divisionId: string): Promise<EligibleLineSupervisor[]>
export async function createBudgetRevisionRequest(input: CreateBudgetRevisionRequestInput): Promise<CreateBudgetRevisionRequestResult>
```

Use authenticated session bearer token for workflow POST, matching `lib/budget-revision.ts`.

- [ ] **Step 4: Add API operation `create-budget-revision-request`**

Route requirements:
- `budget.revision.create` permission;
- validate parent, type, reason, assigned supervisor;
- require authority reference for SUPPLEMENTARY;
- call `njss_create_budget_revision_request`;
- never call the old unassigned creation RPC from authenticated API.

- [ ] **Step 5: Deprecate authenticated client use of `createBudgetRevision(...)`**

Keep types/helpers needed by existing code, but change the Budget Preparation shortcut to navigate to the workspace rather than calling unassigned creation. If `createBudgetRevision` remains exported for internal compatibility, it must not be invoked by UI code.

- [ ] **Step 6: Run Task 8 regression**

Expected: menu/service/API assertions green; workspace page and notification routing still RED.

- [ ] **Step 7: Commit service/RBAC/API**

Commit message:

```text
feat: add revision workspace service and navigation
```

---

### Task 4: Dedicated Registrar/Line Supervisor workspace UI

**Files:**
- Create: `app/dashboard/budget/revisions/page.tsx`
- Create: `app/dashboard/budget/revisions/BudgetRevisionRequestDialog.tsx`
- Create: `app/dashboard/budget/revisions/BudgetRevisionQueue.tsx`
- Modify: `app/dashboard/budget-template/page.tsx`
- Test: `scripts/budget-revision-workspace.test.mjs`

**Interfaces:**
- Consumes: `getBudgetRevisionWorkQueue`, `getEligibleLineSupervisors`, `createBudgetRevisionRequest`, existing `getBudgetRevisionPosition`, existing transition functions.
- Produces: operational front door for Registrar and Line Supervisor.

- [ ] **Step 1: Build the workspace page shell**

Use `useAuth()` and explicit business roles:

```ts
const isRegistrar = roles.includes('Registrar')
const isLineSupervisor = roles.includes('Line Supervisor')
```

Do not let `all` permission alone expose business actions.

- [ ] **Step 2: Load and partition queue items**

Registrar:
- Awaiting My Action = SUBMITTED/RESUBMITTED
- Open Requests = DRAFT/RETURNED
- Completed = APPROVED/REJECTED/ARCHIVED

Line Supervisor:
- My Revision Requests = assigned to current profile and DRAFT/RETURNED
- Submitted = SUBMITTED/RESUBMITTED
- Completed = APPROVED/REJECTED/ARCHIVED

The page must not infer scope; render only rows returned by the secure view.

- [ ] **Step 3: Add summary cards**

Registrar cards:
`Awaiting Registrar Action`, `Requested / In Preparation`, `Returned`, `Approved`, `Rejected`.

Supervisor cards:
`New Requests`, `Draft / Returned`, `Submitted`, `Approved / Rejected`.

- [ ] **Step 4: Build `BudgetRevisionRequestDialog`**

Registrar form fields:
- Budget Year
- Department
- Section/Division
- Current Approved Budget
- Change Type
- Indicative Change Amount
- Reason/Justification
- Authority Reference
- Effective Date
- Supporting Reference
- Instruction to Line Supervisor
- Responsible Line Supervisor

Selection behavior:
- after division selection, load eligible supervisors;
- 1 result → preselect;
- >1 → require selection;
- 0 → block submission and show: `No active Line Supervisor is assigned to this section. Configure the section assignment before requesting a budget change.`

Pre-submit budget summary shows Original, Current Revised, Actual, Outstanding, Budget Available, Released Available.

- [ ] **Step 5: Add role-specific queue actions**

Line Supervisor DRAFT/RETURNED row action:

```text
Open Revision
```

Navigate to:

```text
/dashboard/budget-template?submission=<revision_submission_id>&revision=<revision_id>
```

Registrar SUBMITTED/RESUBMITTED row actions:

```text
Approve | Return | Reject
```

Use existing `transitionBudgetRevision` and require comments for Return/Reject.

- [ ] **Step 6: Handle direct links**

Support:

```text
/dashboard/budget/revisions?revision=<revision_id>
```

by selecting/highlighting/opening that queue item.

Support:

```text
/dashboard/budget/revisions?parent=<approved_submission_id>&action=request
```

by opening the Registrar request dialog with the parent preselected.

- [ ] **Step 7: Change Budget Preparation shortcut**

Replace direct dialog opening with navigation:

```ts
router.push(`/dashboard/budget/revisions?parent=${selected.id}&action=request`)
```

The existing “Request Budget Change” button remains as a shortcut only.

- [ ] **Step 8: Run Task 8 regression and application checks**

Run:

```text
node scripts/budget-revision-workspace.test.mjs
bun run lint
bun run typecheck
```

Expected: Task 8 regression, lint and typecheck PASS.

- [ ] **Step 9: Commit workspace UI**

Commit message:

```text
feat: add budget revision work queue workspace
```

---

### Task 5: Budget revision notification routing and display

**Files:**
- Modify: `components/NotificationsDropdown.tsx`
- Modify: `app/dashboard/notifications/page.tsx`
- Modify: `hooks/useRealtimeNotifications.ts`
- Test: `scripts/budget-revision-workspace.test.mjs`

**Interfaces:**
- Consumes: notifications with `reference_type='BUDGET_REVISION'` and `reference_id=revision_id`.
- Produces: secure recipient filtering and direct revision links.

- [ ] **Step 1: Pass NJSS profile id to notification hook**

Where the UI currently uses Supabase auth `user.id`, use `profile.id` when applying the optional recipient filter:

```ts
const { user, profile } = useAuth()
const notificationUserId = profile?.id
const { notifications, ...rest } = useRealtimeNotifications(notificationUserId)
```

Keep realtime subscription authorization/RLS database-driven; this client id is only a recipient filter.

- [ ] **Step 2: Add budget revision icon/type handling**

In dropdown and full page:

```ts
if (type.startsWith('BUDGET_REVISION')) return <ClipboardList ... />
```

- [ ] **Step 3: Add direct link routing**

```ts
if (notification.reference_type === 'BUDGET_REVISION') {
  return `/dashboard/budget/revisions?revision=${notification.reference_id}`
}
```

- [ ] **Step 4: Add notification filter option**

Full Notifications page:

```html
<option value="BUDGET_REVISION">Budget Revisions</option>
```

- [ ] **Step 5: Run regression, lint, typecheck and build**

Run:

```text
node scripts/budget-revision-workspace.test.mjs
bun run lint
bun run typecheck
bun run build
```

Expected: all PASS.

- [ ] **Step 6: Commit notification UI**

Commit message:

```text
feat: route budget revision notifications to workspace
```

---

### Task 6: Review, migration gate, UAT and delivery

**Files:**
- Review all Task 8 changed files
- Migration: `supabase/migrations/055_budget_revision_workspace_notifications.sql`

**Interfaces:**
- Consumes: completed Task 8 branch.
- Produces: production-ready PR and controlled migration/UAT evidence.

- [ ] **Step 1: Run full CI on the final branch head**

Required green steps include all pre-existing regressions plus Task 8, lint, typecheck and production build.

- [ ] **Step 2: Verify correct Netlify deploy preview**

Required status:

```text
netlify/njsscrem/deploy-preview = success
```

Do not treat `njsscrems` as the production site.

- [ ] **Step 3: Review migration 055 against live schema before applying**

Verify:
- notification FK remains `notifications.user_id -> users.id`;
- `users.auth_user_id` exists;
- `reference_id` is text-compatible with UUID string;
- current menu module code is `budget`;
- current role names exactly `Registrar` and `Line Supervisor`;
- no existing active column/index/function conflict.

- [ ] **Step 4: Apply migration 055 only after code gates are green**

Use Supabase `apply_migration`, not raw DDL through `execute_sql`.

- [ ] **Step 5: Post-migration verification**

Query and verify:
- assignment columns exist;
- notifications RLS enabled;
- authenticated cannot INSERT/DELETE notifications;
- own SELECT/UPDATE policies map through `users.auth_user_id = auth.uid()`;
- `njss_create_budget_revision_request` executable to authenticated;
- old unassigned `njss_create_budget_revision` not executable to authenticated;
- eligible-supervisor RPC exists;
- `v_budget_revision_work_queue` exists;
- runtime `budget.revisions` menu row exists;
- no existing revision/allocation data changed by migration.

- [ ] **Step 6: Controlled UAT without inventing financial transactions**

Use existing approved budget data only if a suitable approved current submission exists. Validate:
1. Registrar can open Initiate Budget Change.
2. Exact-section Line Supervisor is selected/required.
3. Request creates DRAFT revision and sends supervisor notification.
4. Supervisor sees request in My Revision Requests and can open/edit only their section.
5. Supervisor Submit generates Registrar notification.
6. Registrar Return generates supervisor notification; supervisor Resubmit generates Registrar notification.
7. Registrar Approve/Reject route works according to existing hardening rules.
8. Notification click opens exact workspace revision.

If no safe suitable approved budget exists, do not fabricate one in production; stop at schema/RPC verification and document the UAT prerequisite.

- [ ] **Step 7: Open Task 8 PR**

Title:

```text
Add budget revision workspace and notifications
```

Body must state that migration 055 is not merged/applied until the recorded gates have been satisfied.

- [ ] **Step 8: Final verification before merge**

Use fresh evidence for:
- PR mergeability;
- final CI success;
- `njsscrem` preview success;
- migration verification;
- unresolved review threads = none.

- [ ] **Step 9: Merge only the exact verified head**

Use expected head SHA protection. After merge, verify `main` points to the merge commit and Netlify production deployment publishes that commit.