# Head Office annual budget consolidation — 5 October 2026

The annual Division/Section/expense Ledger model is the only operational budget. This change does not enable nationwide operations.

## Active design

1. Budget Officer captures the annual Division budget and official document.
2. Registrar reviews, returns or approves the Division budget; approval locks the lines.
3. Annual activation requires the required Division approvals and activation authority.
4. Posted supplementary adjustments and executed reallocations change the current approved amount.
5. Available budget = current approved budget − outstanding commitments − posted actual expenditure.

Dashboard, budget position, management reports, FF3 and commitment increases use the same annual calculator. Preparation figures remain separate from activated funds. Annual screens select the actual active cycle or latest preparation year instead of assuming the calendar year.

## Legacy retirement

- Old revision, funding, annual plan and activation mapping worklist URLs redirect to supported workspaces.
- Old budget write APIs return HTTP 410. Database execution and legacy capture/report privileges are revoked for client roles, including users with application Administrator permissions.
- Unused legacy budget clients/components are removed. Navigation and Help use the annual design.
- AI budget/funding balance requests are directed to the deterministic annual reports; operational transaction AI reports remain available.
- Current FF4 audit snapshots no longer return quarterly cash ceilings.
- Historical migration sources and dependent financial records remain intact. `budget_allocations` is a private financial posting bridge, with client access limited to reference columns. It is not a budget limit or editable budget.

## Security and financial safeguards

Head Office and assigned organizational scopes apply at the position RPC, preparation-table RLS and document storage. Password setup must be completed before report or budget access. Recorded FF3 annual dimensions and commitment posting identities cannot be changed after commitment. Technical mapping changes cannot erase recorded annual commitments or payments. Increases require valid annual posting linkage and take the same header/Division locks as FF3 commitment creation.

## Applied migration and evidence

Supabase project: `qzsmmalfeinoagvronpb`.
Applied source: `20261005001037_head_office_budget_consolidation.sql`.
SQL SHA-256: `321e88d5784d42539b2220c0b6082a39753ef93566b7058be8629e7822181ba2`.
All eight changed database function bodies matched the applied source byte for byte.

CI #658 passed all required checks, including isolated PostgreSQL tests, lint, TypeScript and production build. Runtime coverage exercises reversals, event-only ledgers, mapping deactivation/replacement, actual commitment increases/decreases, immutable identities, Section-scoped preparation, scoped storage, denied legacy writes and annual payment snapshots. Independent review findings were fixed and rechecked.

Live authenticated business-role read probes and anonymous/legacy denial checks passed in a rolled-back transaction. Legacy release/revision/activation execution, allocation updates and old budget amount reads are denied. Annual capture and activation RPC execution remains granted.

Preservation checks before and after application:

| Record | Before | After |
|---|---:|---:|
| Annual Division budgets | 15 | 15 |
| Division budget lines | 0 | 0 |
| Financial posting references | 437 | 437 |
| FF3 headers | 32 | 32 |
| Commitments | 20 | 20 |
| Payment transactions | 8 | 8 |

## UAT business preparation

FY2027 remains PREPARATION with 15 Division headers and no captured lines. Budget Officer must enter the approved/test annual amounts and documents; Registrar must review and activate them as part of UAT. No financial amounts or approval authorities were invented. Signed-in end-to-end business acceptance and the UAT lead's sign-off remain human activities; CI is not a substitute for those.

Repository change: https://github.com/emabi2002/njss/pull/60.
