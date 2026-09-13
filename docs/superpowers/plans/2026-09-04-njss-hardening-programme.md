# NJSS Hardening Programme Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden NJSS into a presentation-ready and production-governed court registry and expenditure monitoring system with fail-closed access control, authoritative workflows, auditable financial controls, verified Supabase RLS, operational resilience and evidence-based release gates.

**Architecture:** Preserve the existing Next.js 16 + Supabase architecture and strengthen it incrementally. Browser/UI actions remain untrusted; authorization is enforced server-side and again in Supabase through RLS/RPC/Edge Functions. Privileged service-role operations are isolated to server/Edge execution paths. Every hardening item is delivered on an isolated branch with RED/GREEN evidence and a pull request; `main` is the controlled release branch.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, TypeScript 5, Supabase/Postgres/RLS/Edge Functions, Bun, GitHub Actions.

**Spec:** Approved NJSS hardening design and repository baseline captured by NJSS-HARD-01 and GitHub Issue #24.

## Global Constraints

- The canonical operational groups are exactly: Requisition Officer, Line Supervisor, Registrar, Payment/Reconciliation Officer.
- System Administrator is a protected technical role, not a fifth business workflow group.
- NJSS onboarding uses administrator-created accounts; there is no user invitation workflow.
- Section assignment is mandatory for Requisition Officer and Line Supervisor accounts.
- Administrator-created/reset temporary passwords require forced password change at first successful login.
- Browser/UI authorization is never sufficient on its own; API/server and Supabase controls must independently enforce authorization.
- Service-role credentials must never be exposed to browser code or public build output.
- Historical financial/audit records must not be destructively removed merely because an account or master-data item is retired.
- Merge approval does not authorize a production deployment.
- Production database migration requires a separate explicit release gate.
- Existing historical migrations are not renamed or rewritten merely to normalize numbering; applied-state reconciliation comes first.
- Every implementation change follows RED test -> minimal implementation -> GREEN test -> full regression/CI -> PR review.
- `main` is never used as a development branch.

---

## Phase 1 — Governance, Identity and Access Foundation

- [ ] **NJSS-HARD-02:** Protect `main`, require PR/CI gates, add release SHA/evidence controls.
- [ ] **NJSS-HARD-03:** Build migration ledger, checksums, deterministic replay order and live schema-drift reconciliation.
- [ ] **NJSS-HARD-04:** Enforce fail-closed production configuration and service-role/secret boundaries.
- [ ] **NJSS-HARD-05:** Harden login/logout/refresh/session-cookie synchronization, persistence and timeout.
- [ ] **NJSS-HARD-06:** Harden forgot/reset/change-password lifecycle, enumeration resistance and token expiry.
- [ ] **NJSS-HARD-07:** Consolidate administrator-controlled user provisioning/lifecycle and remove invitation semantics.
- [ ] **NJSS-HARD-08:** Protect System Administrator and last-admin invariants under concurrency.
- [ ] **NJSS-HARD-09:** Prove four-group RBAC parity across menus, APIs, routes and workflow actions.
- [ ] **NJSS-HARD-10:** Execute actor-by-actor RLS/RPC/Edge penetration tests against Supabase.

## Phase 2 — Master Data and Budget Controls

- [ ] **NJSS-HARD-11:** Province/Court Location/Department/Division/Section hierarchy integrity.
- [ ] **NJSS-HARD-12:** Cost Centre/Expense-Posting Code/CoA/Funding Source mapping integrity.
- [ ] **NJSS-HARD-13:** Master-data CRUD authorization, validation, duplicate prevention and historical preservation.
- [ ] **NJSS-HARD-14:** Budget preparation creation/submission controls.
- [ ] **NJSS-HARD-15:** Budget review/return/reject/approve segregation.
- [ ] **NJSS-HARD-16:** Operational-budget activation, fingerprints, immutable snapshots and dual control.
- [ ] **NJSS-HARD-17:** Funding authority, receipt, allocation and balance controls.
- [ ] **NJSS-HARD-18:** Supplementary budget/revision/reforecast history and operative-baseline logic.

## Phase 3 — FF3, Commitments, Suppliers and FF4

- [ ] **NJSS-HARD-19:** FF3 drafting, lines, calculations, quotations, documents and ownership.
- [ ] **NJSS-HARD-20:** FF3 submit/endorse/return/reject/approve workflow reconciliation.
- [ ] **NJSS-HARD-21:** Commitment/encumbrance creation, cancellation, release and balance controls.
- [ ] **NJSS-HARD-22:** Supplier lifecycle, duplicate detection and reference/banking audit controls.
- [ ] **NJSS-HARD-23:** FF4 creation only against authorized FF3/commitment context.
- [ ] **NJSS-HARD-24:** FF4 verification/approval/processing/payment/reconciliation authority reconciliation.
- [ ] **NJSS-HARD-25:** Overpayment, duplicate invoice/payment and invalid-commitment prevention.

## Phase 4 — Workflow, Audit and Reporting

- [ ] **NJSS-HARD-26:** Formalize all workflow state machines and legal transitions.
- [ ] **NJSS-HARD-27:** Harden My Tasks & Approvals scoping and action eligibility.
- [ ] **NJSS-HARD-28:** Notification/deep-link/acknowledgement delivery controls.
- [ ] **NJSS-HARD-29:** Concurrency, double-click and idempotency protection.
- [ ] **NJSS-HARD-30:** Audit immutability, actor integrity, denied-action evidence and degraded-audit detection.
- [ ] **NJSS-HARD-31:** Report row/data-scope leakage tests.
- [ ] **NJSS-HARD-32:** PDF/CSV/print/export authorization and financial-total verification.
- [ ] **NJSS-HARD-33:** End-to-end Budget -> Funding -> FF3 -> Commitment -> FF4 -> Payment reconciliation.

## Phase 5 — Operations and UI Assurance

- [ ] **NJSS-HARD-34:** Full/differential backup integrity.
- [ ] **NJSS-HARD-35:** Restore validation and disaster-recovery rehearsal.
- [ ] **NJSS-HARD-36:** Housekeeping, data-quality, health and degraded-service alerts.
- [ ] **NJSS-HARD-37:** File upload/storage type, ownership and access security.
- [ ] **NJSS-HARD-38:** Email/system-information/external-service failure handling.
- [ ] **NJSS-HARD-39:** Inventory every page/menu/button/link/modal/action and verify routing/functionality.
- [ ] **NJSS-HARD-40:** Remove dead or misleading controls, including Remember Me and Resend Invitation.
- [ ] **NJSS-HARD-41:** Validation, error, accessibility, keyboard and responsive behavior.
- [ ] **NJSS-HARD-42:** Direct-URL and direct-API bypass testing.

## Phase 6 — Security, UAT and Release

- [ ] **NJSS-HARD-43:** CSP/XSS/injection/CSRF/session/open-redirect hardening.
- [ ] **NJSS-HARD-44:** Dependency/SCA and secret-leakage review.
- [ ] **NJSS-HARD-45:** Service-role/RPC/Edge privilege-escalation review and consolidation.
- [ ] **NJSS-HARD-46:** Adversarial data-isolation and cross-role tests.
- [ ] **NJSS-HARD-47:** Reconcile and verify National UAT dataset work, including PR #22/#23.
- [ ] **NJSS-HARD-48:** Execute role-by-role UAT scenarios with evidence.
- [ ] **NJSS-HARD-49:** Full regression, lint, typecheck, build and real Supabase security test pack.
- [ ] **NJSS-HARD-50:** Final security review, release evidence, rollback readiness and production go-live gate.

## Release Gates

Implementation work is approved across the programme, but the following remain deliberate safety barriers:

1. Each task is developed outside `main` and presented as a PR with evidence.
2. A successful PR CI result is necessary but not sufficient for production release.
3. Production Supabase migrations are never inferred from a merge or application deployment approval.
4. Production deployment must identify and verify the exact approved source commit SHA.
5. Final go-live occurs only after HARD-50 evidence shows no unresolved critical/high security or financial-integrity defects.