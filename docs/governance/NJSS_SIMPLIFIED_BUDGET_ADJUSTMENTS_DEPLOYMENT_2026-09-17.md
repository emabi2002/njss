# NJSS Simplified Budget Adjustments and Reallocations — Production Deployment Evidence

**Deployment date:** 17 September 2026 (PNG local date)  
**Repository:** `emabi2002/njss`  
**Production Supabase project:** `qzsmmalfeinoagvronpb`  
**Production implementation merge:** `ae341ceb2f701894d2c9df30fad6d3cbf923df3d`

## Scope

This deployment extends the simplified Head Office annual-budget foundation with append-only supplementary adjustments, Registrar-controlled reallocations, a Budget Officer execution path, and an authoritative current-budget-position service. It does not yet change FF3 workflow behavior.

The authoritative position is based on:

`Original Budget + Posted Supplementary Adjustments + Executed Reallocations In - Executed Reallocations Out - Outstanding Commitments - Actual Expenditure = Available Budget`.

## Repository and CI evidence

The implementation was merged through protected `main` at SHA `ae341ceb2f701894d2c9df30fad6d3cbf923df3d`.

GitHub Actions CI run #564 completed successfully on that exact merge SHA. Its `Build and validate` job included the simplified budget adjustment/reallocation schema contract, event-dimension hardening, adjustments navigation, client contract, adjustments UI contract, legacy backend preservation, RBAC/security checks, PostgreSQL runtime checks, lint, TypeScript typecheck and production build.

## Production migration ledger

Production Supabase records all four additive migrations:

1. `20260916231044 simplified_budget_adjustments_reallocations`
2. `20260916231130 simplified_budget_event_dimensions_hardening`
3. `20260916231936 simplified_budget_adjustments_navigation`
4. `20260916231952 simplified_budget_adjustments_audit_concurrency`

No already-deployed migration was modified in place.

## Live structure and business-row verification

Production verification confirms both new event tables exist:

- `budget_supplementary_adjustments`
- `budget_reallocations`

At verification time both contain **0 business rows**. The previously deployed simplified annual-budget tables also remain at 0 rows because no annual budget has yet been created in production. The deployment therefore established the controls without fabricating financial events.

## Legacy financial-data preservation

The protected production counts remain exactly aligned with the Phase 1 deployment baseline:

| Table | Rows |
| --- | ---: |
| `budget_allocations` | 437 |
| `budget_revision_lines` | 30 |
| `budget_revisions` | 8 |
| `divisional_budget_lines` | 467 |
| `divisional_budget_submissions` | 213 |
| `ff3_commitments` | 20 |
| `ff3_headers` | 32 |
| `ff3_items` | 32 |
| `ff4_headers` | 16 |

This provides evidence that the additive adjustment/reallocation deployment did not delete or rewrite the sampled existing budget, FF3 or FF4 transaction records.

## Authority and RBAC verification

Live role-permission verification confirms:

- `Registrar` holds `budget.reallocation.approve`.
- `Budget Officer` holds `budget.reallocation.execute`.
- `Budget Officer` holds `budget.supplementary.enter`.

No other normal business-role grant was returned for `budget.reallocation.approve` in the verification query. Reallocation approval is additionally guarded by active Registrar-role membership in the secured database function rather than by permission alone.

The request permission is intentionally not auto-granted to an arbitrary role; it can be assigned to the configured Division Director business role as part of operational role configuration.

## Secured RPC verification

Production verification confirms these application RPCs are `SECURITY DEFINER`, use pinned `search_path = public, auth`, deny anonymous execution and are callable by authenticated users only as controlled permission-checked entry points:

- `create_budget_supplementary_draft`
- `update_budget_supplementary_draft`
- `post_budget_supplementary_adjustment`
- `request_budget_reallocation`
- `approve_budget_reallocation`
- `reject_budget_reallocation`
- `execute_budget_reallocation`
- `get_current_budget_position`

Database controls include active-cycle validation, documentary authority validation, immutable posted/executed events, event-only financial dimensions, source-availability checks and row-locking/concurrency protection for reallocation execution.

## Operational boundary

This phase establishes the financial-event layer that the next implementation phase will consume. It does **not** yet make the new current-budget-position service the FF3 workflow authority.

The next phase is therefore **FF3 integration**, including insufficient-budget managerial review with a separate blocked budget state, no financial commitment while blocked, automatic re-evaluation after supplementary/reallocation events, and an atomic server-side budget recheck before commitment creation.

## Result

The simplified supplementary-budget and Registrar-controlled reallocation layer is present in production, its migration ledger is complete, CI is green on the implementation merge, authority permissions are correctly separated, no adjustment/reallocation business rows were fabricated, and the sampled legacy financial row counts remain unchanged.