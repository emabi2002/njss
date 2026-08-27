# Task 8 execution ledger — plan: docs/superpowers/plans/2026-08-27-budget-revision-workspace-notifications.md

- Base branch: main @ d2e4bfb17aeb6f42df8de8dac426f30c98a7db5b
- Execution mode: Option 1 discipline emulated in-chat because subagent-dispatch runtime is unavailable.
- Task 1: RED contract created in `scripts/budget-revision-workspace.test.mjs` and wired into CI.
- Task 2: migration 055 source added. Review found the PostgreSQL DISTINCT/ORDER BY incompatibility in the eligible-supervisor lookup; regression observed RED and the query ordering was corrected before any database application.
- Task 3: static navigation, client service and assigned-request API are implemented; old unassigned API creation is retired with HTTP 410. Existing funding-workflow inputs were regression-protected after review found two accidental route changes.
- Task 4: dedicated Budget Revision & Supplementary Budget workspace, Registrar request dialog, and Line Supervisor/Registrar work queues are implemented.
- Task 5: BUDGET_REVISION notification routing is implemented. Budget Preparation now reads the `submission` deep link so the assigned Line Supervisor can open the exact revision submission from the work queue. Remaining: route the legacy Request Budget Change shortcut to the dedicated workspace, switch notification consumers to NJSS profile IDs, then run full CI/build/deploy-preview and production migration/UAT gates.
