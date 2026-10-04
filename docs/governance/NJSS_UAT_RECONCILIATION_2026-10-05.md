# NJSS Head Office UAT reconciliation — 5 October 2026 (PNG)

This record supersedes the uploaded management review's repository-state findings. Inspection used a full checkout of main at `6cd82ca4ee20aa9c38ddba07003af610ca5a4a65`, live GitHub PR/ruleset data, Supabase catalogue/rollback probes, and Netlify deployment metadata. No production promotion is authorised by this UAT work.

## Corrected findings

- Phase 3 direct-ledger FF3 control was already merged at `09b0de2`. All six checked live FF3 calculation, commitment, transition and notification function bodies match the final source after normalizing CRLF. Do not merge #42–#45 over that implementation.
- Organisation Setup, registry/division filtering and guarded safe delete were already merged. #48 is obsolete.
- Main already contains server-authoritative access loading and the `njss-self-password` Edge Function. The useful missing part of #23 was client route enforcement; the nationwide reset and old client RBAC loader conflict with approved Head Office scope.
- Court Interpreter schema is absent; the live September 30 ledger records its removal. It is not a current UAT module.
- Main is protected by active ruleset 22339971: PRs, strict `Build and validate`, no force push, no deletion, no bypass. Independent approval count is zero; management must appoint an actual reviewer. Issue #24 was closed with live evidence.
- Netlify UAT site is `njsscrem.lagoonpng.com`, site ID `b0510b27-835b-4b5d-93dd-6c5ac45330d9`. Its September 30 deployment was ready. `njsscrems` is a separate older site and must not be used for this UAT.

## Fixes in this consolidation

1. Dashboard children now wait for resolved access and confirmed password status, with per-navigation route checks and an explicit no-access route. Failed/malformed password checks stay unknown and allow retry/sign-out; they never become successful checks. Server permission helpers and all three privileged administration/backup Edge authorizers also refuse first-login or unknown password state. Stale asynchronous access/password responses cannot overwrite newer session checks. Routine same-identity INITIAL_SESSION/SIGNED_IN/TOKEN_REFRESHED events preserve established authorization so unsaved forms remain mounted; identity changes and account updates restart checks.
2. The authorised Budget Adjustments child menu is now reachable in the sidebar without inventing permissions or menus. Technical operations routes and summary no longer accept ordinary `dashboard.view`. Route permissions include the actual Head Office capture/review permissions and explicit Organisation Setup, notifications and AI reporting rules.
3. Netlify has `SUPBASE_SERVICE_ROLE_KEY` instead of `SUPABASE_SERVICE_ROLE_KEY`. Two connector upserts reported success, but independent read-back still omitted the correct key. The server now accepts the verified legacy variable as a server-only fallback, preferring the canonical key and throwing in browser/missing-key contexts. This resolves runtime use without claiming the platform rename persisted; remove the compatibility fallback after authoritative configuration confirmation. No key was added to source or public configuration.
4. Provincial operational choices were retired reversibly: 189 active divisions, 387 sections, 27 locations and one provincial UAT account deactivated. Private archive holds 604 before-state flags. Post-check: zero active provincial divisions/sections/users, one active registry, all 15 current Head Office budgets preserved. Financial records, FK links, authentication identities and geographic reference rows were retained.
5. Ten client-readable legacy views bypassed caller RLS. A no-identity authenticated-role probe returned five budget submission rows before the fix. They now use `security_invoker=true`; the same probe and all ten view probes return zero rows. Administrator and all five business-role probes continue to read permitted records. Fresh security advisors show zero ERROR findings.
6. Four previously applied reset/archive SQL sources were recovered from #54 without merging its outdated application files. The September 30 reset checkpoint remains historical: the current database has since been populated with a 2027 PREPARATION cycle and 15 Head Office division budgets.
7. Obsolete national/duplicate PRs #22, #23, #39, #41, #42, #43, #44, #45, #48 and #54 were closed, retaining branches/history.

## Applied migration reconciliation

| Source file | Live version/name | Evidence |
| --- | --- | --- |
| `20261004215333_head_office_uat_operational_scope.sql` | `20261004215333 head_office_uat_operational_scope` | Rollback-only rehearsal returned zero provincial choices; separate post-rollback query confirmed no persisted change. Apply succeeded; invariants and private archive verified. |
| `20261004215730_uat_view_invoker_hardening.sql` | `20261004215730 uat_view_invoker_hardening` | Definitions/grants preserved; no-identity denial and administrator read probes passed. No RLS-disabled public tables. |

The new source filenames now match the exact versions assigned by the managed migration API and confirmed in the live ledger; source SQL bodies are unchanged. Use the managed migration API for deployment; do not replay already-applied versions. Recovered September 30 archive versions already exist in the live ledger and must not be rerun against the current budgets.

## Verification and limits

Targeted dashboard/password/operations behavior tests passed RED then GREEN. Current CI contracts, lint, typecheck and production build are required on the final branch. GitHub CI provides isolated PostgreSQL runtime checks; local scratch has no PostgreSQL server.

A wider initial scan also found obsolete source-text expectations in the legacy activation/revision and legacy budget quick-add UI tests. These expect the superseded spreadsheet screen at the new annual-budget route. They are recorded separately from current CI and must not be reported as current UI acceptance. Legacy backend contracts remain important; changing text assertions alone is not proof of business correctness.

Retained legacy UAT history includes 437 operational allocations and 32 FF3 headers. It is not fresh approved Head Office budget input and must not be copied to production. Private in-database archives are not independently verified off-project recovery backups; no destructive financial purge was performed.

Remaining advisor WARN classes include historic mutable function search paths, authenticated SECURITY DEFINER functions (many are deliberately guarded RPCs), and disabled leaked-password protection. Zero ERROR findings is not a complete security certification. Review permissions/function bodies and Auth settings before production promotion.

## Business acceptance responsibilities

The repository cannot appoint people or sign on behalf of the Registrar. Management must nominate the UAT Lead/deputy, business testers and sign-off authority, reserve testing time, execute positive/negative role and financial scenarios, log defects and reconcile reports. Start only on an identified deployed SHA; production follows a signed UAT acceptance on a separate environment.

Required UAT coverage: first-login/reset/password-check failure; direct denied URLs; inactive provincial account; separate division attachment/manual approval; sections/master-ledger totals; Registrar return/resubmit/electronic approval; annual activation; supplementary/reallocation controls; insufficient FF3 review versus commitment; duplicate/concurrent commitments; verified FF4 Registrar approval and self-approval denial; suppliers; financial reports; audit trail.

## Claude analysis action crosswalk

| Recommendation | Reviewed disposition |
| --- | --- |
| Merge #22/#23 national rebuild | Superseded and closed. Apply extracted missing access controls to current Head Office implementation; preserve current budgets. |
| Consolidate FF3 #42–#45 | Final direct-ledger implementation already on main; six live function bodies verified against source. Superseded PRs closed. |
| Close #39/#41 | Closed as superseded by merged Phase 2. |
| Merge Organisation #48 | Current Organisation implementation already merged; obsolete PR closed. |
| Protect main / Issue #24 | Active strict CI/PR ruleset verified; issue closed with evidence. Independent human review remains a management assignment. |
| Reconcile migrations | New source/live versions match; recovered four applied sources; complete 132-entry live checkpoint recorded. Historical drift follows existing managed mapping rules, not blind CLI replay. |
| Exclude Court Interpreter | Schema/API removal verified in live catalogue and September 30 ledger. Historical additions remain immutable ledger entries. |
| Freeze/tag/deploy exact source | PR #58 merged after CI #650 and review. Netlify read-back confirmed ready Git-connected deployment `6ac2d1bb82042e0008498d9c` at exact merge `5c5c48b708d8dbb2ab1bc40f491f37e8737d49e1`. Runtime follow-up bakes Git commit/build time into System Information; await its exact CI/deployment. A separate manual upload was auto-review blocked and was not retried. |
| Reset/seed national data again | Incompatible with approved Head Office-only scope and current populated budgets. No destructive replay; reversible operational retirement applied. |
| Create tester logins | Eight active Head Office accounts/roles exist. Management must supply actual named tester identities and assignments before new accounts are created. |
| Appoint lead/reviewer, schedule scripts, sign off | Management actions. Positive/negative coverage listed above; no AI or developer claim substitutes for business acceptance. |

## Runtime release follow-up

Both server service-role client factories use one server-only lookup: canonical `SUPABASE_SERVICE_ROLE_KEY`, then the verified legacy `SUPBASE_SERVICE_ROLE_KEY`. No credential enters `NextConfig.env`, browser code values, public metadata or source files. Only commit SHA and build time are added to public build metadata. The Netlify-provided `COMMIT_REF` takes precedence over manually set SHA values so System Information identifies the built source. Actual administrator authorization remains unchanged and still precedes privileged operations.

Deployment verification for #58: existing Git-connected UAT site reported `ready`, Next.js plugin `success`, commit `5c5c48b708d8dbb2ab1bc40f491f37e8737d49e1`, and publication 2026-10-04 22:24 UTC (5 October 08:24 PNG). Three updated Supabase functions were read back byte-for-byte from source: admin-users v6, admin-access v5, database-backup v5; all ACTIVE and JWT verification retained. This is deployment/source evidence, not performed business UAT.
