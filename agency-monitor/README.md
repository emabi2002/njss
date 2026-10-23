# Agency Internal Requisition, Purchasing & Expenditure Monitor

**Step 3 Development Release: v0.3 — 23 October 2026**

A standalone Next.js and Supabase application for **departmental/sectional internal purchasing control** in a single government agency. The product records item requests, approvals, purchase orders, delivered quantities and internally reported/verified expenditure. It flags possible repeated purchases before approval and retains a searchable cross-division history.

**NOT** an official financial management/accounting system, IFMS integration, financial statements engine, e-tendering platform or payment execution service.

## Independent installation rule

Every adopting agency gets its own new application project, new Supabase project, PostgreSQL database, Auth user directory, private file storage, environment credentials and backup configuration. No NJSS business data or other agency's operational records are copied or shared.

## Implemented development features

- Agency identity: name, addresses, logo HTTPS URL, contact and configurable duplicate lookback.
- Organization: divisions and sections; agency-specific monitoring categories, item codes, units, synonyms, suppliers.
- Secure login through agency-owned Supabase Auth; role-checked SQL RPC operations.
- Staff role/section mapping for **already verified** agency Auth identities; no browser self-registration or implicit administrator privileges.
- Internal requisition, independent reviewer approval, and warnings for pending/recent purchases using item identity, normalized codes/names and administrator-curated aliases.
- Warnings saved with reviewer, decision, reason and date. Warnings do **not** automatically establish waste or fraud.
- Purchase order capture with division/section attribution, historical/external purchase option, item/approved-quantity checks and serialized quantity control for linked requisitions.
- Partial delivery receipt with over-receipt prevention.
- Reported internal expenditure evidence and separate second-person verification/dispute (no bank payments).
- Purchasing-by-item and purchasing-by-section SQL reporting views, with database-side full-history aggregation.
- Database RLS and limited direct grants; private-by-default bucket provisioned with **no public upload/download policies**.
- Test suite for comparison logic, quantity controls and static SQL-contract checks.

## Source and execution

1. Read [Independent installation](docs/INSTALLATION.md) and [UAT controls](docs/UAT-CHECKLIST.md).
2. Use **a brand-new, authorised Supabase test project only**; never point this source at NJSS or an agency production database.
3. Run the clean migration `supabase/migrations/20261023000100_initial_monitoring.sql` in the new empty project after technical review. It is **not applied anywhere** by this release.
4. Provide the project's environment variables following `.env.example`; never put a service-role key into `NEXT_PUBLIC_*` variables.
5. Install dependencies and run `npm test`, `npm run typecheck` and `npm run build`, then `npm run dev` for controlled UAT.

## Test status and limitations

- **15 Node unit/contract tests pass.** TypeScript **syntax transpilation** of the 4 TS/TSX modules passed.
- **Unverified**: SQL migration execution and function behavior in Postgres, Supabase RLS policies under real users, full TypeScript typecheck, Next.js production build, deployed UI, concurrent multi-user UAT, independent project backup/recovery, and file upload/download.
- No npm lockfile has been generated: dependency installation was blocked by unavailable registry access in this environment. Generate/commit a lockfile and do supply-chain review before pilot/deploy.
- Logo can be set by an approved HTTPS URL; actual file uploads and purchase evidence attachments remain a future secured feature.
- Duplicate matching covers same catalog item, exact normalized item names/codes and curated synonyms with equal units. General fuzzy semantic detection is **not yet present in SQL**; the JS scoring utility is not used for approval decisions.
- Requisitions/purchases are one line per transaction in this starter; multi-line form entry, item reconciliation, richer role delegation and imports still need development.
- Current staff have cross-division **read access to requisitions/purchasing data** intentionally for institution-wide duplicate checks; production-specific confidentiality scopes need agency policy review.

**Do not use production finances, official records or sensitive attachments until database integration testing and security/UAT gates are completed.**

## v0.3 additions
- Independent one-time verified Auth administrator bootstrap script.
- Agency-local authenticated upload/download APIs for private requisition, purchase and expenditure attachments; file signatures and per-record access checks.
- Administrator-only logo upload.
- Unlinked historical purchasing requires administrator authority.
- Supabase testing remains pending; no live NJSS database is touched.

## Build status and deployment caution
See [Step 3 completion gates](docs/STEP-3-COMPLETION-GATES.md). Source and local tests are ready for independent UAT, **not production**. This is not an IFMS interface or government accounting application.

## Validation
The standalone source is CI-tested using Node 22, `npm ci`, 25 Node tests, TypeScript semantic typecheck, Next.js build and an isolated PostgreSQL 17 migration/workflow smoke test with synthetic accounts. Live Supabase-specific integration/UAT and agency acceptance remain mandatory for production.
