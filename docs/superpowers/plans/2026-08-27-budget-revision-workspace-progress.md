# Task 8 execution ledger — plan: docs/superpowers/plans/2026-08-27-budget-revision-workspace-notifications.md

- Base branch: main @ d2e4bfb17aeb6f42df8de8dac426f30c98a7db5b
- Execution mode: Option 1 discipline emulated in-chat because subagent-dispatch runtime is unavailable.
- Task 1: RED contract created in `scripts/budget-revision-workspace.test.mjs` and wired into CI.
- Task 2: migration 055 source added. Review found PostgreSQL DISTINCT/ORDER BY incompatibilities in the eligible-supervisor lookup. Both were reproduced against the live schema read-only, converted into regression assertions, and corrected before any database application; the final cast-matched ordering parses successfully.
- Task 3: static navigation, client service and assigned-request API are implemented; old unassigned API creation is retired with HTTP 410. Existing funding-workflow inputs were regression-protected after review found two accidental route changes.
- Task 4: dedicated Budget Revision & Supplementary Budget workspace, Registrar request dialog, and Line Supervisor/Registrar work queues are implemented.
- Task 5: BUDGET_REVISION notification routing is implemented. Budget Preparation reads the `submission` deep link so the assigned Line Supervisor opens the exact revision submission. The legacy `Request Budget Change` button routes to the dedicated workspace with the current approved parent, and the duplicate inline request dialog path has been removed. Notification consumers filter by NJSS `users.id` (`profile.id`) rather than the Supabase auth UUID.
- Independent PR review found an async deep-link hydration defect in the Registrar request dialog. A RED regression was added and the dialog was corrected so an explicit approved parent is preserved after candidate loading; an ineligible explicit parent now errors instead of silently falling back to another budget.
- Temporary source-transformation workflows used for narrow edits have self-deleted and are not part of the PR diff.
- Remaining gate: fresh full CI and correct `njsscrem` deploy preview on this exact user-authored head, final live privilege/RLS preflight, then controlled migration 055 application and workflow UAT before merge.
