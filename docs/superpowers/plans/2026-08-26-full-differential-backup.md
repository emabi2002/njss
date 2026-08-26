# Full and Differential ZIP Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the selective Housekeeping export with secure Full and Differential logical database ZIP backups that download locally and can be validated.

**Architecture:** PostgreSQL change-capture triggers and snapshot RPCs provide consistent Full and Differential datasets. A JWT-protected Supabase Edge Function creates the ZIP under service-role authority after re-checking the caller's NJSS permissions. The existing Housekeeping UI downloads the binary package and the validation route verifies format and checksums.

**Tech Stack:** Next.js 16, TypeScript, Supabase/PostgreSQL, Supabase Edge Functions (Deno), `@supabase/supabase-js`, JSZip, Web Crypto / Node crypto.

**Spec:** `docs/superpowers/specs/2026-08-26-full-differential-backup-design.md`

## Global Constraints

- Full means a consistent **NJSS logical database backup** of all application `public` tables plus schema metadata; do not describe it as a provider physical/PITR snapshot.
- Differential means all row-level inserts, updates and deletes since the latest successful Full Backup baseline cursor.
- Both formats must download as `.zip` to the local browser.
- Backup generation requires `operations.manage`, `settings.manage`, or `all`.
- Do not weaken existing RLS or expose service-role credentials to the browser.
- Do not implement destructive restore in this change.

---

### Task 1: Add backup registry, change journal and consistent snapshot RPCs

**Files:**
- Create: `supabase/migrations/049_full_differential_backup_framework.sql`
- Test: `lib/backup/full-differential-backup.test.mjs`

**Interfaces:**
- Produces RPC `njss_backup_full_snapshot() -> jsonb`.
- Produces RPC `njss_backup_differential_snapshot(p_baseline_change_id bigint) -> jsonb`.
- Produces RPC `njss_backup_schema_snapshot() -> jsonb`.
- Produces tables `system_backup_registry`, `system_backup_change_log`.

- [ ] **Step 1: Write a failing regression test** that asserts migration 049 creates both internal tables, the change trigger, Full/Differential RPCs, RLS/grants, and trigger attachment to public application tables.
- [ ] **Step 2: Run the regression test and confirm it fails** because migration 049 is absent.
- [ ] **Step 3: Implement migration 049** with additive/idempotent DDL, row-level change capture, consistent snapshot functions, service-role-only RPC grants, and RLS on internal tables.
- [ ] **Step 4: Run the regression test and confirm it passes.**
- [ ] **Step 5: Apply migration 049 to the connected Supabase project and verify table/function/trigger presence with read-only SQL.**

### Task 2: Build the JWT-protected Supabase backup generator

**Files:**
- Create: `supabase/functions/njss-database-backup/index.ts`
- Modify: `.github/workflows/ci.yml`
- Test: `lib/backup/full-differential-backup.test.mjs`

**Interfaces:**
- Consumes `POST { "backupType": "FULL" | "DIFFERENTIAL" }` with bearer JWT.
- Returns `application/zip` and headers `X-NJSS-Backup-Id`, `X-NJSS-Backup-Type`, `X-NJSS-Backup-Filename`.

- [ ] **Step 1: Extend the failing regression test** to require a JWT authorization check, permission check for `operations.manage/settings.manage/all`, `njss_backup_full_snapshot`, `njss_backup_differential_snapshot`, JSZip packaging, SHA-256 checksums and backup-registry writes.
- [ ] **Step 2: Run the test and confirm the Edge Function requirements fail.**
- [ ] **Step 3: Implement the Edge Function** to authorize the user, generate Full or Differential package content, calculate checksums, write backup history, audit the operation, and return binary ZIP with CORS-exposed download headers.
- [ ] **Step 4: Run the regression test and confirm it passes.**
- [ ] **Step 5: Deploy `njss-database-backup` with JWT verification enabled and verify ACTIVE status.**

### Task 3: Replace the Housekeeping button with Full and Differential downloads

**Files:**
- Modify: `app/dashboard/admin/operations/page.tsx`
- Modify: `app/api/operations/housekeeping/backup/route.ts`
- Test: `lib/backup/full-differential-backup.test.mjs`

**Interfaces:**
- UI function `createBackup(backupType: "FULL" | "DIFFERENTIAL")`.
- Compatibility API accepts the same backup type and proxies to the secure Supabase function.

- [ ] **Step 1: Extend the regression test** to require two Housekeeping actions labelled `Full ZIP Backup` and `Differential ZIP Backup`, both sending an explicit backup type and downloading the returned filename.
- [ ] **Step 2: Run the test and confirm the UI/route checks fail.**
- [ ] **Step 3: Update the route** so it no longer exports selected tables itself and instead forwards the authenticated request to `njss-database-backup`.
- [ ] **Step 4: Update Housekeeping UI** with two clearly described buttons, progress states, and browser ZIP download behavior.
- [ ] **Step 5: Run the regression test and confirm it passes.**

### Task 4: Validate Full and Differential ZIP packages

**Files:**
- Modify: `app/api/operations/housekeeping/validate-backup/route.ts`
- Test: `lib/backup/full-differential-backup.test.mjs`

**Interfaces:**
- Accepts `.zip` multipart field `backup`.
- Returns `{ valid, status, issues, details, nextSteps }` for both new formats.

- [ ] **Step 1: Extend the regression test** to require recognition of `NJSS_FULL_DATABASE_BACKUP` and `NJSS_DIFFERENTIAL_DATABASE_BACKUP`, required package files, baseline id for Differential, and SHA-256 verification using `checksums.json`.
- [ ] **Step 2: Run the test and confirm validation checks fail.**
- [ ] **Step 3: Implement validation** for Full and Differential layouts and reject checksum mismatches or incomplete packages.
- [ ] **Step 4: Run the regression test and confirm it passes.**

### Task 5: Verify and integrate

**Files:**
- Modify only if verification reveals a defect.

- [ ] **Step 1: Run backup regression test, existing RBAC tests, lint, typecheck and production build in CI.**
- [ ] **Step 2: Generate one live Full ZIP Backup through the Edge Function using an authorized test session if available; otherwise verify RPC output and function deployment without exposing a user token.**
- [ ] **Step 3: Verify a completed Full registry record can serve as the baseline for Differential generation.**
- [ ] **Step 4: Open a pull request, review changed files, and merge only after all CI checks pass.**
