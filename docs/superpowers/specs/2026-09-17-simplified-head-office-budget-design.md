# NJSS Simplified Head Office Budget Design

Date: 17 September 2026  
Repository: `emabi2002/njss`  
Status: Approved business design; implementation planning pending written-spec review

## 1. Purpose

This design replaces the existing complex divisional budget-preparation workflow with a much simpler Head Office budget-capture process while preserving the existing NJSS financial-control capabilities for FF3 requisitions, commitments, FF4 payments, actual expenditure, supplementary budgets, reallocations, and reporting.

The budget applies to NJSS Head Office only. It is not a national or provincial budget-entry process.

The key business principle is that budget preparation and approval occur largely outside NJSS, while NJSS becomes the controlled operational record used to enforce available-budget rules against Section and ledger combinations.

## 2. Agreed Business Process

### 2.1 Budget preparation

Each Division prepares its budget in a spreadsheet. The Division may revise and discuss the draft before formal approval.

The Budget Officer may enter draft figures into NJSS before the budget is formally approved. While the budget remains in `DRAFT`, the Budget Officer may amend figures, print draft reports, compare totals, and reconcile the entered figures against the working documents.

### 2.2 Formal approval

The budget is printed and discussed in the appropriate meeting. The Registrar approves the official budget by signing and stamping the approved document.

The signed and stamped Registrar-approved document becomes the authoritative documentary record of the original budget.

The Budget Officer then verifies the NJSS draft figures against the signed and stamped approved document and uploads the official approved document to NJSS.

### 2.3 Division lock

Each Division has one annual budget record containing all Sections within that Division.

After the Budget Officer verifies the NJSS figures against the signed and stamped approved document, the Budget Officer locks that Division budget.

A locked Division budget is immutable. Original budget figures cannot be edited after lock. Any later financial change must be recorded as a supplementary adjustment or Registrar-authorised reallocation.

Division budgets are locked independently. Other Divisions may remain in draft while completed Divisions are already locked.

### 2.4 Annual activation

The annual budget cannot become active until all required Division budgets are locked.

Once all required Divisions are locked, the Registrar's Office issues formal advice or correspondence instructing that the annual budget be activated.

The Budget Officer records or uploads that authority and activates the financial year in NJSS.

Only an `ACTIVE` annual budget may be used for FF3 budget checks, commitments, FF4 processing, and authoritative budget reporting.

Activation does not alter figures. It makes the already locked approved figures operational.

## 3. Core Budget Structure

The operational budget hierarchy is:

`Financial Year -> Division -> Section -> Standard Ledger -> Approved Amount`

Each Division has one annual budget record for a financial year. That Division record contains all of its Sections.

All Divisions and Sections use the same standard NJSS ledger master. A ledger code such as Travel, Accommodation, Office Equipment Maintenance, Software Maintenance, Fuel, or Repairs is not restricted to one Division or Section.

The same ledger code may therefore appear against many Sections, each with its own budget amount.

The authoritative budget-control key is:

`Financial Year + Division + Section + Ledger`

Example:

- FY2027 / Corporate Services / ICT / Travel = K40,000
- FY2027 / Corporate Services / HR / Travel = K25,000
- FY2027 / Finance / Accounts / Travel = K30,000

The ledger is common; the Section-owned budget amount is distinct.

## 4. Simplified Budget Entry

The new budget-entry experience must remove the existing unnecessary complexity from the preparation side.

The Budget Officer should not be required to enter or maintain the following fields as part of original annual budget capture:

- monthly allocations;
- quantity and unit cost calculations;
- procurement method;
- priority level;
- funding source for normal annual budget capture;
- activity template;
- responsible officer;
- business justification;
- province;
- project/portfolio;
- user-driven submission/review/approval workflow.

The main entry experience should contain:

### Budget header

- Financial Year
- Division
- Status
- optional reference number
- date received or approval date where relevant
- entered by
- entered at

### Section budget grid

- Section
- Ledger Code
- Ledger Description
- Approved Amount

The system automatically calculates:

- Section total
- Division total
- NJSS Head Office annual total

Only used ledger lines need to be stored. Unused zero-value ledger lines do not need operational budget-line records.

## 5. Budget Lifecycle and States

### 5.1 Division budget states

- `DRAFT`
- `LOCKED`

`DRAFT` allows Budget Officer edits and draft reporting.

`LOCKED` means the signed/stamped approved source document has been verified and attached and the original budget is immutable.

### 5.2 Annual budget states

- `PREPARATION`
- `READY_FOR_ACTIVATION`
- `ACTIVE`
- `CLOSED`

`READY_FOR_ACTIVATION` is reached only when all required Division budgets are locked.

`ACTIVE` is reached only when the Budget Officer processes activation following formal advice from the Registrar's Office.

## 6. Document Control

Budget record keeping is document-centric.

The official approved source document is the Registrar-signed and stamped budget document. The working spreadsheet may also be retained, but the signed/stamped approved document is the authoritative documentary evidence for the original budget.

NJSS will use a private Supabase Storage bucket dedicated to budget documents. A suitable bucket name is:

`njss-budget-documents`

The bucket must not be public.

Suggested logical storage structure:

`FY2027/<division>/original/`

`FY2027/<division>/supplementary/`

`FY2027/<division>/reallocations/`

The database stores metadata and the storage object path, not the binary content in database tables.

Document metadata should include:

- document type;
- financial year;
- Division where applicable;
- reference number if available;
- correspondence/approval date;
- description;
- storage path;
- original filename;
- MIME type;
- uploaded by;
- uploaded at;
- version or supersession relationship where required.

The original approved document must be present before a Division can be locked.

After lock, the official source document must not be silently replaced. If a corrected official document is later received, the existing version remains in history and the corrected document is added as a new controlled version with a reason and timestamp.

The same document repository supports:

- original approved budget documents;
- working spreadsheets where retained;
- supplementary budget authorities;
- Registrar reallocation correspondence;
- annual activation advice;
- other formal Registrar correspondence used as budget authority.

## 7. Original Budget Immutability

Once a Division budget is locked, its original amounts are immutable.

The original annual budget remains permanently reportable as the approved baseline.

Later changes must never overwrite the original amount. They are recorded separately as financial events.

The current approved position is calculated as:

`Original Budget + Supplementary Adjustments + Reallocation In - Reallocation Out = Current Approved Budget`

The available position is calculated as:

`Current Approved Budget - Outstanding Commitments - Actual Expenditure = Available Budget`

## 8. Supplementary Budget

A supplementary budget is a separate adjustment transaction entered by the Budget Officer from approved official authority.

It does not overwrite the original budget.

Each supplementary adjustment records at minimum:

- transaction number;
- financial year;
- Division;
- Section;
- ledger;
- adjustment amount;
- authority reference where available;
- supporting document;
- reason/description;
- entered by;
- entered at.

The supplementary adjustment changes the current approved budget but leaves the original approved budget unchanged.

## 9. Budget Reallocation Governance

### 9.1 Authority model

The Division Director may request or recommend a budget reallocation when a Section or ledger has insufficient funds.

The Registrar is the sole and final authority for approving a budget reallocation.

No Deputy Registrar, Division Director, Budget Officer, System Administrator, or other role may approve a reallocation merely by virtue of their system role.

The Registrar may authorise movement of funds:

- between ledger lines;
- between Sections within a Division;
- between different Divisions.

The Registrar does not require consent from the source Division Director. Registrar authority is overriding.

Formal correspondence from the Registrar's Office, such as a signed letter, memo, or other official instruction, is sufficient authority for the Budget Officer to progress the reallocation.

### 9.2 Execution model

The Registrar approves the reallocation.

The Budget Officer executes the approved movement in NJSS.

The Budget Officer cannot execute an unapproved reallocation.

The reallocation must be stored as one linked transaction containing both source and destination sides.

The database operation must be atomic: both source and destination movements succeed together or neither is posted.

### 9.3 Protected source balance

A reallocation may use only genuinely available funds.

The system must reject a reallocation that would reduce the source below protected commitments or actual expenditure.

Therefore:

`Reallocation Amount <= Source Available Budget`

Committed and spent amounts cannot be reallocated away.

### 9.4 Reallocation audit record

A reallocation records at minimum:

- reallocation number;
- financial year;
- reason;
- requesting Division/Director where applicable;
- Registrar authority reference;
- Registrar authority document;
- Registrar approval date;
- source Division;
- source Section;
- source ledger;
- destination Division;
- destination Section;
- destination ledger;
- transfer amount;
- Budget Officer who executed it;
- execution timestamp.

## 10. FF3 Budget Control

The existing FF3 budget-control engine should be adapted rather than replaced wholesale.

The budget check must resolve against the authoritative active position for:

`Financial Year + Division + Section + Ledger`

### 10.1 Sufficient budget

If the requested amount is within available budget, the FF3 follows the normal workflow and may create a commitment at the appropriate control point.

### 10.2 Insufficient budget

If the FF3 exceeds available budget, NJSS must warn the requester immediately and calculate the shortfall.

The requisition may still enter management review so the Line Manager and Division Director can consider the business requirement.

However, the FF3 is marked with a separate budget-control state:

`INSUFFICIENT_BUDGET_BLOCKED`

while its workflow status can independently show where it is in the approval chain.

Example:

- Workflow Status: WITH LINE MANAGER
- Budget Status: INSUFFICIENT BUDGET - BLOCKED
- Requested: K8,000
- Available: K5,000
- Shortfall: K3,000
- Commitment Created: NO

### 10.3 Officer actions

The requester sees the warning and cannot override the budget ceiling.

The Line Manager sees the warning and may:

- return the FF3 for reduction/correction;
- reduce quantities/value where workflow rules allow;
- recommend continuation for higher consideration.

The Division Director sees the warning and may:

- return or reduce the request;
- initiate a budget reallocation request where the expenditure remains necessary.

Neither Line Manager nor Division Director may override the budget ceiling or directly commit an unfunded FF3.

### 10.4 Commitment rule

No commitment is created while the FF3 is budget-blocked.

Only when the effective available budget is sufficient may the financial commitment be established.

If a Registrar-approved reallocation or supplementary adjustment later makes sufficient funds available, NJSS reruns the budget check and clears the block without requiring the user to recreate the FF3.

## 11. FF4 and Actual Expenditure

FF4 and payment processing continue to use the existing NJSS financial-control engine, but budget availability must reconcile to the same authoritative budget-position source used by FF3.

Actual expenditure reduces available budget according to the existing payment/commitment rules.

The redesign must not introduce separate budget-position calculations in FF3, FF4, reports, and reallocation validation. They must all use one authoritative calculation service or secured database view/function.

## 12. Authoritative Budget Position

Introduce a single authoritative budget-position layer, implemented as a secured view, function, or equivalent service.

A proposed logical name is:

`v_current_budget_position`

For each Financial Year + Division + Section + Ledger it must expose at least:

- original budget;
- supplementary adjustments;
- reallocations in;
- reallocations out;
- current approved budget;
- outstanding commitments;
- actual expenditure;
- available budget;
- active/locked status context.

This source becomes authoritative for:

- FF3 availability checks;
- FF4/payment reconciliation;
- reallocation validation;
- management reporting;
- budget dashboards;
- audit reporting.

## 13. Permissions and Segregation of Duties

Introduce or rationalise permissions around the simplified business functions.

Expected permissions include:

- `budget.view`
- `budget.capture`
- `budget.lock`
- `budget.activate`
- `budget.supplementary.enter`
- `budget.reallocation.request`
- `budget.reallocation.approve`
- `budget.reallocation.execute`
- `budget.documents.manage`
- `budget.report`

Role intent:

- Budget Officer: capture, edit drafts, upload documents, lock verified Division budgets, enter supplementary adjustments, execute approved reallocations, activate annual budget when formally advised.
- Division Director: request/recommend reallocation.
- Registrar: sole holder of reallocation approval authority.
- Other authorised finance/management users: view/report according to assigned permissions.

The System Administrator may maintain the application technically but must not automatically gain Registrar financial authority.

Database/RPC enforcement must protect these controls; UI hiding alone is insufficient.

## 14. Proposed Data Model

The implementation should introduce a simplified capture layer without immediately deleting the existing budget tables.

Recommended logical structures:

### Annual cycle

`annual_budget_cycles`

Fields conceptually include:

- id;
- financial_year;
- status;
- activation authority document/reference;
- activated_by;
- activated_at;
- created_at;
- updated_at.

### Division budget header

`division_budgets`

Fields conceptually include:

- id;
- annual_budget_cycle_id;
- financial_year;
- division_id;
- status;
- optional reference;
- approval date;
- entered_by;
- entered_at;
- locked_by;
- locked_at;
- created_at;
- updated_at.

Enforce one original Division budget per Financial Year + Division.

### Division budget lines

`division_budget_lines`

Fields conceptually include:

- id;
- division_budget_id;
- section_id;
- expense_ledger_id;
- original_amount;
- created_at;
- updated_at.

Enforce uniqueness within the original budget for Section + Ledger.

### Budget documents

`budget_documents`

Fields conceptually include:

- id;
- financial_year;
- division_budget_id where applicable;
- related_entity_type;
- related_entity_id;
- document_type;
- reference_number;
- document_date;
- description;
- storage_bucket;
- storage_path;
- original_filename;
- mime_type;
- version_number;
- supersedes_document_id;
- uploaded_by;
- uploaded_at.

### Supplementary adjustments

`budget_supplementary_adjustments`

Stores approved supplementary events without modifying original budget lines.

### Reallocations

`budget_reallocations`

Stores reallocation header, authority, approval and execution status.

`budget_reallocation_lines` or explicit source/destination fields store both sides of the movement.

The final physical schema may use project conventions already established in NJSS; table names above describe responsibilities rather than requiring exact names.

## 15. Screen Design

### 15.1 Annual Budget dashboard

Show each Division, status, amount and year-level readiness.

Example columns:

- Division
- Status
- Total
- Official Document
- Locked Date

Show Head Office total and annual budget state.

### 15.2 Division Budget Entry

Header:

- Financial Year
- Division
- status
- official document status

Grid grouped by Section with columns:

- Ledger
- Description
- Amount

Show Section totals and Division total.

Actions while Draft:

- Save Draft
- Print/Export Draft
- Upload Documents
- Lock Division

Lock action must validate the required official approved document and other mandatory conditions.

### 15.3 Budget Adjustments

Provide separate functions for:

- Supplementary Budget
- Reallocation

Show original, supplementary, reallocation in/out, current approved, committed, actual and available amounts.

### 15.4 Annual Budget Activation

Display:

- all required Divisions and lock status;
- Head Office total;
- Registrar activation authority reference/document;
- activation action available to authorised Budget Officer only when readiness conditions pass.

### 15.5 FF3 budget panel

Make budget position prominent:

- current approved budget;
- commitments;
- actual expenditure;
- available budget;
- current FF3 request;
- projected shortfall/remaining balance;
- budget-control state.

Do not allow requesters to create new finance/ledger codes from the FF3 screen. Ledger codes come from centrally maintained master data.

## 16. Migration and Compatibility Strategy

Do not immediately delete or destructively rewrite the existing budget tables.

The existing implementation currently supports complex budget submissions, monthly allocations, revisions, releases, funding, reporting, FF3 and FF4 integration. Removing those structures prematurely creates unnecessary regression risk.

Use a staged migration:

1. Add the simplified capture tables and document controls.
2. Add the authoritative current-budget-position layer.
3. Build the new Budget Entry UI.
4. Implement Division locking and annual activation.
5. Implement supplementary budgets and reallocation workflow.
6. Adapt FF3 to the new budget position and blocked-insufficient-budget behaviour.
7. Reconcile FF4 and reporting to the same authoritative position.
8. Run UAT with representative Head Office budgets.
9. Retire the old Budget Template navigation only after the new flow is proven.
10. Retain legacy data/tables until dependencies are formally reconciled and archival/removal is separately approved.

## 17. Required UAT Scenarios

The implementation is not complete until at least the following scenarios pass:

1. Budget Officer creates a financial-year Division draft.
2. One Division record contains multiple Sections.
3. Multiple Sections use the same standard ledger code independently.
4. Draft figures can be edited repeatedly.
5. Draft Division/Head Office totals calculate correctly.
6. Draft budget can be printed/exported for review.
7. Official signed/stamped Registrar-approved document can be uploaded.
8. Division cannot be locked without required official document evidence.
9. Budget Officer locks a verified Division.
10. Locked original figures cannot be edited.
11. Locked official source document cannot be silently replaced.
12. Other Divisions can remain Draft while one Division is Locked.
13. Annual budget cannot become Ready for Activation while required Divisions remain Draft.
14. All required Divisions lock successfully.
15. Registrar activation advice can be recorded/uploaded.
16. Budget Officer activates the annual budget.
17. Only Active annual budget is used for FF3 budget control.
18. FF3 resolves the correct Financial Year + Division + Section + Ledger position.
19. Sufficient-budget FF3 proceeds normally.
20. Insufficient-budget FF3 is allowed into management review but creates no commitment.
21. Requester sees available amount and shortfall.
22. Line Manager sees the same budget warning.
23. Division Director sees the same budget warning.
24. Director can request a reallocation.
25. Non-Registrar user cannot approve a reallocation.
26. Registrar can approve a reallocation.
27. Budget Officer cannot execute a reallocation before Registrar approval.
28. Official Registrar correspondence can be attached as authority.
29. Budget Officer executes approved reallocation.
30. Cross-Division reallocation is supported.
31. Reallocation cannot exceed source available balance.
32. Source commitments and actual expenditure remain protected.
33. Reallocation posts source and destination atomically.
34. Blocked FF3 automatically becomes fundable after sufficient reallocation.
35. Supplementary adjustment increases the correct Section/Ledger current budget.
36. Supplementary adjustment does not alter original budget history.
37. FF4/payment reduces the correct available position.
38. Original, current approved, committed, actual and available figures reconcile in reports.
39. Historical original budget remains unchanged after all later events.
40. Role/permission tests prove only Registrar can approve reallocations.

## 18. Non-Goals

This redesign does not attempt to:

- create a national/provincial budget-entry process;
- make Divisions electronically submit their original budgets through NJSS;
- reproduce the external budget-approval meeting inside NJSS;
- allow managers to override insufficient-budget controls;
- allow the Deputy Registrar to approve reallocations;
- allow System Administrators to inherit Registrar budget authority;
- discard legacy budget structures before dependencies are proven safe to retire.

## 19. Success Criteria

The redesign is successful when:

- budget preparation in NJSS is simple enough for one Budget Officer to manage all Head Office Divisions;
- the original Registrar-approved budget remains permanently auditable;
- each Section has an independently controlled balance against standard ledger codes;
- FF3 and FF4 use the same authoritative budget position;
- insufficient-budget requisitions can be reviewed but cannot create commitments until funded;
- Registrar-only reallocation authority is enforced in the database and UI;
- Budget Officer execution is fully auditable;
- supplementary and reallocation events never overwrite original approved figures;
- existing financial controls continue to operate without regression.
