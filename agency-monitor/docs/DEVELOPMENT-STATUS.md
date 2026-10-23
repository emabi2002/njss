# Step 3 — Actual development status

**Release:** v0.2, 23 October 2026. **State:** Development source bundle, **not deployed / not UAT approved**.

### Completed within source
- Independent new-agency app and clean-schema code; remains isolated from existing NJSS.
- Frontend for agency setup, divisions/sections, internal expense categories, items, supplier, staff role assignment, requisitions, purchasing, receipts, expense evidence verification, item purchase history and department reports.
- Role-checked SQL RPC transactions and RLS for public tables; narrowed access to employee and audit information.
- Recorded duplicate warning resolution with explanations; alias-based matching; linked PO item/quantity validation; serialized receipt quantity control.
- Full-history purchasing views, private bucket provisioned deny-by-default.
- 15/15 pure JS + static SQL-contract tests, 4 TS/TSX parse checks.

### Not yet completed
- Running Postgres/Supabase migration and confirming SQL functions; no authorised disposable Supabase project exists for this release.
- npm dependency installation, full build/typecheck, deployed browser UI and multi-user integration/UAT.
- Document/receipt upload flows, supplier invoice linkage, richer source metadata, reporting pagination and stronger semantic similar-item detection.
- CI pipeline, lockfile and independent agency backup/restore rehearsal.
- Agency registration automation and costs/ownership decisions.

### Change control
Do not apply any SQL or replace/change NJSS production. For a new agency, use a wholly new Supabase project and application hosting project. Required approval and cost confirmation are separate gates.
