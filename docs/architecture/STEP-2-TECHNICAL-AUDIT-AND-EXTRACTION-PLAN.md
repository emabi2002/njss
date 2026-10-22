# STEP 2 — Detailed NJSS Technical Assessment and Internal Monitoring Master-Template Extraction Plan

**Document status:** Targeted read-only technical audit and implementation blueprint; product scope corrected 22 October 2026. Step 1 version 1.2 is authoritative.  
**Date:** 22 October 2026  
**GitHub source:** `emabi2002/njss`, default branch `main`, assessed through connected GitHub repository  
**Supabase source:** Connected project `NJSS System`, read-only catalog and security inspections  
**Architecture authority:** Step 1 v1.2: **independent application hosting + Supabase database/Auth/Storage for each adopting agency**. No shared agency database. **Purpose:** internal requisition, purchase register, receipt and expenditure monitoring for sections/divisions. **Explicitly no IFMS integration, no statutory accounting/GL replacement, and no payment execution.**  
**Scope boundary:** This is NOT a completed penetration test, exhaustive code review, code refactor, recovery exercise, or clean-install validation.

## A. Executive engineering decision
Do **not** clone the running NJSS database, replay all legacy SQL blindly, or add `tenant_id` to every table. Build a *master internal-monitoring software release* from reusable requisition/purchasing modules, clean baseline migrations, generic seed data and an agency configuration/onboarding process. Do not build IFMS connectors or official accounting interfaces. Every agency receives a newly provisioned, separate project with an empty business dataset.

NJSS is the **reference implementation**, not the permanent identity of the product. Preserve NJSS financial workflows in its own installation and as optional/selected modules, not as global assumptions. NJSS's existing formal-finance-oriented structures require classification as internal monitoring, optional local budget ceilings, NJSS-only form support, or historical/retired infrastructure; they must not silently redefine the new product as an ERP.

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

| Domain | Evidence | Classification for internal monitoring master | Target change |
| --- | --- | --- | --- |
| Application startup/identity | `app/layout.tsx`, `app/page.tsx` embed NJSS-specific metadata and copy | CORE + configurable branding | Agency-neutral app metadata and bootstrap config; configurable legal title |
| Organization branding | `lib/org.ts`, `app/api/settings/organization/route.ts`, `system_settings` | CORE | New-agency setup wizard, verified logo upload, agency contact/address; no NJSS fallback in master |
| Dashboard/navigation | `app/dashboard/layout.tsx`, `lib/rbac/config.ts` | CORE + optional modules | Replace hard-coded labels, module IDs, logo fallbacks, local-storage keys |
| Authentication | `contexts/AuthContext.tsx`, `lib/supabase.ts`, `lib/rbac/server.ts` | CORE | New project-scoped Auth per installation; verify session/cookie, user-profile linking, client/server boundaries |
| Permissions/RBAC | `lib/rbac/{admin,server,groups,config}.ts`, `users`, `roles`, `user_roles`, `role_permissions` | CORE permission engine, configurable agency roles | Templates for duties and scope; NJSS named roles become selectable workflow set |
| Organization structure | `departments`, `sections`, `court_locations` | CORE hierarchical divisions/sections; OPTIONAL court locations | Remove mandatory Waigani/NCD-WGN dependencies from generic user admin |
| Internal expense categories | `expense_ledger`, `chart_of_accounts`, `finance_posting_mappings`, `cost_centres`, `lib/finance-posting-mapping.ts` | CORE classification tags; OPTIONAL/RETIRED official posting mappings | Offer agency categories, subcategories and item tagging for internal reporting; **no IFMS code mapping or government ledger posting** |
| Planned spending ceilings | `annual_budget_cycles`, `division_budgets`, `division_budget_lines`, `lib/head-office-budget.ts` | OPTIONAL internal controls | Adapt to internal spending limits and comparisons where an agency chooses, not official appropriations/general ledger |
| Legacy budget modules | `app/api/workflows/budget/route.ts` deliberately returns retired-workflow error; multiple older budget views/tables still exist | DEPRECATED / migration-only | Do not ship historical paths as active features or seed from old tables |
| Requisitions / FF3 | `app/api/workflows/ff3/route.ts` requires permissions and calls `njss_transition_ff3`; `lib/ff3-simplified-budget.ts` calls active budget-check RPC | CORE internal requisitions + optional NJSS FF3 format | Capture item, qty, expected cost, purpose, section; show previous/pending purchase matches before approval; no automatic expense booking |
| Purchase evidence / FF4 compatibility | `app/api/workflows/ff4/route.ts` uses `njss_create_ff4`, then separately `njss_save_ff4_payment_lines`, and `njss_transition_ff4` | CORE internal expense/receipt evidence + OPTIONAL NJSS FF4 compatibility | Repair non-atomic create/line-save path; capture reported purchase/receipt and verified expense evidence without treating it as an official bank payment |
| Request, purchase and expense status | `commitment_transactions`, `ff3_commitments`, `payment_transactions`, report views | Repurpose to internal histories where useful; remove official posting assumptions | Define requested/approved/ordered/received/reported-spent separately; prevent double-counting and provide audit corrections |
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

**P1 — Partial FF4 / purchase-evidence record creation risk.** `app/api/workflows/ff4/route.ts` performs FF4 creation and payment-line persistence in distinct RPCs. If saving lines fails, response states FF4 was created, indicating potential partial state. Determine compensating logic and prefer a transactionally atomic server RPC for new installations.

**P1 — Role and authority abstraction.** `lib/rbac/groups.ts` defines NJSS-specific Requisition Officer, Line Supervisor, Registrar and Payment/Reconciliation Officer. The platform should express generic roles/duties and configurable authority mapping while retaining approved NJSS template.

**P1 — Authentication/profile matching.** `lib/rbac/server.ts` selects app profile by `auth_user_id` OR email, then limits to one. Review ambiguity/uniqueness and require robust verified ID mapping in the master template; test account re-use and inactive users.

**P1 — Security-definer and advisor warnings.** Inspect 53 authenticated-executable privileged functions, parameter and identity validation, ACLs and all advisor notices. 47 mutable search-path warnings flagged; fix only in approved changes after classifying affected functions.

**P1 — Agency-specific hardcoding.** `app/api/admin/users/route.ts` requires Waigani Head Office `NCD-WGN`; `lib/org.ts`, `app/layout.tsx`, `app/page.tsx`, dashboard layouts, RBAC menu config and localStorage keys also embed NJSS names. Generalize, but retain optional judicial/court module.

**P2 — Aging/dead budget and support modules.** Retired budget API, legacy table/view variants, migration-only scripts, test schemas, archives and deprecated UI paths must be excluded from the new baseline, not destroyed in the running NJSS installation.

**P2 — Publication/ownership.** Existing repository is public. Determine whether the reusable internal-monitoring master product should use a private repository, plus licensing, code provenance, software delivery and support rights per agency. Review CI secret exposure and dependencies before productization.

## E. Target engineering design

### 1. Central internal-monitoring product repository: source and releases only
Suggested structure:
```
agency-spend-monitor-master/
  app/                    # generic dashboard / modules
  components/
  core/                   # purchasing controls, item matching, approval and evidence contracts
  modules/                # requisitions, item catalogue, purchase/receipt register, duplicate alerts, internal spend, suppliers, reports, court-optional
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
- Agency-specific `NEXT_PUBLIC_SUPABASE_URL`, publishable key, server-side secret, domain, backup path and internal monitoring configuration. No IFMS or accounting-system integration component.
- Agency-specific production release approvals, migrations, acceptance, billing, support and recovery.
- New installer loads only generic classifications, permissions templates and empty ledger/budget transactional structures; first agency administrator is created through an authorised secure invitation flow.

**Central service is not required at runtime**. Master template updates can be distributed as versioned software releases; agency DBs are never queried centrally by default. Each agency's keys/credentials must not be reused across deployments.

### 3. Configuration and module activation
- `organization`: name, short name, official seal/logo, contacts, addresses, colours, letterheads, currency, timezone, fiscal periods.
- `organization_structure`: divisions, sections/branches, cost centres, approved locations.
- `monitoring`: agency categories/expense items, catalogue aliases, spend reporting codes, planned internal ceilings (optional), procurement/history review thresholds; **no official ledger posting or IFMS code crosswalk**.
- `workflow`: approval officers/limits, delegation, segregation, documents, generic requisition approvals and optional NJSS FF3/FF4 views. Record purchases/receipts/internal expenditure evidence; do not execute or certify bank payments.
- `features`: optional court-specific forms and AI reporting subject to governance. Disabled/unconfigured features must not leak routes or permissions. **No IFMS integration feature.**

### 4. Internal monitoring and security invariants
- One authoritative internal requisition/purchase history. Optional planned spending ceilings are management controls, not the government's official budget position.
- Submission/endorsement/approval **do not** establish purchase, receipt or payment. Record the evidence type and verification status separately to avoid duplicated expense totals.
- Store expected/recorded unit costs, quantities and amounts in fixed-decimal types; track correction history instead of silently changing past transactions.
- Independent RLS/RPC permission checks inside each agency; separate requesters, reviewers, receipt verifiers and expenditure record verifiers where appropriate.
- Financial documents private by default, with short-lived authorised retrieval links.
- All migrations/release scripts validated against brand-new disposable instance, then UAT, then independently approved agency production.
- **IFMS integration is prohibited by the product scope:** no IFMS interface, file interchange, scheduled sync, accounting posting, official payments or dependency. The application is a standalone internal purchasing control and monitoring register.

## F. Step 3 implementation work packages — recommended order

| Seq | Work package | Concrete output | Required verification |
| --- | --- | --- | --- |
| 3.1 | Governance + private master repo decision | Ownership and release policy, feature map | Explicit owner sign-off |
| 3.2 | Create clean migration plan | Baseline schema specification excluding legacy archives/UAT/temp schemas | Diff reviewed against desired model |
| 3.3 | Extract generic branding and hierarchy | Configurable agency identity and organization setup | NJSS look-and-feel remains consistent |
| 3.4 | Abstract RBAC and workflow templates | Generic duties + NJSS Registrar template | Role, delegated approver and negative authorisation tests |
| 3.5 | Item-level purchasing history and monitoring | Item catalogue, comparable item aliases, requisition/order/receipt/recorded-expense chain | No double-counting; quantity and unit-price tests; 30/90/365-day duplicate alerts |
| 3.6 | Correct purchase-evidence/FF4 atomicity and storage | Atomic evidence+line writes, private file access | Fault-injection and authorised object-access tests |
| 3.7 | Build independent provisioning | Repeatable clean deployment manifest + fresh empty DB setup | Brand-new test project starts with **zero real NJSS data** |
| 3.8 | Release/upgrade packaging | Versioned upgrade migrations and rollout/rollback protocol | Upgrade and restore tests on disposable instance |
| 3.9 | Full pilot acceptance | NJSS compatibility test and synthetic Agency B clean-room test | Independent data, users, domains, Storage, keys and backups verified |

Never create paid Supabase projects or modify production without the relevant separate project/cost and change approvals.


## H. Updated functional gaps to implement (product owner clarification, 22 October 2026)

The core objective is to stop unnecessary repeated purchasing and make institutional purchases/spending easily searchable across departments, divisions and sections. These requirements are **not** currently validated as complete in NJSS.

**New clean-schema entities (illustrative, validate before implementation):**
- `items`: agency item code, normalized name, aliases, category, description, unit of measure, optional SKU/asset category.
- `requisitions` + `requisition_lines`: requester, section, purposes, requested quantity, estimated unit/line cost, workflow and approvals.
- `purchases` + `purchase_lines`: supplier, purchase order/reference, order date, ordered quantity, actual unit cost, requester linkage.
- `goods_receipts` + `receipt_lines`: delivered date, received quantity, receiver and attached evidence.
- `expense_evidence`: amount reported, vendor/document, date, verification status and responsible officer; *not* official accounting posting or payment execution.
- `duplicate_review_events`: request line ID, matched requisitions/purchases, match factors, reviewer, resolution, overrides, explanation and timestamps.
- `agency_settings`: agency branding, hierarchy, warning windows and approved item/category definitions.

**Duplicate alert design:** exact item codes and aliases first; fuzzy item descriptions second, considering unit/category, quantity, prior pending approval and recent purchase status. Default comparison windows should be configurable (e.g. 30/90/365 days). The system warns, shows evidence and requires a review/override reason; it must not automatically conclude waste/fraud or blindly block legitimate replenishment. Prevent duplicate record imports or repeated request submission through idempotency keys.

**Dashboards and reports:** month-by-month quantities and values purchased by item, unit, department, supplier and expense category; repeat purchase frequency; possible duplicates pending review; unfulfilled orders; average price trend; requests pending approval; records missing proof of receipt or internal expenditure verification.

**Workflow integrity:** a purchase may be made without an existing application requisition for historical import purposes, but must be labelled `historical/external` and not retroactively represented as approved by this application. Cost totals distinguish estimate vs order amount vs verified recorded expenditure. UAT must include same-item purchases by two different divisions, multiple units of measure, cancelled requests, split deliveries, modified quantities, and legitimate repeat supplies.

**Product boundary:** management tracking only. **No IFMS integration**, no formal statutory general ledger, no payment execution or settlement certification. All previous prose characterising the product as a replacement ERP or government accounting platform is superseded.

**Revised Step 3 priorities:** agency-neutral master scaffold → item catalogue and duplicate matching → requisition/approval workflow → purchasing and receipt history → internal spend evidence → dashboards → optional NJSS FF3/FF4 compatibility → clean new-agency provisioning and UAT.


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
- Clean database replay on a new Supabase test project, restore drill, performance/concurrency testing and internal requisition/purchase/expense history consistency tests.
- Full legal, data-protection, hosting, government institutional deployment and document-retention requirements (**not IFMS integration approval**).

**Step 2 technical inventory and implementation blueprint: COMPLETE AS A READ-ONLY PLANNING DELIVERABLE.**  
**Step 3 implementation readiness: CONDITIONAL** on architecture sign-off, ownership/repository decision, cost approvals for any new test infrastructure and explicit approvals for database/security changes.  
**Production system: UNCHANGED.**
