# Budget Revision Task 7 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the approved NJSS budget-revision workflow against scope bypasses, invalid financial movements, ambiguous allocation lineage, and direct-table mutation paths while enforcing the approved business sequence: Registrar requests the post-approval change, the responsible Line Supervisor reviews/adjusts and submits their section budget, and the Registrar performs the final approve/return/reject decision.

**Architecture:** Keep migrations 051–053 intact and use migration 054 as the additive hardening/correction layer. The existing SECURITY DEFINER revision RPCs remain internal workers behind hardened public wrappers. Business-role ownership is enforced at the database boundary, not only in the UI: Registrar-only initiation; Line-Supervisor-only draft preparation/submission within SECTION_WIDE scope; Registrar-only final disposition. There is no externally exposed separate revision REVIEW action. The single Registrar Approve action may use the legacy REVIEWED state internally and atomically because migration 052 expects it before approval.

**Tech Stack:** PostgreSQL/Supabase RLS and SECURITY DEFINER RPCs, Next.js API routing, React/Next.js Budget Preparation UI, Node source-level regression checks, GitHub Actions CI.

**Spec:** Approved NJSS Budget Revision / Reforecast design implemented in PR #11 through Tasks 1–6, with the Task 7 workflow correction approved on 27 August 2026.

## Global Constraints

- Preserve the four operational RBAC groups and existing SECTION_WIDE / SYSTEM_WIDE data-scope model.
- Preserve existing approved budget history and FF3/FF4/funding transaction lineage.
- **Registrar alone initiates** a revision, supplementary budget, virement, reduction, reclassification or reforecast request.
- The **Line Supervisor for the affected section** can edit the requested DRAFT/RETURNED revision and SUBMIT/RESUBMIT it.
- The Line Supervisor cannot approve the revision.
- The Registrar does not prepare the revised line figures; after submission the Registrar can APPROVE, RETURN or REJECT.
- Requisition Officer and Payment/Reconciliation Officer remain view/report only for revision workflow purposes.
- Correct Netlify preview gate is `netlify/njsscrem/deploy-preview`.
- Use TDD: the corrected workflow contract must fail against the previous Task 7 implementation before the workflow correction is applied.

---

### Task 1: Define the hardening regression contract

**Files:**
- `scripts/budget-revision-hardening.test.mjs`
- `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: migrations 051–053, migration 054, current revision API/RPC names, Budget Preparation UI.
- Produces: executable CI contract for security, financial invariants, and workflow ownership.

- [x] **Step 1: Write the failing hardening test** for migration 054, strict scope, authenticated-user checks, internal RPC revocations, revision-edit guards, exact source-allocation mapping, effective-year validation, revision-type rules, funded-floor protection and exact master-data mapping.
- [x] **Step 2: Add the regression to CI** after Task 6 reporting regression.
- [x] **Step 3: Verify original RED** when migration 054 was absent.
- [x] **Step 4: Extend the regression for the approved workflow correction**: Registrar-only initiation; Line-Supervisor-only preparation/submission; Registrar approve/return/reject; no external Review Revision button/action.
- [x] **Step 5: Verify corrected-workflow RED** against the prior maker/checker implementation.

### Task 2: Migration 054 hardening and workflow correction

**Files:**
- `supabase/migrations/054_budget_revision_hardening.sql`
- `app/api/workflows/budget/route.ts`
- `lib/budget-revision.ts`
- `app/dashboard/budget-template/page.tsx`
- `app/dashboard/budget-template/BudgetRevisionDialog.tsx`

**Interfaces:**
- Consumes: `njss_validate_budget_revision`, `njss_create_budget_revision`, `njss_transition_budget_revision` from migration 052.
- Produces: hardened wrappers under the same public RPC/function signatures and a simplified user-facing revision workflow.

- [x] **Step 1: Harden allocation lineage** by rejecting zero or multiple active operational allocations for an approved source budget line and enforce one active allocation per non-null `source_budget_line_id`.
- [x] **Step 2: Enforce Registrar-only initiation** with both role and `budget.revision.create` checks, and explicitly disable the legacy Line Supervisor create grant introduced in migration 051.
- [x] **Step 3: Permit trusted Registrar creation cloning only through a transaction-local creation flag**, while ordinary revision-row/header/month edits remain Line-Supervisor-only.
- [x] **Step 4: Enforce Line Supervisor preparation/submission** with strict organisational scope, DRAFT/RETURNED edit states, `budget.revision.edit`, and SUBMIT/RESUBMIT role checks.
- [x] **Step 5: Enforce Registrar final disposition** for APPROVE/RETURN/REJECT. Remove the previous rule preventing the Registrar requester from approving, because the Line Supervisor is the preparer/submitter in the approved model.
- [x] **Step 6: Remove externally exposed revision REVIEW action** from API/client/UI. Registrar Approve is available directly after SUBMITTED/RESUBMITTED and performs any legacy REVIEWED transition internally and atomically.
- [x] **Step 7: Preserve financial validation**: REFORECAST annual neutrality; REDUCTION one-way negative movement; balanced VIREMENT/RECLASSIFICATION; only Supplementary may increase the total envelope; funded-floor protection; exact active cost-centre/posting-code/Chart-of-Accounts mappings for new targets.
- [x] **Step 8: Preserve direct-write trigger guards** and base-function revocations so UI/API bypasses do not weaken database controls.

### Task 3: Verify and review

**Files:**
- Test: `scripts/budget-revision-hardening.test.mjs`
- Test: existing CI suite

**Interfaces:**
- Consumes: corrected migration 054 and UI/API workflow.
- Produces: Task 7 gate ready for controlled UAT migration planning.

- [x] **Step 1: Verify GREEN** on the corrected Task 7 regression.
- [x] **Step 2: Run the full CI suite** including RBAC, prior budget regressions, lint, typecheck and production build.
- [x] **Step 3: Review migration 054 against migrations 023, 036, 046, 051–053** to ensure commitment, funding, report-scope and preparation semantics do not regress.
- [x] **Step 4: Verify the correct `njsscrem` Netlify deploy preview succeeds.**
- [x] **Step 5: Apply migrations 051–054 to production Supabase only after green CI/deploy gates and verify schema/RBAC/integrity before merge.**

## Production migration verification — 27 August 2026

- Migrations `budget_revision_reforecast_schema`, `budget_revision_reforecast_workflow`, `budget_revision_reporting`, and `budget_revision_hardening` were applied in order after CI/deploy-preview gates were green.
- The initial 051 attempt was rolled back by the database because `njss_operations` is a front-end module grouping rather than a live database `modules.code`. A RED regression was added and 051 was corrected to use live FK module codes: `budget` for operational revision permissions and `reports` for revision reporting.
- Post-migration checks confirmed: zero revision data rows were introduced by deployment; zero active allocation formula mismatches; no duplicate active source-line allocation groups; all three hardening triggers exist; wrapper RPCs are executable to authenticated while renamed base functions are not; `budget_available` and `released_available` exist in the authoritative view.
- Role matrix verified: Registrar initiates and disposes; Line Supervisor cannot create but can edit/submit; Requisition Officer and Payment/Reconciliation Officer remain view/report only.
- Active Financial Cost Centres and active Posting Codes remain zero by prior master-data cleanup design, so creation of new revision target lines remains intentionally blocked until Finance-approved master data is loaded.