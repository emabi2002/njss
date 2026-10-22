# Step 1 — Independent Agency Deployment Architecture and Standards Baseline

**Project:** NJSS CREMS → Reusable Government Financial Management System (GFMS)  
**Version:** 1.1 — corrected deployment decision  
**Updated:** 22 October 2026  
**Status:** Architecture baseline, not a production implementation  
**Reference installation:** National Judicial Staff Services (NJSS)  
**Supersedes:** 21 October shared-database / multi-tenant architecture proposal

## 1. AUTHORITATIVE DEPLOYMENT DECISION

**Every adopting government agency receives its own new, independent system.**

An agency deployment must consist of:
- a separately managed application project and application deployment (and preferably its own repository based on the maintained release template);
- a new Supabase project with its **own PostgreSQL database** and Auth users;
- dedicated database objects, storage files, backups, service credentials, secrets, audit records, job queues, integration settings and operational logs;
- its own administrators, users, organisational structure, ledgers, budgets, approval hierarchy, documentation and brand identity;
- separate production and UAT/testing environments, each with its own project/database where required.

**Never share the NJSS database, Supabase project, authentication users, file storage or production secrets with another agency.** Never copy NJSS finance transactions, user accounts, personal records, attachments, passwords, or audit history to a new agency installation.

This is **single-agency deployment / repeatable single-tenant installations**, **not** a shared multi-tenant SaaS and **not** a central database containing multiple institutions. Reuse software and standards, *not* live operational infrastructure.

## 2. PRODUCT DESIGN: MASTER TEMPLATE + AGENCY INSTANCES

### A. Master template (development/release distribution only)
Maintain a versioned GFMS master codebase containing:
- configurable agency identity (name, logo, colours, contact details, document branding);
- standard dashboard, budget, requisition, approval, expenditure, financial-control, document and reporting modules;
- standard database schema migrations, fixed reference classifications and clean configuration seed data;
- configurable organisation, cost-centre and agency ledger **mapping to approved government classifications**;
- standard secure role templates, segregation of duties and compliance controls;
- versioned deployment manifest, migration scripts, installation checklist, tests and technical documentation.

The master template does **not** run a common production data service. No central financial datastore or shared end-user login is required.

### B. Agency-specific projects
When an agency subscribes/adopts, provision an independent repository/project from an approved master release; configure a separate app hosting project (e.g., its own Netlify site), a fresh Supabase project/database, storage, keys, domain, administrative identities and deployment pipeline. Use an empty business dataset; only non-sensitive generic reference data may be seeded.

Each agency owns and administers its local operational data subject to the signed ownership/hosting/support arrangements. The central maintainer controls standard software releases but must not have unrestricted access to agency financial data by default.

### C. Maintaining one reusable product
Use tagged GFMS core releases, reviewed database migrations, a tested upgrade path, a compatibility matrix and release notes. Agency-specific changes should remain declarative configuration, plugins or carefully isolated extensions rather than unmanaged code edits; otherwise every installation becomes an expensive independent fork.

## 3. BASELINE OBSERVATIONS (READ ONLY, 21 OCT 2026)
- The GitHub NJSS repository is `emabi2002/njss`, default branch `main`, publicly visible at the time of assessment. Its `package.json` identifies Next.js 16, React 19, TypeScript, and Supabase libraries.
- `app/layout.tsx` still embeds an NJSS-specific title and `app/page.tsx` contains NJSS naming. These need conversion to config values in the reusable template.
- The existing Supabase project is named `NJSS System`. Its public schema includes FF3/FF4, budgets, financial mappings, staff permissions, audit records, suppliers and reporting views.
- No public business table inspected has `institution_id`, `agency_id`, or `tenant_id`. **Under the corrected single-agency architecture, this is NOT a blocker and tenant IDs do NOT need to be added to every business table.** Protect records by user roles, departments, sections and functional/data scopes *within* each independent agency database.
- Some existing data and audit/backup records remain after prior cleanup requests; do not presume the cleanup is finished, and never migrate this data into a new agency.
- Review public source exposure, dependencies, secrets and server permissions before releasing a government product.

## 4. DEPLOYMENT TOPOLOGY

```text
                   GFMS MASTER SOFTWARE TEMPLATE
                    source / migrations / releases
                              |
              approved independent provisioning
                 /            |             \
          NJSS system     Agency B system    Agency C system
          app project     app project        app project
          Supabase A      Supabase B         Supabase C
          PostgreSQL A    PostgreSQL B       PostgreSQL C
          Auth A          Auth B             Auth C
          Storage A       Storage B          Storage C
          Backups A       Backups B          Backups C
          secrets A       secrets B          secrets C
```

No runtime dependencies between agency databases. Independent agency deployments can be updated or restored without transferring records from another agency.

## 5. STANDARD VERSUS CONFIGURABLE ELEMENTS

**Mandatory standard core (centrally released):** schema foundations, business transaction states, financial calculations, audit model, security baseline, permission concepts, payment-status reconciliation, platform accessibility and reporting framework.

**Per-agency configuration:** official name, logo, address, contact details, departments/divisions/sections, cost centres, approved ledger crosswalks, annual budgets, funds, users, signatories, relevant approval levels, dashboard branding and document presentation.

**Agency-specific module policy:** NJSS FF3/FF4 and court-registry workflow is a selectable module/template where appropriate, not an assumption for all other agencies. Other departments may use an equivalent standard requisition/expenditure workflow adapted to their authorised document forms.

**Restricted configuration:** no local administrator may disable immutable audit controls, break segregation of duties, change canonical finance arithmetic, or bypass institution-approved financial limits without documented governance.

## 6. FINANCIAL CONTROL MODEL

Required distinct, auditable states:
1. Draft / requested.
2. Submitted, endorsed and authorised.
3. Commitment created, adjusted or released.
4. Payment request / FF4 prepared and approved (does not establish settlement).
5. Payment or settlement confirmed by an authoritative process.
6. Reconciliation complete, including exceptions and reversals.

Agree on release controls, available budget formula, partial payment rules, exceptions, decimal handling, fiscal-year boundaries and authorised ledger mappings before changing financial transaction code. Confirm whether official IFMS or another approved government system is authoritative for specific posting/payment events. Integration may be added only with authorisation and appropriate credentials for each agency.

## 7. INDEPENDENT AGENCY PROVISIONING CHECKLIST

1. Validate the requesting agency and authorised sponsoring officer, institutional ownership and operating agreement.
2. Choose the approved GFMS release and create a new agency-specific application repository/project from the template (with no NJSS source-data dump).
3. Provision a **new Supabase project** with a **new empty PostgreSQL database**; apply versioned migrations and generic seed classifications only.
4. Provision independent storage, authentication, admin user, secrets, backups, recovery configuration and monitoring. Follow least privilege.
5. Create agency-specific app hosting/deployment project, environment variables, domain, SSL/TLS and separate UAT and production settings.
6. In setup wizard, configure agency identity, fiscal year, hierarchy, cost centres, approved ledger mapping, authority limits, finance workflow and authorised account holders.
7. Run schema, finance accuracy, RBAC/RLS, documents, approval, audit, backup/restore, regression and penetration tests *for this agency installation*.
8. Obtain agency-specific UAT and acceptance. Activate and hand over administrative documentation and upgrade agreement.

No agency production service may begin from another agency's copied business data, credentials or backups.

## 8. SECURITY, COMPLIANCE AND DATA OWNERSHIP

Database separation is necessary but is **not** alone sufficient: within each project enable RLS on exposed tables, design least-privilege role and organisational data scopes, enforce segregation of duties, restrict Storage downloads and ensure service-role secrets remain server-side. Independently secure each agency's backups, CI pipeline, logs, integration credentials and hosting account access. An agency's users must not be configured in another agency's Auth project.

Each agency needs independent disaster recovery, retention policy, audit evidence and continuity planning. Decide legally required hosting region, privacy/cybersecurity controls, official financial standards, licensing and IFMS integration before claiming compliance. Government software release and hosting approval are separate governance decisions.

## 9. NJSS AS REFERENCE IMPLEMENTATION

- Keep the existing NJSS deployment, database and users intact; do not mutate production under Step 1.
- Audit and extract **reusable application logic** from NJSS, not NJSS live financial/user data.
- Parameterise agency naming and visual identity in the master template; keep NJSS as its own independent configured instance.
- Preserve FF3/FF4 and Registrar approval as NJSS-specific operational workflows.
- Retain organisation-versus-financial-cost-centre separation.
- Document which schema objects, migrations, seed records and screen components may be safely reused by other government agencies.

## 10. IMPLEMENTATION STAGES / EXIT CRITERIA

**Step 1 — Architecture baseline (this document):** adopt independent per-agency deployment model; identify reusable core and hardcoded NJSS-specific features. No code deployment or database changes.

**Step 2 — Deep source and database audit:** trace routes/components/actions, auth/RLS, all financial states and table relations; classify code as core vs agency-specific; map clean-schema migrations and configuration needs; design GFMS master-template repository, installation manifest and safe upgrade mechanics. Do not start paid new projects without approval.

**Step 3 — Master product extraction:** implement environment-driven agency identity and optional modules; isolate core code; produce clean migrations/seeds and a repeatable agency provisioning script; test with a disposable **non-production** instance only after costs and authorisation are approved.

**Step 4 — Independent agency setup flow:** administrator wizard for organisation, ledgers, roles, approvals and branding; agency dashboard/report configuration; never connect to the NJSS database.

**Step 5 — Acceptance and deployment:** simulate a second agency in a dedicated test project; validate independent users/files/financial data and operations, migrations, backups/recovery and baseline security; perform a controlled agency-specific go-live.

## 11. ACCEPTANCE, REVERSED ASSUMPTIONS, OPEN ITEMS

**Step 1 accepted architectural correction:** each agency receives an independent application project and its own Supabase project, database, users, Storage and operations; only software template and releases are reused.

**Explicitly withdrawn:** shared database, global `institutions` table within the NJSS database, blanket business-table `tenant_id` conversion, multi-tenant RLS model, and deploying a second agency against the NJSS Supabase instance.

**Open governance/implementation decisions:** master template ownership/licensing; per-agency repository ownership; UAT + production project policy; billing and hosting responsibility; whether a central update service is allowed to access runtime installations; official ledger/form templates; agency-specific support and integration contracts.

**Implementation status:** architecture documentation only. No new Supabase project, paid branch, application project or database migration has been created. No production credentials or records changed.
