# STEP 2 — Detailed NJSS Technical Assessment and GFMS Master-Template Extraction Plan

**Document status:** Targeted read-only technical audit and implementation blueprint  
**Date:** 22 October 2026  
**GitHub source:** `emabi2002/njss`, default branch `main`, assessed through connected GitHub repository  
**Supabase source:** Connected project `NJSS System`, read-only catalog and security inspections  
**Architecture authority:** Step 1 v1.1: **one independent app hosting project + one independent Supabase project/database/auth/storage per adopting government agency**. No shared operational database.  
**Scope boundary:** This is NOT a completed penetration test, exhaustive code review, code refactor, recovery exercise, or clean-install validation.

## A. Executive engineering decision
Do **not** clone the running NJSS database, replay all legacy SQL blindly, or add `tenant_id` to every table. Build a *master software release* from reusable core modules, clean baseline migrations, generic seed data and an agency configuration/onboarding process. Every agency receives a newly provisioned, separate project with an empty business dataset.

NJSS is the **reference implementation**, not the permanent identity of the product. Preserve NJSS financial workflows in its own installation and as optional/selected modules, not as global assumptions.

## B. Evidence and boundaries

### GitHub inventory
- Next.js 16.2.4, React 19.2.4, TypeScript, Tailwind, Recharts, Supabase Auth/JS/SSR; `package.json` shows `@supabase/auth-helpers-nextjs` alongside `@supabase/ssr` (verify usage/deprecation in Step 3).
- Repository root: `app/`, `components/`, `contexts/`, `hooks/`, `lib/`, `scripts/`, `supabase/`, `docs/`, `reporting-agent/` and deployment configuration `netlify.toml`.
- `app/api/` contains `account`, `admin`, `budget-activation`, `dashboard`, `operations`, `reports`, `settings`, `system-info`, `workflow` and `workflows` route groups.
- `app/dashboard/` contains budget, FF3, FF4, commitments, suppliers, master data, reports, settings, admin, users, audit, tasks and help.
- `supabase/migrations/`: 94 repository migration files including historical short-prefix and date-stamped series.
- `supabase/tests/`: 3 SQL files; `scripts/` contains many route, security, financial and operational tests (presence does **not** imply these were executed or passed in this audit).
- Existing governance docs: `docs/governance/NJSS_MIGRATION_LEDGER.md`, `NJSS_RELEASE_GOVERNANCE.md`.

### Live database catalog (22 Oct 2026)
- `public`: **105 base tables**, **46 views**, **196 routines/functions**, **246 RLS policies**.
- All **46 public views** showed `security_invoker=true` in pg_catalog. All 105 surveyed public base tables had RLS enabled; 4 have no policies (backup change journal, backup registry, two UAT seed tracking tables). No-policy can intentionally deny client access and must be assessed in context.
- **138** public routines are `SECURITY DEFINER`, **53** of those were executable by the `authenticated` role according to privilege metadata; this is not by itself an exploit but mandates RPC-by-RPC authorization/least-privilege review.
- Supabase security advisor reported **47 function_search_path_mutable warnings** at inspection, requiring reviewed fixes in a new project/release rather than opportunistic production edits.
- Live Supabase migration ledger reports **134** applied entries (latest `20261005021807`). File-name count (94) and applied-entry count (134) do **not** imply identical history. Source governance document already documents re-timestamping, duplicate legacy prefixes (`003`, `052`, `064`), and migration drift.
- Additional non-product schemas exist, including **`dciecms_test` (23 tables)**, `njss_reset_archive` (3 tables), and `task9_recovery` (1 table). These must NOT be copied into an agency baseline absent separate approved justification.
- Current system shows existing financial, user-role, organizational, audit and backup data. This was a structural read-only audit, NOT a data-cleansing or account-access operation.

### Storage finding (HIGH — confirm access controls immediately)
`storage.buckets` identifies:
- `ff3-attachments` — **public**
- `ff4-attachments` — **public**
- `quotations` — **public**
- `njss-budget-documents` — **private**

A public bucket can expose document contents via public object URLs. This audit did **not** enumerate objects or prove any confidential document exposure. Nevertheless, government requisition, quotation and payment attachments should be private by default. Review historical objects, URLs, policy access and authorised download flows; lock down only under a separately approved, tested production change.

Relevant Supabase docs: https://supabase.com/docs/guides/storage/security/access-control

## C. Traceable module assessment and extraction strategy

| Domain | Evidence | Classification for master GFMS | Target change |
| --- | --- | --- | --- |
| Application startup/identity | `app/layout.tsx`, `app/page.tsx` embed NJSS-specific metadata and copy | CORE + configurable branding | Agency-neutral app metadata and bootstrap config; configurable legal title |
| Organization branding | `lib/org.ts`, `app/api/settings/organization/route.ts`, `system_settings` | CORE | New-agency setup wizard, verified logo upload, agency contact/address; no NJSS fallback in master |
| Dashboard/navigation | `app/dashboard/layout.tsx`, `lib/rbac/config.ts` | CORE + optional modules | Replace hard-coded labels, module IDs, logo fallbacks, local-storage keys |
| Authentication | `contexts/AuthContext.tsx`, `lib/supabase.ts`, `lib/rbac/server.ts` | CORE | New project-scoped Auth per installation; verify session/cookie, user-profile linking, client/server boundaries |
| Permissions/RBAC | `lib/rbac/{admin,server,groups,config}.ts`, `users`, `roles`, `user_roles`, `role_permissions` | CORE permission engine, configurable agency roles | Templates for duties and scope; NJSS named roles become selectable workflow set |
| Organization structure | `departments`, `sections`, `court_locations` | CORE hierarchical divisions/sections; OPTIONAL court locations | Remove mandatory Waigani/NCD-WGN dependencies from generic user admin |
| Ledger/chart mapping | `expense_ledger`, `chart_of_accounts`, `finance_posting_mappings`, `cost_centres`, `lib/finance-posting-mapping.ts` | CORE | Approved classification crosswalk; agency ledger import + validations; fixed parent/posting rules |
| Annual budgeting | `annual_budget_cycles`, `division_budgets`, `division_budget_lines`, `lib/head-office-budget.ts` | CORE with adaptable authority titles | Choose ONE canonical financial budgeting source and define approval states |
| Legacy budget modules | `app/api/workflows/budget/route.ts` deliberately returns retired-workflow error; multiple older budget views/tables still exist | DEPRECATED / migration-only | Do not ship historical paths as active features or seed from old tables |
| FF3 requisition | `app/api/workflows/ff3/route.ts` requires permissions and calls `njss_transition_ff3`; `lib/ff3-simplified-budget.ts` calls active budget-check RPC | CORE requisition workflow + NJSS FF3 format | Separate universal requisition transaction from NJSS-specific form name, printable layout and role labels |
| FF4 / payment | `app/api/workflows/ff4/route.ts` uses `njss_create_ff4`, then separately `njss_save_ff4_payment_lines`, and `njss_transition_ff4` | CORE payment-request workflow + NJSS FF4 form | Assess and repair non-atomic create/line-save failure path in a staged migration; preserve explicit payment/reconciliation distinction |
| Commitments/actuals | `commitment_transactions`, `ff3_commitments`, `payment_transactions`, report views | CORE | Standardised statuses, reversals, precision, releases, concurrency and reconciliation tests |
| Suppliers/quotations | `suppliers`, supplier support tables, `app/dashboard/suppliers` | CORE | Fresh agency supplier master; no copying NJSS supplier data; private supplier documents |
| Audit & documents | `audit_logs`, `documents`, financial attachments, storage buckets | CORE | Immutable trace and private buckets; retention rules, approvals, signed URL discipline |
| Reporting | `app/dashboard/reports/`, `lib/reports/`, `v_*budget*`, `v_*ff*` | CORE with institution-scoped branding | Common definitions, independent DB views; no central reporting service with agency data by default |
| Court-specific / regional scope | `court_locations` and `app/api/admin/users/route.ts` hard-code `HEAD_OFFICE_LOCATION_CODE='NCD-WGN'` | NJSS-ONLY | Enable court module in NJSS only; generic user assignment based on configured agency hierarchy |
| AI reporting | `reporting-agent/`, `app/dashboard/reports/ai` and environment configs | OPTIONAL | Disabled by default per agency; own model endpoint and independent data governance |
| Operations/backups | `lib/backup/`, `app/api/operations/`, `supabase/functions/njss-database-backup` | CORE design, agency-specific infra | Project-local monitoring, independent key management, backups, recovery tests, metering |
| Setup and seed | `supabase/seed.sql`, `scripts/setup-db.ts`, `scripts/setup-auth.ts` | REBUILD clean installer | Replace NJSS departments, courts, users, example/synthetic data with neutral reference-only seed; no plaintext password import into release bundle |

## D. Code/design risks requiring resolution

**P0 — Reusable agency template must have a clean zero-data baseline.** The current `supabase/seed.sql` explicitly inserts National Judiciary Staff Services, Court Registry and National/Supreme Court organizational data. Do NOT use this as default installer seed.

**P0 — Document storage.** Three buckets that hold potentially sensitive financial evidence are public. Confirm and remediate policies and historical object handling via authorised change.

**P0 — Migration reconstruction and drift.** Do not execute the complete historical migration sequence blindly: the repository has 94 SQL files while live ledger contains 134 entries, some retimestamped and reset/archive-related. Derive baseline from vetted desired schema, re-create from empty fresh project, and validate it independently.

**P1 — Partial FF4 creation risk.** `app/api/workflows/ff4/route.ts` performs FF4 creation and payment-line persistence in distinct RPCs. If saving lines fails, response states FF4 was created, indicating potential partial state. Determine compensating logic and prefer a transactionally atomic server RPC for new installations.

**P1 — Role and authority abstraction.** `lib/rbac/groups.ts` defines NJSS-specific Requisition Officer, Line Supervisor, Registrar and Payment/Reconciliation Officer. The platform should express generic roles/duties and configurable authority mapping while retaining approved NJSS template.

**P1 — Authentication/profile matching.** `lib/rbac/server.ts` selects app profile by `auth_user_id` OR email, then limits to one. Review ambiguity/uniqueness and require robust verified ID mapping in the master template; test account re-use and inactive users.

**P1 — Security-definer and advisor warnings.** Inspect 53 authenticated-executable privileged functions, parameter and identity validation, ACLs and all advisor notices. 47 mutable search-path warnings flagged; fix only in approved changes after classifying affected functions.

**P1 — Agency-specific hardcoding.** `app/api/admin/users/route.ts` requires Waigani Head Office `NCD-WGN`; `lib/org.ts`, `app/layout.tsx`, `app/page.tsx`, dashboard layouts, RBAC menu config and localStorage keys also embed NJSS names. Generalize, but retain optional judicial/court module.

**P2 — Aging/dead budget and support modules.** Retired budget API, legacy table/view variants, migration-only scripts, test schemas, archives and deprecated UI paths must be excluded from the new baseline, not destroyed in the running NJSS installation.

**P2 — Publication/ownership.** Existing repository is public. Determine whether the GFMS master product should use a private repository, plus licensing, code provenance, software delivery and support rights per agency. Review CI secret exposure and dependencies before productization.

## E. Target engineering design

### 1. Central GFMS product repository: source and releases only
Suggested structure:
```
gfms-master/
  app/                    # generic dashboard / modules
  components/
  core/                   # finance arithmetic, policy contracts, workflow engine
  modules/                # budget, requisitions, payments, suppliers, reports, court-optional
  agency-config/          # schema + UI config; no production financial records
  supabase/
    migrations/           # ordered clean baseline + incremental upgrades
    seed.sql              # generic non-sensitive references ONLY
    tests/
  provisioning/           # per-agency environment and deployment checks
  tests/                  # financial integrity, RBAC, storage, setup, regressions
  docs/                   # operator/agency administrator manuals, release process
```

### 2. Each agency deployment (fully independent)
- Agency repository or separately versioned independent application build and hosting project.
- Newly created Supabase project, distinct PostgreSQL DB, Auth user set, Storage buckets and service keys.
- Optional UAT project *also separate* from the agency's production project.
- Agency-specific `NEXT_PUBLIC_SUPABASE_URL`, publishable key, server-side secret, domain, backup path, accounting config and optional integrations.
- Agency-specific production release approvals, migrations, acceptance, billing, support and recovery.
- New installer loads only generic classifications, permissions templates and empty ledger/budget transactional structures; first agency administrator is created through an authorised secure invitation flow.

**Central service is not required at runtime**. Master template updates can be distributed as versioned software releases; agency DBs are never queried centrally by default. Each agency's keys/credentials must not be reused across deployments.

### 3. Configuration and module activation
- `organization`: name, short name, official seal/logo, contacts, addresses, colours, letterheads, currency, timezone, fiscal periods.
- `organization_structure`: divisions, sections/branches, cost centres, approved locations.
- `finance`: official account framework, account mapping, ledger hierarchy, posting rules, budget ceilings, funding sources, year opening controls.
- `workflow`: configured office/authority titles; approval limits; delegation, segregation, document templates, requisition/FF3 and payment/FF4 selection.
- `features`: optional court registry, AI report assistant, integrations. Disabled/unconfigured features must not leak routes or permissions.

### 4. Financial and security invariants
- One authoritative approved budget position and one clearly documented calculation of available budget.
- Draft/endorsement/approval are **not** payment. Commitments and actuals must not be counted twice.
- Store money in fixed decimal PostgreSQL numeric; control negative and partial transactions; auditable compensation instead of deletion.
- Independent RLS/RPC permission checks inside each agency; separate creator, approver, payer and reconciler roles as applicable.
- Financial documents private by default, with short-lived authorised retrieval links.
- All migrations/release scripts validated against brand-new disposable instance, then UAT, then independently approved agency production.
- Keep IFMS integration optional and authorised; never claim the application replaces PNG IFMS without legal approval and interface agreement.

## F. Step 3 implementation work packages — recommended order

| Seq | Work package | Concrete output | Required verification |
| --- | --- | --- | --- |
| 3.1 | Governance + private master repo decision | Ownership and release policy, feature map | Explicit owner sign-off |
| 3.2 | Create clean migration plan | Baseline schema specification excluding legacy archives/UAT/temp schemas | Diff reviewed against desired model |
| 3.3 | Extract generic branding and hierarchy | Configurable agency identity and organization setup | NJSS look-and-feel remains consistent |
| 3.4 | Abstract RBAC and workflow templates | Generic duties + NJSS Registrar template | Role, delegated approver and negative authorisation tests |
| 3.5 | Consolidate budget and ledger | One approved budget ledger chain | Check committed+actual+available equalities across exceptions |
| 3.6 | Correct FF4 atomicity and security findings | Atomic FF4/line persistence and private file access | Fault-injection and document access tests |
| 3.7 | Build independent provisioning | Repeatable clean deployment manifest + fresh empty DB setup | Brand-new test project starts with **zero real NJSS data** |
| 3.8 | Release/upgrade packaging | Versioned upgrade migrations and rollout/rollback protocol | Upgrade and restore tests on disposable instance |
| 3.9 | Full pilot acceptance | NJSS compatibility test and synthetic Agency B clean-room test | Independent data, users, domains, Storage, keys and backups verified |

Never create paid Supabase projects or modify production without the relevant separate project/cost and change approvals.

## G. Step 2 acceptance criteria / status

### Evidence achieved
- Surveyed current repository top-level code, API routes, RBAC/auth, FF3/FF4, budgeting, master data, seed, setup/deployment and release-governance components.
- Surveyed connected live Supabase public tables/views/functions/policies, live migration ledger, security/performance adviser, privilege metadata and storage bucket configurations.
- Identified module classification, clean baseline requirements, specific security risks and Step 3 build order.
- Preserved the approved independent deployment model without creating any shared database or changing NJSS production.

### Still not validated (gates before declaring the product safe)
- Complete line-by-line examination and verification of all 196 public functions and 246 RLS policies.
- Real authenticated access/penetration testing, permissions and storage object download tests.
- Automated build, lint/typecheck and full test suite execution on a clean checkout.
- Function-level migration-by-migration comparison across all 134 live entries and 94 repository files.
- Clean database replay on a new Supabase test project, restore drill, performance/concurrency testing and independent financial reconciliation.
- Full legal, hosting, IFMS and government approval requirements.

**Step 2 technical inventory and implementation blueprint: COMPLETE AS A READ-ONLY PLANNING DELIVERABLE.**  
**Step 3 implementation readiness: CONDITIONAL** on architecture sign-off, ownership/repository decision, cost approvals for any new test infrastructure and explicit approvals for database/security changes.  
**Production system: UNCHANGED.**
