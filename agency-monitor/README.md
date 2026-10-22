# Agency Internal Requisition & Expenditure Monitor — Step 3

**Architecture:** single agency per independently provisioned deployment. Each government institution receives its own new hosting project, Supabase project, PostgreSQL database, Auth user directory, Storage, secrets and backups. No agency shares the NJSS operational database.

**Business purpose:** internal requisitions, historical purchases, ordered and received quantities, reported expense evidence, cross-section item-history review and potential-duplicate warnings before approval. **Not an ERP, official accounting/general ledger, IFMS replacement or IFMS integration.** No bank payment execution.

## Step 3 deliverable / source artifact

The complete first functional starter was created as a downloadable source ZIP attached to the Step 3 ChatGPT handoff. It contains a stand-alone Next.js app, a clean SQL schema plus role-checked RPCs, an item catalogue/agency setup UI, requisition approvals, duplicate review, purchase/receipt and expenditure-evidence interfaces, four passing JS unit tests, and an independent installation guide.

**This GitHub branch currently includes the duplicate rules and initial documentation. The full standalone app bundle is supplied as an attached ZIP and has NOT yet been imported/verified as a GitHub tree.** Do not merge based on this README alone. The complete code ZIP must be reviewed, imported and run through CI before Step 3 may be merged.

## Critical blockers before real agency deployment

- No new agency Supabase/UAT project has been created, no schema migration executed, and no operating NJSS data changed.
- npm dependency installation and Next.js build/typecheck could not be executed in the isolated workspace.
- SQL RLS and function behavior have not been verified on a disposable Supabase database.
- Database duplicate matching in the functional starter uses the same catalog item ID; fuzzy cross-item matches are not yet wired into server-side SQL.
- Staff provisioning, secure attachment/logo uploads, workflow completeness, detailed item-ledger mapping, historical data import and production-grade dashboard verification remain open.
- Existing NJSS public financial-document storage findings require separate approved remediation.

See Step 1–2 architecture documents in docs/architecture for governance and scope.
