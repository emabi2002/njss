# Standalone agency installation — development v0.3

**Important:** Create an entirely new and separate project for each agency. A new agency must never reuse the NJSS database, authentication users, Supabase project URL/keys, Storage, backups or environment. **This is an internal monitoring tool; it has no IFMS integration and cannot execute bank payments.**

## Gate 0: institution authority, billing and security

Before starting, identify the institution project owner, cloud-billing owner, app hosting account, domain, data-hosting region, support responsibilities and authorised UAT testers. A new Supabase project or paid UAT branch can add costs: receive the institution's approval of the quoted cost before provisioning. Do not use confidential or financial production data during development.

## Gate 1: fresh agency Supabase project

1. Create a **new** Supabase project for this agency's UAT. Production should use another independent project (unless a documented deployment policy explicitly approves a different design).
2. Review `supabase/migrations/20261023000100_initial_monitoring.sql`. On an **empty** project apply this once in a controlled migration transaction only after technical sign-off. The schema contains no operational seed data, demo users or NJSS financial records.
3. The migration defines role-checked RPCs, RLS and read-only database reporting views. All direct business-data client writes are denied. The `monitor-evidence` Storage bucket is private; the new application server-side routes broker documented uploads and 60-second signed downloads after role and record-level checks. Agency logos are served from a separate public branding bucket with server-authorised uploads only.
4. From this agency's Supabase Auth dashboard, invite and verify the first intended agency administrator. A trusted infrastructure administrator then executes `node scripts/bootstrap-admin.mjs` with the independent project credentials and explicit `ALLOW_AGENCY_BOOTSTRAP=YES_I_APPROVE`, `BOOTSTRAP_PROJECT_REF`, `BOOTSTRAP_AUTH_USER_ID` and `BOOTSTRAP_FULL_NAME`. The script verifies an email-confirmed Auth identity, checks that the staff directory is empty, and writes a bootstrap audit record. This bootstrap is **never** performed from an anonymous webpage. Do not seed default passwords.
5. The agency administrator may subsequently invite additional Auth users via the same agency's Supabase Auth dashboard, verify their accounts, then use the application's **Agency Setup → Staff** panel to map their Auth UUID to an internal role/section. The app does not send Auth invitation emails or create Auth user accounts.

## Gate 2: independent application hosting

1. Copy the master source into a new agency-owned GitHub/hosting application project. Prefer a private repository, following approved government policies.
2. Copy `.env.example` to `.env.local` and set the **new agency project's** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and server-only `SUPABASE_SERVICE_ROLE_KEY`. Never use a service-role key in the web UI or `NEXT_PUBLIC_` environment variable.
3. Run `npm install` (which also creates an agency lockfile), `npm test`, `npm run typecheck`, `npm run build`, and `npm run dev` for UAT. Do **not** proceed if any build/dependency/test check fails.
4. Before production create an immutable build, lockfile, rollback runbook, backup restore plan and separate approval record. Do not reuse another agency's passwords, URL or data.

## Gate 3: institution setup

The app's **Agency Setup** panel allows authorised administrators to set official name, abbreviation, postal and physical addresses, phone, contact email, duplicate warning window and an agency-controlled HTTPS logo URL. Agency logo uploads are supported for PNG/JPEG through a strictly administrator-only server route; the approved logo is public branding, not confidential financial documentation. Set the saved HTTPS URL in Agency Settings after uploading. Establish divisions and sections, then internal reporting categories, item records/units, synonyms, suppliers and staff role assignments.

**Internal categories are purchasing-analysis tags, not official accounting general-ledger/IFMS codes.**

## Gate 4: functional acceptance walkthrough

1. Login as a requester assigned to Section A. Create and submit a requisition for an item, quantity and estimated unit price.
2. Have Section B submit the same item, or a distinct item with an administrator-curated alias. The system should flag a pending similar request or recent purchase.
3. Have a separate reviewer inspect the warning and provide a reason (minimum 15 characters for a flagged request), then approve/reject. Verify the review disposition and actor were recorded.
4. Purchase officer enters a purchase against the **approved** item/requisition. Attempt to exceed approved quantity in a second purchase—must fail. An unlinked historical purchase requires a valid section.
5. Receiving officer records partial delivery quantities. A receipt exceeding total ordered quantity must be rejected.
6. Purchasing officer records internal expenditure evidence. A separate reviewer verifies/disputes it with a reason. The reporter cannot verify their own evidence; neither status means bank payment execution.
7. Review **Reports**: item and section aggregation must reflect all records, not a limited browser page. Confirm order totals and expenditure evidence totals are separate.
8. Complete the full [UAT checklist](UAT-CHECKLIST.md), especially permissions, concurrent purchase/receipt transactions, independent tenant database boundaries and recovery.

## Secure supporting-document workflow

Only a logged-in, active and record-authorised officer can upload a PDF/PNG/JPEG supporting file (maximum 8 MB) via `/api/attachments`. The API validates file signatures and uses the **agency-local server key** to store files privately, writes a document record, and provides a 60-second signed URL only after checking the caller's role and access to the linked requisition, purchase or expenditure record. No browser Storage RLS policies are added. There is no client-side public file URL. Production security review must additionally address malicious-content scanning, upload rate limits and audit retention.

## Known blockers

This build is **not deployed, UAT-approved or production-ready**. Although local Node tests and TypeScript syntax checks passed, no SQL migration has been executed against a fresh Supabase project; no permission/API penetration or concurrency test has been executed; npm packages could not be downloaded in the authoring environment, so no full build/typecheck or lockfile exists. This must be resolved before any agency pilot with real data.

The browser currently reads some operational tables across departments to allow institution-wide duplicate-purchase checks. Government deployment requires a per-agency data-classification review; staff PII and audit event read access are more restrictive.
