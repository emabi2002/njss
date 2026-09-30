# Head Office budget reset checkpoint — 30 September 2026

Owner direction: narrow NJSS operations to Waigani Head Office, use the new annual budget process, and clear budgets to start afresh.

## Applied

Live Supabase project qzsmmalfeinoagvronpb recorded migrations 20260930021052 and 20260930021112. A private `njss_reset_archive.head_office_budget_20260930` row contains a JSON copy of two PREPARATION annual cycles and 30 DRAFT division budgets, zero budget lines and zero documents. The schema is not exposed to anon or authenticated roles. The full public-table snapshot attempt timed out and rolled back; it created no archive.

A guarded transaction removed the 30 drafts and two cycles after verifying the archive, statuses, empty child tables, and zero supplementary/reallocation events. Post-apply SELECT returned zero cycles, budgets and lines; one archive row remains. Existing FF3/FF4 records were not changed by this operation.

## Not yet reset

The legacy financial model still contains 437 budget allocations, 3 budget cycles, 213 divisional submissions, 467 lines, 5,604 monthly allocations, 8 revisions, 30 revision lines, 32 FF3 headers, 20 commitments, 16 FF4 headers, 8 payment transactions, and 32 funding allocations. Foreign keys connect budget allocations and submissions to commitments, payment/funding and activation history. Do not delete legacy budget rows without a dependency-ordered archive and a decision on the linked transaction histories.

Provincial cleanup is also not yet executed. There are 189 non-Waigani departments, 387 sections, 28 FF3 and 14 FF4 headers outside Waigani; those FF3/FF4 headers are UAT tagged. One active Alotau user with an auth account and one untagged provincial draft submission require explicit treatment. Keep geographic reference locations separately from operational scope.

## Release gate

The new budget tables are empty and may be repopulated with approved Head Office amounts. FF3 does not yet take the new ACTIVE annual budget as its final authority on main. Complete its atomic commitment checks, cross-role UAT, legacy financial reset decision and release reconciliation before claiming a clean production start.
