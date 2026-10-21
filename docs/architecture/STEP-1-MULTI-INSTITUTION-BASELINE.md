# Step 1 — Multi-Institution Architecture and Standards Baseline
**Project:** NJSS CREMS → configurable Government Expenditure and Financial Monitoring Platform  
**Date:** 21 October 2026  
**Status:** Proposed architecture baseline; no production deployment  
**Pilot tenant:** National Judicial Staff Services (NJSS)

## 1. Decision
Evolve the existing Next.js/React/TypeScript + Supabase/PostgreSQL application through incremental refactoring. Do **not** replace NJSS with a third-party ERP or duplicate one database per institution by default. First develop and test secure tenant boundaries before onboarding a second institution. Preserve existing FF3 → endorsement → Registrar approval → FF4 → reconciliation controls for the NJSS pilot.

## 2. Scope and product boundaries
- **In scope:** institution registration and branding; departments/divisions/sections; cost centres; ledger/chart mappings; fiscal periods; budgets, releases, requisitions, approvals, commitments, payments/status and reconciliations; documents; audit trails; reporting; administration.
- **Outside initial scope:** replacing the official IFMS/general ledger, government payroll, bank payment execution, procurement award, and consolidated whole-of-government accounting. An authorised system-of-record and integration agreement must precede these capabilities.
- **Shared application:** common code, security controls, reporting definitions, financial state machine, auditing and API contracts.
- **Configurable per institution:** approved branding/contact details; organisational hierarchy; institution-specific ledger aliases with canonical mappings; authorised users; approval routing within mandated limits; document layouts and local notification preferences.
- **Not configurable by ordinary institution administrators:** tenant isolation; audit immutability; mandatory segregation of duties; finance arithmetic; official ledger classifications; retention requirements; external-system integration credentials.

## 3. Read-only baseline findings (21 Oct 2026)
- GitHub repo: `emabi2002/njss`, branch `main`; public visibility. `package.json` lists Next.js 16.2.4, React 19.2.4, TypeScript 5, Supabase clients and Recharts.
- App currently has hardcoded NJSS CREMS title in `app/layout.tsx` and NJSS loading copy plus a dashboard redirect in `app/page.tsx`.
- Supabase project `NJSS System` is active. Public-schema inventory includes FF3/FF4, financial/budget, suppliers, roles, documents, audit, backups and reporting views.
- **Major blocker:** no `institution_id`, `tenant_id` or `agency_id` column appears in any public table/view examined. Existing RLS being enabled is **not evidence** that tenants are isolated.
- Existing rows remain, including departments, sections, users, role permissions, expense ledger, division budgets, audit logs and backup change journal. Do not infer that the earlier data-cleanup workflow is fully complete.
- Repository is public; review secrets, PII, grants, policies, views and asset access before institutional onboarding.

## 4. Proposed logical model
**Control plane** (platform-only): `institutions` (immutable ID; status); `institution_settings`; `institution_branding`; `institution_modules`; `platform_roles`; `tenant_provisioning_events`. No institution admin can make themselves a platform administrator.

**Membership/permission plane:** `institution_memberships` (user ID, institution ID, active); institution-scoped role assignments; delegation and limit tables; segregation rules; approvals delegated by authorised office, not by self-service role edits.

**Business-data plane:** add non-null institution references progressively to relevant organisation, finance, requisition, approval, document, supplier-linkage, journal, budget, and reporting entities. Some catalogues may be explicitly global and read-only. Include institution ID in composite foreign keys / uniqueness constraints where cross-tenant joins otherwise remain possible.

**Files plane:** private institution-scoped buckets or object paths; server-enforced authorisation and signed downloads; no public URLs for private finance documents. Logos may be publicly served after verification.

**Integration plane:** adapters and outbound queues for IFMS and any future procurement integration; versioned data contracts, idempotent transaction IDs, retries, reconciliation and full event history. Never assume approval implies payment.

## 5. Financial transaction model
Separate and timestamp the states:
1. Draft/requested (no budget deduction by default).
2. Submitted / endorsed / authorised — require configured stage approvals.
3. Commitment created/adjusted/released (available budget reduced under approved control rules).
4. FF4/payment request prepared and approved (does not itself prove money paid).
5. Externally confirmed settlement/payment and reconciled position.
6. Reversal/cancellation by compensating events, not silent deletion.

Define available budget formula, release controls, rounding, partial payments, over-commitment rules and fiscal-year rollover formally **before coding**. Identify the authoritative source for disbursement confirmation. All money figures use fixed-decimal values, not floating-point arithmetic.

## 6. Non-negotiable security
- Default-deny Row Level Security for all tenant-sensitive tables; policies check authorised active membership for the specific institution and role/action.
- Tenant identity comes from verified session + server-side membership, never client-provided form field alone.
- Policies on views (security-invoker where supported), RPCs, background jobs and Storage; service-role access server-only.
- Segregation of duties: creators must not approve their own requests unless explicitly authorised under documented exception governance.
- Tamper-evident audit of who/when/old-new states; signed attachments and approval decisions have retention controls.
- Test horizontal cross-institution access (API, exports, joins, reports, object URLs, notifications, scheduled tasks).
- Re-evaluate the public repository exposure and any secrets; limit operational/log data by retention policy.

## 7. Suggested tenant onboarding
Platform officer validates institution authority → creates inactive institution → configures identity → fiscal year and hierarchy → canonical ledger crosswalk and cost centres → approves role assignments and financial approval limits → validates import and reports → activates tenant after security and UAT checks.
Do **not** grant arbitrary institution signup as production access.

## 8. NJSS compatibility requirements
- Preserve FF3/FF4 and Registrar rules as an NJSS workflow template, rather than hardcoding them globally.
- Preserve organisation versus financial cost-centre distinction.
- Preserve existing authoritative budget and mapping logic pending detailed field-level audit; no delete/rekey during Step 1.
- Map existing NJSS records to the first institution ID only after approved migration rehearsal and rollback plan.

## 9. Deployment decision (provisional)
A shared Postgres database with scoped schemas/tables + RLS may be suitable for initial pilots. For some departments, contractual/legal classification may require dedicated database/project or hosting. Keep application interfaces portable so tenancy deployment can vary. Complete hosting, residency, legal, security, data ownership and continuity review before government-wide claims.

## 10. Stage gates
**Step 1 (architecture baseline):** document boundaries and decisions, inventory schema, record blockers; no production changes.  
**Step 2 (detailed assessment):** trace forms/routes/API/auth queries and RLS; data classification; map entities, permissions, ledger rules; publish migration/test strategy.  
**Step 3 (isolated implementation):** create tests and migration on non-production DB; tenant provisioning and scoped policy enforcement; instrument audit.  
**Step 4 (configurable UI):** tenant brand, organisation, ledgers, budget and role/approval setup; dashboard visual refactor.  
**Step 5 (UAT):** NJSS pilot + second synthetic agency; cross-tenant penetration tests, finance reconciliation, backup/recovery, performance; controlled cutover.

## 11. Step 1 acceptance and open decisions
**Completed:** baseline design, preliminary repo and schema observations, isolation-risk identification, module boundary and staged conversion plan.  
**Not completed / not claimed:** full source/security audit, detailed schema relationships, RLS policy verification, UAT, code changes, schema migration, deployment, IFMS approval or compliance certification.

**Decisions still requiring governance input:** product ownership and licensing, who may provision government agencies, official finance classifications and forms, system of record for payments, approved hosting location, whether single- or separate-tenant deployments are mandated, institutional data-retention policy, integration authority.

**Stop condition:** do not activate a second real agency on the present database; no institution-scoped protections have yet been established.
