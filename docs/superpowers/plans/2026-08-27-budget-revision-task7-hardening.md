# Budget Revision Task 7 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the approved NJSS budget-revision workflow against scope bypasses, segregation-of-duties conflicts, invalid financial movements, ambiguous allocation lineage, and direct-table mutation paths before UAT migration.

**Architecture:** Keep migrations 051–053 intact and add migration 054 as an additive hardening layer. Wrap the existing SECURITY DEFINER revision RPCs and validator so authenticated callers must pass stricter organisational-scope, maker/checker, financial, and master-data checks, while trigger guards protect revision draft rows from direct writes outside the controlled edit state.

**Tech Stack:** PostgreSQL/Supabase RLS and SECURITY DEFINER RPCs, Next.js API routing, Node source-level regression checks, GitHub Actions CI.

**Spec:** Approved NJSS Budget Revision / Reforecast design implemented in PR #11 through Tasks 1–6.

## Global Constraints

- Preserve the four operational RBAC groups and existing SECTION_WIDE / SYSTEM_WIDE data-scope model.
- Preserve existing approved budget history and FF3/FF4/funding transaction lineage.
- Do not apply migrations 051–054 to live Supabase during Task 7.
- Do not merge PR #11 during Task 7.
- Correct Netlify preview gate is `netlify/njsscrem/deploy-preview`.
- Use TDD: regression contract must fail before migration 054 is added, then pass after hardening.

---

### Task 1: Define the hardening regression contract

**Files:**
- Create: `scripts/budget-revision-hardening.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: migrations 051–053 and current revision API/RPC names.
- Produces: an executable CI contract for migration 054 security and financial invariants.

- [ ] **Step 1: Write the failing test** asserting migration 054, strict scope checks, authenticated-user checks, RPC base-function revocations, revision-edit guards, maker/checker rules, exact source-allocation mapping, effective-year validation, revision-type financial rules, funded-floor protection, and exact master-data mapping.
- [ ] **Step 2: Add the regression to CI** immediately after the Task 6 reporting regression.
- [ ] **Step 3: Run CI and verify RED**: all pre-existing regression stages pass and `Budget revision hardening regression checks` fails because migration 054 is absent.

### Task 2: Add additive migration 054 hardening

**Files:**
- Create: `supabase/migrations/054_budget_revision_hardening.sql`

**Interfaces:**
- Consumes: `njss_validate_budget_revision`, `njss_create_budget_revision`, `njss_transition_budget_revision` from migration 052.
- Produces: hardened wrappers under the same public RPC/function signatures so application code requires no API change.

- [ ] **Step 1: Harden allocation lineage** by rejecting zero or multiple active operational allocations for an approved source budget line and enforce one active allocation per non-null `source_budget_line_id`.
- [ ] **Step 2: Wrap revision creation** so the caller must have an NJSS user profile, the effective date is inside the budget year, and data scope is checked with ownership arguments set to NULL so own-record logic cannot bypass SECTION_WIDE boundaries.
- [ ] **Step 3: Wrap revision transitions** so organisational scope is strict, the requester cannot REVIEW or APPROVE their own revision, and RETURN/REJECT require comments.
- [ ] **Step 4: Wrap revision validation** to enforce: REFORECAST is annual-value neutral; REDUCTION contains no positive rows and has a negative net; VIREMENT/RECLASSIFICATION contain both positive and negative movements and balance to zero; non-supplementary revisions cannot expand the total envelope; no proposed source amount falls below approved funded value; new targets require exact active cost-centre, posting-code, and Chart-of-Accounts mappings.
- [ ] **Step 5: Add direct-write trigger guards** on revision `divisional_budget_lines` and `budget_monthly_allocations`, allowing edits only in DRAFT/RETURNED status with `budget.revision.edit` (or `all`) and strict current organisational scope.
- [ ] **Step 6: Revoke execution on renamed base functions** from PUBLIC and authenticated, granting only the hardened wrapper signatures to authenticated.

### Task 3: Verify and review

**Files:**
- Test: `scripts/budget-revision-hardening.test.mjs`
- Test: existing CI suite

**Interfaces:**
- Consumes: migration 054.
- Produces: Task 7 hardening gate ready for controlled UAT migration planning.

- [ ] **Step 1: Verify GREEN** on the Task 7 regression.
- [ ] **Step 2: Run the full CI suite** including RBAC, prior budget regression gates, lint, typecheck, and build.
- [ ] **Step 3: Review migration 054 against migrations 023, 036, 046, 051–053** to ensure no previous commitment, report-scope, or preparation workflow semantics regress.
- [ ] **Step 4: Verify the correct `njsscrem` Netlify deploy preview succeeds.**
- [ ] **Step 5: Leave migrations unapplied and PR #11 draft/open** pending the final controlled migration/UAT stage.
