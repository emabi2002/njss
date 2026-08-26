# NJSS Four-Group RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing five-role NJSS workflow model with four controlled operational groups plus System Administrator, add section-wide scoping, and make role assignment automatically determine menus, permissions and reporting scope.

**Architecture:** Preserve the existing Supabase-backed RBAC framework and add one additive migration after 044. Runtime permission resolution remains role-based; a new `SECTION_WIDE` scope is added to shared RBAC types and scope evaluators. UI/user administration is updated to expose only the four controlled business groups plus System Administrator, while advanced role-permission configuration remains available to authorised administrators.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Supabase/PostgreSQL, Node built-in test/assert utilities, ESLint, TypeScript compiler.

**Spec:** `docs/superpowers/specs/2026-08-26-four-group-rbac-design.md`

## Global Constraints

- Do not modify historical migrations 000-044.
- Preserve historic FF3, FF4, payment, user and audit records.
- One business workflow group per normal staff account.
- System Administrator cannot also hold a business workflow group.
- Requisition Officer and Line Supervisor are section-scoped.
- Registrar and Payment/Reconciliation Officer are system-wide.
- Only Requisition Officer and Line Supervisor receive normal `supplier.create` authority.
- Line Supervisor prepares/submits budget; Registrar reviews/approves/rejects budget.
- UI hiding is not authorization; server/API/database checks must continue to enforce permissions and scope.

---

### Task 1: Add four-group constants and section-wide scope

**Files:**
- Modify: `lib/rbac/types.ts`
- Modify: `lib/rbac/scope.ts`
- Modify: `app/dashboard/users/types.ts`
- Create: `lib/rbac/four-group-rbac.test.mjs`

**Interfaces:**
- Produces `DataScopeType` value `SECTION_WIDE`.
- Produces canonical group names: `Requisition Officer`, `Line Supervisor`, `Registrar`, `Payment/Reconciliation Officer`, `System Administrator`.
- `isRecordInScope(context, record)` returns true for matching `section_id` when any active scope is `SECTION_WIDE`.

- [ ] **Step 1: Write the failing regression test**

Create `lib/rbac/four-group-rbac.test.mjs` using Node `assert` to verify the TypeScript source contains `SECTION_WIDE`, the four canonical business group names, and section comparison logic (`record.section_id === context.sectionId`).

- [ ] **Step 2: Run the test and confirm failure**

Run: `node lib/rbac/four-group-rbac.test.mjs`
Expected: FAIL because `SECTION_WIDE` and the four-group constants do not yet exist.

- [ ] **Step 3: Implement shared type/scope changes**

Add `SECTION_WIDE` to `DataScopeType` and to the access-admin scope dropdown. Update `isRecordInScope` so `SECTION_WIDE` returns true only when both the authenticated user's `sectionId` and record `section_id` exist and match.

Replace the five-role `WORKFLOW_ROLE_ORDER` with:

```ts
export const WORKFLOW_ROLE_ORDER = [
  "Requisition Officer",
  "Line Supervisor",
  "Registrar",
  "Payment/Reconciliation Officer",
]
```

- [ ] **Step 4: Re-run regression test**

Run: `node lib/rbac/four-group-rbac.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run static checks**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

---

### Task 2: Add additive migration 045 for controlled groups and automatic permission bundles

**Files:**
- Create: `supabase/migrations/045_four_group_operational_rbac.sql`
- Extend: `lib/rbac/four-group-rbac.test.mjs`

**Interfaces:**
- Migration creates/updates four business roles and keeps System Administrator protected.
- Existing FF4 Officer and Accounts Reconciliation Officer assignments migrate to Payment/Reconciliation Officer.
- Existing section and department fields on `users` remain unchanged.
- `role_permissions` becomes the source of inherited permissions for each group.

- [ ] **Step 1: Extend failing regression test**

Assert that migration 045 exists and contains all five canonical role names, role-migration mappings, `SECTION_WIDE`, `SYSTEM_WIDE`, `supplier.create`, budget template permissions for Line Supervisor, Registrar budget approval, `ff4.reconcile` for Payment/Reconciliation Officer, and `all` for System Administrator.

- [ ] **Step 2: Run the test and confirm failure**

Run: `node lib/rbac/four-group-rbac.test.mjs`
Expected: FAIL because migration 045 does not exist.

- [ ] **Step 3: Implement migration 045**

The migration must:

1. Extend the existing `data_scope_type` checks/enums safely so `SECTION_WIDE` is accepted wherever scope values are constrained.
2. Create/update `Requisition Officer`, `Line Supervisor`, `Registrar`, `Payment/Reconciliation Officer` as protected business roles with workflow sequence 1-4.
3. Set Requisition Officer and Line Supervisor default scope to `SECTION_WIDE`.
4. Set Registrar and Payment/Reconciliation Officer scope to `SYSTEM_WIDE`.
5. Replace each controlled role's permissions with the exact permission bundles in the approved spec.
6. Migrate user assignments from old controlled names to new names without deleting historic role rows.
7. Retire old controlled roles after mapping.
8. Recreate/update the single-workflow-role guard so it refers to four controlled business groups, not five.
9. Preserve System Administrator `all` permission and technical/business separation.
10. Record migration/audit events for role changes when the existing audit function is available.

- [ ] **Step 4: Re-run regression test**

Run: `node lib/rbac/four-group-rbac.test.mjs`
Expected: PASS.

---

### Task 3: Update runtime RBAC catalogue, route/menu inheritance and admin wording

**Files:**
- Modify: `lib/rbac/config.ts`
- Modify: `app/dashboard/users/access-tabs.tsx`
- Modify: `app/api/admin/users/route.ts`
- Extend: `lib/rbac/four-group-rbac.test.mjs`

**Interfaces:**
- Existing `MENU_ITEMS` and `ROUTE_PERMISSIONS` remain permission-driven rather than role-name-driven.
- User administration accepts only an active controlled business role or System Administrator.

- [ ] **Step 1: Add failing source assertions**

Assert that no active runtime/admin UI wording still says `five controlled` or `five fixed workflow roles`, and that old role names are not present in the canonical role-order list.

- [ ] **Step 2: Run test and confirm failure**

Run: `node lib/rbac/four-group-rbac.test.mjs`
Expected: FAIL on legacy five-role wording.

- [ ] **Step 3: Update runtime/admin code**

- Keep permission catalogue entries needed by the new bundles.
- Add `ff4.reconcile` to the runtime catalogue if not already present there.
- Change user administration validation/error text from five controlled roles to four controlled groups.
- Change Access Control role-panel copy to four fixed workflow groups plus protected administrator.
- Preserve permission-based route gating so inherited permission bundles automatically determine menu visibility.

- [ ] **Step 4: Re-run test and static checks**

Run: `node lib/rbac/four-group-rbac.test.mjs && npm run typecheck && npm run lint`
Expected: PASS.

---

### Task 4: Enforce section/system scope through workflow APIs and reports

**Files:**
- Review/modify as needed: `app/api/workflows/ff3/route.ts`
- Review/modify as needed: `app/api/workflows/budget/route.ts`
- Review/modify as needed: `app/api/workflows/suppliers/route.ts`
- Review/modify as needed: `app/api/workflows/ff4/route.ts`
- Review/modify as needed: `app/dashboard/reports/page.tsx`
- Review/modify as needed: reporting functions introduced by migration 028
- Extend: `lib/rbac/four-group-rbac.test.mjs`

**Interfaces:**
- Requisition Officer and Line Supervisor can access records/reports matching their `section_id`.
- Registrar and Payment/Reconciliation Officer can access all sections due `SYSTEM_WIDE`.
- Supplier creation requires `supplier.create`; this is inherited only by Requisition Officer and Line Supervisor among business groups.

- [ ] **Step 1: Add failing authorization assertions**

Add source/migration assertions verifying workflow writes call server permission guards and that section scope logic is available to data filtering/authorization paths. Add assertions that the new migration grants `supplier.create` only to the two section-level business groups.

- [ ] **Step 2: Run test and record any failing paths**

Run: `node lib/rbac/four-group-rbac.test.mjs`
Expected: Any unguarded or inconsistent path fails the source assertions.

- [ ] **Step 3: Patch affected API/report paths minimally**

Use `requirePermission`/server access context and section matching where the existing path does not already enforce RBAC. Do not duplicate authorization logic in UI components when the shared server/scope utilities can be used.

- [ ] **Step 4: Static verification**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

---

### Task 5: Update user provisioning UX for group + organisational assignment

**Files:**
- Modify: `app/dashboard/users/page.tsx`
- Modify: `app/dashboard/users/access-tabs.tsx` only if needed for labels/help text
- Extend: `lib/rbac/four-group-rbac.test.mjs`

**Interfaces:**
- Create/edit user continues to submit `department_id`, `section_id`, and one `role_id` to `/api/admin/users`.
- Section-level groups require a section selection in the UI and API.
- System-wide groups do not derive access from the selected section.

- [ ] **Step 1: Add failing UI/API validation assertions**

Verify source contains a canonical predicate/helper identifying section-scoped groups and that user creation rejects Requisition Officer/Line Supervisor accounts without `section_id`.

- [ ] **Step 2: Implement minimal provisioning rules**

Display `Major Access Group` in the user form, restrict selectable business groups to the four controlled groups, require Section for Requisition Officer/Line Supervisor, and show `System-wide` scope guidance for Registrar/Payment-Reconciliation/System Administrator.

Mirror the section requirement server-side in `app/api/admin/users/route.ts` so it cannot be bypassed from the browser.

- [ ] **Step 3: Run regression/static checks**

Run: `node lib/rbac/four-group-rbac.test.mjs && npm run typecheck && npm run lint`
Expected: PASS.

---

### Task 6: Final verification and deployment readiness

**Files:**
- Review all changed files on `feature/four-group-rbac`
- No additional feature scope unless verification finds a defect

**Interfaces:**
- Four controlled business groups plus System Administrator only.
- Automatic role-permission inheritance works through existing `role_permissions` loading.
- Section-wide and system-wide scope behavior matches the approved spec.

- [ ] **Step 1: Run complete verification**

Run:

```bash
node lib/rbac/four-group-rbac.test.mjs
npm run typecheck
npm run lint
npm run build
```

Expected: all commands PASS.

- [ ] **Step 2: Inspect migration safety**

Confirm migration 045 is additive, does not drop transactional/audit tables, preserves existing user organisational fields, and only retires superseded role definitions after user mapping.

- [ ] **Step 3: Review diff for legacy assumptions**

Search changed runtime files for `FF4 Officer`, `Accounts Reconciliation Officer`, `FF Requisition Officer`, `Line/Section Supervisor`, and `five controlled`; only migration mapping/history comments may retain those strings.

- [ ] **Step 4: Prepare merge summary**

Document changed role model, automatic inheritance, migration behavior, and UAT cases: section isolation, Registrar global visibility, Payment/Reconciliation global outstanding-payment visibility, supplier creation restrictions, budget approval chain, and System Administrator full access.
