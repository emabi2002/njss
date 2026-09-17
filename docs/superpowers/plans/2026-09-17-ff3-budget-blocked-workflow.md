# FF3 Budget-Blocked Workflow Implementation Plan

## Goal
Integrate the simplified active Head Office budget with FF3 while separating managerial workflow from financial commitment.

## Business rules
- FF3 is checked against the active budget key: Financial Year + Division + Section + Ledger.
- If the request exceeds Available Budget, submission is allowed into managerial review with `budget_control_status = INSUFFICIENT_BUDGET_BLOCKED`.
- A blocked FF3 creates no commitment and cannot receive final financial approval until the shortfall is cleared.
- Supervisor and Division/Section-head endorsements remain available while blocked; they may return the request or support a reallocation request.
- After a supplementary budget or Registrar-approved reallocation increases the position, a fresh budget check can clear the block automatically; human workflow approvals are never auto-granted.
- Final `APPROVE` performs an atomic server-side recheck and only then creates the commitment.
- When there is no active simplified annual budget, legacy allocation/release controls remain the compatibility path until cutover.

## Implementation
1. Add FF3 budget-control metadata columns and constrained states.
2. Add a server-authoritative FF3 budget-check RPC that resolves the posting ledger and prefers the active simplified budget; otherwise it falls back to the current legacy allocation calculation.
3. Replace `njss_transition_ff3` submission logic so insufficient funds records a block instead of raising an exception. Keep final approval blocked until a fresh sufficient check succeeds.
4. Update `checkBudgetAvailability` to call the authoritative RPC.
5. Update New FF3 UI to show Current Approved Budget, Commitments, Actual Expenditure, Available, Request, Shortfall, and a clear blocked warning; remove the client-side hard stop for insufficient funds while keeping mapping failures as hard stops.
6. Add regression contracts to CI and preserve existing FF3/FF4 commitment behavior.

## Verification
- Sufficient request: SUBMIT -> endorsements -> APPROVE -> one commitment.
- Insufficient request: SUBMIT succeeds, budget state BLOCKED, no commitment.
- Blocked request can be endorsed and returned, but APPROVE fails while short.
- After budget increase, fresh check changes budget state to SUFFICIENT without changing workflow state.
- Final approval rechecks atomically and creates exactly one commitment.
- No active simplified budget uses legacy compatibility behavior.
- Existing FF3/FF4, RLS, lint, typecheck and build regressions remain green.
