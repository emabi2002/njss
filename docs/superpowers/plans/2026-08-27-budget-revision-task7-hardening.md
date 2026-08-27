# Budget Revision Task 7 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the approved NJSS budget-revision workflow against scope bypasses, invalid financial movements, ambiguous allocation lineage, and direct-table mutation paths while enforcing the approved business sequence: Registrar requests the post-approval change, the responsible Line Supervisor reviews/adjusts and submits their section budget, and the Registrar performs the final approve/return/reject decision.

**Architecture:** Keep migrations 051–053 intact and use migration 054 as the additive hardening/correction layer. The existing SECURITY DEFINER revision RPCs remain internal workers behind hardened public wrappers. Business-role ownership is enforced at the database boundary, not only in the UI: Registrar-only initiation; Line-Supervisor-only draft preparation/submission within SECTION_WIDE scope; Registrar-only final disposition. There is no externally exposed separate revision REVIEW action. The single Registrar Approve action may use the legacy REVIEWED state internally and atomically because migration 052 expects it before approval.

**Tech Stack:** PostgreSQL/Supabase RLS and SECURITY DEFINER RPCs, Next.js API routing, React/Next.js Budget Preparation UI, Node source-level regression checks, GitHub Actions CI.

**Spec:** Approved NJSS Budget Revision / Reforecast design implemented in PR #11 through Tasks 1–6, with the Task 7 workflow correction approved on 27 August 2026.

## Global Constraints

- Preserve the four operational RBAC groups and existing SECTION_WIDE / SYSTEM_WIDE data-scope model.
- Preserve existing approved budget history and FF3/FF4/funding transaction lineage.
- **Registrar alone initiates** a revision, supplementary budget, virement, reduction, reclassification or reforecast request.
- The **Line Supervisor for the affected section** can edit the requested DRAFT/RETURNED revision and SUBMIT/RESUBMIT it.
- The Line Supervisor cannot approve the revision.
- The Registrar does not prepare the revised line figures; after submission the Registrar can APPROVE, RETURN or REJECT.
- Requisition Officer and Payment/Reconciliation Officer remain view/report only for revision workflow purposes.
- Correct Netlify preview gate is `netlify/njsscrem/deploy-preview`.
- Use TDD: the corrected workflow contract must fail against the previous Task 7 implementation before the workflow correction is applied.

## Production migration verification — 27 August 2026

- Migrations `budget_revision_reforecast_schema`, `budget_revision_reforecast_workflow`, `budget_revision_reporting`, and `budget_revision_hardening` were applied in order after CI/deploy-preview gates were green.
- The initial 051 attempt was rolled back by the database because `njss_operations` is a front-end module grouping rather than a live database `modules.code`. A RED regression was added and 051 was corrected to use live FK module codes: `budget` for operational revision permissions and `reports` for revision reporting.
- Post-migration checks confirmed: zero revision data rows were introduced by deployment; zero active allocation formula mismatches; no duplicate active source-line allocation groups; all three hardening triggers exist; wrapper RPCs are executable to authenticated while renamed base functions are not; `budget_available` and `released_available` exist in the authoritative view.
- Role matrix verified: Registrar initiates and disposes; Line Supervisor cannot create but can edit/submit; Requisition Officer and Payment/Reconciliation Officer remain view/report only.
- Active Financial Cost Centres and active Posting Codes remain zero by prior master-data cleanup design, so creation of new revision target lines remains intentionally blocked until Finance-approved master data is loaded.
- Final merge-candidate verification passed on 27 August 2026: full CI and `netlify/njsscrem/deploy-preview` were both green on the verified PR head.