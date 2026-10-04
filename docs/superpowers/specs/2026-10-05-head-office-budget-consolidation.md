# Head Office annual budget consolidation

## Goal
Only the simplified annual Head Office budget is an operational budget. No nationwide rollout, quarterly releases, funding authority workflow, legacy revision submissions or manual consolidation remain in active budget navigation, APIs or reports.

## Architecture
Annual cycle → Division budget → Section and expense Ledger lines. Budget Officer captures the official annual amounts and supporting documents; Registrar reviews and locks Division budgets, then activates the annual cycle using the activation authority. Posted supplementary adjustments and executed reallocations change the approved amount. Current approved budget minus outstanding commitments minus posted actual expenditure is the available budget.

All budget overview, dashboard and management reports use the same secured current-position RPC and the same internal calculator used by FF3. Only active Head Office Divisions and Sections are returned, within the caller's authorized data scope. Preparation totals are clearly separate from active approved funds.

Legacy screens redirect to the corresponding annual-budget workspace. Legacy write APIs return HTTP 410. Database privileges on legacy write RPCs and capture tables are retired, including for authenticated Administrators, while the new annual RPCs remain operational. Historical migration sources and financial references remain intact for audit and recoverability.

The `budget_allocations` identity is an internal financial posting bridge: FF3 commitments and FF4 payments still reference it. It is not an editable budget or source of approved limits. Deleting these identities would break financial records, so they are preserved; direct client writes are prohibited. No financial history is erased.

## Acceptance
- Active menus expose annual capture, current position, activation and adjustments only.
- No operational UI reads legacy budget/release/funding balances.
- Head Office and assigned scope are enforced at the secured RPC, not only UI filters.
- Reversed commitments and payment reversals produce the same balances in FF3 and reports.
- Retired client writes fail while annual capture/approval/activation and financial posting remain available.
- Required CI, PostgreSQL runtime regression, lint, typecheck and production build pass.
