# Head Office UAT readiness implementation plan

Goal: reconcile the October 5 report against current code and fix verified readiness gaps.
Architecture: preserve the current Head Office budget implementation; extract only the missing access gate from the old national branch. Keep existing financial history intact while retiring provincial organisation choices.
Tech stack: Next.js 16, React 19, Supabase PostgreSQL, Netlify.
Scope: owner-authorised direct fixes to the UAT system; no production promotion.

- [ ] Test and fix fail-closed dashboard rendering and password-state failures, including unknown state, denied routes, no-access and first-login redirect.
- [ ] Restrict operations summary and routes to technical permissions, retaining AI reporting restrictions.
- [ ] Reconcile reset archive source files without merging outdated application code.
- [ ] Retire provincial operational choices transactionally with private before-state archive and Head Office invariants.
- [ ] Close obsolete overlapping PRs only after checking replacement implementation.
- [ ] Run current regression contracts, lint, typecheck, build and isolated PostgreSQL tests; investigate all failures.
- [ ] Publish the reviewed change through a PR; verify exact CI SHA and deployed UAT build. Record external blockers honestly.
