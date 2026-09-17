# NJSS Simplified Budget Adjustments — Production Deployment Evidence

**Date:** 17 September 2026  
**Scope:** Phase 2 — Supplementary Budgets, Registrar-controlled Reallocations and Authoritative Budget Position

## Release identity

- Repository: `emabi2002/njss`
- Pull request: #40 — `Phase 2: simplified budget adjustments and reallocations`
- Main merge commit: `ae341ceb2f701894d2c9df30fad6d3cbf923df3d`
- Main CI: run #564 (`35160997442`) — completed successfully after merge.

## Production migrations

The following Phase 2 migrations are recorded in the production Supabase migration history:

- `simplified_budget_adjustments_reallocations`
- `simplified_budget_event_dimensions_hardening`
- `simplified_budget_adjustments_navigation`
- `simplified_budget_adjustments_audit_concurrency`

They were applied as additive changes. Existing legacy FF3, FF4, commitment, payment, revision and budget-allocation data was not rewritten or deleted.

## Post-deployment structural verification

Verified in production:

- `budget_supplementary_adjustments` exists.
- `budget_reallocations` exists.
- `budget.supplementary.enter` is active.
- `budget.reallocation.approve` is active.
- `budget.adjustments` navigation is active.
- Registrar holds the normal-role grant for `budget.reallocation.approve`.
- No non-Registrar role holds an allowed normal-role grant for `budget.reallocation.approve`.

For both new financial-event tables:

- Row Level Security is enabled.
- The authenticated role has SELECT access only.
- The authenticated role has no direct INSERT, UPDATE or DELETE privilege.
- The anonymous role has no write privilege.
- Controlled writes are performed through permission-checked RPCs.

## Production data-preservation evidence

Post-deployment production counts:

| Object | Row count |
| --- | ---: |
| `annual_budget_cycles` | 0 |
| `division_budgets` | 0 |
| `division_budget_lines` | 0 |
| `budget_documents` | 0 |
| `budget_supplementary_adjustments` | 0 |
| `budget_reallocations` | 0 |
| `budget_allocations` | 437 |
| `divisional_budget_submissions` | 213 |
| `divisional_budget_lines` | 467 |
| `budget_revisions` | 8 |
| `budget_revision_lines` | 30 |
| `ff3_headers` | 32 |
| `ff3_items` | 32 |
| `ff3_commitments` | 20 |
| `ff4_headers` | 16 |

The legacy financial counts match the pre-deployment baseline. The Phase 2 migration did not fabricate annual-budget, supplementary-budget or reallocation business transactions.

## Security-advisor review

The production security advisor was run after deployment. The new Phase 2 financial-event tables did **not** introduce an RLS-enabled-without-policy finding, and the new Phase 2 functions did **not** appear in the mutable-function-search-path findings.

The advisor continues to report pre-existing/global findings, including several older SECURITY DEFINER views, older mutable-search-path functions, four unrelated RLS tables without policies, and the project-level leaked-password-protection setting. It also identifies authenticated execution of SECURITY DEFINER RPCs. The Phase 2 authenticated RPCs are intentionally exposed application entry points and contain explicit authentication, permission/role checks, fixed search paths, and restricted direct table writes.

## Business-control evidence

Phase 2 preserves these approved controls:

- Original annual budgets remain immutable after Division lock and annual activation.
- Supplementary budgets are separate authorised events and do not edit the original budget.
- Registrar remains the sole reallocation approval authority.
- Budget Officer executes a reallocation only after Registrar authority evidence exists.
- Reallocation execution rechecks source availability before posting.
- Posted supplementary events and executed reallocations are immutable.
- Event-only Section/Ledger positions are supported, so a valid ledger may receive authorised funding even if no zero-value original line was stored.
- Transaction numbering and requester-Division audit binding were hardened for concurrency and audit integrity.

## Phase boundary

This deployment establishes the authoritative Head Office budget position:

`Original + Supplementary + Reallocation In - Reallocation Out = Current Approved Budget`

`Current Approved Budget - Outstanding Commitments - Actual Expenditure = Available Budget`

Phase 2 deliberately did not change FF3 workflow behavior. Phase 3 integrates FF3 with this authoritative position so insufficient-budget requests can continue through managerial review while financial commitment remains blocked until sufficient budget is available.
