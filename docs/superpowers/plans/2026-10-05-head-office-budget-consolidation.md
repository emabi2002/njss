# Head Office budget consolidation implementation plan

**Goal:** Adopt only the simplified annual Head Office budget in the active application.
**Architecture:** Annual cycle, Division/Section/Ledger lines, Registrar approval/activation, supplementary adjustments and reallocations. One secured current-position RPC delegates calculations to the existing FF3 calculator. Preserve financial posting identities and audit history.
**Tech Stack:** Next.js 16, TypeScript, Supabase PostgreSQL and RLS.
**Spec:** docs/superpowers/specs/2026-10-05-head-office-budget-consolidation.md

- [x] Replace legacy budget overview with current annual positions and preparation status.
- [x] Replace dashboard budget sources and nationwide scope with Head Office annual metrics.
- [x] Replace report library and management sources with annual budget position and real financial traces.
- [x] Retire old routes, write APIs, unused UI/client helpers, menus and permissions; audit remaining notifications/FF3 display.
- [x] Add migration securing Head Office scoped canonical positions and revoking legacy write privileges without deleting financial records.
- [x] Add meaningful PostgreSQL and retirement regression tests; adapt superseded UI contracts while preserving historical migration contracts.
- [x] Run all required checks and independent code review; resolve findings.
- [ ] Publish the reviewed repository change and confirm exact UAT deployment.

Applied and verified migration: `20261005001037_head_office_budget_consolidation`. PostgreSQL/runtime, lint, typecheck and production build passed in CI #658; independent review blockers resolved.

Review focus: scope bypass, financial double counting, preparation versus approved balances, financial identity preservation, remaining reachable old writes and reports.
